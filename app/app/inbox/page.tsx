import { createClient } from "@/lib/supabase/server";
import { InboxClient, type InboxItem } from "@/app/app/inbox/inbox-client";


// Kept from the pre-port version: every page under /app reads the
// session cookie and cannot be statically prerendered.
export const dynamic = "force-dynamic"

/**
 * /app/inbox — human-review queue and detailed inbox for campaign replies.
 *
 * Surfaces reply_classifications, resolved against recipients and prospects,
 * displaying full qualification signals, snippets, and deep links to lead workspaces.
 */
export default async function InboxPage() {
  const supabase = await createClient();

  // Fetch classifications for the user (both handled and unhandled so user can toggle/filter)
  const { data: rows } = await supabase
    .from("reply_classifications")
    .select(
      "id,category,confidence,snippet,created_at,recipient_id,needs_human,wants_meeting,handled",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const classificationRows = rows ?? [];

  const recipientIds = Array.from(
    new Set(
      classificationRows.map((r) => r.recipient_id as string).filter(Boolean),
    ),
  );

  const recipientMap = new Map<
    string,
    {
      id: string;
      campaign_id: string | null;
      prospect_id: string | null;
      email: string | null;
      status: string | null;
    }
  >();

  if (recipientIds.length > 0) {
    const { data: recipientRows } = await supabase
      .from("campaign_recipients")
      .select("id,campaign_id,prospect_id,email,status")
      .in("id", recipientIds);

    for (const rr of recipientRows ?? []) {
      recipientMap.set(rr.id as string, {
        id: rr.id as string,
        campaign_id: (rr.campaign_id as string) ?? null,
        prospect_id: (rr.prospect_id as string) ?? null,
        email: (rr.email as string) ?? null,
        status: (rr.status as string) ?? null,
      });
    }
  }

  const prospectIds = Array.from(
    new Set(
      Array.from(recipientMap.values())
        .map((r) => r.prospect_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const prospectMap = new Map<
    string,
    {
      id: string;
      input_name: string | null;
      input_company: string | null;
      input_title: string | null;
      email: string | null;
      phone: string | null;
      lead_status: string | null;
      qualification_bucket: string | null;
      next_action: string | null;
      handoff_summary: string | null;
    }
  >();

  if (prospectIds.length > 0) {
    const { data: prospectRows } = await supabase
      .from("prospects")
      .select(
        "id,input_name,input_company,input_title,email,phone,lead_status,qualification_bucket,next_action,handoff_summary",
      )
      .in("id", prospectIds);

    for (const pr of prospectRows ?? []) {
      prospectMap.set(pr.id as string, {
        id: pr.id as string,
        input_name: (pr.input_name as string) ?? null,
        input_company: (pr.input_company as string) ?? null,
        input_title: (pr.input_title as string) ?? null,
        email: (pr.email as string) ?? null,
        phone: (pr.phone as string) ?? null,
        lead_status: (pr.lead_status as string) ?? null,
        qualification_bucket: (pr.qualification_bucket as string) ?? null,
        next_action: (pr.next_action as string) ?? null,
        handoff_summary: (pr.handoff_summary as string) ?? null,
      });
    }
  }

  const campaignIds = Array.from(
    new Set(
      Array.from(recipientMap.values())
        .map((r) => r.campaign_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const campaignMap = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: campaignRows } = await supabase
      .from("campaigns")
      .select("id,name")
      .in("id", campaignIds);

    for (const cr of campaignRows ?? []) {
      campaignMap.set(
        cr.id as string,
        (cr.name as string) ?? "Outreach Campaign",
      );
    }
  }

  const items: InboxItem[] = classificationRows.map((r) => {
    const recipient = recipientMap.get(r.recipient_id as string);
    const prospect = recipient?.prospect_id
      ? prospectMap.get(recipient.prospect_id)
      : null;
    const campaignName = recipient?.campaign_id
      ? (campaignMap.get(recipient.campaign_id) ?? null)
      : null;

    return {
      id: r.id as string,
      recipientId: (r.recipient_id as string) ?? "",
      category: (r.category as string) ?? "other",
      confidence: (r.confidence as number) ?? null,
      snippet: (r.snippet as string) ?? null,
      wantsMeeting: Boolean(r.wants_meeting),
      needsHuman: Boolean(r.needs_human),
      handled: Boolean(r.handled),
      createdAt: (r.created_at as string) ?? new Date().toISOString(),

      // Recipient info
      recipientEmail: recipient?.email ?? null,

      // Lead profile info
      prospectId: prospect?.id ?? recipient?.prospect_id ?? null,
      leadName: prospect?.input_name ?? null,
      leadCompany: prospect?.input_company ?? null,
      leadTitle: prospect?.input_title ?? null,
      leadPhone: prospect?.phone ?? null,
      leadStatus: prospect?.lead_status ?? null,
      qualificationBucket: prospect?.qualification_bucket ?? null,
      nextAction: prospect?.next_action ?? null,
      handoffSummary: prospect?.handoff_summary ?? null,

      // Campaign info
      campaignName,
    };
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-background/50 relative overflow-hidden">
      {/* Decorative gradient background */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-br from-[var(--chart-violet)]/10 via-[var(--chart-sky)]/5 to-transparent blur-3xl -z-10 pointer-events-none opacity-50" />

      <header className="px-6 py-6 border-b border-border/40 bg-card/30 backdrop-blur-sm">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight">
            Reply Inbox &amp; Handoffs
          </h1>
          <p className="text-sm text-muted-foreground">
            Review inbound prospect replies, AI qualification signals, and
            execute next steps.
          </p>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <InboxClient initialItems={items} />
      </section>
    </div>
  );
}
