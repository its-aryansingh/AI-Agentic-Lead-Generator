import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { importLeadCsv } from "@/app/app/leads/actions";
import { createClient } from "@/lib/supabase/server";
import { LeadsTableClient, type LeadRow } from "@/app/app/leads/leads-table-client";
import { RefreshCw, Upload } from "lucide-react";
import { CrmSyncDialog } from "@/app/app/leads/crm-sync-dialog";
import { ManualLeadForm } from "@/app/app/leads/manual-lead-form";

const errors: Record<string, string> = {
  missing_csv: "Choose a CSV file first.",
  csv_too_large: "CSV files must be 2 MB or smaller.",
  no_valid_rows: "No usable leads were found. Each row needs a name.",
  duplicate_contacts:
    "The CSV contains contacts that already exist. Review or deduplicate the file before importing it.",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let leads: LeadRow[] = [];
  if (user) {
    const { data } = await supabase
      .from("prospects")
      .select(
        "id,input_name,input_company,input_title,email,phone,lead_status,next_action,next_action_at,email_subject,research_summary,created_at,company_domain,enrichment_status",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    leads = (data ?? []) as LeadRow[];
  }

  const { data: connections } = user
    ? await supabase
        .from("crm_connections")
        .select("provider")
        .eq("user_id", user.id)
        .eq("status", "active")
    : { data: [] };

  const connectedProviders = (connections ?? [])
    .map((row) => row.provider)
    .filter(
      (value): value is "hubspot" | "zoho" =>
        value === "hubspot" || value === "zoho",
    );

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">All Leads</h1>
          <p className="text-xs text-muted-foreground">
            Manage, research, and send personalized cold outreach to your leads.
          </p>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {error && (
            <p className="text-sm text-destructive font-medium bg-destructive/10 border border-destructive/20 rounded-md p-3">
              {errors[error] ?? "Import failed."}
            </p>
          )}

          {/* Quick Intake Section */}
          <div className="grid gap-4 md:grid-cols-3">
            <ManualLeadForm />

            <Card size="sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <RefreshCw className="size-4 text-primary" /> Sync from CRM
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Preview HubSpot or Zoho contacts before a safe, audited
                  import.
                </p>
                <CrmSyncDialog connectedProviders={connectedProviders} />
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Upload className="size-4 text-primary" /> Import CSV
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col justify-between h-[calc(100%-48px)]">
                <p className="text-xs text-muted-foreground">
                  Upload up to 1,000 rows (2 MB max). Columns: Name, Company,
                  Title, LinkedIn, Email, and Phone.
                </p>
                <form
                  action={importLeadCsv}
                  className="flex flex-col gap-3 mt-3"
                >
                  <Input
                    name="csv"
                    type="file"
                    accept=".csv,text/csv"
                    required
                    className="h-9 text-xs file:text-xs"
                  />
                  <Button type="submit" size="sm" className="text-xs h-8">
                    Import CSV leads
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Full Interactive Leads Table */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Leads Directory ({leads.length})
              </h2>
            </div>
            <LeadsTableClient initialLeads={leads} />
          </div>
        </div>
      </section>
    </div>
  );
}
