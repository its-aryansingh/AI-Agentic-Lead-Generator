"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RefreshCw } from "lucide-react";

type Provider = "hubspot" | "zoho";
type Summary = { fetched: number; created: number; updated: number; unchanged: number; invalid: number; failed: number; nextCursor?: string | null; hasMore?: boolean };
export function CrmSyncDialog({ connectedProviders }: { connectedProviders: Provider[] }) {
  const [open, setOpen] = React.useState(false), [provider, setProvider] = React.useState<Provider>(connectedProviders[0] ?? "hubspot");
  const [limit, setLimit] = React.useState("100"), [modifiedAfter, setModifiedAfter] = React.useState("");
  const [summary, setSummary] = React.useState<Summary | null>(null), [token, setToken] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false), [error, setError] = React.useState<string | null>(null);
  async function request(mode: "preview" | "apply") {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/crm/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, provider, limit: Number(limit), modifiedAfter: modifiedAfter ? new Date(modifiedAfter).toISOString() : undefined, confirmationToken: mode === "apply" ? token : undefined }) });
      const body = await response.json() as { error?: string; summary?: Summary; confirmationToken?: string } & Summary;
      if (!response.ok) throw new Error(body.error ?? "CRM sync failed.");
      if (mode === "preview") { setSummary(body.summary ?? null); setToken(body.confirmationToken ?? null); }
      else { setSummary(body); setToken(null); window.location.reload(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "CRM sync failed."); }
    finally { setLoading(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) { setSummary(null); setToken(null); setError(null); } }}>
    <DialogTrigger render={<Button size="sm" variant="outline" className="text-xs h-8"><RefreshCw className="size-3.5" /> Sync from CRM</Button>} />
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Sync leads from CRM</DialogTitle><DialogDescription>Preview a single CRM page before importing it. Imported contacts never overwrite populated lead fields.</DialogDescription></DialogHeader>
      {connectedProviders.length === 0 ? <div className="space-y-3 rounded-md border p-3"><p className="text-sm">No active CRM connection found.</p><Button render={<Link href="/app/settings/crm" />}>Connect a CRM in settings</Button></div> : <div className="space-y-3">
        <label className="block text-xs font-medium">CRM<select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm">{connectedProviders.map((value) => <option key={value} value={value}>{value === "hubspot" ? "HubSpot" : "Zoho CRM"}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium">Page limit<Input className="mt-1" type="number" min="1" max="100" value={limit} onChange={(e) => setLimit(e.target.value)} /></label><label className="text-xs font-medium">Modified after<Input className="mt-1" type="datetime-local" value={modifiedAfter} onChange={(e) => setModifiedAfter(e.target.value)} /></label></div>
        {summary && <div className="rounded-md bg-muted p-3 text-xs grid grid-cols-3 gap-2"><span>Fetched: {summary.fetched}</span><span>New: {summary.created}</span><span>Matches: {summary.updated + summary.unchanged}</span><span>Invalid: {summary.invalid}</span><span>Failed: {summary.failed}</span><span>Platform credits: 0</span>{summary.hasMore && <span>More available</span>}</div>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>}
      {connectedProviders.length > 0 && <DialogFooter><Button variant="outline" disabled={loading} onClick={() => request("preview")}>{loading ? "Loading…" : "Preview"}</Button>{token && <Button disabled={loading} onClick={() => request("apply")}>{loading ? "Importing…" : "Confirm and import"}</Button>}</DialogFooter>}
    </DialogContent>
  </Dialog>;
}
