import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Check = {
  name: string;
  state: "ready" | "warning" | "blocked";
  detail: string;
};
export default async function ReadinessPage() {
  const supabase = await createClient(),
    {
      data: { user },
    } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [
    { data: mailbox },
    { data: voice },
    { data: userProfile },
    { data: preference },
    { data: context },
    { data: playbook },
    { data: crm },
    { count: leadCount },
  ] = await Promise.all([
    supabase
      .from("mailboxes")
      .select("status,physical_address")
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("voice_connections")
      .select("status,call_start_hour,call_end_hour,calling_timezone")
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("users")
      .select("credits_remaining,plan")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("ai_preferences")
      .select("active_provider,chat_model,research_model,writing_model")
      .maybeSingle(),
    supabase
      .from("customer_contexts")
      .select("company_name,product_summary")
      .maybeSingle(),
    supabase
      .from("playbook_examples")
      .select("id")
      .eq("is_approved", true)
      .not("approved_at", "is", null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("crm_connections")
      .select("provider")
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase.from("prospects").select("id", { count: "exact", head: true }),
  ]);
  const hasPlatformKey = Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
  );
  const creditsRemaining = (userProfile?.credits_remaining as number) ?? 0;
  const hasCredits = creditsRemaining > 0;
  const aiReady = hasPlatformKey && hasCredits;

  const checks: Check[] = [
    {
      name: "Stable credential encryption",
      state:
        process.env.CONNECTION_ENCRYPTION_KEY ||
        process.env.MAILBOX_STATE_SECRET
          ? "ready"
          : "blocked",
      detail:
        "Required to decrypt customer provider credentials after deployment.",
    },
    {
      name: "Platform AI & Credits",
      state: aiReady ? "ready" : hasPlatformKey ? "warning" : "blocked",
      detail: aiReady
        ? `${creditsRemaining.toLocaleString()} credits available · ${String(preference?.writing_model ?? "claude-sonnet-4-6")}`
        : hasPlatformKey
          ? "No credits remaining. Top up in Settings → Billing."
          : "Configure OPENAI_API_KEY or ANTHROPIC_API_KEY in environment.",
    },
    {
      name: "Gmail mailbox",
      state: mailbox ? "ready" : "blocked",
      detail: mailbox
        ? "Active customer mailbox"
        : "Connect Gmail and complete consent.",
    },
    {
      name: "Email physical address",
      state: mailbox?.physical_address ? "ready" : "blocked",
      detail: mailbox?.physical_address
        ? "CAN-SPAM footer configured"
        : "Add the sender physical address.",
    },
    {
      name: "Bolna voice",
      state: voice ? "ready" : "blocked",
      detail: voice
        ? `${voice.call_start_hour}:00–${voice.call_end_hour}:00 ${voice.calling_timezone}`
        : "Connect and verify Bolna.",
    },
    {
      name: "Seller context",
      state:
        context?.company_name && context?.product_summary ? "ready" : "blocked",
      detail: context
        ? "Customer context saved"
        : "Complete company and product context.",
    },
    {
      name: "Approved playbook",
      state: playbook ? "ready" : "blocked",
      detail: playbook
        ? "At least one approved example"
        : "Approve a redacted sales example.",
    },
    {
      name: "Pilot leads",
      state: (leadCount ?? 0) > 0 ? "ready" : "blocked",
      detail: `${leadCount ?? 0} leads available`,
    },
    {
      name: "CRM",
      state: crm ? "ready" : "warning",
      detail: crm
        ? `${String(crm.provider)} connected`
        : "Explicitly deferred until CRM testing.",
    },
    {
      name: "Cron secret",
      state: process.env.CRON_SECRET ? "ready" : "blocked",
      detail: process.env.CRON_SECRET
        ? "Configured"
        : "Required for scheduled workers.",
    },
    {
      name: "Sentry monitoring",
      state: process.env.SENTRY_DSN ? "ready" : "warning",
      detail: process.env.SENTRY_DSN
        ? "Server monitoring enabled"
        : "Add SENTRY_DSN before production pilot.",
    },
  ];
  const blocked = checks.filter((check) => check.state === "blocked").length,
    warnings = checks.filter((check) => check.state === "warning").length;
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Pilot readiness</h1>
          <p className="text-sm text-muted-foreground">
            Day 8 launch gates for a controlled low-volume pilot.
          </p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle className="flex gap-2">
              Overall{" "}
              <Badge variant={blocked ? "destructive" : "default"}>
                {blocked
                  ? `blocked · ${blocked}`
                  : "ready for controlled pilot"}
              </Badge>
              {warnings > 0 && (
                <Badge variant="secondary">{warnings} warnings</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {checks.map((check) => (
              <div key={check.name} className="border rounded-md p-3">
                <div className="flex justify-between gap-2">
                  <strong className="text-sm">{check.name}</strong>
                  <Badge
                    variant={
                      check.state === "blocked"
                        ? "destructive"
                        : check.state === "warning"
                          ? "secondary"
                          : "default"
                    }
                  >
                    {check.state}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {check.detail}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Controlled pilot rules</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>
              Initial emails require approval; voice calls remain manually
              initiated.
            </p>
            <p>No automatic voice redial or automatic CRM push.</p>
            <p>
              Use low volume and stop immediately on opt-out, provider error or
              unexpected lead state.
            </p>
            <p>Current schema: 20260829000800_day8_ai_providers.sql</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
