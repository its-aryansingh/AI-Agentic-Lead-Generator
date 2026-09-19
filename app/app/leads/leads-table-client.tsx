"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Trash2,
  ExternalLink,
  Mail,
  Phone,
  Filter,
  CheckCircle2,
  Sparkles,
  Globe,
  Loader2,
} from "lucide-react";
import {
  deleteLeadAction,
  deleteLeadsAction,
  enrichLeadsAction,
} from "@/app/app/leads/actions";
import { leadStatusLabel } from "@/lib/lead-status";

export interface LeadRow {
  id: string;
  input_name: string | null;
  input_company: string | null;
  input_title: string | null;
  email: string | null;
  phone: string | null;
  company_domain?: string | null;
  enrichment_status?: string | null;
  lead_status: string | null;
  next_action: string | null;
  next_action_at: string | null;
  email_subject: string | null;
  research_summary: string | null;
  created_at: string | null;
}

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  new: {
    label: "New",
    className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  researching: {
    label: "Researching",
    className: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  },
  ready: {
    label: "Ready",
    className: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  },
  contacted: {
    label: "Contacted",
    className: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  },
  engaged: {
    label: "Engaged",
    className: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  qualified: {
    label: "Qualified",
    className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  },
  disqualified: {
    label: "Disqualified",
    className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  },
  converted: {
    label: "Converted",
    className: "bg-green-500/10 text-green-500 border-green-500/20",
  },
  do_not_contact: {
    label: "Do Not Contact",
    className: "bg-red-500/10 text-red-500 border-red-500/20",
  },
};

const ENRICHMENT_STATUS_VARIANTS: Record<
  string,
  { label: string; className: string }
> = {
  completed: {
    label: "Enriched",
    className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  },
  queued: {
    label: "Queued",
    className: "bg-blue-500/10 text-blue-600 border-blue-500/20 animate-pulse",
  },
  running: {
    label: "Scraping...",
    className:
      "bg-indigo-500/10 text-indigo-600 border-indigo-500/20 animate-pulse",
  },
  partial: {
    label: "Partial",
    className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/10 text-red-600 border-red-500/20",
  },
  blocked: {
    label: "Blocked",
    className: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
  },
  not_started: {
    label: "Not Enriched",
    className: "bg-muted text-muted-foreground border-border",
  },
};

export function LeadsTableClient({
  initialLeads,
}: {
  initialLeads: LeadRow[];
}) {
  const router = useRouter();
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [router]);
  const [deletedIds, setDeletedIds] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null,
  );
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = React.useState(false);

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [isEnrichingBulk, setIsEnrichingBulk] = React.useState(false);
  const [enrichingRowId, setEnrichingRowId] = React.useState<string | null>(
    null,
  );
  const [bulkFeedback, setBulkFeedback] = React.useState<string | null>(null);
  const [outreachChannel, setOutreachChannel] = React.useState<
    "email" | "voice" | "smart_both"
  >("email");
  const [outreachPreview, setOutreachPreview] = React.useState<{
    eligible: number;
    skipped: number;
    estimatedCredits: number;
    approvalId: string;
    confirmationToken: string;
  } | null>(null);
  const [outreachRun, setOutreachRun] = React.useState<string | null>(null);
  const [scheduleFeedback, setScheduleFeedback] = React.useState<string | null>(
    null,
  );
  const [outreachBusy, setOutreachBusy] = React.useState(false);

  const leads = React.useMemo(() => {
    return initialLeads.filter((l) => !deletedIds.has(l.id));
  }, [initialLeads, deletedIds]);

  const filteredLeads = React.useMemo(() => {
    return leads.filter((lead) => {
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (lead.input_name?.toLowerCase() ?? "").includes(q) ||
        (lead.input_company?.toLowerCase() ?? "").includes(q) ||
        (lead.input_title?.toLowerCase() ?? "").includes(q) ||
        (lead.email?.toLowerCase() ?? "").includes(q) ||
        (lead.phone?.toLowerCase() ?? "").includes(q);

      const matchesStatus =
        statusFilter === "all" || lead.lead_status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [leads, search, statusFilter]);

  const allFilteredSelected =
    filteredLeads.length > 0 &&
    filteredLeads.every((l) => selectedIds.has(l.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads.map((l) => l.id)));
    }
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkEnrich() {
    if (selectedIds.size === 0) return;
    setIsEnrichingBulk(true);
    setBulkFeedback(null);
    try {
      const res = await enrichLeadsAction(Array.from(selectedIds));
      if (res.success) {
        setBulkFeedback(
          `Public website enrichment queued for ${res.enqueued ?? selectedIds.size} lead(s).`,
        );
        setSelectedIds(new Set());
        router.refresh();
      } else {
        alert(res.error || "Failed to start bulk enrichment.");
      }
    } catch {
      alert("Failed to start bulk enrichment.");
    } finally {
      setIsEnrichingBulk(false);
    }
  }

  async function previewOutreach() {
    setOutreachBusy(true);
    setOutreachRun(null);
    try {
      const res = await fetch("/api/outreach/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: outreachChannel,
          prospectIds: Array.from(selectedIds),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setOutreachPreview(json);
    } catch (e) {
      setBulkFeedback(
        e instanceof Error ? e.message : "Could not preview outreach.",
      );
    } finally {
      setOutreachBusy(false);
    }
  }
  async function startOutreach() {
    if (!outreachPreview) return;
    setOutreachBusy(true);
    try {
      const res = await fetch("/api/outreach/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approvalId: outreachPreview.approvalId,
          confirmationToken: outreachPreview.confirmationToken,
          consentConfirmed: true,
          idempotencyKey: `ui-${outreachPreview.approvalId}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setOutreachRun(json.runId);
      setOutreachPreview(null);
      router.refresh();
    } catch (e) {
      setBulkFeedback(
        e instanceof Error ? e.message : "Could not start outreach.",
      );
    } finally {
      setOutreachBusy(false);
    }
  }
  async function scheduleOutreach() {
    if (!outreachPreview) return;
    setOutreachBusy(true);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/outreach/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${outreachChannel} outreach`,
          channel: outreachChannel,
          approvalId: outreachPreview.approvalId,
          confirmationToken: outreachPreview.confirmationToken,
          consentConfirmed: true,
          timezone: timeZone,
          localTime: "09:00",
          weekdays: [1, 2, 3, 4, 5],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setScheduleFeedback(
        `Schedule saved. First run: ${new Date(json.schedule.next_run_at).toLocaleString()}`,
      );
      setOutreachPreview(null);
    } catch (e) {
      setBulkFeedback(
        e instanceof Error ? e.message : "Could not save schedule.",
      );
    } finally {
      setOutreachBusy(false);
    }
  }

  async function handleSingleEnrich(leadId: string) {
    setEnrichingRowId(leadId);
    try {
      const res = await enrichLeadsAction([leadId]);
      if (res.success) {
        router.refresh();
      } else {
        alert(res.error || "Failed to start enrichment.");
      }
    } catch {
      alert("Failed to start enrichment.");
    } finally {
      setEnrichingRowId(null);
    }
  }

  async function handleDelete(leadId: string) {
    setDeletingId(leadId);
    try {
      const res = await deleteLeadAction(leadId);
      if (res.success && res.deletedIds.includes(leadId)) {
        setDeletedIds((prev) => new Set(prev).add(leadId));
        setConfirmDeleteId(null);
        router.refresh();
      } else if (res.success && res.skippedIds.includes(leadId)) {
        alert("This lead has accepted call history and cannot be deleted because its one-call safety record must be retained.");
        setConfirmDeleteId(null);
      } else {
        alert(res.error || "Failed to delete lead");
      }
    } catch {
      alert("Failed to delete lead");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setIsDeletingBulk(true);
    setBulkFeedback(null);
    try {
      const res = await deleteLeadsAction(ids);
      if (!res.success) {
        setBulkFeedback(res.error || "Failed to delete selected leads.");
        return;
      }
      setDeletedIds((previous) => {
        const next = new Set(previous);
        res.deletedIds.forEach((id) => next.add(id));
        return next;
      });
      setSelectedIds(new Set(res.skippedIds));
      setConfirmBulkDelete(false);
      setBulkFeedback(
        res.skippedIds.length
          ? `Deleted ${res.deletedIds.length} lead(s). Kept ${res.skippedIds.length} lead(s) with accepted call history to preserve one-call safety.`
          : `Deleted ${res.deletedIds.length} selected lead(s).`,
      );
      router.refresh();
    } catch {
      setBulkFeedback("Failed to delete selected leads.");
    } finally {
      setIsDeletingBulk(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-foreground shadow-sm">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-primary">
              {selectedIds.size} {selectedIds.size === 1 ? "lead" : "leads"}{" "}
              selected
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              className="h-7 text-xs px-2"
            >
              Clear selection
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              value={outreachChannel}
              onChange={(e) => {
                setOutreachChannel(e.target.value as typeof outreachChannel);
                setOutreachPreview(null);
              }}
              className="h-7 rounded border bg-background px-2 text-xs"
              aria-label="Outreach channel"
            >
              <option value="email">Email</option>
              <option value="voice">Call</option>
              <option value="smart_both">Smart Both</option>
            </select>
            {outreachPreview ? (
              <>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={outreachBusy}
                  onClick={startOutreach}
                >
                  {outreachBusy ? "Starting…" : "Confirm & Run Now"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={outreachBusy}
                  onClick={scheduleOutreach}
                >
                  Schedule weekdays
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={outreachBusy}
                onClick={previewOutreach}
              >
                {outreachBusy ? "Previewing…" : "Start Autonomous Outreach"}
              </Button>
            )}
            <Button
              size="sm"
              disabled={isEnrichingBulk}
              onClick={handleBulkEnrich}
              className="h-7 text-xs gap-1.5 bg-primary text-primary-foreground font-medium"
            >
              {isEnrichingBulk ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Queuing enrichment...
                </>
              ) : (
                <>
                  <Globe className="size-3.5" />
                  Enrich Selected ({selectedIds.size})
                </>
                )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isDeletingBulk}
              onClick={() => setConfirmBulkDelete(true)}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <Trash2 className="size-3.5" />
              Delete Selected ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      {confirmBulkDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
          aria-describedby="bulk-delete-description"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-xl">
            <h2 id="bulk-delete-title" className="text-base font-semibold">
              Delete {selectedIds.size} selected {selectedIds.size === 1 ? "lead" : "leads"}?
            </h2>
            <p id="bulk-delete-description" className="text-sm text-muted-foreground">
              This permanently removes the selected lead records and their dependent workflow data. Leads with accepted call history will be kept so the one-call-per-person safety record cannot be bypassed.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isDeletingBulk}
                onClick={() => setConfirmBulkDelete(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isDeletingBulk}
                onClick={handleBulkDelete}
                autoFocus
              >
                {isDeletingBulk ? "Deleting…" : "Delete selected leads"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {outreachPreview && (
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
          Preview: {outreachPreview.eligible} eligible,{" "}
          {outreachPreview.skipped} skipped · estimated{" "}
          {outreachPreview.estimatedCredits} platform credit(s). Confirming
          means you attest that you have lawful permission to contact these
          leads.
        </div>
      )}
      {outreachRun && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-700">
          Outreach run <span className="font-mono">{outreachRun}</span> is
          running. Email is queued through Gmail; calls remain subject to live
          compliance checks.
        </div>
      )}
      {scheduleFeedback && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-700">
          {scheduleFeedback}
        </div>
      )}

      {bulkFeedback && (
        <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 font-medium flex items-center justify-between">
          <span>{bulkFeedback}</span>
          <button
            onClick={() => setBulkFeedback(null)}
            className="text-muted-foreground hover:text-foreground font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}
      {/* Controls: Search and Filter */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search leads by name, company, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="size-4 text-muted-foreground shrink-0" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter leads by workflow status"
            className="h-9 px-3 text-xs rounded-md border border-input bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All Statuses ({leads.length})</option>
            <option value="new">New</option>
            <option value="researching">Researching</option>
            <option value="ready">Ready</option>
            <option value="contacted">Contacted</option>
            <option value="engaged">Engaged</option>
            <option value="qualified">Qualified</option>
            <option value="disqualified">Disqualified</option>
            <option value="converted">Converted</option>
            <option value="do_not_contact">Do Not Contact</option>
          </select>
        </div>
      </div>

      {/* Leads Table */}
      <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
                <th className="w-10 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all leads"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-input text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Enrichment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">AI Outreach</th>
                <th className="px-4 py-3">Next Action</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredLeads.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-muted-foreground text-sm"
                  >
                    {leads.length === 0
                      ? "No leads added yet. Add a lead above or import a CSV to get started."
                      : "No leads match your search/filter criteria."}
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => {
                  const statusInfo = {
                    ...(STATUS_VARIANTS[lead.lead_status ?? "new"] ?? {
                      label: leadStatusLabel(
                        lead.lead_status,
                        lead.next_action,
                      ),
                      className: "bg-muted text-muted-foreground border-border",
                    }),
                    label: leadStatusLabel(lead.lead_status, lead.next_action),
                  };
                  const enrichmentInfo = ENRICHMENT_STATUS_VARIANTS[
                    lead.enrichment_status ?? "not_started"
                  ] ?? {
                    label: lead.enrichment_status ?? "Not Enriched",
                    className: "bg-muted text-muted-foreground border-border",
                  };
                  const isDeleting = deletingId === lead.id;
                  const isConfirming = confirmDeleteId === lead.id;

                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-muted/30 transition-colors group cursor-pointer"
                      onClick={(e) => {
                        // Don't navigate if clicking action buttons or checkbox
                        const target = e.target as HTMLElement;
                        if (
                          target.closest("button") ||
                          target.closest("a") ||
                          target.closest("input")
                        )
                          return;
                        router.push(`/app/leads/${lead.id}`);
                      }}
                    >
                      {/* Selection Checkbox */}
                      <td
                        className="w-10 px-3 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${lead.input_name || "lead"}`}
                          checked={selectedIds.has(lead.id)}
                          onChange={() => toggleSelectOne(lead.id)}
                          className="rounded border-input text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                        />
                      </td>

                      {/* Name & Title */}
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/leads/${lead.id}`}
                          className="font-medium text-foreground hover:underline flex items-center gap-1.5"
                        >
                          {lead.input_name || "Unnamed Lead"}
                        </Link>
                        {lead.input_title && (
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {lead.input_title}
                          </div>
                        )}
                      </td>

                      {/* Company */}
                      <td className="px-4 py-3 text-muted-foreground">
                        {lead.input_company ? (
                          <span className="font-medium text-foreground">
                            {lead.input_company}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>

                      {/* Contact Info */}
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          {lead.email ? (
                            <div className="flex items-center gap-1.5 text-xs text-foreground">
                              <Mail className="size-3 text-muted-foreground shrink-0" />
                              <span
                                className="truncate max-w-[180px]"
                                title={lead.email}
                              >
                                {lead.email}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">
                              No email
                            </span>
                          )}
                          {lead.phone && (
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Phone className="size-2.5 shrink-0" />
                              <span>{lead.phone}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Enrichment Status */}
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`text-xs px-2 py-0.5 font-normal border ${enrichmentInfo.className}`}
                        >
                          {enrichmentInfo.label}
                        </Badge>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`text-xs px-2 py-0.5 font-normal border ${statusInfo.className}`}
                        >
                          {statusInfo.label}
                        </Badge>
                      </td>

                      {/* AI Outreach / Draft status */}
                      <td className="px-4 py-3 text-xs">
                        {lead.lead_status === "contacted" ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                            <CheckCircle2 className="size-3.5" /> Sent
                          </span>
                        ) : lead.email_subject ? (
                          <span className="inline-flex items-center gap-1 text-amber-500 font-medium">
                            <Sparkles className="size-3.5" /> Draft Ready
                          </span>
                        ) : lead.research_summary ? (
                          <span className="text-muted-foreground">
                            Researched
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">
                            Not Drafted
                          </span>
                        )}
                      </td>

                      {/* Next Action */}
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {lead.next_action || "review"}
                      </td>

                      {/* Actions: Enrich, View & Delete */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              enrichingRowId === lead.id ||
                              lead.enrichment_status === "running" ||
                              lead.enrichment_status === "queued"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSingleEnrich(lead.id);
                            }}
                            className="h-8 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10 border-primary/20"
                            title="Run website crawler & contact enrichment"
                          >
                            {enrichingRowId === lead.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <>
                                <Globe className="size-3.5 mr-1" /> Enrich
                              </>
                            )}
                          </Button>

                          <Link href={`/app/leads/${lead.id}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              title="Open lead workspace"
                            >
                              <ExternalLink className="size-3.5 mr-1" /> Open
                            </Button>
                          </Link>

                          {isConfirming ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={isDeleting}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(lead.id);
                                }}
                                className="h-8 px-2 text-xs"
                              >
                                {isDeleting ? "..." : "Confirm"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId(null);
                                }}
                                className="h-8 px-1.5 text-xs"
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(lead.id);
                              }}
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title="Delete lead"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
