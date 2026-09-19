"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { VoiceCallOverride } from "@/app/app/leads/[id]/voice-call-override";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Call = {
  id: string; prospectId: string | null; leadName: string | null; createdAt: string;
  durationSeconds: number; status: string; providerStatus: string | null;
  outcome: string | null; costMinorUnits: string; costCurrency: string | null;
  hasTranscript: boolean; hasRecording: boolean;
};
type Analytics = {
  totalCalls: number; answeredCalls: number; answerRate: number; totalDurationSeconds: number;
  currencyTotals: Array<{ currency: string; costMinorUnits: string }>;
  calls: Call[]; nextCursor: string | null; platformCreditsRemaining: number;
};

function minutes(seconds: number) { return (seconds / 60).toFixed(1); }
function providerCost(currency: string, value: string) {
  return currency === "BOLNA_CENTS" ? `${value} Bolna cents` : `${value} ${currency} cents`;
}

export function CallsDashboardClient() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const [transcript, setTranscript] = useState<{ id: string; text: string | null; summary: string | null } | null>(null);

  const load = useCallback(async (nextCursor: string | null = null) => {
    setLoading(true); setError(null);
    try {
      const query = nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : "";
      const response = await fetch(`/api/voice/analytics${query}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Could not load calls.");
      setData(json as Analytics); setCursor(nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load calls."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); const poll = window.setInterval(() => { if (document.visibilityState === "visible") void load(cursor); }, 30_000); return () => { window.clearTimeout(initial); window.clearInterval(poll); }; }, [cursor, load]);
  async function openTranscript(id: string) {
    const response = await fetch(`/api/voice/executions/${id}/transcript`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) { setError(json.error ?? "Transcript unavailable."); return; }
    setTranscript({ id, text: json.transcript ?? null, summary: json.summary ?? null });
  }
  function nextPage() {
    if (!data?.nextCursor) return;
    setPreviousCursors((items) => [...items, cursor]);
    void load(data.nextCursor);
  }
  function previousPage() {
    if (!previousCursors.length) return;
    const previous = previousCursors.at(-1) ?? null;
    setPreviousCursors((items) => items.slice(0, -1));
    void load(previous);
  }

  return <main className="mx-auto max-w-7xl space-y-6 p-6">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Call Intelligence</h1><p className="text-sm text-muted-foreground">Outbound call outcomes, recordings, and provider billing.</p></div><Button onClick={() => void load(cursor)} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</Button></div>
    {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {loading && !data ? <p className="text-sm text-muted-foreground">Loading call intelligence...</p> : <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Metric title="Total Calls" value={String(data?.totalCalls ?? 0)} />
        <Metric title="Answer Rate" value={`${Math.round((data?.answerRate ?? 0) * 100)}%`} detail={`${data?.answeredCalls ?? 0} answered`} />
        <Metric title="Total Minutes Talked" value={minutes(data?.totalDurationSeconds ?? 0)} />
        <Card><CardHeader><CardTitle className="text-sm">Bolna provider spend — billed directly by Bolna</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">{data?.currencyTotals.length ? data.currencyTotals.map((total) => <p key={total.currency}>{providerCost(total.currency, total.costMinorUnits)}</p>) : <p className="text-muted-foreground">No provider cost yet.</p>}</CardContent></Card>
        <Metric title="SalesEngAI platform credits" value={String(data?.platformCreditsRemaining ?? 0)} detail="remaining" />
      </section>
      {!data?.calls.length ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No provider-accepted calls match these filters yet.</CardContent></Card> :
        <Card><CardHeader><CardTitle>Call log</CardTitle></CardHeader><CardContent className="space-y-3 overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead className="border-b text-muted-foreground"><tr><th className="p-2">Lead</th><th className="p-2">Time</th><th className="p-2">Duration</th><th className="p-2">Status</th><th className="p-2">Outcome</th><th className="p-2">Bolna cost</th><th className="p-2">Evidence</th><th className="p-2">Action</th></tr></thead><tbody>{data.calls.map((call) => <tr className="border-b align-top" key={call.id}><td className="p-2">{call.leadName ?? "Deleted lead"}</td><td className="p-2">{new Date(call.createdAt).toLocaleString()}</td><td className="p-2">{call.durationSeconds}s</td><td className="p-2"><span>{call.status}</span><small className="block text-muted-foreground">{call.providerStatus ?? "-"}</small></td><td className="p-2">{call.outcome ?? "-"}</td><td className="p-2">{providerCost(call.costCurrency ?? "BOLNA_CENTS", call.costMinorUnits)}</td><td className="p-2 space-x-2">{call.hasRecording && <audio controls preload="none" className="inline-block h-8 max-w-40" src={`/api/voice/executions/${call.id}/recording`} />}{call.hasTranscript && <Button variant="link" className="h-auto p-0" onClick={() => void openTranscript(call.id)}>Transcript</Button>}</td><td className="p-2">{call.prospectId ? <VoiceCallOverride leadId={call.prospectId} /> : "-"}</td></tr>)}</tbody></table><div className="flex items-center justify-end gap-2"><Button variant="outline" size="icon" aria-label="Previous call log page" title="Previous page" disabled={loading || previousCursors.length === 0} onClick={previousPage}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label="Next call log page" title="Next page" disabled={loading || !data.nextCursor} onClick={nextPage}><ChevronRight /></Button></div></CardContent></Card>}
    </>}
    {transcript && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><Card className="max-h-[80vh] w-full max-w-2xl overflow-auto"><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Call transcript</CardTitle><Button variant="ghost" onClick={() => setTranscript(null)}>Close</Button></CardHeader><CardContent className="space-y-4">{transcript.summary && <p className="whitespace-pre-wrap text-sm">{transcript.summary}</p>}<pre className="whitespace-pre-wrap break-words rounded bg-muted p-3 text-sm">{transcript.text ?? "No transcript was supplied by Bolna."}</pre></CardContent></Card></div>}
  </main>;
}

function Metric({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return <Card><CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{value}</p>{detail && <p className="text-xs text-muted-foreground">{detail}</p>}</CardContent></Card>;
}
