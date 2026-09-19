/**
 * Core pure filtering functions for lead search.
 * Decoupled from database IO for comprehensive unit testability.
 */

export const META_TOKENS = new Set([
  "all",
  "lead",
  "leads",
  "present",
  "database",
  "db",
  "list",
  "out",
  "show",
  "get",
  "find",
  "every",
  "everyone",
  "existing",
  "current",
  "our",
  "my",
  "the",
  "them",
  "any",
  "which",
  "who",
  "have",
  "been",
  "not",
  "added",
  "today",
  "called",
  "call",
  "contacted",
  "in",
  "from",
  "to",
  "of",
  "for",
  "as",
  "per",
  "via",
  "is",
  "are",
  "that",
  "there",
  "with",
  "without",
]);

export function isMetaQuery(rawTerm: string): boolean {
  if (!rawTerm || !rawTerm.trim()) return true;
  const cleanTokens = rawTerm
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return cleanTokens.length > 0 && cleanTokens.every((t) => META_TOKENS.has(t));
}

export function extractMeaningfulTerm(rawTerm: string): string {
  const cleanTokens = rawTerm
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const meaningfulTokens = cleanTokens.filter((t) => !META_TOKENS.has(t));
  return meaningfulTokens.length > 0
    ? meaningfulTokens.join(" ")
    : rawTerm.trim().toLowerCase();
}

export interface LeadForFiltering {
  id: string;
  input_name?: string | null;
  input_company?: string | null;
  input_title?: string | null;
  email?: string | null;
  phone?: string | null;
  lead_status?: string | null;
  qualification_bucket?: string | null;
  next_action?: string | null;
  created_at: string;
  handoff_summary?: string | null;
  research_summary?: string | null;
  latest_reply?: {
    category?: string | null;
    snippet?: string | null;
    wants_meeting?: boolean;
    created_at?: string;
  } | null;
  latest_call?: {
    status: string;
    provider_status?: string | null;
    outcome?: string | null;
    duration_seconds?: number | null;
    created_at?: string;
  } | null;
  calls?: Array<unknown>;
}

export function filterLeadsByCallStatus<T extends LeadForFiltering>(
  leads: T[],
  callStatus?: string,
): T[] {
  if (!callStatus || callStatus === "any") return leads;
  return leads.filter((p) => {
    const call = p.latest_call;
    if (callStatus === "not_called") {
      // The caller supplies person-level history, not merely a row-local
      // nullable field. A failed reservation never counts as a completed
      // person contact attempt and remains eligible for a first real call.
      return !call || call.status === "failed";
    }
    if (!call) return false;
    if (callStatus === "called") return true;
    if (callStatus === "no_answer") {
      return (
        call.status === "no_answer" ||
        call.provider_status === "no-answer" ||
        call.provider_status === "no_answer" ||
        call.outcome === "no_answer"
      );
    }
    if (callStatus === "answered") {
      return (
        call.status === "completed" ||
        ["interested", "question", "objection", "not_interested"].includes(
          call.outcome ?? "",
        )
      );
    }
    if (callStatus === "completed") return call.status === "completed";
    if (callStatus === "busy") {
      return call.status === "busy" || call.provider_status === "busy";
    }
    if (callStatus === "failed") return call.status === "failed";
    return true;
  });
}

export function filterLeadsByPhone<T extends LeadForFiltering>(
  leads: T[],
  hasPhone?: boolean,
): T[] {
  if (hasPhone === undefined) return leads;
  return leads.filter((p) =>
    hasPhone
      ? Boolean(p.phone && p.phone.trim().length > 3)
      : !p.phone || p.phone.trim().length <= 3,
  );
}

export function filterLeadsByTimeRange<T extends LeadForFiltering>(
  leads: T[],
  timeRange?: string,
  now = new Date(),
): T[] {
  if (!timeRange || timeRange === "all_time") return leads;

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - now.getDay() * 86400000;
  const last30Days = startOfToday - 30 * 86400000;

  return leads.filter((p) => {
    const createdAt = new Date(p.created_at).getTime();
    if (timeRange === "today") return createdAt >= startOfToday;
    if (timeRange === "yesterday")
      return createdAt >= startOfYesterday && createdAt < startOfToday;
    if (timeRange === "this_week") return createdAt >= startOfWeek;
    if (timeRange === "last_30_days") return createdAt >= last30Days;
    return true;
  });
}

export function filterLeadsByAvailability<T extends LeadForFiltering>(
  leads: T[],
  availability?: string,
): T[] {
  if (!availability || availability === "any") return leads;

  if (
    availability === "available_later" ||
    availability === "callback_requested"
  ) {
    return leads.filter((p) => {
      const text = [
        p.latest_reply?.snippet ?? "",
        p.handoff_summary ?? "",
        p.research_summary ?? "",
        p.next_action ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return (
        Boolean(p.latest_reply?.wants_meeting) ||
        p.next_action === "call" ||
        p.next_action === "follow_up" ||
        /\b(later|call back|callback|reschedule|next week|tomorrow|available|timing|time)\b/i.test(
          text,
        )
      );
    });
  }

  if (availability === "available_now") {
    return leads.filter((p) => p.next_action === "call" || p.latest_reply?.wants_meeting === true);
  }

  if (availability === "unknown") {
    return leads.filter((p) => !p.next_action || p.next_action === "none");
  }

  if (availability === "has_next_action") {
    return leads.filter((p) =>
      Boolean(p.next_action && p.next_action !== "none"),
    );
  }

  return leads;
}

export function filterLeadsByQuery<T extends LeadForFiltering>(
  leads: T[],
  query?: string,
): T[] {
  if (!query || !query.trim()) return leads;
  const rawTerm = query.trim().toLowerCase();

  if (isMetaQuery(rawTerm)) {
    return leads;
  }

  const asksForQualified =
    rawTerm.includes("qualified") ||
    rawTerm.includes("hot") ||
    rawTerm.includes("warm");
  const asksForReplies =
    rawTerm.includes("reply") ||
    rawTerm.includes("replies") ||
    rawTerm.includes("inbound");

  if (asksForQualified) {
    return leads.filter(
      (r) =>
        (!asksForReplies || Boolean(r.latest_reply)) &&
        (r.lead_status === "qualified" ||
          r.lead_status === "engaged" ||
          r.qualification_bucket === "hot" ||
          r.qualification_bucket === "warm" ||
          r.latest_reply?.category === "interested"),
    );
  }

  if (asksForReplies) {
    return leads.filter(
      (r) =>
        Boolean(r.latest_reply) ||
        r.lead_status === "replied" ||
        r.lead_status === "qualified" ||
        r.input_name?.toLowerCase().includes(rawTerm) ||
        r.input_company?.toLowerCase().includes(rawTerm),
    );
  }

  const effectiveTerm = extractMeaningfulTerm(rawTerm);
  return leads.filter(
    (r) =>
      r.input_name?.toLowerCase().includes(effectiveTerm) ||
      r.input_company?.toLowerCase().includes(effectiveTerm) ||
      r.email?.toLowerCase().includes(effectiveTerm) ||
      r.phone?.toLowerCase().includes(effectiveTerm) ||
      r.input_title?.toLowerCase().includes(effectiveTerm) ||
      r.lead_status?.toLowerCase().includes(effectiveTerm) ||
      r.qualification_bucket?.toLowerCase().includes(effectiveTerm) ||
      r.latest_reply?.snippet?.toLowerCase().includes(effectiveTerm),
  );
}
