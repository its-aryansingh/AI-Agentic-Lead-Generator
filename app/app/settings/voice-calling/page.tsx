import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { decryptCredential, encryptCredential } from "@/lib/credential-crypto";
import { verifyBolnaConnection } from "@/lib/providers/bolna";
import { createClient } from "@/lib/supabase/server";
import { voiceWebhookSignature } from "@/lib/voice-compliance";

import { VerifyButton } from "@/app/app/settings/voice-calling/verify-button";


// Every page under /app reads the session cookie, so none of them can
// be statically prerendered. Two earlier commits in this repo exist
// only to add this line to the other dashboard routes after the
// build crashed on them; these pages arrived from SalesEngAIMVP
// without it.
export const dynamic = "force-dynamic"

function maskedAgentId(value: unknown) {
  const id = String(value ?? "");
  if (!id) return "";
  return id.length <= 8 ? `••••${id.slice(-2)}` : `••••••••-${id.slice(-6)}`;
}

function validateCallingSettings(formData: FormData): string | null {
  const start = Number(formData.get("start_hour"));
  const end = Number(formData.get("end_hour"));
  const timeZone = String(formData.get("timezone") ?? "").trim();
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || end <= start) {
    return "Calling hours must be whole hours with the end later than the start.";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    return "Enter a valid IANA timezone, such as Asia/Kolkata.";
  }
  return null;
}

async function saveBolna(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const validationError = validateCallingSettings(formData);
  if (validationError) redirect(`/app/settings/voice-calling?error=${encodeURIComponent(validationError)}`);

  const { data: existing } = await supabase
    .from("voice_connections")
    .select("id,status,encrypted_api_key,api_key_last_four,agent_id,last_verified_at")
    .eq("user_id", user.id)
    .eq("provider", "bolna")
    .maybeSingle();
  const suppliedApiKey = String(formData.get("api_key") ?? "").trim();
  const suppliedAgentId = String(formData.get("agent_id") ?? "").trim();
  const replacingCredentials = Boolean(suppliedApiKey || suppliedAgentId);
  if (replacingCredentials && (!suppliedApiKey || !suppliedAgentId)) {
    redirect("/app/settings/voice-calling?error=enter_both_api_key_and_agent_id");
  }
  if (!replacingCredentials && existing?.status !== "active") {
    redirect("/app/settings/voice-calling?error=missing_credentials");
  }

  let apiKey = suppliedApiKey;
  let agentId = suppliedAgentId;
  let failure: string | null = null;
  try {
    if (!replacingCredentials) {
      apiKey = decryptCredential(String(existing?.encrypted_api_key ?? ""));
      agentId = String(existing?.agent_id ?? "");
    }
    if (replacingCredentials) await verifyBolnaConnection(apiKey, agentId);
    const { error } = await supabase.from("voice_connections").upsert(
      {
        user_id: user.id,
        provider: "bolna",
        encrypted_api_key: replacingCredentials ? encryptCredential(apiKey) : existing?.encrypted_api_key,
        api_key_last_four: replacingCredentials ? apiKey.slice(-4) : existing?.api_key_last_four,
        agent_id: agentId,
        from_phone_number: String(formData.get("from_phone") ?? "").trim() || null,
        status: "active",
        last_verified_at: replacingCredentials
          ? new Date().toISOString()
          : existing?.last_verified_at,
        last_error: null,
        call_start_hour: Number(formData.get("start_hour")),
        call_end_hour: Number(formData.get("end_hour")),
        calling_timezone: String(formData.get("timezone")).trim(),
      },
      { onConflict: "user_id,provider" },
    );
    if (error) throw error;
  } catch (error) {
    failure = error instanceof Error ? error.message : "verification_failed";
  }
  if (failure) redirect(`/app/settings/voice-calling?error=${encodeURIComponent(failure)}`);
  redirect("/app/settings/voice-calling?saved=1");
}

async function disconnectBolna() {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase
    .from("voice_connections")
    .update({ status: "disconnected", encrypted_api_key: "disconnected", last_error: null })
    .eq("user_id", user.id)
    .eq("provider", "bolna");
  if (error) redirect(`/app/settings/voice-calling?error=${encodeURIComponent(error.message)}`);
  redirect("/app/settings/voice-calling?disconnected=1");
}

export default async function VoiceCallingPage({ searchParams }: {
  searchParams: Promise<{ saved?: string; error?: string; disconnected?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: connection } = await supabase
    .from("voice_connections")
    .select("id,status,api_key_last_four,agent_id,from_phone_number,last_verified_at,last_error,call_start_hour,call_end_hour,calling_timezone,webhook_version")
    .eq("user_id", user.id)
    .eq("provider", "bolna")
    .maybeSingle();
  const query = await searchParams;
  const active = connection?.status === "active";
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const webhook = active && connection?.id
    ? `${base}/api/webhooks/bolna/${connection.id}?signature=${voiceWebhookSignature(String(connection.id), Number(connection.webhook_version))}`
    : null;

  return <div className="flex-1 overflow-y-auto p-6"><div className="max-w-3xl mx-auto space-y-4">
    <header><h1 className="text-xl font-semibold">Voice calling</h1><p className="text-sm text-muted-foreground">Connect each customer&apos;s own Bolna account. Credentials are encrypted and used only server-side.</p></header>
    {query.saved && <p className="text-sm text-emerald-600">Bolna connection verified and settings saved.</p>}
    {query.disconnected && <p className="text-sm text-emerald-600">Bolna disconnected. Enter fresh credentials to reconnect.</p>}
    {query.error && <p className="text-sm text-destructive">Connection failed: {decodeURIComponent(query.error).replaceAll("_", " ")}</p>}
    <Card><CardHeader><CardTitle>Bolna connection {connection && `· ${String(connection.status)}`}</CardTitle></CardHeader><CardContent className="space-y-4">
      {active && <p className="text-xs text-muted-foreground">Currently connected agent: {maskedAgentId(connection.agent_id)}. Leave both credential fields blank to update only the calling settings.</p>}
      <form action={saveBolna} className="grid gap-3 md:grid-cols-2">
        <Input name="api_key" type="password" autoComplete="new-password" required={!active} placeholder={active ? `API key ending ${String(connection.api_key_last_four)} (leave blank to keep)` : "Bolna API key"} />
        <Input name="agent_id" autoComplete="off" required={!active} placeholder={active ? "Agent ID (leave blank to keep)" : "Bolna Agent ID"} />
        <Input name="from_phone" defaultValue={String(connection?.from_phone_number ?? "")} placeholder="From number in E.164 (optional)" />
        <Input name="timezone" defaultValue={String(connection?.calling_timezone ?? "Asia/Kolkata")} placeholder="IANA timezone" />
        <Input name="start_hour" type="number" min="0" max="23" defaultValue={Number(connection?.call_start_hour ?? 9)} />
        <Input name="end_hour" type="number" min="1" max="24" defaultValue={Number(connection?.call_end_hour ?? 18)} />
        <VerifyButton />
      </form>
      {active && <form action={disconnectBolna}><Button type="submit" variant="ghost" size="sm">Disconnect Bolna</Button></form>}
    </CardContent></Card>
    {webhook && <Card><CardHeader><CardTitle>Webhook setup</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>Paste this URL into the Bolna agent Analytics tab under “Push all execution data to webhook”:</p><code className="block break-all rounded bg-muted p-3 text-xs">{webhook}</code><p className="text-muted-foreground">The signed URL binds updates to this customer connection. Never share it publicly.</p></CardContent></Card>}
    <Card><CardHeader><CardTitle>Required agent safeguards</CardTitle></CardHeader><CardContent className="text-sm space-y-1"><p>Enable outbound calling restrictions for the same hours above.</p><p>Agent must disclose that it is an AI assistant and ask permission to continue.</p><p>Set a short pilot duration limit. SalesEngAI disables automatic retry and permits only one accepted attempt per lead.</p></CardContent></Card>
  </div></div>;
}
