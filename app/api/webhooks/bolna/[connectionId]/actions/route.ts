import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { decryptCredential } from "@/lib/credential-crypto";
import { sendGmail } from "@/lib/providers/gmail";
import {
  createGoogleCalendarMeeting,
  getGoogleCalendarBusyPeriods,
  isGoogleCalendarAuthError,
} from "@/lib/providers/google-calendar";
import { createAdminClient } from "@/lib/supabase/server";
import { createLeadHandoff, deliverLeadHandoffNotifications } from "@/lib/unified-lead-handoff";
import {
  validateConfirmedVoiceAction,
  voiceActionCallbackSchema,
} from "@/lib/voice/action-core";
import { validBolnaWebhookSource, validVoiceWebhookSignature } from "@/lib/voice-compliance";
import {
  evaluateTransferAvailability,
  type TransferFallback,
} from "@/lib/voice/transfer-policy";
import {
  findAvailableMeetingSlots,
  meetingSlotAllowed,
  parseSlotId,
} from "@/lib/voice/calendar-policy";

export const runtime = "nodejs";

function responseFor(row: Record<string, unknown>, replayed = false) {
  return NextResponse.json({
    actionRequestId: row.id,
    status: row.status,
    result: row.result ?? null,
    replayed,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > 16_384) {
    return new NextResponse("Payload too large", { status: 413 });
  }

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 16_384) {
      return new NextResponse("Payload too large", { status: 413 });
    }
    raw = JSON.parse(text);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  const parsed = voiceActionCallbackSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_ACTION_REQUEST" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const signature = new URL(req.url).searchParams.get("signature") ?? "";
  const { data: connection } = await supabase
    .from("voice_connections")
    .select("id,user_id,status,webhook_version,booking_link_url,human_transfer_phone,transfer_enabled,transfer_start_hour,transfer_end_hour,transfer_timezone,transfer_weekdays,transfer_fallback")
    .eq("id", connectionId)
    .eq("provider", "bolna")
    .maybeSingle();
  if (!connection) return new NextResponse("Unknown connection", { status: 404 });
  if (
    connection.status !== "active" ||
    !validVoiceWebhookSignature(
      connectionId,
      signature,
      Number(connection.webhook_version),
    )
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!validBolnaWebhookSource(req.headers)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const request = parsed.data;
  const { data: execution } = await supabase
    .from("voice_executions")
    .select("id,user_id,prospect_id,status,provider_execution_id")
    .eq("connection_id", connectionId)
    .eq("id", request.executionId)
    .maybeSingle();
  if (!execution || execution.user_id !== connection.user_id) {
    return new NextResponse("Unknown execution", { status: 404 });
  }
  if (!["in_progress", "finalizing"].includes(String(execution.status))) {
    return NextResponse.json(
      { error: "EXECUTION_NOT_ACTIVE" },
      { status: 409 },
    );
  }

  const actionDigest = createHash("sha256")
    .update(
      JSON.stringify(request.action) +
        (request.action.kind === "BOOK_MEETING" &&
        request.action.operation === "FIND_SLOTS"
          ? `:${Math.floor(Date.now() / 60_000)}`
          : ""),
    )
    .digest("hex")
    .slice(0, 32);
  const idempotencyKey = `${request.executionId}:${request.toolCallId ?? actionDigest}`;
  const { data: prior } = await supabase
    .from("voice_action_requests")
    .select("id,status,result,failure_reason")
    .eq("connection_id", connectionId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (prior && prior.status !== "confirmation_required") {
    return responseFor(prior as Record<string, unknown>, true);
  }

  let validation;
  try {
    validation = validateConfirmedVoiceAction(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "INVALID_ACTION" },
      { status: 422 },
    );
  }

  const initial = {
    user_id: connection.user_id,
    connection_id: connectionId,
    execution_id: execution.id,
    prospect_id: execution.prospect_id,
    action_kind: request.action.kind,
    idempotency_key: idempotencyKey,
    provider_tool_call_id: request.toolCallId ?? null,
    arguments: request.action,
    confirmation_evidence: request.confirmationEvidence ?? null,
    status: validation.requiresConfirmation
      ? "confirmation_required"
      : "confirmed",
    confirmed_at: validation.requiresConfirmation
      ? null
      : new Date().toISOString(),
  };

  let actionRequestId = String(prior?.id ?? "");
  if (prior) {
    const { error } = await supabase
      .from("voice_action_requests")
      .update(initial)
      .eq("id", prior.id)
      .eq("status", "confirmation_required");
    if (error) return NextResponse.json({ error: "ACTION_LEDGER_ERROR" }, { status: 500 });
  } else {
    const { data: inserted, error } = await supabase
      .from("voice_action_requests")
      .insert(initial)
      .select("id,status,result")
      .single();
    if (error?.code === "23505") {
      const { data: raced } = await supabase
        .from("voice_action_requests")
        .select("id,status,result")
        .eq("connection_id", connectionId)
        .eq("idempotency_key", idempotencyKey)
        .single();
      return raced
        ? responseFor(raced as Record<string, unknown>, true)
        : NextResponse.json({ error: "ACTION_LEDGER_ERROR" }, { status: 500 });
    }
    if (error || !inserted) {
      return NextResponse.json({ error: "ACTION_LEDGER_ERROR" }, { status: 500 });
    }
    actionRequestId = String(inserted.id);
  }

  if (validation.requiresConfirmation) {
    return NextResponse.json({
      actionRequestId,
      status: "confirmation_required",
      instruction: "Repeat the exact action and ask the recipient to confirm.",
    });
  }

  const startedAt = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("voice_action_requests")
    .update({ status: "executing", started_at: startedAt })
    .eq("id", actionRequestId)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();
  if (!claimed) {
    const { data: current } = await supabase
      .from("voice_action_requests")
      .select("id,status,result,failure_reason")
      .eq("id", actionRequestId)
      .single();
    return current
      ? responseFor(current as Record<string, unknown>, true)
      : NextResponse.json({ error: "ACTION_LEDGER_ERROR" }, { status: 500 });
  }

  try {
    let result: Record<string, unknown>;
    if (request.action.kind === "SCHEDULE_CALLBACK") {
      if (!execution.prospect_id) throw new Error("LEAD_NOT_AVAILABLE");
      await createLeadHandoff(supabase, {
        userId: String(execution.user_id), prospectId: String(execution.prospect_id), sourceType: "callback_request", sourceId: String(actionRequestId),
        reason: "callback_requested", dueAt: request.action.at, conversationSummary: `Confirmed callback requested for ${request.action.at} (${request.action.tz}).`, priority: "high",
      });
      await deliverLeadHandoffNotifications(supabase, 2);
      result = {
        scheduledAt: request.action.at,
        timezone: request.action.tz,
      };
    } else if (request.action.kind === "TRANSFER_HUMAN") {
      const availability = evaluateTransferAvailability({
        enabled: connection.transfer_enabled === true,
        phone: connection.human_transfer_phone
          ? String(connection.human_transfer_phone)
          : null,
        timezone: String(connection.transfer_timezone ?? "Asia/Kolkata"),
        startHour: Number(connection.transfer_start_hour ?? 9),
        endHour: Number(connection.transfer_end_hour ?? 18),
        weekdays: Array.isArray(connection.transfer_weekdays)
          ? connection.transfer_weekdays.map(Number)
          : [1, 2, 3, 4, 5],
        fallback: String(
          connection.transfer_fallback ?? "schedule_callback",
        ) as TransferFallback,
      });
      if (
        !availability.allowed &&
        connection.transfer_fallback === "human_review" &&
        execution.prospect_id
      ) {
        await createLeadHandoff(supabase, { userId: String(execution.user_id), prospectId: String(execution.prospect_id), sourceType: "voice_call", sourceId: String(actionRequestId), reason: "transfer_failed", conversationSummary: String(request.action.reason ?? "A requested transfer requires salesperson review."), priority: "urgent" });
        await deliverLeadHandoffNotifications(supabase, 2);
      }
      result = {
        ...availability,
        trigger: request.action.trigger,
        reason: request.action.reason,
      };
    } else if (request.action.kind === "BOOK_MEETING") {
      const { data: calendar } = await supabase
        .from("calendar_connections")
        .select("id,status,account_email,encrypted_refresh_token,calendar_id,calendar_timezone,meeting_title,meeting_duration_minutes,availability_start_hour,availability_end_hour,availability_weekdays,slot_increment_minutes,buffer_minutes")
        .eq("user_id", connection.user_id)
        .eq("provider", "google")
        .eq("status", "active")
        .maybeSingle();
      if (!calendar?.encrypted_refresh_token) {
        throw new Error("ACTIVE_CALENDAR_NOT_AVAILABLE");
      }
      const policy = {
        timezone: String(calendar.calendar_timezone),
        startHour: Number(calendar.availability_start_hour),
        endHour: Number(calendar.availability_end_hour),
        weekdays: Array.isArray(calendar.availability_weekdays)
          ? calendar.availability_weekdays.map(Number)
          : [1, 2, 3, 4, 5],
        durationMinutes: Number(calendar.meeting_duration_minutes),
        incrementMinutes: Number(calendar.slot_increment_minutes),
        bufferMinutes: Number(calendar.buffer_minutes),
      };
      const refreshToken = decryptCredential(
        String(calendar.encrypted_refresh_token),
      );
      const now = new Date();
      const timeMax = new Date(now.getTime() + 14 * 86_400_000);
      const busy = await getGoogleCalendarBusyPeriods({
        refreshToken,
        calendarId: String(calendar.calendar_id),
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        timezone: policy.timezone,
      });
      if (request.action.operation === "FIND_SLOTS") {
        result = {
          slots: findAvailableMeetingSlots({ policy, busy, now, limit: 3 }),
          timezone: policy.timezone,
          instruction:
            "Offer at most two labels and retain their slot IDs. Do not claim a booking until the exact slot is confirmed and book_confirmed_meeting succeeds.",
        };
      } else {
        if (!execution.prospect_id) throw new Error("LEAD_NOT_AVAILABLE");
        const slot = parseSlotId(String(request.action.slotId));
        if (!slot) throw new Error("INVALID_MEETING_SLOT");
        const start = new Date(slot.start);
        const end = new Date(slot.end);
        if (
          start > timeMax ||
          !meetingSlotAllowed({ policy, busy, start, end, now })
        ) {
          throw new Error("MEETING_SLOT_NO_LONGER_AVAILABLE");
        }
        const { data: prospect } = await supabase
          .from("prospects")
          .select("input_name,input_company,email")
          .eq("id", execution.prospect_id)
          .eq("user_id", connection.user_id)
          .maybeSingle();
        if (!prospect?.email) throw new Error("LEAD_EMAIL_NOT_AVAILABLE");
        const created = await createGoogleCalendarMeeting({
          refreshToken,
          calendarId: String(calendar.calendar_id),
          idempotencyKey,
          title: String(calendar.meeting_title),
          description: `SalesEngAI-confirmed qualification meeting with ${String(prospect.input_name ?? "the prospect")} (${String(prospect.input_company ?? "company not provided")}).`,
          start: slot.start,
          end: slot.end,
          timezone: policy.timezone,
          attendeeEmail: String(prospect.email),
        });
        result = {
          start: slot.start,
          end: slot.end,
          timezone: policy.timezone,
          eventId: created.eventId,
          meetingLink: created.meetingLink,
          providerReplayed: created.replayed,
        };
        const { error } = await supabase
          .from("prospects")
          .update({ next_action: "push_to_crm", next_action_at: slot.start })
          .eq("id", execution.prospect_id)
          .eq("user_id", connection.user_id);
        if (error) throw error;
      }
    } else {
      if (!execution.prospect_id) throw new Error("LEAD_NOT_AVAILABLE");
      if (!connection.booking_link_url) {
        throw new Error("BOOKING_LINK_NOT_CONFIGURED");
      }
      const [{ data: prospect }, { data: mailbox }, { data: context }] =
        await Promise.all([
          supabase
            .from("prospects")
            .select("id,input_name,email")
            .eq("id", execution.prospect_id)
            .eq("user_id", connection.user_id)
            .maybeSingle(),
          supabase
            .from("mailboxes")
            .select("email_address,oauth_refresh_token_encrypted")
            .eq("user_id", connection.user_id)
            .eq("status", "active")
            .not("oauth_refresh_token_encrypted", "is", null)
            .limit(1)
            .maybeSingle(),
          supabase
            .from("customer_contexts")
            .select("company_name")
            .eq("user_id", connection.user_id)
            .maybeSingle(),
        ]);
      if (!prospect?.email) throw new Error("LEAD_EMAIL_NOT_AVAILABLE");
      if (!mailbox?.oauth_refresh_token_encrypted) {
        throw new Error("ACTIVE_MAILBOX_NOT_AVAILABLE");
      }
      const sent = await sendGmail({
        refreshToken: decryptCredential(
          String(mailbox.oauth_refresh_token_encrypted),
        ),
        from: String(mailbox.email_address),
        to: String(prospect.email),
        subject: `Schedule time with ${String(context?.company_name ?? "our team")}`,
        body: `Hi ${String(prospect.input_name ?? "there")},\n\nAs requested on our call, here is the approved booking link:\n${connection.booking_link_url}\n\nRegards,\n${String(context?.company_name ?? "The team")}`,
      });
      result = {
        asset: "booking_link",
        channel: "email",
        messageId: sent.messageId,
        threadId: sent.threadId,
      };
    }

    const { data: completed } = await supabase
      .from("voice_action_requests")
      .update({
        status: "succeeded",
        result,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionRequestId)
      .eq("status", "executing")
      .select("id,status,result")
      .single();
    if (!completed) {
      return NextResponse.json({ error: "ACTION_LEDGER_ERROR" }, { status: 500 });
    }
    return responseFor(completed as Record<string, unknown>);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.slice(0, 240) : "ACTION_FAILED";
    if (
      request.action.kind === "BOOK_MEETING" &&
      isGoogleCalendarAuthError(error)
    ) {
      await supabase
        .from("calendar_connections")
        .update({
          status: "reconnect_required",
          last_error: "Google authorization expired or was revoked.",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", connection.user_id)
        .eq("provider", "google");
    }
    const { data: failed } = await supabase
      .from("voice_action_requests")
      .update({
        status: "failed",
        failure_reason: reason,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", actionRequestId)
      .select("id,status,result,failure_reason")
      .single();
    return NextResponse.json(
      {
        actionRequestId: failed?.id ?? actionRequestId,
        status: "failed",
        error: reason,
      },
      { status: 422 },
    );
  }
}
