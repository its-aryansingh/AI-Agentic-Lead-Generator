"use client";

/**
 * Client-side chat surface using the Vercel AI SDK's useChat hook.
 *
 * Renders:
 *  - Streaming assistant + user messages
 *  - Tool-call cards (web_search, enrich_prospect, start_bulk_job)
 *  - A composer with submit-on-enter (shift+enter newline)
 *
 * The mock path: when the API returns JSON with { mock: true } instead
 * of a stream, we synthesise an assistant message ourselves so the UI
 * still feels alive without an Anthropic key.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Globe,
  UserCheck,
  Database,
  Send,
  HelpCircle,
  Loader2,
  BarChart3,
  CalendarClock,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { csvToProspects, type ParsedProspect } from "@/lib/csv-parse";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  toolCallId?: string;
  toolName: string;
  state: "running" | "result";
  result?: ToolResult;
}

type ToolResult =
  | WebSearchResult
  | EnrichResult
  | BulkJobResult
  | ClarifyResult
  | LaunchCampaignResult
  | SpecialistResult
  | AutomationResult
  | Record<string, unknown>;

interface WebSearchResult {
  count: number;
  candidates: Array<{
    id: string | null;
    name: string;
    title: string;
    company: string;
    source_url?: string;
    convertibilityScore?: number;
    intentBucket?: "high" | "medium" | "low";
    primaryTrigger?: string;
    suggestedHook?: string;
    signals?: {
      hasActiveHiring?: boolean;
      hiringRoles?: string[];
      recentFunding?: {
        amount?: string;
        round?: string;
        date?: string;
      };
      isNewInRole?: boolean;
      monthsInRole?: number;
      signalSummary?: string;
    };
  }>;
  sourceUsed?: "apollo" | "web_signal" | "mock";
  using_mock_data?: boolean;
}

interface EnrichResult {
  prospect: {
    name: string;
    title: string;
    company: string;
    source_url?: string;
  };
  draft: {
    research_summary: string;
    email_subject: string;
    email_body: string;
    talking_points: string[];
  };
}

interface BulkJobResult {
  job_id?: string;
  prospect_count?: number;
  sheet_url?: string;
  sheet_is_mock?: boolean;
  csv_data_url?: string;
  preview?: Array<{ name: string; title: string; company: string }>;
  credits_remaining?: number;
  error?: string;
}

interface ClarifyResult {
  question: string;
  suggested_answers?: string[];
}

interface LaunchCampaignResult {
  campaign_id?: string;
  scheduled?: number;
  suppressed_skipped?: number;
  note?: string;
  error?: string;
}

/** Result returned by an orchestrator run_* delegation (one specialist). */
interface SpecialistResult {
  specialist?: string;
  role?: string;
  emoji?: string;
  summary?: string;
  steps?: number;
  tools_used?: string[];
  outputs?: Array<{ tool: string; output: unknown }>;
  used_mock?: boolean;
  error?: string;
}

/** Result returned by the create_automation tool. */
interface AutomationResult {
  automation?: {
    id: string;
    name: string;
    schedule_frequency: string | null;
    next_run_at: string | null;
  };
  next_run_at?: string;
  error?: string;
}

interface InitialMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: Array<{ toolName: string; result?: unknown }>;
}

export function ChatClient({
  initialSessionId,
  initialMessages = [],
}: {
  initialSessionId?: string;
  initialMessages?: InitialMessage[];
}) {
  // Hydrate persisted tool-call shapes into the runtime ChatMessage type
  // (they share id/role/text; the toolCalls array's `state` flips to
  // "result" because by definition a resumed call has already returned).
  const hydrated: ChatMessage[] = initialMessages.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    toolCalls: m.toolCalls?.map((tc) => ({
      toolName: tc.toolName,
      state: "result" as const,
      result: (tc.result ?? {}) as ToolResult,
    })),
  }));
  const [messages, setMessages] = React.useState<ChatMessage[]>(hydrated);
  const [input, setInput] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [sessionId, setSessionId] = React.useState<string | undefined>(
    initialSessionId,
  );
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  async function submit(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || pending) return;
    setError(null);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };
    const assistantId = crypto.randomUUID();
    const placeholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
    };
    const nextMessages = [...messages, userMsg, placeholder];
    setMessages(nextMessages);
    setInput("");
    setPending(true);

    try {
      // Build the UIMessage[] payload the API expects.
      const apiMessages = nextMessages
        .filter((m) => m.id !== assistantId)
        .map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: "text" as const, text: m.text }],
        }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, messages: apiMessages }),
      });

      if (!res.ok) {
        throw new Error(`Chat API ${res.status}`);
      }

      const newSession = res.headers.get("x-session-id");
      if (newSession) {
        setSessionId(newSession);
        // Once a session id exists, mirror it into the URL so refresh
        // and back-button keep the conversation alive.
        if (!sessionId && typeof window !== "undefined") {
          window.history.replaceState({}, "", `/app/chat/${newSession}`);
        }
      }

      const contentType = res.headers.get("content-type") ?? "";

      // Mock path — single JSON message.
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as {
          mock?: boolean;
          sessionId?: string;
          assistant?: { text: string };
        };
        if (data.sessionId) {
          setSessionId(data.sessionId);
          if (!sessionId && typeof window !== "undefined") {
            window.history.replaceState({}, "", `/app/chat/${data.sessionId}`);
          }
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: data.assistant?.text ?? "" }
              : m,
          ),
        );
        return;
      }

      // Real stream — read the UI-message protocol from the AI SDK.
      await consumeUIStream(res.body!, (event) => {
        setMessages((prev) => applyStreamEvent(prev, assistantId, event));
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                text:
                  m.text || "Sorry — I hit an error sending that. Try again?",
              }
            : m,
        ),
      );
    } finally {
      // Ensure all tool calls on this assistant message are marked as completed so spinners don't linger
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId || !m.toolCalls?.length) return m;
          return {
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.state === "running" ? { ...tc, state: "result" as const } : tc,
            ),
          };
        }),
      );
      setPending(false);
    }
  }

  return (
    <>
      <section ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {messages.length === 0 && <EmptyState onPick={(s) => submit(s)} />}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} sessionId={sessionId} />
          ))}
        </div>
      </section>

      {error && (
        <div className="px-6 pb-2 text-xs text-destructive max-w-3xl mx-auto w-full">
          {error}
        </div>
      )}

      <footer className="border-t border-border bg-card">
        <div className="max-w-3xl mx-auto px-6 pt-3">
          <CsvDropZone
            disabled={pending}
            onParsed={(prospects) => submit(buildCsvMessage(prospects))}
          />
        </div>
        <form
          className="max-w-3xl mx-auto px-6 py-4 flex gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your ideal prospect, or name a person to research…"
            className="resize-none min-h-[60px]"
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button type="submit" disabled={pending || !input.trim()} size="lg">
            {pending ? "…" : "Send"}
          </Button>
        </form>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------------
// Stream parser — consumes the AI SDK's UI-message protocol
// ---------------------------------------------------------------------

type StreamEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool-call"; toolName: string; toolCallId: string }
  | {
      kind: "tool-result";
      toolCallId: string;
      toolName: string;
      result: ToolResult;
    };

async function consumeUIStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // The AI SDK v6 UI stream is newline-delimited JSON.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const stripped = trimmed.replace(/^data:\s*/, "");
      if (stripped === "[DONE]") continue;
      try {
        const event = JSON.parse(stripped) as Record<string, unknown>;
        // Text deltas — keys vary across SDK versions; cover both shapes.
        if (event.type === "text-delta" || event.type === "text") {
          const delta = (event.delta as string) ?? (event.text as string);
          if (typeof delta === "string") onEvent({ kind: "text", delta });
        }
        if (
          event.type === "tool-call" ||
          event.type === "tool-input-available"
        ) {
          onEvent({
            kind: "tool-call",
            toolName: String(event.toolName ?? event.name ?? ""),
            toolCallId: String(event.toolCallId ?? event.id ?? ""),
          });
        }
        if (
          event.type === "tool-result" ||
          event.type === "tool-output-available" ||
          event.type === "tool-execution-finish" ||
          event.type === "tool_result"
        ) {
          onEvent({
            kind: "tool-result",
            toolName: String(event.toolName ?? event.name ?? ""),
            toolCallId: String(event.toolCallId ?? event.id ?? ""),
            result: (event.result ?? event.output) as ToolResult,
          });
        }
      } catch {
        // Some lines are framing meta (start, finish, etc.) — ignore.
      }
    }
  }
}

function applyStreamEvent(
  prev: ChatMessage[],
  assistantId: string,
  event: StreamEvent,
): ChatMessage[] {
  return prev.map((m) => {
    if (m.id !== assistantId) return m;
    if (event.kind === "text") {
      return { ...m, text: m.text + event.delta };
    }
    if (event.kind === "tool-call") {
      return {
        ...m,
        toolCalls: [
          ...(m.toolCalls ?? []),
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            state: "running" as const,
          },
        ],
      };
    }
    if (event.kind === "tool-result") {
      const toolCalls = [...(m.toolCalls ?? [])];
      const last = [...toolCalls]
        .reverse()
        .find(
          (t) =>
            t.state === "running" &&
            (t.toolCallId === event.toolCallId ||
              (!t.toolCallId && t.toolName === event.toolName)),
        );
      if (last) {
        last.state = "result";
        last.result = event.result;
      } else {
        toolCalls.push({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: "result",
          result: event.result,
        });
      }
      return { ...m, toolCalls };
    }
    return m;
  });
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function MessageBubble({ message, sessionId }: { message: ChatMessage; sessionId?: string }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-3 text-sm whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground font-medium text-indigo-400">
        Aravya SalesEngAI
      </div>
      {message.toolCalls?.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} sessionId={sessionId} />
      ))}
      {message.text && (
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.text}
        </div>
      )}
      {!message.text && !message.toolCalls?.length && (
        <div className="text-sm text-muted-foreground italic">Thinking…</div>
      )}
    </div>
  );
}

const SPECIALIST_LABELS: Record<string, string> = {
  run_prospector: "🔎 Prospector",
  run_researcher: "🧪 Researcher",
  run_copywriter: "✍️ Copywriter",
  run_compliance: "🛡️ Compliance",
  run_outreach: "📤 Outreach",
};

function runningLabel(toolName: string): string {
  const label = SPECIALIST_LABELS[toolName];
  return label ? `${label} working…` : `Running ${toolName}…`;
}

function ToolCallCard({ toolCall, sessionId }: { toolCall: ToolCall; sessionId?: string }) {
  if (toolCall.state === "running") {
    return (
      <Card
        size="sm"
        className="bg-muted/20 border-muted-foreground/20 overflow-hidden relative"
      >
        <div
          className="absolute top-0 left-0 h-[2px] w-1/3 bg-primary animate-pulse-fast"
          style={{ animation: "slideRight 1.5s infinite linear" }}
        />
        <CardContent className="text-xs text-muted-foreground py-3 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>{runningLabel(toolCall.toolName)}</span>
        </CardContent>
      </Card>
    );
  }

  if (toolCall.toolName.startsWith("run_")) {
    return <SpecialistCard result={toolCall.result as SpecialistResult} />;
  }
  return (
    <ToolOutputCard toolName={toolCall.toolName} result={toolCall.result} sessionId={sessionId} />
  );
}

/** Renders one underlying handler's output (used directly and nested in specialist cards). */
function ToolOutputCard({
  toolName,
  result,
  sessionId,
}: {
  toolName: string;
  result?: ToolResult;
  sessionId?: string;
}) {
  if (toolName === "create_or_update_voice_agent") return <VoiceAgentControlCard result={result} sessionId={sessionId} />;
  if (toolName === "start_qualification_calls_batch") return <QualificationCallsCard result={result} sessionId={sessionId} />;
  if (toolName === "schedule_lead_followup") return <FollowupCard result={result} sessionId={sessionId} />;
  if (toolName === "sync_crm_leads") return <CrmSyncCard result={result} sessionId={sessionId} />;
  if (toolName === "get_call_details_and_analytics") return <CallAnalyticsCard result={result} />;
  if (toolName === "trigger_outreach_run") return <OutreachRunCard result={result} sessionId={sessionId} />;
  if (
    toolName === "web_search" ||
    toolName === "public_source_search" ||
    toolName === "add_named_prospects"
  ) {
    return <WebSearchCard result={result as WebSearchResult} />;
  }
  if (toolName === "enrich_prospect")
    return <EnrichCard result={result as EnrichResult} />;
  if (toolName === "start_bulk_job")
    return <BulkJobCard result={result as BulkJobResult} />;
  if (toolName === "launch_campaign")
    return <LaunchCampaignCard result={result as LaunchCampaignResult} />;
  if (toolName === "create_automation")
    return <AutomationCard result={result as AutomationResult} />;
  if (toolName === "clarify_question")
    return <ClarifyCard result={result as ClarifyResult} />;
  if (toolName === "search_leads") {
    const res = result as { count?: number; leads?: Array<unknown> };
    const count = res?.count ?? res?.leads?.length ?? 0;
    return (
      <div className="text-xs text-muted-foreground bg-muted/20 border border-border/40 rounded-md px-3 py-2 flex items-center gap-2">
        <span className="text-primary font-medium">
          📋 Found {count} lead{count === 1 ? "" : "s"} in database
        </span>
      </div>
    );
  }
  if (toolName === "save_candidates_to_leads") {
    const res = result as {
      count?: number;
      leads?: Array<unknown>;
      error?: string;
    };
    if (res?.error) {
      return (
        <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
          Could not add leads: {res.error}
        </div>
      );
    }
    const count = res?.count ?? res?.leads?.length ?? 0;
    return (
      <div className="text-xs text-muted-foreground bg-muted/20 border border-border/40 rounded-md px-3 py-2">
        <span className="text-primary font-medium">
          Added {count} lead{count === 1 ? "" : "s"} to Leads
        </span>
      </div>
    );
  }
  if (toolName === "enrich_lead") {
    const res = result as EnrichResult;
    if (res?.draft?.email_subject) {
      return <EnrichCard result={res} />;
    }
    return (
      <div className="text-xs text-muted-foreground bg-muted/20 border border-border/40 rounded-md px-3 py-2 flex items-center gap-2">
        <span className="text-primary font-medium">
          ⚡ Lead researched &amp; qualification email drafted
        </span>
      </div>
    );
  }
  if (toolName === "list_intake_jobs" || toolName === "enrich_intake_job") {
    const res = result as {
      message?: string;
      count?: number;
      enriched_count?: number;
    };
    return (
      <div className="text-xs text-muted-foreground bg-muted/20 border border-border/40 rounded-md px-3 py-2 flex items-center gap-2">
        <span className="text-primary font-medium">
          {res?.message ?? `⚙️ ${toolName.replace(/_/g, " ")} complete`}
        </span>
      </div>
    );
  }
  return null;
}

type ControlResult = Record<string, unknown> & {
  error?: string;
  message?: string;
  preview?: Record<string, unknown>;
  confirmation?: {
    approval_id?: string;
    confirmation_token?: string;
    expires_at?: string;
    requires_confirmation?: boolean;
    requires_second_confirmation?: boolean;
  };
};

function VoiceAgentControlCard({ result, sessionId }: { result?: ToolResult; sessionId?: string }) {
  return <ActionPreviewCard title="Bolna voice agent" icon={<Volume2 className="w-4 h-4 text-primary" />} result={result as ControlResult} sessionId={sessionId} />;
}

function QualificationCallsCard({ result, sessionId }: { result?: ToolResult; sessionId?: string }) {
  return <ActionPreviewCard title="Qualification calls" icon={<PhoneCall className="w-4 h-4 text-primary" />} result={result as ControlResult} sessionId={sessionId} />;
}

function FollowupCard({ result, sessionId }: { result?: ToolResult; sessionId?: string }) {
  return <ActionPreviewCard title="Lead follow-up" icon={<CalendarClock className="w-4 h-4 text-primary" />} result={result as ControlResult} sessionId={sessionId} />;
}

function CrmSyncCard({ result, sessionId }: { result?: ToolResult; sessionId?: string }) {
  return <ActionPreviewCard title="CRM sync" icon={<RefreshCw className="w-4 h-4 text-primary" />} result={result as ControlResult} sessionId={sessionId} />;
}

function OutreachRunCard({ result, sessionId }: { result?: ToolResult; sessionId?: string }) {
  return <ActionPreviewCard title="Outreach run" icon={<ShieldCheck className="w-4 h-4 text-primary" />} result={result as ControlResult} sessionId={sessionId} />;
}

function ActionPreviewCard({
  title,
  icon,
  result,
  sessionId,
}: {
  title: string;
  icon: React.ReactNode;
  result: ControlResult;
  sessionId?: string;
}) {
  const [state, setState] = React.useState<"idle" | "submitting" | "second" | "success" | "error">("idle");
  const [execution, setExecution] = React.useState<Record<string, unknown> | null>(null);
  const confirmation = result?.confirmation;
  const canConfirm = Boolean(sessionId && confirmation?.approval_id && confirmation?.confirmation_token);
  const submitConfirmation = async (overrideConfirmed = false) => {
    if (!sessionId || !confirmation?.approval_id || !confirmation.confirmation_token) return;
    setState("submitting");
    try {
      const response = await fetch("/api/chat/tool-confirmations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, approvalId: confirmation.approval_id, confirmationToken: confirmation.confirmation_token, overrideConfirmed }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      setExecution(body);
      if (body.requires_second_confirmation === true) setState("second");
      else setState(response.ok && !body.error ? "success" : "error");
    } catch {
      setExecution({ error: "network_error", message: "The confirmation could not be sent. Retry safely." });
      setState("error");
    }
  };
  const previewText = result?.preview
    ? Object.entries(result.preview)
        .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
        .slice(0, 6)
        .map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`)
    : [];
  const details = execution ?? result;
  const nestedResult = details?.result as Record<string, unknown> | undefined;
  const partial = nestedResult?.status === "partial" || Number(nestedResult?.blocked ?? 0) > 0 || Number(nestedResult?.failed ?? 0) > 0;
  return (
    <Card size="sm" className="overflow-hidden border-muted-foreground/20">
      <CardHeader className="px-4 py-3 bg-muted/30 border-b border-border/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {icon}<span>{title}</span>
          {state === "success" && <Badge className="ml-auto bg-emerald-600">Confirmed</Badge>}
          {state === "submitting" && <Loader2 className="ml-auto w-4 h-4 animate-spin" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex flex-col gap-3 text-sm">
        {previewText.length > 0 && (
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-1 text-xs text-muted-foreground">
            {previewText.map((line) => <div key={line}>{line}</div>)}
          </dl>
        )}
        {result?.preview && typeof result.preview.blocked === "object" && (
          <div className="text-xs text-amber-700 dark:text-amber-300">Blocked leads remain excluded when this runs.</div>
        )}
        {Boolean(result?.estimates) && <div className="text-xs text-muted-foreground">Preview includes created, updated, and skipped estimates.</div>}
        {(details?.message as string | undefined) && <div className={details?.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{String(details.message)}</div>}
        {state === "success" && <div className={partial ? "text-xs text-amber-700 dark:text-amber-300" : "text-xs text-emerald-700 dark:text-emerald-300"}>{partial ? "Completed with skipped or blocked items. Review the reported outcomes before retrying." : "The confirmed action completed. Any blocked items are reported separately."}</div>}
        {canConfirm && state !== "success" && (
          <Button type="button" size="sm" className="w-fit" disabled={state === "submitting"} onClick={() => submitConfirmation(state === "second")}>
            {state === "second" ? "Confirm Call Again" : state === "error" ? "Retry confirmation" : "Confirm and run"}
          </Button>
        )}
        {confirmation?.expires_at && state === "idle" && <div className="text-[11px] text-muted-foreground">Approval expires {new Date(confirmation.expires_at).toLocaleTimeString()}.</div>}
      </CardContent>
    </Card>
  );
}

function CallAnalyticsCard({ result }: { result?: ToolResult }) {
  const value = (result ?? {}) as Record<string, unknown>;
  const analytics = (value.analytics ?? value) as Record<string, unknown>;
  const calls = Array.isArray(analytics.calls) ? analytics.calls : [];
  return (
    <Card size="sm" className="overflow-hidden border-muted-foreground/20">
      <CardHeader className="px-4 py-3 bg-muted/30 border-b border-border/50"><CardTitle className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Call intelligence</CardTitle></CardHeader>
      <CardContent className="p-4 text-sm flex flex-col gap-3">
        {value.error ? <div className="text-destructive text-xs">{String(value.message ?? "Call details are unavailable.")}</div> : <>
          <div className="grid grid-cols-2 gap-2 text-xs"><span>Total calls: {String(analytics.totalCalls ?? "0")}</span><span>Answer rate: {typeof analytics.answerRate === "number" ? `${Math.round(analytics.answerRate * 100)}%` : "-"}</span><span>Talk time: {Math.round(Number(analytics.totalDurationSeconds ?? 0) / 60)} min</span><span>Platform credits: {String(value.platform_credits_remaining ?? "-")}</span></div>
          <div className="text-xs text-muted-foreground">Bolna provider spend — billed directly by Bolna</div>
          {Array.isArray(analytics.currencyTotals) && <div className="text-xs">{analytics.currencyTotals.map((row) => { const cost = row as Record<string, unknown>; return <div key={String(cost.currency)}>{String(cost.currency)} {String(cost.costMinorUnits)} minor units</div>; })}</div>}
          <div className="text-xs text-muted-foreground">SalesEngAI platform credits are separate from Bolna provider spend.</div>
          {calls.length > 0 && <div className="text-xs text-muted-foreground">Showing {calls.length} call record{calls.length === 1 ? "" : "s"}.</div>}
        </>}
      </CardContent>
    </Card>
  );
}

/** A single specialist delegation: badge + summary + its nested tool outputs. */
function SpecialistCard({ result }: { result?: SpecialistResult }) {
  if (!result) return null;
  if (result.error) {
    return (
      <Card size="sm" className="border-destructive/30 bg-destructive/5">
        <CardContent className="py-3 text-sm text-destructive font-medium flex items-center gap-2">
          <HelpCircle className="w-4 h-4" />
          {result.role ?? "Specialist"} couldn’t finish: {result.error}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card
      size="sm"
      className="overflow-hidden border-muted-foreground/20 hover:border-muted-foreground/40 transition-colors"
    >
      <CardHeader className="px-4 py-3 bg-muted/30 border-b border-border/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="text-base leading-none">{result.emoji ?? "🤖"}</span>
          {result.role ?? "Specialist"}
          {result.used_mock && (
            <Badge
              variant="secondary"
              className="ml-auto align-middle text-[10px]"
            >
              demo data
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4">
        {result.summary && (
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {result.summary}
          </div>
        )}
        {result.outputs?.map((o, i) => (
          <ToolOutputCard
            key={i}
            toolName={o.tool}
            result={o.output as ToolResult}
          />
        ))}
        {result.tools_used && result.tools_used.length > 0 && (
          <div className="text-[11px] text-muted-foreground border-t border-border/50 pt-2">
            via {result.tools_used.join(", ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AutomationCard({ result }: { result?: AutomationResult }) {
  if (!result || result.error) {
    return (
      <Card size="sm" className="border-destructive/30 bg-destructive/5">
        <CardContent className="py-3 text-sm text-destructive font-medium flex items-center gap-2">
          <HelpCircle className="w-4 h-4" />
          {result?.error ?? "Couldn’t create the automation."}
        </CardContent>
      </Card>
    );
  }
  const next = result.next_run_at ?? result.automation?.next_run_at;
  return (
    <Card size="sm" className="overflow-hidden border-muted-foreground/20">
      <CardHeader className="px-4 py-3 bg-muted/30 border-b border-border/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="text-base leading-none">⏱</span>
          Automation created — {result.automation?.name ?? "Untitled"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 text-sm text-muted-foreground flex flex-col gap-1">
        <div>
          Runs{" "}
          <span className="text-foreground font-medium">
            {result.automation?.schedule_frequency ?? "on schedule"}
          </span>
          .
        </div>
        {next && (
          <div>
            Next run:{" "}
            <span className="text-foreground">
              {new Date(next).toLocaleString()}
            </span>
          </div>
        )}
        <a
          href="/app/automations"
          className="text-primary hover:underline mt-1 w-fit"
        >
          Manage automations →
        </a>
      </CardContent>
    </Card>
  );
}

function WebSearchCard({ result }: { result: WebSearchResult }) {
  const isApollo = result.sourceUsed === "apollo";
  return (
    <Card
      size="sm"
      className="overflow-hidden border-muted-foreground/20 hover:border-muted-foreground/40 transition-colors"
    >
      <CardHeader className="px-4 py-3 bg-muted/30 border-b border-border/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          <span>
            Found {result.count} convertible lead{result.count === 1 ? "" : "s"}
          </span>
          {isApollo ? (
            <Badge
              variant="outline"
              className="ml-auto align-middle text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            >
              Apollo B2B
            </Badge>
          ) : result.using_mock_data ? (
            <Badge
              variant="secondary"
              className="ml-auto align-middle text-[10px]"
            >
              demo data
            </Badge>
          ) : result.sourceUsed === "web_signal" ? (
            <Badge
              variant="secondary"
              className="ml-auto align-middle text-[10px]"
            >
              web signals
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ul className="flex flex-col gap-3">
          {result.candidates.slice(0, 8).map((c, i) => {
            const score = c.convertibilityScore;
            return (
              <li
                key={c.id ?? i}
                className="flex flex-col gap-1 p-2 rounded-md bg-muted/20 border border-border/40 hover:border-border/70 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm group-hover:text-primary transition-colors">
                    {c.name}
                  </span>
                  {typeof score === "number" && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-semibold",
                        score >= 80
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : score >= 60
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            : "bg-muted text-muted-foreground border-border",
                      )}
                    >
                      {score >= 80 ? "🔥 " : score >= 60 ? "⚡ " : ""}
                      {score}/100
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.title} · {c.company}
                </div>
                {c.primaryTrigger && (
                  <div className="text-[11px] text-primary/90 flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs">🎯</span>
                    <span className="font-medium">{c.primaryTrigger}</span>
                  </div>
                )}
                {c.signals && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {c.signals.recentFunding && (
                      <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        💰 {c.signals.recentFunding.amount || "Recent funding"}
                      </span>
                    )}
                    {c.signals.hasActiveHiring && (
                      <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        📈 Hiring surge
                      </span>
                    )}
                    {c.signals.isNewInRole && (
                      <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        ✨ New in role
                      </span>
                    )}
                  </div>
                )}
                {c.suggestedHook && (
                  <div className="text-[11px] text-muted-foreground italic border-l-2 border-primary/30 pl-2 mt-1">
                    &ldquo;{c.suggestedHook}&rdquo;
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {result.candidates.length > 8 && (
          <div className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border/50 text-center">
            …and {result.candidates.length - 8} more
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EnrichCard({ result }: { result: EnrichResult }) {
  const fullEmail = `Subject: ${result.draft.email_subject}\n\n${result.draft.email_body}`;
  return (
    <Card
      size="sm"
      className="overflow-hidden border-muted-foreground/20 hover:border-muted-foreground/40 transition-colors"
    >
      <CardHeader className="px-4 py-3 bg-muted/30 border-b border-border/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-primary" />
          <span>
            {result.prospect.name}{" "}
            <span className="text-muted-foreground font-normal">
              — {result.prospect.title} at {result.prospect.company}
            </span>
          </span>
          <CopyButton text={fullEmail} label="Copy email" className="ml-auto" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-4">
        <Section label="Research">{result.draft.research_summary}</Section>
        <Section label="Subject" copyText={result.draft.email_subject}>
          {result.draft.email_subject}
        </Section>
        <Section label="Email" copyText={result.draft.email_body}>
          {result.draft.email_body}
        </Section>
        <div className="bg-muted/20 p-3 rounded-lg border border-border/50">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
            Talking points
          </div>
          <ul className="list-disc pl-4 text-sm flex flex-col gap-1.5 marker:text-primary/60">
            {result.draft.talking_points.map((tp, i) => (
              <li key={i}>{tp}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function BulkJobCard({ result }: { result: BulkJobResult }) {
  if (result.error) {
    return (
      <Card size="sm" className="border-destructive/30 bg-destructive/5">
        <CardContent className="py-3 text-sm text-destructive font-medium flex items-center gap-2">
          <HelpCircle className="w-4 h-4" />
          {result.error}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card
      size="sm"
      className="overflow-hidden border-muted-foreground/20 hover:border-muted-foreground/40 transition-colors"
    >
      <CardHeader className="px-4 py-3 bg-muted/30 border-b border-border/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          Enriched {result.prospect_count} prospect
          {result.prospect_count === 1 ? "" : "s"}
          {result.sheet_is_mock && (
            <Badge
              variant="secondary"
              className="ml-auto align-middle text-[10px]"
            >
              demo data
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap gap-2">
          {result.sheet_url && !result.sheet_is_mock && (
            <a
              href={result.sheet_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium shadow-sm",
                "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
              )}
            >
              Open Google Sheet
            </a>
          )}
          {result.csv_data_url && (
            <a
              href={result.csv_data_url}
              download={`salesengai-prospects-${result.job_id ?? "export"}.csv`}
              className={cn(
                "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium shadow-sm",
                "border border-border bg-card hover:bg-muted transition-colors",
              )}
            >
              Download CSV
            </a>
          )}
        </div>
        {result.preview && result.preview.length > 0 && (
          <div className="bg-muted/10 p-3 rounded-lg border border-border/30">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              Preview
            </div>
            <ul className="text-sm flex flex-col gap-1.5">
              {result.preview.map((p, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground/90">
                    {p.name}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    — {p.title} at {p.company}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {typeof result.credits_remaining === "number" && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-1 border-t border-border/50 pt-3">
            {result.credits_remaining} credit
            {result.credits_remaining === 1 ? "" : "s"} remaining
            {result.job_id && (
              <>
                <span className="opacity-50">·</span>
                <a
                  href={`/app/jobs/${result.job_id}`}
                  className="hover:text-foreground transition-colors underline underline-offset-2"
                >
                  view inline
                </a>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LaunchCampaignCard({ result }: { result: LaunchCampaignResult }) {
  if (result.error) {
    return (
      <Card size="sm" className="border-destructive/30 bg-destructive/5">
        <CardContent className="py-3 text-sm text-destructive font-medium flex items-center gap-2">
          <HelpCircle className="w-4 h-4" />
          {result.error}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card
      size="sm"
      className="overflow-hidden border-muted-foreground/20 hover:border-muted-foreground/40 transition-colors"
    >
      <CardHeader className="px-4 py-3 bg-muted/30 border-b border-border/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" />
          Campaign launched — {result.scheduled ?? 0} email
          {result.scheduled === 1 ? "" : "s"} queued
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4 text-sm">
        {typeof result.suppressed_skipped === "number" &&
          result.suppressed_skipped > 0 && (
            <div className="text-xs text-muted-foreground bg-muted/30 px-2 py-1.5 rounded border border-border/50">
              <span className="font-medium">{result.suppressed_skipped}</span>{" "}
              skipped (on suppression list)
            </div>
          )}
        {result.note && (
          <div className="text-xs text-muted-foreground italic border-l-2 border-primary/40 pl-2">
            {result.note}
          </div>
        )}
        <div className="flex flex-wrap gap-4 mt-1 border-t border-border/50 pt-3">
          <a
            href="/app/pipeline"
            className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            View pipeline <span aria-hidden="true">&rarr;</span>
          </a>
          <a
            href="/app/inbox"
            className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            Reply inbox <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function ClarifyCard({ result }: { result: ClarifyResult }) {
  return (
    <Card size="sm" className="bg-primary/5 border-primary/20">
      <CardContent className="py-4 px-4 flex flex-col gap-3">
        <div className="text-sm font-medium text-primary flex gap-2">
          <HelpCircle className="w-5 h-5 shrink-0" />
          <span className="pt-0.5">{result.question}</span>
        </div>
        {result.suggested_answers && result.suggested_answers.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-7">
            {result.suggested_answers.map((s, i) => (
              <Badge
                key={i}
                variant="secondary"
                className="hover:bg-primary hover:text-primary-foreground cursor-default transition-colors"
              >
                {s}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  label,
  children,
  copyText,
}: {
  label: string;
  children: React.ReactNode;
  copyText?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-2">
        <span>{label}</span>
        {copyText && <CopyButton text={copyText} className="ml-auto" />}
      </div>
      <div className="text-sm whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — fail silently */
        }
      }}
      className={cn(
        "text-[11px] font-medium px-2 py-0.5 rounded border border-border",
        "hover:bg-muted transition-colors text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

// ---------------------------------------------------------------------
// CSV input — collapsed dropzone above the composer. On drop/paste we
// parse client-side and synthesise a chat message that the agent will
// route to the add_named_prospects tool.
// ---------------------------------------------------------------------

function CsvDropZone({
  disabled,
  onParsed,
}: {
  disabled: boolean;
  onParsed: (prospects: ParsedProspect[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const [paste, setPaste] = React.useState("");
  const [warnings, setWarnings] = React.useState<string[]>([]);

  async function ingest(text: string) {
    const { prospects, warnings } = csvToProspects(text);
    setWarnings(warnings);
    if (prospects.length === 0) return;
    onParsed(prospects);
    setOpen(false);
    setPaste("");
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between text-xs text-muted-foreground pb-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="underline underline-offset-2 hover:text-foreground transition-colors disabled:opacity-50"
        >
          Have a CSV? Drop or paste it here.
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pb-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setHover(false);
          const file = e.dataTransfer.files?.[0];
          if (!file) return;
          const text = await file.text();
          await ingest(text);
        }}
        className={cn(
          "rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground transition-colors",
          hover && "bg-muted",
        )}
      >
        Drop a .csv file here, or paste rows below. Header row optional —
        columns:{" "}
        <code className="font-mono">
          name, company, title, linkedin_url, email
        </code>
        .
      </div>
      <Textarea
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        placeholder="Priya Sharma,Razorpay,Head of Marketing&#10;Rahul Mehta,Freshworks,VP Sales"
        className="resize-none min-h-[80px] font-mono text-xs"
        disabled={disabled}
      />
      {warnings.length > 0 && (
        <ul className="text-[11px] text-amber-700 dark:text-amber-300 flex flex-col gap-0.5">
          {warnings.map((w, i) => (
            <li key={i}>· {w}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setPaste("");
            setWarnings([]);
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled || !paste.trim()}
          onClick={() => ingest(paste)}
        >
          Add to chat
        </Button>
      </div>
    </div>
  );
}

function buildCsvMessage(prospects: ParsedProspect[]): string {
  const sample = prospects
    .slice(0, 8)
    .map(
      (p) =>
        `- ${p.name}${p.company ? ` at ${p.company}` : ""}${p.title ? ` (${p.title})` : ""}`,
    )
    .join("\n");
  const more =
    prospects.length > 8 ? `\n…and ${prospects.length - 8} more.` : "";
  // Compose a JSON payload the model can pass straight through to
  // add_named_prospects without any guesswork.
  const json = JSON.stringify(
    prospects.map((p) => ({
      name: p.name,
      company: p.company,
      title: p.title,
      linkedin_url: p.linkedin_url,
    })),
  );
  return `I uploaded a CSV with ${prospects.length} prospect${prospects.length === 1 ? "" : "s"}.

Sample:
${sample}${more}

Please stage them via add_named_prospects (use this exact list) and then ask me to confirm before bulk-enriching.

PROSPECTS_JSON=${json}`;
}

// ---------------------------------------------------------------------
// Empty state — clickable suggestions to lower activation friction.
// ---------------------------------------------------------------------

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = [
    "find me 15 heads of marketing at fintech startups in India",
    "research Priya Sharma at Razorpay",
    "get me 20 founders running B2B SaaS in Bangalore",
  ];
  return (
    <div className="flex flex-col items-center text-center gap-4 py-12">
      <h2 className="text-2xl font-semibold tracking-tight">
        What kind of prospects are you looking for?
      </h2>
      <p className="text-muted-foreground max-w-md text-sm">
        Try one of these, or describe your own ICP in plain English.
      </p>
      <div className="flex flex-col gap-2 w-full max-w-md mt-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left text-sm border border-border rounded-md px-3 py-2 hover:bg-muted transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
