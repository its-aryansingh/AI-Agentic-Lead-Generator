import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addManualLead, importLeadCsv } from "@/app/app/leads/actions";
import { createClient } from "@/lib/supabase/server";
import { LeadsTableClient, type LeadRow } from "@/app/app/leads/leads-table-client";
import { UserPlus, Upload } from "lucide-react";


// Every page under /app reads the session cookie, so none of them can
// be statically prerendered. Two earlier commits in this repo exist
// only to add this line to the other dashboard routes after the
// build crashed on them; these pages arrived from SalesEngAIMVP
// without it.
export const dynamic = "force-dynamic"

const errors: Record<string, string> = {
  missing_csv: "Choose a CSV file first.",
  csv_too_large: "CSV files must be 2 MB or smaller.",
  no_valid_rows: "No usable leads were found. Each row needs a name.",
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
    const { data: userJobs } = await supabase
      .from("jobs")
      .select("id")
      .eq("user_id", user.id);
    const jobIds = (userJobs ?? []).map((j) => j.id);

    if (jobIds.length > 0) {
      const { data } = await supabase
        .from("prospects")
        .select(
          "id,input_name,input_company,input_title,email,phone,lead_status,next_action,next_action_at,email_subject,research_summary,created_at",
        )
        .in("job_id", jobIds)
        .order("created_at", { ascending: false });

      leads = (data ?? []) as LeadRow[];
    }
  }

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
          <div className="grid gap-4 md:grid-cols-2">
            <Card size="sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <UserPlus className="size-4 text-primary" /> Add single lead
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={addManualLead} className="flex flex-col gap-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      name="name"
                      required
                      maxLength={200}
                      placeholder="Full name *"
                      className="h-8 text-xs"
                    />
                    <Input
                      name="company"
                      maxLength={200}
                      placeholder="Company"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      name="title"
                      maxLength={200}
                      placeholder="Job title"
                      className="h-8 text-xs"
                    />
                    <Input
                      name="email"
                      type="email"
                      maxLength={320}
                      placeholder="Work email"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      name="phone"
                      maxLength={40}
                      placeholder="Phone (+country code)"
                      className="h-8 text-xs"
                    />
                    <Input
                      name="linkedin_url"
                      type="url"
                      maxLength={1000}
                      placeholder="LinkedIn URL"
                      className="h-8 text-xs"
                    />
                  </div>
                  <Button type="submit" size="sm" className="mt-1 text-xs h-8">
                    Add lead
                  </Button>
                </form>
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
                <form action={importLeadCsv} className="flex flex-col gap-3 mt-3">
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
