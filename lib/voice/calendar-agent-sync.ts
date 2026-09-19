import { decryptCredential } from "@/lib/credential-crypto";
import { updateBolnaQualificationAgent } from "@/lib/voice/providers/bolna";
import { createAdminClient } from "@/lib/supabase/server";
import { voiceWebhookSignature } from "@/lib/voice-compliance";

function publicOrigin() {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) throw new Error("NEXT_PUBLIC_APP_URL_MISSING");
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    throw new Error("PUBLIC_HTTPS_APP_URL_REQUIRED");
  }
  return url.origin;
}

export async function syncManagedAgentCalendarTools(
  userId: string,
  calendarBookingEnabled: boolean,
) {
  const supabase = createAdminClient();
  const { data: connection, error } = await supabase
    .from("voice_connections")
    .select("id,status,encrypted_api_key,agent_id,agent_management_mode,webhook_version,call_start_hour,call_end_hour,calling_timezone,default_language,max_call_seconds,max_turns,max_objection_attempts,human_transfer_phone,booking_link_url,transfer_enabled,transfer_start_hour,transfer_end_hour,transfer_timezone,transfer_weekdays,transfer_fallback,agent_options,agent_config_version")
    .eq("user_id", userId)
    .eq("provider", "bolna")
    .maybeSingle();
  if (error) throw error;
  if (
    !connection ||
    connection.status === "disconnected" ||
    connection.agent_management_mode === "external" ||
    !connection.agent_id ||
    String(connection.agent_id).startsWith("provisioning-")
  ) {
    return { synced: false, reason: "managed_agent_not_ready" };
  }
  const origin = publicOrigin();
  const version = Number(connection.webhook_version ?? 1);
  const signature = voiceWebhookSignature(String(connection.id), version);
  const options =
    connection.agent_options && typeof connection.agent_options === "object"
      ? (connection.agent_options as Record<string, unknown>)
      : {};
  try {
    await updateBolnaQualificationAgent(
      decryptCredential(String(connection.encrypted_api_key)),
      String(connection.agent_id),
      {
        agentName: "SalesEngAI Qualification Agent",
        webhookUrl: `${origin}/api/webhooks/bolna/${connection.id}?signature=${signature}`,
        actionWebhookUrl: `${origin}/api/webhooks/bolna/${connection.id}/actions?signature=${signature}`,
        language: String(connection.default_language ?? "en") as
          | "en"
          | "hi"
          | "hinglish",
        maxCallSeconds: Number(connection.max_call_seconds ?? 180),
        maxTurns: Number(connection.max_turns ?? 12),
        maxObjectionAttempts: Number(connection.max_objection_attempts ?? 1),
        callStartHour: Number(connection.call_start_hour ?? 9),
        callEndHour: Number(connection.call_end_hour ?? 18),
        agentWelcomeMessage: String(options.agentWelcomeMessage ?? "") || undefined,
        voiceName: String(options.voiceName ?? "Nila"),
        voiceId: String(options.voiceId ?? "V9LCAAi4tTlqe9JadbCo"),
        synthesizerProvider: String(options.synthesizerProvider ?? "elevenlabs"),
        synthesizerModel: String(options.synthesizerModel ?? "eleven_turbo_v2_5"),
        llmProvider: String(options.llmProvider ?? "openai"),
        llmModel: String(options.llmModel ?? "gpt-5.4-mini"),
        temperature: Number(options.temperature ?? 1),
        ambientNoise: Boolean(options.ambientNoise),
        ambientNoiseTrack: String(options.ambientNoiseTrack ?? "office") as
          | "office"
          | "coffee-shop"
          | "call-center",
        interruptionWords: Number(options.interruptionWords ?? 2),
        silenceHangupSeconds: Number(options.silenceHangupSeconds ?? 10),
        telephonyProvider: String(options.telephonyProvider ?? "plivo"),
        bookingLinkEnabled: Boolean(connection.booking_link_url),
        calendarBookingEnabled,
        transferEnabled: connection.transfer_enabled === true,
        transferPhone: connection.human_transfer_phone
          ? String(connection.human_transfer_phone)
          : undefined,
        transferTimezone: String(connection.transfer_timezone ?? "Asia/Kolkata"),
        transferStartHour: Number(connection.transfer_start_hour ?? 9),
        transferEndHour: Number(connection.transfer_end_hour ?? 18),
        transferWeekdays: Array.isArray(connection.transfer_weekdays)
          ? connection.transfer_weekdays.map(Number)
          : [1, 2, 3, 4, 5],
        transferFallback: String(
          connection.transfer_fallback ?? "schedule_callback",
        ) as "schedule_callback" | "human_review" | "end_call",
      },
    );
    await supabase
      .from("voice_connections")
      .update({
        agent_config_version: Number(connection.agent_config_version ?? 1) + 1,
        agent_config_synced_at: new Date().toISOString(),
        agent_config_error: null,
      })
      .eq("id", connection.id)
      .eq("user_id", userId);
    return { synced: true };
  } catch (syncError) {
    await supabase
      .from("voice_connections")
      .update({
        agent_config_error:
          syncError instanceof Error
            ? syncError.message.slice(0, 240)
            : "calendar_tool_sync_failed",
      })
      .eq("id", connection.id)
      .eq("user_id", userId);
    throw syncError;
  }
}
