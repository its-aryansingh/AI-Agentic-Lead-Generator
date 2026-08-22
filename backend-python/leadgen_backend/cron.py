from typing import Any
from datetime import datetime, UTC
import httpx

from leadgen_backend.config import Settings
from leadgen_backend.supabase_rest import SupabaseRest
from leadgen_backend.mailbox_rotation_core import pick_rotation_mailbox
from leadgen_backend.providers import (
    send_gmail, list_recent_inbound, classify_reply, needs_human,
    notify_push, notify_slack
)
from leadgen_backend.sequence_utils import hydrate_template
from leadgen_backend.email_warmup_core import daily_cap_for_mailbox
from leadgen_backend.email_compliance import append_compliance_footer, make_unsub_token, sha256_email

async def send_due(settings: Settings, supabase: SupabaseRest) -> dict[str, int]:
    campaigns = await supabase._get("campaigns", {"status": "eq.active", "select": "id,user_id,mailbox_id,daily_cap,send_window_start_hour,send_window_end_hour,mailbox_rotation", "limit": "100"})
    if not campaigns: return {"sent": 0}
    
    total_sent = 0
    now_hour = datetime.now(UTC).hour
    
    for c in campaigns:
        start_h = c.get("send_window_start_hour", 9)
        end_h = c.get("send_window_end_hour", 17)
        if now_hour < start_h or now_hour >= end_h:
            continue
            
        mb_cols = "id,email_address,oauth_refresh_token,daily_send_limit,daily_sent,last_reset_at,warmup_started_at,physical_address,status"
        mailbox = None
        
        if c.get("mailbox_rotation"):
            pool = await supabase._get("mailboxes", {"user_id": f"eq.{c['user_id']}", "status": "eq.active", "select": mb_cols, "limit": "20"})
            if not pool: continue
            
            candidates = []
            for m in pool:
                wu_dt = datetime.fromisoformat(m["warmup_started_at"].replace("Z", "+00:00"))
                candidates.append({
                    "id": m["id"],
                    "daily_sent": m.get("daily_sent", 0),
                    "effective_cap": min(
                        daily_cap_for_mailbox(wu_dt),
                        m.get("daily_send_limit", 10),
                        c.get("daily_cap", 30)
                    ),
                    "warmup_started_at_ms": wu_dt.timestamp() * 1000
                })
                
            choice = pick_rotation_mailbox(candidates)
            if not choice: continue
            for m in pool:
                if m["id"] == choice["id"]:
                    mailbox = m
                    break
        else:
            single = await supabase._get("mailboxes", {"id": f"eq.{c['mailbox_id']}", "select": mb_cols})
            if single: mailbox = single[0]
            
        if not mailbox or mailbox.get("status") != "active":
            continue
            
        daily_sent = mailbox.get("daily_sent", 0)
        last_reset = datetime.fromisoformat(mailbox["last_reset_at"].replace("Z", "+00:00"))
        
        if last_reset.date() != datetime.now(UTC).date():
            daily_sent = 0
            await supabase._patch("mailboxes", {"id": f"eq.{mailbox['id']}"}, {"daily_sent": 0, "last_reset_at": datetime.now(UTC).isoformat()})
            
        wu_dt = datetime.fromisoformat(mailbox["warmup_started_at"].replace("Z", "+00:00"))
        cap = min(daily_cap_for_mailbox(wu_dt), mailbox.get("daily_send_limit", 10), c.get("daily_cap", 30))
        remaining = max(0, cap - daily_sent)
        if remaining == 0: continue
        
        due_recs = await supabase._get("campaign_recipients", {
            "campaign_id": f"eq.{c['id']}",
            "status": "eq.scheduled",
            "scheduled_for": f"lte.{datetime.now(UTC).isoformat()}",
            "select": "id,email,subject,body",
            "limit": str(remaining)
        })
        if not due_recs: continue
        
        app_url = "http://localhost:3000"  # would come from settings in real life
        
        for r in due_recs:
            email_hash = sha256_email(r["email"])
            sup = await supabase._get("suppressions", {"user_id": f"eq.{c['user_id']}", "email_hash": f"eq.{email_hash}", "select": "email_hash"})
            if sup:
                await supabase._patch("campaign_recipients", {"id": f"eq.{r['id']}"}, {"status": "skipped"})
                continue
                
            unsub_token = make_unsub_token(r["id"], c["user_id"])
            body = append_compliance_footer(
                body=r["body"], 
                unsub_token=unsub_token, 
                physical_address=mailbox.get("physical_address"),
                app_url=app_url
            )
            
            try:
                sent_res = await send_gmail(
                    refresh_token=mailbox.get("oauth_refresh_token", ""),
                    from_addr=mailbox.get("email_address", ""),
                    to=r["email"],
                    subject=r["subject"],
                    body=body
                )
                await supabase._patch("campaign_recipients", {"id": f"eq.{r['id']}"}, {
                    "status": "sent", "sent_at": datetime.now(UTC).isoformat(),
                    "message_id": sent_res["messageId"], "thread_id": sent_res["threadId"]
                })
                await supabase._post("email_events", {
                    "recipient_id": r["id"], "user_id": c["user_id"], "event_type": "sent", "payload": {"mock": sent_res["mock"]}
                })
                daily_sent += 1
                total_sent += 1
            except Exception as e:
                await supabase._patch("campaign_recipients", {"id": f"eq.{r['id']}"}, {
                    "status": "failed", "bounce_reason": str(e)
                })
                await supabase._post("email_events", {
                    "recipient_id": r["id"], "user_id": c["user_id"], "event_type": "failed"
                })
                
        await supabase._patch("mailboxes", {"id": f"eq.{mailbox['id']}"}, {"daily_sent": daily_sent})
        
    return {"sent": total_sent}

async def detect_replies(settings: Settings, supabase: SupabaseRest) -> dict[str, int]:
    mailboxes = await supabase._get("mailboxes", {"status": "eq.active", "select": "id,user_id,oauth_refresh_token,status", "limit": "100"})
    processed = 0
    if not mailboxes: return {"processed": 0}
    
    for mb in mailboxes:
        try:
            inbound = await list_recent_inbound(mb.get("oauth_refresh_token", ""), 25)
        except Exception:
            continue
            
        for msg in inbound:
            if not msg.get("threadId"): continue
            
            recs = await supabase._get("campaign_recipients", {
                "thread_id": f"eq.{msg['threadId']}",
                "select": "id,campaign_id,prospect_id,email,status"
            })
            if not recs: continue
            rec = recs[0]
            
            if rec.get("status") in ("replied", "bounced", "unsubscribed"):
                continue
                
            if msg.get("isBounce"):
                await supabase._patch("campaign_recipients", {"id": f"eq.{rec['id']}"}, {
                    "status": "bounced", "bounce_reason": msg.get("snippet", "")[:280]
                })
                if rec.get("prospect_id"):
                    await supabase._patch("sequence_enrollments", {
                        "prospect_id": f"eq.{rec['prospect_id']}", "status": "eq.active"
                    }, {"status": "bounced"})
                
                await supabase._post("suppressions", {
                    "user_id": mb["user_id"], "email_hash": sha256_email(rec["email"]), "reason": "bounced"
                }, headers={"Prefer": "resolution=merge-duplicates"})
                
                await supabase._post("email_events", {
                    "recipient_id": rec["id"], "user_id": mb["user_id"], "event_type": "bounced"
                })
                processed += 1
                continue
                
            if msg.get("isAutoReply"):
                await supabase._post("email_events", {
                    "recipient_id": rec["id"], "user_id": mb["user_id"], "event_type": "auto_reply", "payload": {"snippet": msg.get("snippet", "")}
                })
                continue
                
            await supabase._patch("campaign_recipients", {"id": f"eq.{rec['id']}"}, {
                "status": "replied", "reply_at": datetime.now(UTC).isoformat()
            })
            
            if rec.get("prospect_id"):
                await supabase._patch("sequence_enrollments", {
                    "prospect_id": f"eq.{rec['prospect_id']}", "status": "eq.active"
                }, {"status": "completed"})
                
            await supabase._post("email_events", {
                "recipient_id": rec["id"], "user_id": mb["user_id"], "event_type": "replied", "payload": {"snippet": msg.get("snippet", "")}
            })
            
            classification = await classify_reply(msg.get("snippet", ""))
            cat = classification.get("category", "other")
            if cat == "unsubscribe":
                await supabase._post("suppressions", {
                    "user_id": mb["user_id"], "email_hash": sha256_email(rec["email"]), "reason": "unsubscribed"
                }, headers={"Prefer": "resolution=merge-duplicates"})
                
            is_hot = needs_human(cat)
            wants_meet = classification.get("wants_meeting", False)
            
            await supabase._post("reply_classifications", {
                "recipient_id": rec["id"], "user_id": mb["user_id"],
                "category": cat, "confidence": classification.get("confidence", 0.5),
                "snippet": msg.get("snippet", "")[:500], "needs_human": is_hot,
                "wants_meeting": wants_meet, "handled": False
            })
            
            if is_hot:
                await notify_push(mb["user_id"], {"title": f"New {cat} reply", "body": msg.get("snippet", "")[:240]}, supabase)
                await notify_slack(mb["user_id"], {"text": f"New {cat} reply"}, supabase)
            processed += 1
            
    return {"processed": processed}

async def advance_sequences(settings: Settings, supabase: SupabaseRest) -> dict[str, int]:
    # Placeholder for logic
    return {"processed": 0}

async def poll_intent(settings: Settings, supabase: SupabaseRest) -> dict[str, int]:
    return {"watches": 0, "triggers_written": 0}

async def run_automations(settings: Settings, supabase: SupabaseRest) -> dict[str, int]:
    return {"processed": 0}
