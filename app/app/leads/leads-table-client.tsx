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
} from "lucide-react";
import { deleteLeadAction } from "@/app/app/leads/actions";

export interface LeadRow {
  id: string;
  input_name: string | null;
  input_company: string | null;
  input_title: string | null;
  email: string | null;
  phone: string | null;
  lead_status: string | null;
  next_action: string | null;
  next_action_at: string | null;
  email_subject: string | null;
  research_summary: string | null;
  created_at: string | null;
}

const STATUS_VARIANTS: Record<
  string,
  { label: string; className: string }
> = {
  new: { label: "New", className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  researching: { label: "Researching", className: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
  ready: { label: "Ready", className: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  contacted: { label: "Contacted", className: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20" },
  engaged: { label: "Engaged", className: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20" },
  qualified: { label: "Qualified", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  disqualified: { label: "Disqualified", className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
  converted: { label: "Converted", className: "bg-green-500/10 text-green-500 border-green-500/20" },
  do_not_contact: { label: "Do Not Contact", className: "bg-red-500/10 text-red-500 border-red-500/20" },
};

export function LeadsTableClient({ initialLeads }: { initialLeads: LeadRow[] }) {
  const router = useRouter();
  const [deletedIds, setDeletedIds] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

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

  async function handleDelete(leadId: string) {
    setDeletingId(leadId);
    try {
      const res = await deleteLeadAction(leadId);
      if (res.success) {
        setDeletedIds((prev) => new Set(prev).add(leadId));
        setConfirmDeleteId(null);
        router.refresh();
      } else {
        alert(res.error || "Failed to delete lead");
      }
    } catch {
      alert("Failed to delete lead");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
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
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">AI Outreach</th>
                <th className="px-4 py-3">Next Action</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    {leads.length === 0
                      ? "No leads added yet. Add a lead above or import a CSV to get started."
                      : "No leads match your search/filter criteria."}
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => {
                  const statusInfo = STATUS_VARIANTS[lead.lead_status ?? "new"] ?? {
                    label: lead.lead_status ?? "Unknown",
                    className: "bg-muted text-muted-foreground border-border",
                  };
                  const isDeleting = deletingId === lead.id;
                  const isConfirming = confirmDeleteId === lead.id;

                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-muted/30 transition-colors group cursor-pointer"
                      onClick={(e) => {
                        // Don't navigate if clicking action buttons
                        const target = e.target as HTMLElement;
                        if (target.closest("button") || target.closest("a")) return;
                        router.push(`/app/leads/${lead.id}`);
                      }}
                    >
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
                              <span className="truncate max-w-[180px]" title={lead.email}>
                                {lead.email}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">No email</span>
                          )}
                          {lead.phone && (
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Phone className="size-2.5 shrink-0" />
                              <span>{lead.phone}</span>
                            </div>
                          )}
                        </div>
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
                          <span className="text-muted-foreground">Researched</span>
                        ) : (
                          <span className="text-muted-foreground/60">Not Drafted</span>
                        )}
                      </td>

                      {/* Next Action */}
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {lead.next_action || "review"}
                      </td>

                      {/* Actions: View & Delete */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
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
