import type { CompatClient } from "@/lib/supabase/server";

export type VoiceAnalyticsFilters = {
  from?: string;
  to?: string;
  status?: string[];
  outcome?: string[];
  prospectId?: string;
  cursor?: string;
  limit?: number;
};

export type VoiceExecutionDetails = {
  id: string;
  prospectId: string | null;
  leadName: string | null;
  createdAt: string;
  startedAt: string | null;
  answeredAt: string | null;
  completedAt: string | null;
  status: string;
  providerStatus: string | null;
  outcome: string | null;
  durationSeconds: number;
  answered: boolean;
  costMinorUnits: string;
  costCurrency: string | null;
  costUnit: string;
  hasTranscript: boolean;
  hasRecording: boolean;
};

export type VoiceAnalytics = {
  totalCalls: number;
  answeredCalls: number;
  answerRate: number;
  totalDurationSeconds: number;
  // This value is only a single-currency convenience. Consumers must render
  // currencyTotals, never a cross-currency grand total.
  totalBolnaCostMinorUnits: string;
  currencyTotals: Array<{ currency: string; costMinorUnits: string }>;
  calls: VoiceExecutionDetails[];
  nextCursor: string | null;
};

function decimal(value: unknown) {
  if (value === null || value === undefined || value === "") return "0";
  const text = String(value);
  return /^\d+(?:\.\d+)?$/.test(text) ? text : "0";
}

function addUnsignedIntegerStrings(left: string, right: string) {
  let carry = 0;
  let output = "";
  let i = left.length - 1;
  let j = right.length - 1;
  while (i >= 0 || j >= 0 || carry > 0) {
    const digit1 = i >= 0 ? Number(left[i]) : 0;
    const digit2 = j >= 0 ? Number(right[j]) : 0;
    const total = digit1 + digit2 + carry;
    output = String(total % 10) + output;
    carry = Math.floor(total / 10);
    i -= 1;
    j -= 1;
  }
  return output.replace(/^0+(?=\d)/, "") || "0";
}

// Decimal string addition avoids turning provider fractional cents into IEEE754
// values while aggregating in application code or requiring a newer JS target.
export function addDecimalStrings(left: string, right: string) {
  const [li, lf = ""] = decimal(left).split(".");
  const [ri, rf = ""] = decimal(right).split(".");
  const width = Math.max(lf.length, rf.length);
  const asScaled = (whole: string, fraction: string) =>
    `${whole}${(fraction + "0".repeat(width)).slice(0, width)}`;
  const value = addUnsignedIntegerStrings(asScaled(li, lf), asScaled(ri, rf));
  if (width === 0) return value;
  const padded = value.padStart(width + 1, "0");
  const whole = padded.slice(0, -width).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-width).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function mapExecution(row: Record<string, unknown>): VoiceExecutionDetails {
  const prospect = row.prospects as { input_name?: unknown } | null;
  return {
    id: String(row.id),
    prospectId: row.prospect_id ? String(row.prospect_id) : null,
    leadName: prospect?.input_name ? String(prospect.input_name) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    answeredAt: row.answered_at ? String(row.answered_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    status: String(row.status),
    providerStatus: row.provider_status ? String(row.provider_status) : null,
    outcome: row.outcome ? String(row.outcome) : null,
    durationSeconds: Math.max(0, Number(row.duration_seconds ?? 0)),
    answered:
      row.answered === true ||
      Boolean(row.answered_at) ||
      Number(row.duration_seconds ?? 0) > 0,
    costMinorUnits: decimal(row.cost_minor_units),
    costCurrency: row.cost_currency ? String(row.cost_currency) : null,
    costUnit: String(row.cost_unit ?? "cent"),
    hasTranscript: Boolean(row.transcript),
    hasRecording: Boolean(row.recording_url),
  };
}

export function aggregateVoiceAnalytics(rows: Array<Record<string, unknown>>) {
  const currencyTotals = new Map<string, string>();
  let answeredCalls = 0;
  let totalDurationSeconds = 0;
  for (const row of rows) {
    const duration = Math.max(0, Number(row.duration_seconds ?? 0));
    if (row.answered === true || Boolean(row.answered_at) || duration > 0) {
      answeredCalls += 1;
    }
    totalDurationSeconds += duration;
    const currency = row.cost_currency
      ? String(row.cost_currency)
      : "BOLNA_CENTS";
    currencyTotals.set(
      currency,
      addDecimalStrings(
        currencyTotals.get(currency) ?? "0",
        decimal(row.cost_minor_units),
      ),
    );
  }
  const totals = [...currencyTotals.entries()].map(
    ([currency, costMinorUnits]) => ({ currency, costMinorUnits }),
  );
  return {
    totalCalls: rows.length,
    answeredCalls,
    answerRate: rows.length ? answeredCalls / rows.length : 0,
    totalDurationSeconds,
    totalBolnaCostMinorUnits:
      totals.length === 1 ? totals[0].costMinorUnits : "0",
    currencyTotals: totals,
  };
}

export async function getVoiceAnalytics(
  userId: string,
  filters: VoiceAnalyticsFilters = {},
  client?: CompatClient,
): Promise<VoiceAnalytics> {
  if (!client) throw new Error("A server-scoped Supabase client is required.");
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  let query = client
    .from("voice_executions")
    .select(
      "id,prospect_id,status,provider_status,outcome,duration_seconds,answered,started_at,answered_at,completed_at,cost_minor_units,cost_currency,cost_unit,transcript,recording_url,created_at,prospects(input_name)",
    )
    .eq("user_id", userId)
    .not("provider_execution_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  if (filters.status?.length) query = query.in("status", filters.status);
  if (filters.outcome?.length) query = query.in("outcome", filters.outcome);
  if (filters.prospectId) query = query.eq("prospect_id", filters.prospectId);
  if (filters.cursor) query = query.lt("created_at", filters.cursor);
  const { data, error } = await query;
  if (error) throw error;
  const mapped = (data ?? []).map((row) =>
    mapExecution(row as Record<string, unknown>),
  );
  const hasMore = mapped.length > limit;
  const calls = hasMore ? mapped.slice(0, limit) : mapped;
  // Aggregate the complete filtered tenant set, independently of the paged
  // call-log response. Fetching is deliberately paged to avoid Supabase's
  // default row cap silently skewing analytics for larger tenants.
  const summaryRows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += 1000) {
    let summaryQuery = client
      .from("voice_executions")
      .select(
        "duration_seconds,answered,answered_at,cost_minor_units,cost_currency",
      )
      .eq("user_id", userId)
      .not("provider_execution_id", "is", null)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (filters.from)
      summaryQuery = summaryQuery.gte("created_at", filters.from);
    if (filters.to) summaryQuery = summaryQuery.lte("created_at", filters.to);
    if (filters.status?.length)
      summaryQuery = summaryQuery.in("status", filters.status);
    if (filters.outcome?.length)
      summaryQuery = summaryQuery.in("outcome", filters.outcome);
    if (filters.prospectId)
      summaryQuery = summaryQuery.eq("prospect_id", filters.prospectId);
    const { data: batch, error: summaryError } = await summaryQuery;
    if (summaryError) throw summaryError;
    summaryRows.push(...((batch ?? []) as Array<Record<string, unknown>>));
    if (!batch || batch.length < 1000) break;
  }
  const aggregate = aggregateVoiceAnalytics(summaryRows);
  return {
    ...aggregate,
    calls,
    nextCursor: hasMore ? (calls.at(-1)?.createdAt ?? null) : null,
  };
}
