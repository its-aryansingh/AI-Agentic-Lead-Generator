"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Mail,
  Search,
  Calendar,
  Flame,
  UserCheck,
  HelpCircle,
  Shield,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { markHandled } from "@/app/app/actions";

export interface InboxItem {
  id: string; // classification id
  recipientId: string;
  category: string;
  confidence: number | null;
  snippet: string | null;
  wantsMeeting: boolean;
  needsHuman: boolean;
  handled: boolean;
  createdAt: string;

  // Recipient info
  recipientEmail: string | null;

  // Lead info
  prospectId: string | null;
  leadName: string | null;
  leadCompany: string | null;
  leadTitle: string | null;
  leadPhone: string | null;
  leadStatus: string | null;
  qualificationBucket: string | null;
  nextAction: string | null;
  handoffSummary: string | null;

  // Campaign info
  campaignName: string | null;
}

const CATEGORY_TABS = [
  { id: "all", label: "All Inbound", icon: Mail },
  { id: "hot", label: "Hot & Meeting Requests", icon: Flame },
  { id: "interested", label: "Interested", icon: Sparkles },
  { id: "question", label: "Questions", icon: HelpCircle },
  { id: "objection", label: "Objections", icon: Shield },
  { id: "handled", label: "Handled", icon: CheckCircle2 },
] as const;

export function InboxClient({ initialItems }: { initialItems: InboxItem[] }) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<string>("all");
  const [handledIds, setHandledIds] = React.useState<Set<string>>(
    new Set(initialItems.filter((i) => i.handled).map((i) => i.id)),
  );
  const [selectedItem, setSelectedItem] = React.useState<InboxItem | null>(
    null,
  );

  // Compute metrics
  const totalCount = initialItems.length;
  const hotCount = initialItems.filter(
    (i) => i.wantsMeeting || i.qualificationBucket === "hot",
  ).length;
  const unhandledCount = initialItems.filter(
    (i) => !handledIds.has(i.id),
  ).length;
  const questionCount = initialItems.filter(
    (i) => i.category.toLowerCase() === "question",
  ).length;

  // Filter items
  const filteredItems = React.useMemo(() => {
    return initialItems.filter((item) => {
      const isHandled = handledIds.has(item.id);

      // Category / Tab filter
      if (selectedCategory === "handled") {
        if (!isHandled) return false;
      } else if (selectedCategory === "hot") {
        if (
          !item.wantsMeeting &&
          item.qualificationBucket !== "hot" &&
          item.category.toLowerCase() !== "interested"
        )
          return false;
        if (isHandled) return false;
      } else if (selectedCategory !== "all") {
        if (item.category.toLowerCase() !== selectedCategory.toLowerCase())
          return false;
        if (isHandled) return false;
      } else {
        // "all" tab shows unhandled by default, or all if handled tab not selected
        // We show all items in "all" tab
      }

      // Search Query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const name = (item.leadName ?? "").toLowerCase();
        const company = (item.leadCompany ?? "").toLowerCase();
        const title = (item.leadTitle ?? "").toLowerCase();
        const email = (item.recipientEmail ?? "").toLowerCase();
        const snippet = (item.snippet ?? "").toLowerCase();
        const category = (item.category ?? "").toLowerCase();

        return (
          name.includes(query) ||
          company.includes(query) ||
          title.includes(query) ||
          email.includes(query) ||
          snippet.includes(query) ||
          category.includes(query)
        );
      }

      return true;
    });
  }, [initialItems, selectedCategory, searchQuery, handledIds]);

  const handleToggleHandled = async (e: React.MouseEvent, item: InboxItem) => {
    e.stopPropagation();
    const isCurrentlyHandled = handledIds.has(item.id);

    setHandledIds((prev) => {
      const next = new Set(prev);
      if (isCurrentlyHandled) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });

    const formData = new FormData();
    formData.append("id", item.id);
    await markHandled(formData);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Metric Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card size="sm" className="bg-card/50 border-border/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground uppercase font-medium">
                Total Inbound
              </span>
              <span className="text-2xl font-bold mt-0.5">{totalCount}</span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Mail className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card
          size="sm"
          className="bg-card/50 border-border/50 hover:border-amber-500/40 transition-colors"
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs text-amber-500 font-medium uppercase">
                🔥 Hot / Meeting
              </span>
              <span className="text-2xl font-bold mt-0.5 text-amber-400">
                {hotCount}
              </span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
              <Flame className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="bg-card/50 border-border/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground uppercase font-medium">
                Questions
              </span>
              <span className="text-2xl font-bold mt-0.5">{questionCount}</span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
              <HelpCircle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="bg-card/50 border-border/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground uppercase font-medium">
                Needs Attention
              </span>
              <span className="text-2xl font-bold mt-0.5 text-emerald-400">
                {unhandledCount}
              </span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <UserCheck className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 2. Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full">
          {CATEGORY_TABS.map((tab) => {
            const Icon = tab.icon;
            const count =
              tab.id === "all"
                ? initialItems.length
                : tab.id === "hot"
                  ? hotCount
                  : tab.id === "handled"
                    ? handledIds.size
                    : initialItems.filter(
                        (i) => i.category.toLowerCase() === tab.id,
                      ).length;

            return (
              <button
                key={tab.id}
                onClick={() => setSelectedCategory(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap",
                  selectedCategory === tab.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "px-1.5 py-0.2 text-[10px] rounded-full",
                    selectedCategory === tab.id
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search leads, email, or message…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs bg-card/60"
          />
        </div>
      </div>

      {/* 3. Structured Data Table */}
      <div className="border border-border/50 rounded-xl overflow-hidden bg-card/40 backdrop-blur-sm shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 border-b border-border/60 text-muted-foreground font-medium uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Lead / Prospect</th>
                <th className="py-3 px-4">Reply Signal</th>
                <th className="py-3 px-4 min-w-[280px]">
                  Latest Message Snippet
                </th>
                <th className="py-3 px-4">AI Qualification</th>
                <th className="py-3 px-4">Next Action</th>
                <th className="py-3 px-4">Received</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <EmptyState
                      icon={<Mail className="w-8 h-8 opacity-60" />}
                      title="No replies match your filter"
                      description={
                        searchQuery
                          ? "Try modifying your search query."
                          : "When prospects respond to your cold emails, their replies and qualification will appear here."
                      }
                    />
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isHandled = handledIds.has(item.id);
                  const isHot =
                    item.wantsMeeting ||
                    item.qualificationBucket === "hot" ||
                    item.category.toLowerCase() === "interested";

                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className={cn(
                        "group transition-colors cursor-pointer hover:bg-muted/30",
                        isHandled && "opacity-60 bg-muted/10",
                      )}
                    >
                      {/* 1. Lead / Prospect Column */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div
                              className={cn(
                                "w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs uppercase",
                                isHot
                                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {item.leadName
                                ? item.leadName.charAt(0)
                                : (item.recipientEmail?.charAt(0) ?? "?")}
                            </div>
                            {item.wantsMeeting && (
                              <div
                                className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-violet-600 text-white flex items-center justify-center text-[9px] shadow-sm"
                                title="Meeting Requested"
                              >
                                📅
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col max-w-[180px]">
                            <span className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                              {item.leadName || "(Unknown Lead)"}
                            </span>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {item.leadTitle ? `${item.leadTitle} · ` : ""}
                              {item.leadCompany || "Company"}
                            </span>
                            <span className="text-[10px] text-muted-foreground/80 font-mono truncate">
                              {item.recipientEmail || item.recipientId}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 2. Reply Signal & Category */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1 items-start">
                          <CategoryBadge
                            category={item.category}
                            confidence={item.confidence}
                          />
                          {item.wantsMeeting && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/30 font-medium flex items-center gap-1"
                            >
                              <Calendar className="w-2.5 h-2.5" />
                              Wants Meeting
                            </Badge>
                          )}
                        </div>
                      </td>

                      {/* 3. Latest Message Snippet */}
                      <td className="py-3 px-4">
                        <div className="text-xs text-foreground/90 bg-muted/20 border border-border/30 rounded-lg p-2.5 line-clamp-3 leading-relaxed">
                          &ldquo;{item.snippet ?? "(no message content)"}&rdquo;
                        </div>
                      </td>

                      {/* 4. AI Qualification Bucket & Status */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1 items-start">
                          <BucketBadge bucket={item.qualificationBucket} />
                          <span className="text-[10px] text-muted-foreground capitalize">
                            Status:{" "}
                            <strong className="text-foreground font-medium">
                              {item.leadStatus ?? "new"}
                            </strong>
                          </span>
                        </div>
                      </td>

                      {/* 5. Recommended Next Action */}
                      <td className="py-3 px-4">
                        <NextActionBadge action={item.nextAction} />
                      </td>

                      {/* 6. Received Timestamp */}
                      <td className="py-3 px-4 whitespace-nowrap text-muted-foreground text-[11px]">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 opacity-60" />
                          <span>{formatTimeAgo(item.createdAt)}</span>
                        </div>
                      </td>

                      {/* 7. Action Buttons */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {/* This repo's Button does not implement asChild
                              (it has no Slot), so the canonical shadcn
                              fallback is to style the Link directly with
                              buttonVariants. SalesEngAIMVP shipped the
                              asChild form against the same Button; it does
                              not typecheck. */}
                          {item.prospectId && (
                            <Link
                              href={`/app/leads/${item.prospectId}`}
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                buttonVariants({ size: "xs", variant: "default" }),
                                "gap-1 shadow-sm font-medium",
                              )}
                            >
                              Open Lead
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </Link>
                          )}

                          <Button
                            size="xs"
                            variant={isHandled ? "outline" : "secondary"}
                            onClick={(e) => handleToggleHandled(e, item)}
                            className={cn(
                              "gap-1 text-[11px]",
                              isHandled && "text-muted-foreground",
                            )}
                            title={
                              isHandled ? "Mark as unhandled" : "Mark handled"
                            }
                          >
                            <CheckCircle2
                              className={cn(
                                "w-3.5 h-3.5",
                                isHandled ? "text-emerald-500" : "opacity-60",
                              )}
                            />
                            {isHandled ? "Handled" : "Done"}
                          </Button>
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

      {/* 4. Quick Preview Drawer / Modal when row selected */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedItem(null)}
        >
          <Card
            className="w-full max-w-2xl bg-card border-border/80 shadow-2xl overflow-hidden animate-slide-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border/60 flex items-center justify-between bg-muted/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                  {selectedItem.leadName?.charAt(0) ?? "L"}
                </div>
                <div className="flex flex-col">
                  <h3 className="font-bold text-base text-foreground">
                    {selectedItem.leadName || selectedItem.recipientEmail}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {selectedItem.leadTitle
                      ? `${selectedItem.leadTitle} · `
                      : ""}
                    {selectedItem.leadCompany || "Company"}
                  </span>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedItem(null)}
              >
                ✕
              </Button>
            </div>

            <CardContent className="p-6 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
              {/* Inbound Reply Card */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase font-bold tracking-wider text-muted-foreground">
                    Inbound Prospect Reply
                  </span>
                  <CategoryBadge
                    category={selectedItem.category}
                    confidence={selectedItem.confidence}
                  />
                </div>
                <div className="p-3.5 bg-muted/30 border border-border/40 rounded-xl text-sm leading-relaxed whitespace-pre-wrap font-sans text-foreground/95">
                  &ldquo;{selectedItem.snippet}&rdquo;
                </div>
              </div>

              {/* Qualification & Handoff Summary */}
              {selectedItem.handoffSummary && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    AI Qualification &amp; Handoff Brief
                  </span>
                  <div className="p-3.5 bg-primary/5 border border-primary/20 rounded-xl text-xs leading-relaxed whitespace-pre-wrap font-mono text-foreground/90">
                    {selectedItem.handoffSummary}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-border/50 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    handleToggleHandled(e, selectedItem);
                    setSelectedItem(null);
                  }}
                  className="gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  {handledIds.has(selectedItem.id)
                    ? "Mark Unhandled"
                    : "Mark Handled"}
                </Button>

                {selectedItem.prospectId && (
                  <Link
                    href={`/app/leads/${selectedItem.prospectId}`}
                    className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
                  >
                    Go to Lead Workspace
                    <ExternalLink className="w-4 h-4" />
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Helper Badges & Utilities
// ---------------------------------------------------------------------

function CategoryBadge({
  category,
  confidence,
}: {
  category: string;
  confidence: number | null;
}) {
  const cat = category.toLowerCase();
  let color = "bg-sky-500/10 text-sky-400 border-sky-500/30";
  let label = category;

  if (cat === "interested") {
    color = "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    label = "Interested";
  } else if (cat === "question") {
    color = "bg-amber-500/15 text-amber-400 border-amber-500/30";
    label = "Question";
  } else if (cat === "objection") {
    color = "bg-rose-500/15 text-rose-400 border-rose-500/30";
    label = "Objection";
  } else if (cat === "out_of_office") {
    color = "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
    label = "Out of Office";
  } else if (cat === "unsubscribe") {
    color = "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    label = "Unsubscribed";
  }

  return (
    <Badge
      variant="outline"
      className={cn("text-[11px] font-medium capitalize", color)}
    >
      {label}
      {confidence !== null && (
        <span className="ml-1 opacity-70 font-normal">
          ({Math.round(confidence * 100)}%)
        </span>
      )}
    </Badge>
  );
}

function BucketBadge({ bucket }: { bucket: string | null }) {
  const b = (bucket ?? "not_determined").toLowerCase();
  if (b === "hot") {
    return (
      <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[10px] font-bold">
        🔥 Hot Lead
      </Badge>
    );
  }
  if (b === "warm") {
    return (
      <Badge className="bg-blue-500/20 text-blue-400 border border-blue-500/40 text-[10px] font-bold">
        ⚡ Warm Lead
      </Badge>
    );
  }
  if (b === "cold") {
    return (
      <Badge className="bg-zinc-500/20 text-zinc-400 border border-zinc-500/40 text-[10px]">
        ❄️ Cold
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      Pending
    </Badge>
  );
}

function NextActionBadge({ action }: { action: string | null }) {
  const act = (action ?? "none").toLowerCase();
  if (act === "human_handoff") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium">
        👤 Human Handoff
      </Badge>
    );
  }
  if (act === "book_meeting") {
    return (
      <Badge className="bg-violet-500/15 text-violet-300 border border-violet-500/30 text-[10px] font-medium">
        📅 Book Meeting
      </Badge>
    );
  }
  if (act === "follow_up") {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        ✉️ Follow-up
      </Badge>
    );
  }
  return (
    <span className="text-[11px] text-muted-foreground capitalize">
      {action ?? "None"}
    </span>
  );
}

function formatTimeAgo(dateStr: string): string {
  try {
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const diffSeconds = Math.round(
      (new Date(dateStr).getTime() - new Date().getTime()) / 1000,
    );
    const diffMinutes = Math.round(diffSeconds / 60);
    const diffHours = Math.round(diffMinutes / 60);
    const diffDays = Math.round(diffHours / 24);

    if (Math.abs(diffMinutes) < 60) {
      if (Math.abs(diffMinutes) <= 1) return "just now";
      return rtf.format(diffMinutes, "minute");
    }
    if (Math.abs(diffHours) < 24) {
      return rtf.format(diffHours, "hour");
    }
    return rtf.format(diffDays, "day");
  } catch {
    return dateStr;
  }
}
