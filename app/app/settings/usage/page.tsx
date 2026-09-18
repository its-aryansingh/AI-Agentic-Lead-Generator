import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Sparkles,
  BarChart3,
  Activity,
  Layers,
  Receipt,
  ArrowDownRight,
} from "lucide-react";
import Link from "next/link";


// Every page under /app reads the session cookie, so none of them can
// be statically prerendered. Two earlier commits in this repo exist
// only to add this line to the other dashboard routes after the
// build crashed on them; these pages arrived from SalesEngAIMVP
// without it.
export const dynamic = "force-dynamic"

export default async function UsagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: userProfile },
    { data: recentEvents },
    { data: creditTransactions },
    { data: creditPacks },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("credits_remaining,plan,credits_reset_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("ai_usage_events")
      .select("id,provider,model,operation,status,created_at,duration_ms")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("credit_transactions")
      .select("id,delta,reason,job_id,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("credit_packs")
      .select("id,pack_id,credits_added,payment_provider,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const creditsRemaining = (userProfile?.credits_remaining as number) ?? 0;
  const currentPlan = (userProfile?.plan as string) ?? "free";
  const resetAt = userProfile?.credits_reset_at
    ? new Date(userProfile.credits_reset_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "N/A";

  // Aggregate operations from credit_transactions and ai_usage_events
  const opBreakdown = new Map<
    string,
    { count: number; totalCredits: number }
  >();

  // 1. Ingest credit transactions into breakdown
  for (const tx of creditTransactions ?? []) {
    let cleanOp = String(tx.reason || "operation");
    if (cleanOp.startsWith("enrich_lead")) cleanOp = "enrich_lead";
    else if (cleanOp.startsWith("intake_enrichment")) cleanOp = "intake_lead_enrichment";
    else if (cleanOp.startsWith("ai_op_")) cleanOp = cleanOp.replace(/^ai_op_/, "");

    const existing = opBreakdown.get(cleanOp) ?? { count: 0, totalCredits: 0 };
    existing.count += 1;
    existing.totalCredits += Math.abs(Number(tx.delta || 0));
    opBreakdown.set(cleanOp, existing);
  }

  // 2. Ingest any AI usage events not already covered
  for (const event of recentEvents ?? []) {
    const op = String(event.operation);
    if (!opBreakdown.has(op)) {
      opBreakdown.set(op, { count: 1, totalCredits: 1 });
    }
  }

  const totalOpsRecorded = (creditTransactions?.length ?? 0) + (recentEvents?.length ?? 0);
  const totalCreditsUsed = Array.from(opBreakdown.values()).reduce(
    (acc, curr) => acc + curr.totalCredits,
    0,
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">
              AI Compute &amp; Credit Usage
            </h1>
            <p className="text-sm text-zinc-400 mt-0.5">
              Live audit of AI operations, credit consumption, and pack purchase
              history.
            </p>
          </div>
          <Link
            href="/app/settings/billing"
            className={buttonVariants({
              variant: "default",
              className: "bg-indigo-600 hover:bg-indigo-700 text-white",
            })}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Manage Plan &amp; Packs
          </Link>
        </header>

        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-zinc-900 border-white/10">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Credits Remaining</span>
                <Sparkles className="w-4 h-4 text-indigo-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {creditsRemaining.toLocaleString()}
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Plan:{" "}
                <span className="text-zinc-200 capitalize font-medium">
                  {currentPlan}
                </span>
              </p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-white/10">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">
                  Recent Ops (Sample: 50)
                </span>
                <Activity className="w-4 h-4 text-emerald-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {totalOpsRecorded}
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Consumed ~{totalCreditsUsed} credits in sample
              </p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-white/10">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">
                  Next Monthly Reset
                </span>
                <BarChart3 className="w-4 h-4 text-purple-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-white">{resetAt}</div>
              <p className="text-xs text-zinc-400 mt-1">
                One-time packs never expire
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Operation Breakdown Table */}
        <Card className="bg-zinc-900 border-white/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                Consumption by Operation Type
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                Audit Window: Last 50 ops
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {opBreakdown.size === 0 ? (
              <p className="text-xs text-zinc-400 py-4 text-center">
                No recent operations recorded yet. Start chat turns or enrich
                leads to see live consumption.
              </p>
            ) : (
              <div className="divide-y divide-white/5">
                <div className="grid grid-cols-3 text-xs text-zinc-400 pb-2 font-medium">
                  <span>Operation</span>
                  <span className="text-center">Executions</span>
                  <span className="text-right">Credits Consumed</span>
                </div>
                {Array.from(opBreakdown.entries()).map(([op, data]) => (
                  <div
                    key={op}
                    className="grid grid-cols-3 text-xs py-2.5 items-center"
                  >
                    <span className="text-zinc-200 font-medium capitalize">
                      {op.replace(/_/g, " ")}
                    </span>
                    <span className="text-center text-zinc-400 font-mono">
                      {data.count}
                    </span>
                    <span className="text-right text-indigo-400 font-semibold font-mono">
                      {data.totalCredits} cr
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Credit Ledger & Real-Time Activity Log */}
        <Card className="bg-zinc-900 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Receipt className="w-4 h-4 text-emerald-400" />
              Recent Credit Ledger &amp; Compute Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!(creditTransactions?.length || recentEvents?.length) ? (
              <p className="text-xs text-zinc-400 py-4 text-center">
                No activity logged yet.
              </p>
            ) : (
              <div className="space-y-2">
                {creditTransactions?.slice(0, 15).map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-xl border border-white/5 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="text-zinc-200 font-medium capitalize flex items-center gap-1.5">
                        <ArrowDownRight className="w-3.5 h-3.5 text-amber-400" />
                        {String(tx.reason || "AI Operation").replace(/_/g, " ")}
                      </div>
                      <div className="text-[11px] text-zinc-400 font-mono">
                        Job: {tx.job_id ? tx.job_id.slice(0, 13) + "…" : "real-time"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <div className="text-amber-400 font-semibold font-mono">
                          {tx.delta} cr
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {new Date(tx.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px] py-0 border-emerald-500/30 text-emerald-400"
                      >
                        deducted
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Credit Pack History */}
        {(creditPacks?.length ?? 0) > 0 && (
          <Card className="bg-zinc-900 border-white/10">
            <CardHeader>
              <CardTitle className="text-white text-base">
                One-Time Pack Purchases
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {creditPacks?.map((pack) => (
                  <div
                    key={pack.id}
                    className="flex items-center justify-between p-3 bg-zinc-800/40 rounded-xl border border-white/5 text-xs"
                  >
                    <div>
                      <div className="text-zinc-200 font-medium">
                        +{pack.credits_added.toLocaleString()} credits
                      </div>
                      <div className="text-[11px] text-zinc-400 font-mono">
                        Pack ID: {pack.pack_id} · via {pack.payment_provider}
                      </div>
                    </div>
                    <div className="text-xs text-zinc-400">
                      {new Date(pack.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
