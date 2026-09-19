import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { listRecentInbound, classifyGmailError } from "@/lib/providers/gmail";
import { decryptCredential } from "@/lib/credential-crypto";
import { sha256Email } from "@/lib/email-compliance";
import { classifyReply, needsHuman } from "@/lib/reply-classify";
import {
  extractQualificationFacts,
  qualificationBucket,
  workflowForQualification,
} from "@/lib/qualification";
import { createLeadHandoff, deliverLeadHandoffNotifications } from "@/lib/unified-lead-handoff";
import { applyProspectTransition } from "@/lib/outreach/prospect-state-machine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const provided = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (
    process.env.NODE_ENV !== "production" &&
    (provided === "YOUR_CRON_SECRET" || !process.env.CRON_SECRET)
  ) {
    return true;
  }
  return (
    Boolean(process.env.CRON_SECRET) && provided === process.env.CRON_SECRET
  );
}

export async function POST(req: Request) {
  if (!authorized(req)) return new NextResponse("Forbidden", { status: 403 });
  const supabase = createAdminClient();
  const { data: mailboxes } = await supabase
    .from("mailboxes")
    .select("id,user_id,oauth_refresh_token_encrypted,status")
    .eq("status", "active")
    .limit(100);
  let processed = 0;

  for (const mb of mailboxes ?? []) {
    let inbound;
    try {
      inbound = await listRecentInbound({
        refreshToken: decryptCredential(
          mb.oauth_refresh_token_encrypted as string,
        ),
        maxResults: 50,
      });
    } catch (error) {
      const code = classifyGmailError(error);
      await supabase
        .from("mailboxes")
        .update({
          status: code === "auth" ? "reconnect_required" : "error",
          last_error_code: code,
          last_error_message:
            code === "auth"
              ? "Google authorization expired or was revoked"
              : "Gmail reply polling failed",
        })
        .eq("id", mb.id)
        .eq("user_id", mb.user_id);
      continue;
    }

    for (const msg of inbound) {
      if (!msg.threadId || !msg.id) continue;
      const { data: recipient } = await supabase
        .from("campaign_recipients")
        .select(
          "id,campaign_id,prospect_id,email,status,campaigns!inner(mailbox_id)",
        )
        .eq("thread_id", msg.threadId)
        .eq("user_id", mb.user_id)
        .eq("campaigns.mailbox_id", mb.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!recipient) continue;
      const kind = msg.isBounce
        ? "bounce"
        : msg.isAutoReply
          ? "auto_reply"
          : "reply";
      const { data: claim, error: claimError } = await supabase
        .from("gmail_inbound_events")
        .insert({
          mailbox_id: mb.id,
          user_id: mb.user_id,
          recipient_id: recipient.id,
          provider_message_id: msg.id,
          provider_thread_id: msg.threadId,
          event_kind: kind,
        })
        .select("id,processed_at")
        .single();

      let claimId = claim?.id;
      if (claimError) {
        if (claimError.code === "23505") {
          const { data: existing } = await supabase
            .from("gmail_inbound_events")
            .select("id,processed_at")
            .eq("mailbox_id", mb.id)
            .eq("user_id", mb.user_id)
            .eq("provider_message_id", msg.id)
            .maybeSingle();
          if (existing?.processed_at) {
            continue;
          }
          claimId = existing?.id;
        } else {
          continue;
        }
      }
      if (!claimId) continue;

      if (msg.isBounce) {
        await supabase
          .from("campaign_recipients")
          .update({
            status: "bounced",
            bounce_reason: msg.snippet.slice(0, 280),
          })
          .eq("id", recipient.id)
          .eq("user_id", mb.user_id);
        if (recipient.prospect_id) {
          await applyProspectTransition(supabase, { userId: String(mb.user_id), prospectId: String(recipient.prospect_id), event: "disqualified", actor: "system", source: "gmail_reply", sourceId: msg.id });
          await supabase
            .from("sequence_enrollments")
            .update({ status: "bounced" })
            .eq("user_id", mb.user_id)
            .eq("prospect_id", recipient.prospect_id)
            .eq("status", "active");
          await supabase
            .from("campaign_recipients")
            .update({ status: "skipped" })
            .eq("user_id", mb.user_id)
            .eq("prospect_id", recipient.prospect_id)
            .eq("status", "scheduled");
          await supabase.from("outreach_run_items").update({ status: "cancelled", skip_reason: "email_bounced", completed_at: new Date().toISOString() })
            .eq("user_id", mb.user_id).eq("prospect_id", recipient.prospect_id).eq("status", "pending");
          await supabase
            .from("prospects")
            .update({
              next_action: "none",
              qualification_bucket: "disqualified",
            })
            .eq("id", recipient.prospect_id)
            .eq("user_id", mb.user_id);
        }
        await supabase.from("suppressions").upsert(
          {
            user_id: mb.user_id,
            email_hash: sha256Email(recipient.email as string),
            reason: "bounced",
          },
          { onConflict: "user_id,email_hash" },
        );
        await supabase.from("email_events").insert({
          recipient_id: recipient.id,
          user_id: mb.user_id,
          event_type: "bounced",
          payload: { provider_message_id: msg.id },
        });
        await supabase
          .from("gmail_inbound_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", claimId)
          .eq("user_id", mb.user_id);
        processed++;
        continue;
      }

      if (msg.isAutoReply) {
        await supabase.from("email_events").insert({
          recipient_id: recipient.id,
          user_id: mb.user_id,
          event_type: "auto_reply",
          payload: { snippet: msg.snippet, provider_message_id: msg.id },
        });
        await supabase
          .from("gmail_inbound_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", claimId)
          .eq("user_id", mb.user_id);
        processed++;
        continue;
      }

      const classification = await classifyReply({
        userId: String(mb.user_id),
        body: msg.snippet,
      });
      const unsubscribed = classification.category === "unsubscribe";
      await supabase
        .from("campaign_recipients")
        .update({
          status: unsubscribed ? "unsubscribed" : "replied",
          reply_at: new Date().toISOString(),
        })
        .eq("id", recipient.id)
        .eq("user_id", mb.user_id);
      if (recipient.prospect_id) {
        await applyProspectTransition(supabase, { userId: String(mb.user_id), prospectId: String(recipient.prospect_id), event: unsubscribed ? "unsubscribed" : "email_replied", actor: "system", source: "gmail_reply", sourceId: msg.id });
        await supabase
          .from("sequence_enrollments")
          .update({ status: unsubscribed ? "unsubscribed" : "completed" })
          .eq("user_id", mb.user_id)
          .eq("prospect_id", recipient.prospect_id)
          .eq("status", "active");
        await supabase
          .from("campaign_recipients")
          .update({ status: "skipped" })
          .eq("user_id", mb.user_id)
          .eq("prospect_id", recipient.prospect_id)
          .eq("status", "scheduled");
        await supabase.from("outreach_run_items").update({ status: "cancelled", skip_reason: unsubscribed ? "unsubscribed" : "email_replied", completed_at: new Date().toISOString() })
          .eq("user_id", mb.user_id).eq("prospect_id", recipient.prospect_id).eq("status", "pending");
      }
      if (unsubscribed)
        await supabase.from("suppressions").upsert(
          {
            user_id: mb.user_id,
            email_hash: sha256Email(recipient.email as string),
            reason: "unsubscribed",
          },
          { onConflict: "user_id,email_hash" },
        );
      await supabase.from("email_events").insert({
        recipient_id: recipient.id,
        user_id: mb.user_id,
        event_type: unsubscribed ? "unsubscribed" : "replied",
        payload: { snippet: msg.snippet, provider_message_id: msg.id },
      });

      const isHot = needsHuman(classification.category);
      const { data: replyClassification } = await supabase.from("reply_classifications").insert({
        recipient_id: recipient.id,
        user_id: mb.user_id,
        provider_message_id: msg.id,
        category: classification.category,
        confidence: classification.confidence,
        snippet: msg.snippet.slice(0, 500),
        needs_human: isHot,
        wants_meeting: Boolean(classification.wants_meeting),
        handled: false,
      }).select("id").maybeSingle();
      if (recipient.prospect_id) {
        const facts = extractQualificationFacts(
          msg.snippet,
          classification.category,
          Boolean(classification.wants_meeting),
        );
        await supabase.from("lead_qualification_facts").upsert(
          facts.map((f) => ({
            ...f,
            user_id: mb.user_id,
            prospect_id: recipient.prospect_id,
            source_ref: msg.id,
          })),
          { onConflict: "prospect_id,fact_key" },
        );
        const bucket = qualificationBucket(facts, classification.category);
        await supabase
          .from("prospects")
          .update({
            qualification_bucket: bucket,
            ...workflowForQualification(bucket, classification.category),
            next_action_at: null,
          })
          .eq("id", recipient.prospect_id)
          .eq("user_id", mb.user_id);
        if (isHot) await createLeadHandoff(supabase, { userId: String(mb.user_id), prospectId: String(recipient.prospect_id), sourceType: Boolean(classification.wants_meeting) ? "meeting_request" : "email_reply", sourceId: String(replyClassification?.id ?? msg.id), reason: Boolean(classification.wants_meeting) ? "meeting_requested" : classification.category === "objection" ? "objection" : "hot_reply", conversationSummary: msg.snippet, priority: Boolean(classification.wants_meeting) ? "urgent" : "high" });
      }
      await supabase
        .from("gmail_inbound_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", claimId)
        .eq("user_id", mb.user_id);
      processed++;
    }
  }
  await deliverLeadHandoffNotifications(supabase);
  return NextResponse.json({ processed });
}

export { POST as GET };
