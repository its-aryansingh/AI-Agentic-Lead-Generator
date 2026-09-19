"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function VoiceCallOverride({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [approval, setApproval] = useState<{ approvalId: string; confirmationToken: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [done, setDone] = useState<string | null>(null);
  async function preview() {
    setBusy(true); setError(null);
    try { const res = await fetch("/api/voice/qualification", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "preview", leadId, overrideReason: reason }) }); const json = await res.json(); if (!res.ok) throw new Error(json.error); setApproval(json); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not prepare Call Again."); } finally { setBusy(false); }
  }
  async function apply() {
    if (!approval) return; setBusy(true); setError(null);
    try { const res = await fetch("/api/voice/qualification", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "apply", leadId, overrideReason: reason, ...approval }) }); const json = await res.json(); if (!res.ok) throw new Error(json.message ?? json.error); setDone(json.status === "scheduled" ? "Override call scheduled." : "Override call accepted by Bolna."); setApproval(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Call Again was blocked."); } finally { setBusy(false); }
  }
  return <div className="space-y-2"><Button type="button" variant="outline" onClick={() => { setOpen(true); setDone(null); }}>Call Again (Override)</Button>{done && <p className="text-sm text-emerald-600">{done}</p>}{open && <div role="dialog" aria-modal="true" className="rounded-md border bg-muted/30 p-3 space-y-3"><strong>Call Again requires approval</strong><p className="text-xs text-muted-foreground">This only requests another attempt. It never overrides consent, DNC/suppression, E.164 validation, active connection, valid transfer number, or calling hours.</p><textarea aria-label="Override reason" className="w-full rounded border bg-background p-2 text-sm" value={reason} onChange={(e) => { setReason(e.target.value); setApproval(null); }} placeholder="Why is another call necessary?" minLength={10} maxLength={500} />{error && <p className="text-sm text-destructive">{error}</p>}{approval ? <Button type="button" disabled={busy} onClick={apply}>{busy ? "Calling…" : "Confirm Call Again"}</Button> : <Button type="button" disabled={busy || reason.trim().length < 10} onClick={preview}>{busy ? "Preparing…" : "Review override"}</Button>}<Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button></div>}</div>;
}
