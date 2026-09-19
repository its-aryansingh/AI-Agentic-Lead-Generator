import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { encryptCredential } from "@/lib/credential-crypto";
import {
  verifyCustomerCrm,
  type CustomerCrmCredentials,
} from "@/lib/customer-crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

async function saveCrm(formData: FormData) {
  "use server";
  const provider = String(formData.get("provider") ?? ""),
    supabase = await createClient(),
    {
      data: { user },
    } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    let credentials: CustomerCrmCredentials;
    if (provider === "hubspot") {
      const accessToken = String(formData.get("access_token") ?? "").trim();
      if (!accessToken)
        throw new Error("HubSpot private-app token is required.");
      credentials = { provider, accessToken };
    } else if (provider === "zoho") {
      const refreshToken = String(formData.get("refresh_token") ?? "").trim(),
        clientId = String(formData.get("client_id") ?? "").trim(),
        clientSecret = String(formData.get("client_secret") ?? "").trim(),
        region = String(formData.get("region") ?? "com").trim();
      if (!refreshToken || !clientId || !clientSecret)
        throw new Error("All Zoho OAuth credentials are required.");
      credentials = { provider, refreshToken, clientId, clientSecret, region };
    } else throw new Error("Unsupported CRM provider.");
    await verifyCustomerCrm(credentials);
    const hint =
      credentials.provider === "hubspot"
        ? credentials.accessToken.slice(-4)
        : credentials.clientId.slice(-4);
    const region = credentials.provider === "zoho" ? credentials.region : null;
    const { error } = await supabase
      .from("crm_connections")
      .upsert(
        {
          user_id: user.id,
          provider,
          encrypted_credentials: encryptCredential(JSON.stringify(credentials)),
          credential_hint: hint,
          region,
          status: "active",
          last_verified_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
      );
    if (error) throw error;
  } catch (error) {
    redirect(
      `/app/settings/crm?error=${encodeURIComponent(error instanceof Error ? error.message : "CRM verification failed")}`,
    );
  }
  redirect(`/app/settings/crm?saved=${provider}`);
}
async function disconnectCrm(formData: FormData) {
  "use server";
  const provider = String(formData.get("provider") ?? ""),
    supabase = await createClient(),
    {
      data: { user },
    } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase
    .from("crm_connections")
    .update({
      status: "disconnected",
      encrypted_credentials: "disconnected",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("provider", provider);
  redirect("/app/settings/crm?disconnected=1");
}
export default async function CrmSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    disconnected?: string;
  }>;
}) {
  const supabase = await createClient(),
    {
      data: { user },
    } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: connections } = await supabase
    .from("crm_connections")
    .select(
      "provider,status,credential_hint,region,last_verified_at,last_error",
    )
    .order("provider");
  const byProvider = new Map(
      (connections ?? []).map((row) => [String(row.provider), row]),
    ),
    query = await searchParams;
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <header>
          <h1 className="text-xl font-semibold">CRM connections</h1>
          <p className="text-sm text-muted-foreground">
            Connect customer-owned HubSpot or Zoho credentials. Secrets are
            encrypted and used only on the server.
          </p>
        </header>
        {query.saved && (
          <p className="text-sm text-emerald-600">
            {query.saved} verified and connected.
          </p>
        )}
        {query.disconnected && (
          <p className="text-sm">
            CRM disconnected and stored credentials removed.
          </p>
        )}
        {query.error && (
          <p className="text-sm text-destructive">
            {decodeURIComponent(query.error)}
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <CrmCard
            provider="hubspot"
            title="HubSpot"
            connection={byProvider.get("hubspot")}
          />
          <CrmCard
            provider="zoho"
            title="Zoho CRM"
            connection={byProvider.get("zoho")}
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>MVP sync behavior</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>Lead contact details are upserted by email.</p>
            <p>
              A sourced qualification and human-handoff summary is attached as a
              CRM note.
            </p>
            <p>CRM pull and two-way synchronization remain post-MVP.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
function CrmCard({
  provider,
  title,
  connection,
}: {
  provider: "hubspot" | "zoho";
  title: string;
  connection?: Record<string, unknown>;
}) {
  const active = connection?.status === "active";
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} {connection && `· ${String(connection.status)}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {active && (
          <p className="text-xs text-muted-foreground">
            Verified {String(connection?.last_verified_at ?? "")} · credential
            ending {String(connection?.credential_hint ?? "")}
          </p>
        )}
        <form action={saveCrm} className="space-y-3">
          <input type="hidden" name="provider" value={provider} />
          {provider === "hubspot" ? (
            <Input
              name="access_token"
              type="password"
              required
              placeholder="Private app access token"
            />
          ) : (
            <>
              <Input name="client_id" required placeholder="Zoho client ID" />
              <Input
                name="client_secret"
                type="password"
                required
                placeholder="Zoho client secret"
              />
              <Input
                name="refresh_token"
                type="password"
                required
                placeholder="Zoho refresh token"
              />
              <Input
                name="region"
                defaultValue={String(connection?.region ?? "com")}
                placeholder="Region: com, in, eu"
              />
            </>
          )}
          <Button className="w-full">Verify and save</Button>
        </form>
        {active && (
          <form action={disconnectCrm}>
            <input type="hidden" name="provider" value={provider} />
            <Button variant="ghost" size="sm">
              Disconnect
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
