import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { decryptCredential, encryptCredential } from "@/lib/credential-crypto";
import {
  listBolnaAccountVoices,
  provisionBolnaQualificationAgent,
  updateBolnaQualificationAgent,
  listBolnaAgents,
  listBolnaCredentialProviders,
  listBolnaOutboundNumbers,
  verifyBolnaConnection,
  verifyBolnaOutboundNumber,
  verifyBolnaVoiceChoice,
} from "@/lib/providers/bolna";
import { createClient } from "@/lib/supabase/server";
import { temporalVoiceRolloutReady } from "@/lib/temporal/readiness";
import { normalizeE164, voiceWebhookSignature } from "@/lib/voice-compliance";
import { parseVoicePolicy, type VoicePolicy } from "@/lib/voice/agent-policy";
import { syncManagedAgentCalendarTools } from "@/lib/voice/calendar-agent-sync";
import type {
  BolnaOutboundNumber,
  BolnaVoiceChoice,
} from "@/lib/providers/bolna";
import { revokeGoogleCalendarCredential } from "@/lib/providers/google-calendar";

import { ConnectionCard } from "@/app/app/settings/voice-calling/connection-card";
import { VoicePolicyForm } from "@/app/app/settings/voice-calling/voice-policy-form";

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unexpected voice configuration error.";
}

function publicAppUrl() {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw)
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be set before creating a managed agent.",
    );
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    throw new Error(
      "Managed agents require NEXT_PUBLIC_APP_URL to be a public HTTPS address.",
    );
  }
  return url.origin;
}

function webhookUrl(
  connectionId: string,
  version: number,
  requirePublic = false,
) {
  const base = requirePublic
    ? publicAppUrl()
    : process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  return `${base}/api/webhooks/bolna/${connectionId}?signature=${voiceWebhookSignature(connectionId, version)}`;
}

function actionWebhookUrl(connectionId: string, version: number) {
  return `${publicAppUrl()}/api/webhooks/bolna/${connectionId}/actions?signature=${voiceWebhookSignature(connectionId, version)}`;
}

function managedConfig(
  policy: VoicePolicy,
  connectionId: string,
  webhookVersion: number,
  calendarBookingEnabled = false,
) {
  return {
    agentName: "SalesEngAI Qualification Agent",
    webhookUrl: webhookUrl(connectionId, webhookVersion, true),
    language: policy.language,
    maxCallSeconds: policy.maxCallSeconds,
    maxTurns: policy.maxTurns,
    maxObjectionAttempts: policy.maxObjectionAttempts,
    callStartHour: policy.startHour,
    callEndHour: policy.endHour,
    agentWelcomeMessage: policy.agentOptions.agentWelcomeMessage,
    voiceName: policy.agentOptions.voiceName,
    voiceId: policy.agentOptions.voiceId,
    synthesizerProvider: policy.agentOptions.synthesizerProvider,
    synthesizerModel: policy.agentOptions.synthesizerModel,
    llmProvider: policy.agentOptions.llmProvider,
    llmModel: policy.agentOptions.llmModel,
    temperature: policy.agentOptions.temperature,
    ambientNoise: policy.agentOptions.ambientNoise,
    ambientNoiseTrack: policy.agentOptions.ambientNoiseTrack,
    interruptionWords: policy.agentOptions.interruptionWords,
    silenceHangupSeconds: policy.agentOptions.silenceHangupSeconds,
    telephonyProvider: policy.agentOptions.telephonyProvider,
    actionWebhookUrl: actionWebhookUrl(connectionId, webhookVersion),
    bookingLinkEnabled: Boolean(policy.bookingLinkUrl),
    calendarBookingEnabled,
    transferEnabled: policy.transferEnabled,
    transferPhone: policy.humanTransferPhone ?? undefined,
    transferTimezone: policy.transferTimezone,
    transferStartHour: policy.transferStartHour,
    transferEndHour: policy.transferEndHour,
    transferWeekdays: policy.transferWeekdays,
    transferFallback: policy.transferFallback,
  };
}

async function saveBolnaConnection(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing, error: existingError } = await supabase
    .from("voice_connections")
    .select(
      "id,status,encrypted_api_key,api_key_last_four,agent_id,agent_management_mode",
    )
    .eq("user_id", user.id)
    .eq("provider", "bolna")
    .maybeSingle();

  const suppliedApiKey = String(formData.get("api_key") ?? "").trim();
  const suppliedAgentId = String(formData.get("agent_id") ?? "").trim();
  const suppliedFrom = String(formData.get("from_phone") ?? "").trim();
  const managementMode = String(
    formData.get("management_mode") ?? "managed",
  ) as "managed" | "external";
  const fromPhone = suppliedFrom ? normalizeE164(suppliedFrom) : null;
  let failure: string | null = null;

  try {
    if (existingError) throw existingError;
    if (suppliedFrom && !fromPhone) {
      throw new Error(
        "From number must use E.164 format, such as +911140001400.",
      );
    }
    const hasSavedKey = Boolean(
      existing &&
        existing.encrypted_api_key &&
        existing.encrypted_api_key !== "disconnected",
    );
    if (!suppliedApiKey && !hasSavedKey) {
      throw new Error("Enter your Bolna API key to connect.");
    }

    const apiKey =
      suppliedApiKey || decryptCredential(String(existing?.encrypted_api_key));
    const verifiedFrom = fromPhone
      ? await verifyBolnaOutboundNumber(apiKey, fromPhone)
      : null;

    if (managementMode === "external") {
      if (!suppliedAgentId && !existing?.agent_id) {
        throw new Error(
          "Enter your existing Bolna Agent ID for external mode.",
        );
      }
      const agentId = suppliedAgentId || String(existing?.agent_id ?? "");
      await verifyBolnaConnection(apiKey, agentId);

      const { error } = await supabase.from("voice_connections").upsert(
        {
          user_id: user.id,
          provider: "bolna",
          encrypted_api_key: suppliedApiKey
            ? encryptCredential(apiKey)
            : existing?.encrypted_api_key,
          api_key_last_four: suppliedApiKey
            ? apiKey.slice(-4)
            : existing?.api_key_last_four,
          agent_id: agentId,
          from_phone_number: fromPhone,
          from_phone_provider: verifiedFrom?.telephonyProvider ?? null,
          from_phone_source: verifiedFrom?.source ?? null,
          from_phone_verified_at: verifiedFrom
            ? new Date().toISOString()
            : null,
          status: "active",
          last_verified_at: new Date().toISOString(),
          last_error: null,
          agent_management_mode: "external",
          agent_config_error: null,
        },
        { onConflict: "user_id,provider" },
      );
      if (error) throw error;
    } else {
      // Managed mode: Validate API key. Agent is provisioned / synced via VoicePolicyForm!
      const availableAgents = await listBolnaAgents(apiKey);
      const existingAgentId = String(existing?.agent_id ?? "");
      let isProvisioned = Boolean(
        existingAgentId && !existingAgentId.startsWith("provisioning-"),
      );
      if (
        isProvisioned &&
        !availableAgents.some((agent) => agent.id === existingAgentId)
      ) {
        isProvisioned = false;
      }
      const managedAgent = isProvisioned
        ? availableAgents.find((agent) => agent.id === existingAgentId)
        : null;
      const agentReady = managedAgent?.agent_status === "processed";

      const { error } = await supabase.from("voice_connections").upsert(
        {
          user_id: user.id,
          provider: "bolna",
          encrypted_api_key: suppliedApiKey
            ? encryptCredential(apiKey)
            : existing?.encrypted_api_key,
          api_key_last_four: suppliedApiKey
            ? apiKey.slice(-4)
            : existing?.api_key_last_four,
          agent_id: isProvisioned
            ? existingAgentId
            : `provisioning-${crypto.randomUUID()}`,
          from_phone_number: fromPhone,
          from_phone_provider: verifiedFrom?.telephonyProvider ?? null,
          from_phone_source: verifiedFrom?.source ?? null,
          from_phone_verified_at: verifiedFrom
            ? new Date().toISOString()
            : null,
          status: agentReady ? "active" : "unverified",
          last_verified_at: new Date().toISOString(),
          last_error: null,
          agent_management_mode: "managed",
          agent_config_error: agentReady
            ? null
            : isProvisioned
              ? "awaiting_agent_verification"
              : "awaiting_agent_configuration",
        },
        { onConflict: "user_id,provider" },
      );
      if (error) throw error;
    }
  } catch (error) {
    failure = errorMessage(error);
  }

  if (failure)
    redirect(
      `/app/settings/voice-calling?error=${encodeURIComponent(failure)}`,
    );
  redirect("/app/settings/voice-calling?connection_saved=1");
}

async function saveVoicePolicy(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let failure: string | null = null;
  let external = false;
  try {
    const policy = parseVoicePolicy(formData);
    const { data: connection, error: queryError } = await supabase
      .from("voice_connections")
      .select(
        "id,status,encrypted_api_key,agent_id,agent_management_mode,webhook_version,agent_config_version,from_phone_number,from_phone_source",
      )
      .eq("user_id", user.id)
      .eq("provider", "bolna")
      .maybeSingle();
    if (queryError) throw queryError;
    if (
      !connection ||
      connection.status === "disconnected" ||
      !connection.encrypted_api_key ||
      connection.encrypted_api_key === "disconnected"
    ) {
      throw new Error(
        "Connect your Bolna account with an API key in the connection card first.",
      );
    }

    external = connection.agent_management_mode === "external";
    const apiKey = decryptCredential(String(connection.encrypted_api_key));
    await verifyBolnaVoiceChoice(apiKey, {
      voiceId: policy.agentOptions.voiceId,
      name: policy.agentOptions.voiceName,
      provider: policy.agentOptions.synthesizerProvider,
      model: policy.agentOptions.synthesizerModel,
    });
    if (["anthropic", "groq"].includes(policy.agentOptions.llmProvider)) {
      const configuredProviders = await listBolnaCredentialProviders(apiKey);
      const required = `${policy.agentOptions.llmProvider.toUpperCase()}_API_KEY`;
      if (!configuredProviders.includes(required)) {
        throw new Error(
          `${policy.agentOptions.llmProvider} credentials are not configured in this Bolna account.`,
        );
      }
    }
    if (
      policy.agentOptions.telephonyProvider === "sip-trunk" &&
      (!connection.from_phone_number || connection.from_phone_source !== "sip_trunk")
    ) {
      throw new Error(
        "SIP trunk routing requires an outbound caller ID verified from an active Bolna SIP trunk.",
      );
    }
    const webhookVersion = Number(connection.webhook_version ?? 1);
    const { data: calendar } = await supabase
      .from("calendar_connections")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .eq("status", "active")
      .maybeSingle();
    const config = managedConfig(
      policy,
      String(connection.id),
      webhookVersion,
      Boolean(calendar),
    );

    let agentId = String(connection.agent_id ?? "");
    let isNewProvisioning = false;

    if (!external) {
      if (!agentId || agentId.startsWith("provisioning-")) {
        // Provision managed agent automatically using saved encrypted API key!
        const created = await provisionBolnaQualificationAgent(apiKey, config);
        agentId = created.agent_id;
        isNewProvisioning = true;
      } else {
        // Synchronize managed agent directly to Bolna
        await updateBolnaQualificationAgent(apiKey, agentId, config);
      }
    }

    const { error: updateError } = await supabase
      .from("voice_connections")
      .update({
        agent_id: agentId,
        status: isNewProvisioning ? "unverified" : connection.status,
        call_start_hour: policy.startHour,
        call_end_hour: policy.endHour,
        calling_timezone: policy.timezone,
        default_language: policy.language,
        max_call_seconds: policy.maxCallSeconds,
        max_turns: policy.maxTurns,
        max_objection_attempts: policy.maxObjectionAttempts,
        human_transfer_phone: policy.humanTransferPhone,
        transfer_enabled: policy.transferEnabled,
        transfer_start_hour: policy.transferStartHour,
        transfer_end_hour: policy.transferEndHour,
        transfer_timezone: policy.transferTimezone,
        transfer_weekdays: policy.transferWeekdays,
        transfer_fallback: policy.transferFallback,
        booking_link_url: policy.bookingLinkUrl,
        agent_options: policy.agentOptions,
        agent_config_version: Number(connection.agent_config_version ?? 1) + 1,
        agent_config_synced_at: external ? null : new Date().toISOString(),
        agent_config_error: isNewProvisioning
          ? "awaiting_agent_verification"
          : external
            ? "external_agent_requires_manual_safeguard_sync"
            : null,
      })
      .eq("id", connection.id)
      .eq("user_id", user.id);
    if (updateError) throw updateError;
  } catch (error) {
    failure = errorMessage(error);
  }

  if (failure)
    redirect(
      `/app/settings/voice-calling?error=${encodeURIComponent(failure)}`,
    );
  redirect(
    `/app/settings/voice-calling?policy_saved=${external ? "external" : "managed"}`,
  );
}

async function disconnectBolna() {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase
    .from("voice_connections")
    .update({
      status: "disconnected",
      encrypted_api_key: "disconnected",
      last_error: null,
      temporal_enabled: false,
    })
    .eq("user_id", user.id)
    .eq("provider", "bolna");
  if (error)
    redirect(
      `/app/settings/voice-calling?error=${encodeURIComponent(error.message)}`,
    );
  redirect("/app/settings/voice-calling?disconnected=1");
}

async function saveTemporalRollout(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const enabled = formData.get("temporal_enabled") === "on";
  if (enabled && !temporalVoiceRolloutReady())
    redirect(
      "/app/settings/voice-calling?error=temporal_infrastructure_not_ready",
    );
  const { error } = await supabase
    .from("voice_connections")
    .update({ temporal_enabled: enabled })
    .eq("user_id", user.id)
    .eq("provider", "bolna")
    .eq("status", "active");
  if (error)
    redirect(
      `/app/settings/voice-calling?error=${encodeURIComponent(error.message)}`,
    );
  redirect(
    `/app/settings/voice-calling?temporal_saved=${enabled ? "enabled" : "disabled"}`,
  );
}

async function saveCalendarPolicy(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const integer = (name: string) => Number(String(formData.get(name) ?? ""));
  const duration = integer("calendar_duration");
  const startHour = integer("calendar_start_hour");
  const endHour = integer("calendar_end_hour");
  const increment = integer("calendar_increment");
  const buffer = integer("calendar_buffer");
  const timezone = String(formData.get("calendar_timezone") ?? "").trim();
  const title = String(formData.get("calendar_title") ?? "").trim();
  const weekdays = formData.getAll("calendar_weekdays").map(Number);
  let failure: string | null = null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    if (![15, 30, 45, 60, 90, 120].includes(duration)) throw new Error("invalid_duration");
    if (startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24 || endHour <= startHour) {
      throw new Error("invalid_calendar_hours");
    }
    if (![15, 30, 60].includes(increment) || buffer < 0 || buffer > 120) {
      throw new Error("invalid_calendar_spacing");
    }
    if (!title || title.length > 120 || weekdays.length === 0) {
      throw new Error("invalid_calendar_policy");
    }
    const { error } = await supabase
      .from("calendar_connections")
      .update({
        calendar_timezone: timezone,
        meeting_title: title,
        meeting_duration_minutes: duration,
        availability_start_hour: startHour,
        availability_end_hour: endHour,
        availability_weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
        slot_increment_minutes: increment,
        buffer_minutes: buffer,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("provider", "google")
      .eq("status", "active");
    if (error) throw error;
  } catch (error) {
    failure = errorMessage(error);
  }
  if (failure) redirect(`/app/settings/voice-calling?error=${encodeURIComponent(failure)}`);
  redirect("/app/settings/voice-calling?calendar_saved=1");
}

async function disconnectCalendar() {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: connected } = await supabase
    .from("calendar_connections")
    .select("encrypted_refresh_token")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();
  if (
    connected?.encrypted_refresh_token &&
    connected.encrypted_refresh_token !== "disconnected"
  ) {
    try {
      await revokeGoogleCalendarCredential(
        decryptCredential(String(connected.encrypted_refresh_token)),
      );
    } catch {
      // Local credential destruction still completes if Google is unavailable.
    }
  }
  const { error } = await supabase
    .from("calendar_connections")
    .update({
      status: "disconnected",
      encrypted_refresh_token: "disconnected",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("provider", "google");
  if (error) redirect(`/app/settings/voice-calling?error=${encodeURIComponent(error.message)}`);
  try {
    await syncManagedAgentCalendarTools(user.id, false);
  } catch (syncError) {
    redirect(
      `/app/settings/voice-calling?error=${encodeURIComponent(errorMessage(syncError))}`,
    );
  }
  redirect("/app/settings/voice-calling?calendar_disconnected=1");
}

export default async function VoiceCallingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error: connectionQueryError } = await supabase
    .from("voice_connections")
    .select(
      "id,status,api_key_last_four,agent_id,from_phone_number,from_phone_provider,from_phone_source,from_phone_verified_at,last_verified_at,last_error,call_start_hour,call_end_hour,calling_timezone,webhook_version,temporal_enabled,agent_management_mode,default_language,max_call_seconds,max_turns,max_objection_attempts,human_transfer_phone,transfer_enabled,transfer_start_hour,transfer_end_hour,transfer_timezone,transfer_weekdays,transfer_fallback,booking_link_url,agent_config_synced_at,agent_config_error,agent_options",
    )
    .eq("user_id", user.id)
    .eq("provider", "bolna")
    .maybeSingle();

  const connection = data as Record<string, unknown> | null;
  const { data: calendarData } = await supabase
    .from("calendar_connections")
    .select("id,status,account_email,calendar_id,calendar_timezone,meeting_title,meeting_duration_minutes,availability_start_hour,availability_end_hour,availability_weekdays,slot_increment_minutes,buffer_minutes,last_verified_at,last_error")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();
  const calendar = calendarData as Record<string, unknown> | null;
  const query = await searchParams;
  const active = connection?.status === "active";
  const connected = Boolean(connection && connection.status !== "disconnected");
  const managed = connection?.agent_management_mode !== "external";
  const temporalInfrastructureReady = temporalVoiceRolloutReady();
  let availableVoices: BolnaVoiceChoice[] = [];
  let outboundNumbers: BolnaOutboundNumber[] = [];
  let configuredProviders: string[] = [];
  if (connected) {
    const { data: secret } = await supabase
      .from("voice_connections")
      .select("encrypted_api_key")
      .eq("user_id", user.id)
      .eq("provider", "bolna")
      .maybeSingle();
    if (
      secret?.encrypted_api_key &&
      secret.encrypted_api_key !== "disconnected"
    ) {
      try {
        const apiKey = decryptCredential(String(secret.encrypted_api_key));
        const inventory = await Promise.allSettled([
          listBolnaAccountVoices(apiKey),
          listBolnaOutboundNumbers(apiKey),
          listBolnaCredentialProviders(apiKey),
        ]);
        availableVoices =
          inventory[0].status === "fulfilled" ? inventory[0].value : [];
        outboundNumbers =
          inventory[1].status === "fulfilled" ? inventory[1].value : [];
        configuredProviders =
          inventory[2].status === "fulfilled" ? inventory[2].value : [];
      } catch {
        // Existing connection diagnostics remain visible if inventory refresh fails.
      }
    }
  }
  const webhook =
    active && connection?.id
      ? webhookUrl(
          String(connection.id),
          Number(connection.webhook_version ?? 1),
        )
      : null;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Voice Calling & AI Agents</h1>
          <p className="text-sm text-muted-foreground">
            Configure automated AI phone qualification agents powered by Bolna and ElevenLabs.
          </p>
        </header>

        {query.connection_saved && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            Bolna API connection verified and saved.
          </div>
        )}
        {query.policy_saved && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            Agent configuration saved
            {query.policy_saved === "managed"
              ? " and synchronized with Bolna"
              : " locally"}
            .
          </div>
        )}
        {query.disconnected && (
          <div className="rounded-lg bg-zinc-500/10 border border-zinc-500/20 p-3 text-sm text-muted-foreground">
            Bolna disconnected. Saved credentials were removed from SalesEngAI.
          </div>
        )}
        {query.temporal_saved && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            Durable call orchestration {query.temporal_saved} for this
            connection.
          </div>
        )}
        {query.calendar_connected && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            Google Calendar connected and verified
            {query.calendar_sync === "managed"
              ? ", and synchronized with the managed voice agent"
              : ". Save external-agent tools manually if you use external mode"}
            .
          </div>
        )}
        {query.calendar_saved && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            Meeting availability policy saved.
          </div>
        )}
        {connectionQueryError && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            Voice settings schema is not ready. Apply pending Supabase voice
            migrations.
          </div>
        )}
        {query.error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            Voice configuration error:{" "}
            {decodeURIComponent(query.error).replaceAll("_", " ")}
          </div>
        )}

        {/* 1. BOLNA CONNECTION CARD (API Key entered once) */}
        <ConnectionCard
          connection={connection}
          outboundNumbers={outboundNumbers}
          saveConnectionAction={saveBolnaConnection}
          disconnectAction={disconnectBolna}
        />

        {/* 2. UNIFIED VOICE AGENT CONFIGURATION (Rendered ONCE with dynamic speaker list) */}
        <VoicePolicyForm
          connection={connection}
          saveAction={saveVoicePolicy}
          isManaged={managed}
          isConnected={connected}
          availableVoices={availableVoices}
          configuredProviders={configuredProviders}
        />

        <Card className="border border-border/70 bg-card/60 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Direct meeting booking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {calendar?.status !== "active" ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Connect Google Calendar with free/busy and event-only access.
                  Gmail permissions are kept separate.
                </p>
                <a
                  href="/api/calendar/connect"
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
                >
                  Connect Google Calendar
                </a>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Connected as {String(calendar.account_email)}. The voice agent
                  may offer verified slots and create an event only after the
                  recipient confirms the exact slot.
                </p>
                <form action={saveCalendarPolicy} className="grid gap-3 md:grid-cols-2">
                  <Input name="calendar_title" defaultValue={String(calendar.meeting_title ?? "Introduction call")} placeholder="Meeting title" />
                  <Input name="calendar_timezone" defaultValue={String(calendar.calendar_timezone ?? "Asia/Kolkata")} placeholder="Asia/Kolkata" />
                  <select name="calendar_duration" defaultValue={Number(calendar.meeting_duration_minutes ?? 30)} className="h-9 rounded-md border border-input bg-background px-3 text-xs">
                    {[15, 30, 45, 60, 90, 120].map((value) => <option key={value} value={value}>{value} minute meeting</option>)}
                  </select>
                  <select name="calendar_increment" defaultValue={Number(calendar.slot_increment_minutes ?? 30)} className="h-9 rounded-md border border-input bg-background px-3 text-xs">
                    {[15, 30, 60].map((value) => <option key={value} value={value}>{value} minute slot spacing</option>)}
                  </select>
                  <Input name="calendar_start_hour" type="number" min="0" max="23" defaultValue={Number(calendar.availability_start_hour ?? 9)} />
                  <Input name="calendar_end_hour" type="number" min="1" max="24" defaultValue={Number(calendar.availability_end_hour ?? 18)} />
                  <Input name="calendar_buffer" type="number" min="0" max="120" defaultValue={Number(calendar.buffer_minutes ?? 15)} placeholder="Buffer minutes" />
                  <fieldset className="flex flex-wrap items-center gap-2">
                    {[[1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"],[6,"Sat"],[7,"Sun"]].map(([value, label]) => (
                      <label key={value} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" name="calendar_weekdays" value={value} defaultChecked={(Array.isArray(calendar.availability_weekdays) ? calendar.availability_weekdays.map(Number) : [1,2,3,4,5]).includes(Number(value))} />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <div className="md:col-span-2 flex gap-2">
                    <Button type="submit" size="sm">Save meeting policy</Button>
                  </div>
                </form>
                <form action={disconnectCalendar}>
                  <Button type="submit" variant="outline" size="sm">Disconnect Calendar</Button>
                </form>
              </>
            )}
            <p className="text-[11px] text-muted-foreground">
              External setup: enable Google Calendar API and register the
              GOOGLE_CALENDAR_REDIRECT_URI shown in deployment configuration.
            </p>
          </CardContent>
        </Card>

        {/* 3. TEMPORAL ORCHESTRATION */}
        <Card className="border border-border/70 bg-card/60 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span>🛡️</span> Durable Call Orchestration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Temporal provides durable scheduling, anti-harassment gates, crash recovery, and guaranteed single-attempt execution.
            </p>
            <p
              className={`text-xs font-medium ${temporalInfrastructureReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
            >
              {temporalInfrastructureReady
                ? "✓ Infrastructure configuration and legal-launch gates are active."
                : "○ Development fallback: configure Temporal bridge secrets before enabling durable mode."}
            </p>
            <form action={saveTemporalRollout} className="space-y-3">
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  name="temporal_enabled"
                  defaultChecked={connection?.temporal_enabled === true}
                  disabled={!active || !temporalInfrastructureReady}
                  className="size-4 rounded border-input text-indigo-600 focus:ring-indigo-500"
                />
                Route qualification calls through durable orchestration
              </label>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={!active}
                className="text-xs h-8"
              >
                Save Orchestration Mode
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 4. WEBHOOK SETUP */}
        {webhook && (
          <Card className="border border-border/70 bg-card/60 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span>⚡</span> Webhook Callback URL
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                {managed
                  ? "Your managed agent automatically uses this signed webhook callback:"
                  : "Paste this signed URL into your Bolna agent's Analytics Webhook settings:"}
              </p>
              <code className="block break-all rounded-md bg-muted/60 p-3 text-xs font-mono text-foreground border border-border/50">
                {webhook}
              </code>
              <p className="text-[11px] text-muted-foreground">
                This endpoint receives real-time call states, transcripts, and recordings securely.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
