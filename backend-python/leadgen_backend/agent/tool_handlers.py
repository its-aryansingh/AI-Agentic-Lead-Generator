"""
Tool handlers — concrete implementations of each chat tool.

Mirrors lib/agent/tool-handlers.ts. Each handler receives the tool input
params plus a ToolContext (user_id, session_id) injected server-side.
Handlers never receive these from the model — they come from auth.
"""
from __future__ import annotations

import os
import uuid
import json
from datetime import UTC, datetime
from typing import Any

from leadgen_backend.config import Settings
from leadgen_backend.supabase_rest import SupabaseRest
from leadgen_backend.providers.brave_search import discover_prospects
from leadgen_backend.providers.anthropic_client import draft_for_prospect, draft_reply_response
from leadgen_backend.providers.github import search_github_users
from leadgen_backend.providers.hn_algolia import search_hn_users
from leadgen_backend.providers.producthunt import search_producthunt_makers
from leadgen_backend.email_compliance import make_unsub_token, append_compliance_footer, sha256_email


# ---- helpers ---------------------------------------------------------------

async def _get_or_set_cache(
    supabase: SupabaseRest,
    key: str,
    ttl_seconds: int,
    fetch_fn,
) -> Any:
    cached = await supabase.get_cached(key)
    if cached is not None:
        return cached
    value = await fetch_fn()
    await supabase.set_cache(key, value, ttl_seconds)
    return value


# ---- web_search ------------------------------------------------------------

async def handle_web_search(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
) -> dict[str, Any]:
    cache_key = f"brave:{params['query']}:{params.get('max_results', 15)}"

    async def fetch():
        return await discover_prospects(params)

    candidates = await _get_or_set_cache(supabase, cache_key, 7 * 86_400, fetch)
    if not candidates:
        candidates = []

    inserted: list[dict[str, Any]] = []
    if candidates:
        rows = [
            {
                "session_id": ctx["session_id"],
                "source": c.get("source", "brave"),
                "source_ref": c.get("source_url"),
                "preview": c,
            }
            for c in candidates
        ]
        result = await supabase.insert_prospect_candidates(rows)
        if result:
            inserted = result

    return {
        "count": len(candidates),
        "candidates": inserted if inserted else candidates,
        "using_mock_data": bool(candidates and candidates[0].get("source") == "mock"),
    }


# ---- public_source_search --------------------------------------------------

async def handle_public_source_search(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
) -> dict[str, Any]:
    source = params.get("source", "")
    query = params.get("query", "")
    max_results = params.get("max_results", 15)

    candidates: list[dict[str, Any]] = []

    if source == "github":
        cache_key = f"github:{query}:{max_results}"
        candidates = await _get_or_set_cache(
            supabase, cache_key, 7 * 86_400,
            lambda: search_github_users(query, max_results),
        )
    elif source == "hn_algolia":
        cache_key = f"hn:{query}:{max_results}"
        candidates = await _get_or_set_cache(
            supabase, cache_key, 86_400,
            lambda: search_hn_users(query, max_results),
        )
    elif source == "producthunt":
        cache_key = f"producthunt:{query}:{max_results}"
        candidates = await _get_or_set_cache(
            supabase, cache_key, 86_400,
            lambda: search_producthunt_makers(query, max_results),
        )
    else:
        return {"count": 0, "candidates": [], "error": f"Unknown source: {source}"}

    if not candidates:
        candidates = []

    inserted: list[dict[str, Any]] = []
    if candidates:
        rows = [
            {
                "session_id": ctx["session_id"],
                "source": source,
                "source_ref": c.get("source_url"),
                "preview": c,
            }
            for c in candidates
        ]
        result = await supabase.insert_prospect_candidates(rows)
        if result:
            inserted = result

    return {
        "count": len(candidates),
        "candidates": inserted if inserted else candidates,
        "using_mock_data": bool(candidates and candidates[0].get("source") == "mock"),
    }


# ---- enrich_prospect -------------------------------------------------------

async def handle_enrich_prospect(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
) -> dict[str, Any]:
    name = params.get("name", "")
    company = params.get("company", "")

    # Fetch user's voice anchor for email personalization
    user_profile = await supabase.get_profile(ctx["user_id"])
    voice_anchor = user_profile.get("voice_anchor_text") if user_profile else None

    # Search snippet from Brave for context
    cache_key = f"brave-enrich:{name}:{company}"

    async def fetch_snippet():
        results = await discover_prospects({
            "query": f"{name} {company} site:linkedin.com/in",
            "max_results": 3,
        })
        return results

    snippet_results = await _get_or_set_cache(supabase, cache_key, 7 * 86_400, fetch_snippet)
    snippet = snippet_results[0].get("snippet", "") if snippet_results else ""

    draft = await draft_for_prospect({
        "prospect": {
            "name": name,
            "company": company,
            "title": params.get("title", ""),
            "location": "",
            "snippet": snippet,
        },
        "voiceAnchor": voice_anchor,
    })

    return {
        "name": name,
        "company": company,
        "linkedin_url": params.get("linkedin_url"),
        "research_summary": draft.get("research_summary", ""),
        "email_subject": draft.get("email_subject", ""),
        "email_body": draft.get("email_body", ""),
        "talking_points": draft.get("talking_points", []),
        "using_mock_data": not bool(os.getenv("ANTHROPIC_API_KEY")),
    }


# ---- clarify_question ------------------------------------------------------

async def handle_clarify(
    params: dict[str, Any],
    _ctx: dict[str, str],
    _settings: Settings,
    _supabase: SupabaseRest,
) -> dict[str, Any]:
    return {
        "question": params.get("question", ""),
        "suggested_answers": params.get("suggested_answers", []),
    }


# ---- add_named_prospects ----------------------------------------------------

async def handle_add_named_prospects(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
) -> dict[str, Any]:
    prospects = params.get("prospects", [])

    rows = [
        {
            "session_id": ctx["session_id"],
            "source": "user_named",
            "source_ref": None,
            "preview": p,
        }
        for p in prospects
    ]
    inserted = await supabase.insert_prospect_candidates(rows)

    return {
        "count": len(prospects),
        "staged": True,
        "candidate_ids": [r.get("id") for r in (inserted or []) if r.get("id")],
        "prospects": prospects,
    }


# ---- start_bulk_job ---------------------------------------------------------

async def handle_start_bulk_job(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
) -> dict[str, Any]:
    candidate_ids: list[str] | None = params.get("candidate_ids")

    # Load candidates from this session if no IDs given
    if candidate_ids:
        candidates_raw = await supabase.get_candidates_by_ids(candidate_ids)
    else:
        candidates_raw = await supabase.get_session_candidates(ctx["session_id"])

    candidates = candidates_raw or []

    if not candidates:
        return {"error": "No candidates found. Run web_search first, then confirm scope."}

    # Credits check
    n = len(candidates)
    credit_check = await supabase.check_credits(ctx["user_id"], n)
    if not credit_check.get("ok"):
        return {
            "error": f"Insufficient credits. Need {n}, have {credit_check.get('remaining', 0)}. Upgrade at Settings → Billing."
        }

    # Create job record
    user_profile = await supabase.get_profile(ctx["user_id"])
    voice_anchor = user_profile.get("voice_anchor_text") if user_profile else None

    job_result = await supabase.create_job(
        user_id=ctx["user_id"],
        session_id=ctx["session_id"],
        prospect_count=n,
    )
    if not job_result or not job_result.get("id"):
        return {"error": "Failed to create job record."}

    job_id = job_result["id"]

    # Enrich each candidate synchronously (up to 20; larger batches can be queued)
    enriched: list[dict[str, Any]] = []
    for c in candidates:
        preview = c.get("preview", c)
        try:
            draft = await draft_for_prospect({
                "prospect": {
                    "name": preview.get("name", ""),
                    "company": preview.get("company", ""),
                    "title": preview.get("title", ""),
                    "location": preview.get("location", ""),
                    "snippet": preview.get("snippet", ""),
                },
                "voiceAnchor": voice_anchor,
            })

            domain = preview.get("company_domain") or ""
            email = preview.get("email") or ""
            email_confidence = "unknown"
            if not email and domain:
                # Try basic pattern guess
                name_parts = (preview.get("name") or "").lower().split()
                if name_parts and domain:
                    first = name_parts[0]
                    last = name_parts[-1] if len(name_parts) > 1 else ""
                    email = f"{first}.{last}@{domain}" if last else f"{first}@{domain}"
                    email_confidence = "risky"

            prospect_row = {
                "job_id": job_id,
                "user_id": ctx["user_id"],
                "input_name": preview.get("name", ""),
                "input_company": preview.get("company", ""),
                "input_linkedin_url": preview.get("linkedin_url") or preview.get("source_url"),
                "email": email,
                "email_confidence": email_confidence,
                "research_summary": draft.get("research_summary", ""),
                "email_subject": draft.get("email_subject", ""),
                "email_body": draft.get("email_body", ""),
                "talking_points": draft.get("talking_points", []),
                "stage": "prospect",
            }
            enriched.append(prospect_row)
        except Exception:
            pass

    # Insert all prospect rows
    if enriched:
        await supabase.insert_prospects(enriched)

    # Deduct credits
    await supabase.deduct_credits(ctx["user_id"], len(enriched))

    # Generate CSV download URL
    csv_url = f"/api/export/csv?jobId={job_id}"

    # Try Google Sheets export if user has refresh token
    sheet_url = None
    try:
        if user_profile and user_profile.get("google_refresh_token"):
            from leadgen_backend.export_sheets import export_to_sheet
            from datetime import datetime, UTC
            title = f"LeadGenAI — Job {job_id[:8]} — {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')}"
            sheet_result = await export_to_sheet(
                user_profile["google_refresh_token"],
                title,
                enriched,
            )
            sheet_url = sheet_result.get("url")
            await supabase.update_job_sheet(job_id, sheet_url)
    except Exception:
        pass

    # Mark job complete
    await supabase.update_job_status(job_id, "completed", len(enriched))

    return {
        "job_id": job_id,
        "prospect_count": len(enriched),
        "csv_url": csv_url,
        "sheet_url": sheet_url,
        "using_mock_data": not bool(os.getenv("ANTHROPIC_API_KEY")),
    }


# ---- launch_campaign --------------------------------------------------------

async def handle_launch_campaign(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
) -> dict[str, Any]:
    job_id = params.get("job_id")
    channel = params.get("channel", "email")

    # Resolve job_id — default to most recent completed job
    if not job_id:
        recent = await supabase.get_latest_completed_job(ctx["user_id"])
        if not recent:
            return {"error": "No completed job found. Run a bulk enrichment first."}
        job_id = recent["id"]

    # Load prospects for this job
    prospects = await supabase.get_job_prospects(job_id, ctx["user_id"])
    if not prospects:
        return {"error": "No prospects found for this job."}

    if channel == "whatsapp":
        return await _launch_whatsapp_campaign(params, ctx, settings, supabase, prospects, job_id)

    return await _launch_email_campaign(params, ctx, settings, supabase, prospects, job_id)


async def _launch_email_campaign(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
    prospects: list[dict[str, Any]],
    job_id: str,
) -> dict[str, Any]:
    mailbox_id = params.get("mailbox_id")

    # Get user's active mailbox
    if mailbox_id:
        mailbox_rows = await supabase._get("mailboxes", {"id": f"eq.{mailbox_id}", "user_id": f"eq.{ctx['user_id']}", "select": "id,email_address,oauth_refresh_token,status,warmup_started_at,physical_address"})
    else:
        mailbox_rows = await supabase._get("mailboxes", {"user_id": f"eq.{ctx['user_id']}", "status": "eq.active", "select": "id,email_address,oauth_refresh_token,status,warmup_started_at,physical_address", "limit": "1"})

    if not mailbox_rows:
        return {"error": "No active mailbox found. Connect a Gmail mailbox at Settings → Mailboxes first."}

    mailbox = mailbox_rows[0]

    # Load suppression list
    unsub_hashes = await supabase.get_suppression_hashes(ctx["user_id"])
    suppressed = set(unsub_hashes or [])

    # Create campaign record
    campaign_result = await supabase.create_campaign(
        user_id=ctx["user_id"],
        name=params.get("name", f"Campaign {datetime.now(UTC).strftime('%Y-%m-%d')}"),
        job_id=job_id,
        mailbox_id=mailbox["id"],
        sequence_id=params.get("sequence_id"),
    )
    if not campaign_result:
        return {"error": "Failed to create campaign record."}

    campaign_id = campaign_result["id"]

    # Queue recipients
    physical_address = mailbox.get("physical_address") or "123 Main St, City, Country"
    queued = 0
    skipped_suppressed = 0
    skipped_no_email = 0

    for p in prospects:
        email = p.get("email", "").strip()
        if not email:
            skipped_no_email += 1
            continue
        if p.get("email_confidence") == "invalid":
            skipped_no_email += 1
            continue

        email_hash = sha256_email(email)
        if email_hash in suppressed:
            skipped_suppressed += 1
            continue

        unsub_token = make_unsub_token(email, ctx["user_id"])
        body_with_footer = append_compliance_footer(
            p.get("email_body", ""),
            unsubscribe_url=f"/u/{unsub_token}",
            physical_address=physical_address,
        )

        await supabase.insert_campaign_recipient({
            "campaign_id": campaign_id,
            "prospect_id": p.get("id"),
            "email": email,
            "subject": p.get("email_subject", ""),
            "body": body_with_footer,
            "status": "scheduled",
            "scheduled_for": datetime.now(UTC).isoformat(),
        })
        queued += 1

    return {
        "campaign_id": campaign_id,
        "queued": queued,
        "skipped_suppressed": skipped_suppressed,
        "skipped_no_email": skipped_no_email,
        "mailbox": mailbox.get("email_address"),
        "status": "Campaign scheduled. Emails will send within 15 minutes per your warm-up schedule.",
    }


async def _launch_whatsapp_campaign(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
    prospects: list[dict[str, Any]],
    job_id: str,
) -> dict[str, Any]:
    template = params.get("whatsapp_template")
    language = params.get("whatsapp_language", "en")

    if not template:
        return {"error": "whatsapp_template is required for WhatsApp campaigns (cold WhatsApp requires pre-approved templates)."}

    if not settings.whatsapp_api_url:
        return {
            "sent": 0,
            "error": None,
            "using_mock_data": True,
            "note": "WhatsApp not configured — set WHATSAPP_API_URL to enable real sends.",
        }

    from leadgen_backend.providers.whatsapp import send_whatsapp_template
    sent = 0
    failed = 0

    for p in prospects:
        phone = p.get("phone") or p.get("whatsapp_number")
        if not phone:
            failed += 1
            continue
        try:
            await send_whatsapp_template(
                to=phone,
                template_name=template,
                language_code=language,
                components=[{"type": "body", "parameters": [
                    {"type": "text", "text": (p.get("input_name") or "").split()[0] or "there"},
                    {"type": "text", "text": p.get("input_company") or "your company"},
                ]}],
            )
            sent += 1
        except Exception:
            failed += 1

    return {"sent": sent, "failed": failed, "channel": "whatsapp"}


# ---- push_to_crm ------------------------------------------------------------

async def handle_push_to_crm(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
) -> dict[str, Any]:
    job_id = params.get("job_id")
    crm = params.get("crm", "hubspot")
    include_note = params.get("include_note", True)

    if not job_id:
        recent = await supabase.get_latest_completed_job(ctx["user_id"])
        if not recent:
            return {"error": "No completed job found."}
        job_id = recent["id"]

    prospects = await supabase.get_job_prospects(job_id, ctx["user_id"])
    if not prospects:
        return {"error": "No prospects for this job."}

    # Filter valid emails (skip invalid confidence)
    valid = [p for p in prospects if p.get("email") and p.get("email_confidence") != "invalid"]
    valid = valid[:100]  # cap per call

    if crm == "hubspot":
        return await _push_to_hubspot(valid, include_note, settings)
    elif crm == "zoho":
        return await _push_to_zoho(valid, include_note, settings)
    else:
        return {"error": f"Unknown CRM: {crm}"}


async def _push_to_hubspot(
    prospects: list[dict[str, Any]],
    include_note: bool,
    settings: Settings,
) -> dict[str, Any]:
    hubspot_key = os.getenv("HUBSPOT_API_KEY")
    if not hubspot_key:
        return {
            "pushed": len(prospects), "created": 0, "updated": len(prospects),
            "failed": 0, "errors": [], "using_mock_data": True,
        }

    try:
        from leadgen_backend.providers.hubspot import push_hubspot_contact, add_hubspot_note
    except ImportError:
        return {"error": "HubSpot provider not available.", "using_mock_data": True}

    pushed = created = updated = failed = 0
    errors: list[str] = []

    for p in prospects:
        try:
            result = await push_hubspot_contact(p)
            pushed += 1
            if result.get("created"):
                created += 1
            else:
                updated += 1

            if include_note and result.get("contact_id"):
                note_body = f"Research: {p.get('research_summary', '')}\n\nDrafted email:\nSubject: {p.get('email_subject', '')}\n{p.get('email_body', '')}"
                await add_hubspot_note(result["contact_id"], note_body)
        except Exception as e:
            failed += 1
            if len(errors) < 10:
                errors.append(str(e))

    return {"pushed": pushed, "created": created, "updated": updated, "failed": failed, "errors": errors, "using_mock_data": False}


async def _push_to_zoho(
    prospects: list[dict[str, Any]],
    include_note: bool,
    settings: Settings,
) -> dict[str, Any]:
    zoho_configured = all([
        os.getenv("ZOHO_CLIENT_ID"),
        os.getenv("ZOHO_CLIENT_SECRET"),
        os.getenv("ZOHO_REFRESH_TOKEN"),
    ])
    if not zoho_configured:
        return {
            "pushed": len(prospects), "created": 0, "updated": len(prospects),
            "failed": 0, "errors": [], "using_mock_data": True,
        }

    try:
        from leadgen_backend.providers.zoho import push_zoho_contact, add_zoho_note
    except ImportError:
        return {"error": "Zoho provider not available.", "using_mock_data": True}

    pushed = created = updated = failed = 0
    errors: list[str] = []

    for p in prospects:
        try:
            result = await push_zoho_contact(p)
            pushed += 1
            if result.get("created"):
                created += 1
            else:
                updated += 1

            if include_note and result.get("contact_id"):
                note_body = f"Research: {p.get('research_summary', '')}\n\nDrafted email:\nSubject: {p.get('email_subject', '')}\n{p.get('email_body', '')}"
                await add_zoho_note(result["contact_id"], note_body)
        except Exception as e:
            failed += 1
            if len(errors) < 10:
                errors.append(str(e))

    return {"pushed": pushed, "created": created, "updated": updated, "failed": failed, "errors": errors, "using_mock_data": False}


# ---- draft_reply ------------------------------------------------------------

async def handle_draft_reply(
    params: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
) -> dict[str, Any]:
    reply_id = params.get("reply_classification_id")

    # Load reply classification with context
    reply_rows = await supabase._get(
        "reply_classifications",
        {
            "id": f"eq.{reply_id}",
            "select": "id,category,snippet,wants_meeting,campaign_recipient_id",
        },
        headers={"Authorization": f"Bearer {supabase.settings.supabase_service_role_key}"},
    )
    if not reply_rows:
        return {"error": "Reply not found."}

    reply = reply_rows[0]

    # Load recipient + prospect
    recipient_rows = await supabase._get(
        "campaign_recipients",
        {
            "id": f"eq.{reply['campaign_recipient_id']}",
            "select": "email,subject,body,prospect_id",
        },
        headers={"Authorization": f"Bearer {supabase.settings.supabase_service_role_key}"},
    )
    recipient = recipient_rows[0] if recipient_rows else {}

    prospect_rows = []
    if recipient.get("prospect_id"):
        prospect_rows = await supabase._get(
            "prospects",
            {
                "id": f"eq.{recipient['prospect_id']}",
                "select": "input_name,input_company,email",
            },
            headers={"Authorization": f"Bearer {supabase.settings.supabase_service_role_key}"},
        )
    prospect = prospect_rows[0] if prospect_rows else {}

    user_profile = await supabase.get_profile(ctx["user_id"])
    voice_anchor = user_profile.get("voice_anchor_text") if user_profile else None

    draft = await draft_reply_response({
        "prospect": {
            "name": prospect.get("input_name", ""),
            "company": prospect.get("input_company", ""),
        },
        "original_subject": recipient.get("subject", ""),
        "original_body": recipient.get("body", ""),
        "reply_snippet": reply.get("snippet", ""),
        "reply_category": reply.get("category", ""),
        "wants_meeting": reply.get("wants_meeting", False),
        "voiceAnchor": voice_anchor,
    })

    return {
        "subject": draft.get("subject", ""),
        "body": draft.get("body", ""),
        "next_step": draft.get("next_step", "wait_for_them"),
        "using_mock_data": not bool(os.getenv("ANTHROPIC_API_KEY")),
    }


# ---- dispatch ---------------------------------------------------------------

HANDLER_MAP = {
    "web_search": handle_web_search,
    "public_source_search": handle_public_source_search,
    "enrich_prospect": handle_enrich_prospect,
    "clarify_question": handle_clarify,
    "add_named_prospects": handle_add_named_prospects,
    "start_bulk_job": handle_start_bulk_job,
    "launch_campaign": handle_launch_campaign,
    "push_to_crm": handle_push_to_crm,
    "draft_reply": handle_draft_reply,
}


async def dispatch_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    ctx: dict[str, str],
    settings: Settings,
    supabase: SupabaseRest,
) -> dict[str, Any]:
    handler = HANDLER_MAP.get(tool_name)
    if not handler:
        return {"error": f"Unknown tool: {tool_name}"}
    try:
        return await handler(tool_input, ctx, settings, supabase)
    except Exception as e:
        return {"error": str(e), "tool": tool_name}
