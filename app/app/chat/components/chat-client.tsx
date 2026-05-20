"use client"

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

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { csvToProspects, type ParsedProspect } from "@/lib/csv-parse"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text: string
  toolCalls?: ToolCall[]
}

interface ToolCall {
  toolName: string
  state: "running" | "result"
  result?: ToolResult
}

type ToolResult =
  | WebSearchResult
  | EnrichResult
  | BulkJobResult
  | ClarifyResult
  | Record<string, unknown>

interface WebSearchResult {
  count: number
  candidates: Array<{
    id: string | null
    name: string
    title: string
    company: string
    source_url: string
  }>
  using_mock_data?: boolean
}

interface EnrichResult {
  prospect: { name: string; title: string; company: string; source_url?: string }
  draft: {
    research_summary: string
    email_subject: string
    email_body: string
    talking_points: string[]
  }
}

interface BulkJobResult {
  job_id?: string
  prospect_count?: number
  sheet_url?: string
  sheet_is_mock?: boolean
  csv_data_url?: string
  preview?: Array<{ name: string; title: string; company: string }>
  credits_remaining?: number
  error?: string
}

interface ClarifyResult {
  question: string
  suggested_answers?: string[]
}

interface InitialMessage {
  id: string
  role: "user" | "assistant"
  text: string
  toolCalls?: Array<{ toolName: string; result?: unknown }>
}

export function ChatClient({
  initialSessionId,
  initialMessages = [],
}: {
  initialSessionId?: string
  initialMessages?: InitialMessage[]
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
  }))
  const [messages, setMessages] = React.useState<ChatMessage[]>(hydrated)
  const [input, setInput] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [sessionId, setSessionId] = React.useState<string | undefined>(initialSessionId)
  const [error, setError] = React.useState<string | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages.length])

  async function submit(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || pending) return
    setError(null)
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    }
    const assistantId = crypto.randomUUID()
    const placeholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
    }
    const nextMessages = [...messages, userMsg, placeholder]
    setMessages(nextMessages)
    setInput("")
    setPending(true)

    try {
      // Build the UIMessage[] payload the API expects.
      const apiMessages = nextMessages
        .filter((m) => m.id !== assistantId)
        .map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: "text" as const, text: m.text }],
        }))

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, messages: apiMessages }),
      })

      if (!res.ok) {
        throw new Error(`Chat API ${res.status}`)
      }

      const newSession = res.headers.get("x-session-id")
      if (newSession) {
        setSessionId(newSession)
        // Once a session id exists, mirror it into the URL so refresh
        // and back-button keep the conversation alive.
        if (!sessionId && typeof window !== "undefined") {
          window.history.replaceState({}, "", `/app/chat/${newSession}`)
        }
      }

      const contentType = res.headers.get("content-type") ?? ""

      // Mock path — single JSON message.
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as {
          mock?: boolean
          sessionId?: string
          assistant?: { text: string }
        }
        if (data.sessionId) {
          setSessionId(data.sessionId)
          if (!sessionId && typeof window !== "undefined") {
            window.history.replaceState({}, "", `/app/chat/${data.sessionId}`)
          }
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: data.assistant?.text ?? "" } : m,
          ),
        )
        return
      }

      // Real stream — read the UI-message protocol from the AI SDK.
      await consumeUIStream(res.body!, (event) => {
        setMessages((prev) => applyStreamEvent(prev, assistantId, event))
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong"
      setError(msg)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: m.text || "Sorry — I hit an error sending that. Try again?" }
            : m,
        ),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <section ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {messages.length === 0 && <EmptyState onPick={(s) => submit(s)} />}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
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
            e.preventDefault()
            submit()
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
                e.preventDefault()
                submit()
              }
            }}
          />
          <Button type="submit" disabled={pending || !input.trim()} size="lg">
            {pending ? "…" : "Send"}
          </Button>
        </form>
      </footer>
    </>
  )
}

// ---------------------------------------------------------------------
// Stream parser — consumes the AI SDK's UI-message protocol
// ---------------------------------------------------------------------

type StreamEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool-call"; toolName: string; toolCallId: string }
  | { kind: "tool-result"; toolCallId: string; toolName: string; result: ToolResult }

async function consumeUIStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: StreamEvent) => void,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // The AI SDK v6 UI stream is newline-delimited JSON.
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const stripped = trimmed.replace(/^data:\s*/, "")
      if (stripped === "[DONE]") continue
      try {
        const event = JSON.parse(stripped) as Record<string, unknown>
        // Text deltas — keys vary across SDK versions; cover both shapes.
        if (event.type === "text-delta" || event.type === "text") {
          const delta = (event.delta as string) ?? (event.text as string)
          if (typeof delta === "string") onEvent({ kind: "text", delta })
        }
        if (event.type === "tool-call" || event.type === "tool-input-available") {
          onEvent({
            kind: "tool-call",
            toolName: String(event.toolName ?? event.name ?? ""),
            toolCallId: String(event.toolCallId ?? event.id ?? ""),
          })
        }
        if (event.type === "tool-result" || event.type === "tool-output-available") {
          onEvent({
            kind: "tool-result",
            toolName: String(event.toolName ?? event.name ?? ""),
            toolCallId: String(event.toolCallId ?? event.id ?? ""),
            result: (event.result ?? event.output) as ToolResult,
          })
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
    if (m.id !== assistantId) return m
    if (event.kind === "text") {
      return { ...m, text: m.text + event.delta }
    }
    if (event.kind === "tool-call") {
      const toolCalls = [...(m.toolCalls ?? []), { toolName: event.toolName, state: "running" as const }]
      return { ...m, toolCalls }
    }
    if (event.kind === "tool-result") {
      const toolCalls = [...(m.toolCalls ?? [])]
      const last = [...toolCalls].reverse().find((t) => t.toolName === event.toolName && t.state === "running")
      if (last) {
        last.state = "result"
        last.result = event.result
      } else {
        toolCalls.push({ toolName: event.toolName, state: "result", result: event.result })
      }
      return { ...m, toolCalls }
    }
    return m
  })
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-3 text-sm whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground">LeadGenAI</div>
      {message.toolCalls?.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} />
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
  )
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  if (toolCall.state === "running") {
    return (
      <Card size="sm" className="bg-muted/40">
        <CardContent className="text-xs text-muted-foreground py-2">
          Running <code className="font-mono">{toolCall.toolName}</code>…
        </CardContent>
      </Card>
    )
  }

  if (toolCall.toolName === "web_search" || toolCall.toolName === "public_source_search" || toolCall.toolName === "add_named_prospects") {
    return <WebSearchCard result={toolCall.result as WebSearchResult} />
  }
  if (toolCall.toolName === "enrich_prospect") {
    return <EnrichCard result={toolCall.result as EnrichResult} />
  }
  if (toolCall.toolName === "start_bulk_job") {
    return <BulkJobCard result={toolCall.result as BulkJobResult} />
  }
  if (toolCall.toolName === "clarify_question") {
    return <ClarifyCard result={toolCall.result as ClarifyResult} />
  }
  return null
}

function WebSearchCard({ result }: { result: WebSearchResult }) {
  return (
    <Card size="sm">
      <CardHeader className="px-4">
        <CardTitle>
          Found {result.count} candidate{result.count === 1 ? "" : "s"}
          {result.using_mock_data && (
            <Badge variant="secondary" className="ml-2 align-middle">
              demo data
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {result.candidates.slice(0, 8).map((c, i) => (
            <li key={c.id ?? i} className="flex flex-col">
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">
                {c.title} · {c.company}
              </span>
            </li>
          ))}
        </ul>
        {result.candidates.length > 8 && (
          <div className="text-xs text-muted-foreground mt-3">
            …and {result.candidates.length - 8} more
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EnrichCard({ result }: { result: EnrichResult }) {
  const fullEmail = `Subject: ${result.draft.email_subject}\n\n${result.draft.email_body}`
  return (
    <Card size="sm">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2">
          <span>
            {result.prospect.name}{" "}
            <span className="text-muted-foreground font-normal">
              — {result.prospect.title} at {result.prospect.company}
            </span>
          </span>
          <CopyButton text={fullEmail} label="Copy email" className="ml-auto" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Section label="Research">{result.draft.research_summary}</Section>
        <Section label="Subject" copyText={result.draft.email_subject}>
          {result.draft.email_subject}
        </Section>
        <Section label="Email" copyText={result.draft.email_body}>
          {result.draft.email_body}
        </Section>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
            Talking points
          </div>
          <ul className="list-disc pl-4 text-sm flex flex-col gap-1">
            {result.draft.talking_points.map((tp, i) => (
              <li key={i}>{tp}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

function BulkJobCard({ result }: { result: BulkJobResult }) {
  if (result.error) {
    return (
      <Card size="sm">
        <CardContent className="py-3 text-sm text-destructive">{result.error}</CardContent>
      </Card>
    )
  }
  return (
    <Card size="sm">
      <CardHeader className="px-4">
        <CardTitle>
          Enriched {result.prospect_count} prospect{result.prospect_count === 1 ? "" : "s"}
          {result.sheet_is_mock && (
            <Badge variant="secondary" className="ml-2 align-middle">
              demo data
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {result.sheet_url && !result.sheet_is_mock && (
            <a
              href={result.sheet_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium",
                "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
              )}
            >
              Open Google Sheet
            </a>
          )}
          {result.csv_data_url && (
            <a
              href={result.csv_data_url}
              download={`leadgenai-prospects-${result.job_id ?? "export"}.csv`}
              className={cn(
                "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium",
                "border border-border hover:bg-muted transition-colors",
              )}
            >
              Download CSV
            </a>
          )}
        </div>
        {result.preview && result.preview.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Preview
            </div>
            <ul className="text-sm flex flex-col gap-1">
              {result.preview.map((p, i) => (
                <li key={i}>
                  <span className="font-medium">{p.name}</span>{" "}
                  <span className="text-muted-foreground">
                    — {p.title} at {p.company}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {typeof result.credits_remaining === "number" && (
          <div className="text-[11px] text-muted-foreground">
            {result.credits_remaining} credit
            {result.credits_remaining === 1 ? "" : "s"} remaining
            {result.job_id && (
              <>
                {" · "}
                <a
                  href={`/app/jobs/${result.job_id}`}
                  className="underline underline-offset-2"
                >
                  view inline
                </a>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ClarifyCard({ result }: { result: ClarifyResult }) {
  return (
    <Card size="sm" className="bg-muted/40">
      <CardContent className="py-3 flex flex-col gap-2">
        <div className="text-sm">{result.question}</div>
        {result.suggested_answers && result.suggested_answers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {result.suggested_answers.map((s, i) => (
              <Badge key={i} variant="outline">
                {s}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Section({
  label,
  children,
  copyText,
}: {
  label: string
  children: React.ReactNode
  copyText?: string
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-2">
        <span>{label}</span>
        {copyText && <CopyButton text={copyText} className="ml-auto" />}
      </div>
      <div className="text-sm whitespace-pre-wrap">{children}</div>
    </div>
  )
}

function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
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
  )
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
  disabled: boolean
  onParsed: (prospects: ParsedProspect[]) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [hover, setHover] = React.useState(false)
  const [paste, setPaste] = React.useState("")
  const [warnings, setWarnings] = React.useState<string[]>([])

  async function ingest(text: string) {
    const { prospects, warnings } = csvToProspects(text)
    setWarnings(warnings)
    if (prospects.length === 0) return
    onParsed(prospects)
    setOpen(false)
    setPaste("")
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
    )
  }

  return (
    <div className="flex flex-col gap-2 pb-2">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setHover(true)
        }}
        onDragLeave={() => setHover(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setHover(false)
          const file = e.dataTransfer.files?.[0]
          if (!file) return
          const text = await file.text()
          await ingest(text)
        }}
        className={cn(
          "rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground transition-colors",
          hover && "bg-muted",
        )}
      >
        Drop a .csv file here, or paste rows below. Header row optional —
        columns: <code className="font-mono">name, company, title, linkedin_url, email</code>.
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
            setOpen(false)
            setPaste("")
            setWarnings([])
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
  )
}

function buildCsvMessage(prospects: ParsedProspect[]): string {
  const sample = prospects
    .slice(0, 8)
    .map(
      (p) =>
        `- ${p.name}${p.company ? ` at ${p.company}` : ""}${p.title ? ` (${p.title})` : ""}`,
    )
    .join("\n")
  const more =
    prospects.length > 8 ? `\n…and ${prospects.length - 8} more.` : ""
  // Compose a JSON payload the model can pass straight through to
  // add_named_prospects without any guesswork.
  const json = JSON.stringify(
    prospects.map((p) => ({
      name: p.name,
      company: p.company,
      title: p.title,
      linkedin_url: p.linkedin_url,
    })),
  )
  return `I uploaded a CSV with ${prospects.length} prospect${prospects.length === 1 ? "" : "s"}.

Sample:
${sample}${more}

Please stage them via add_named_prospects (use this exact list) and then ask me to confirm before bulk-enriching.

PROSPECTS_JSON=${json}`
}

// ---------------------------------------------------------------------
// Empty state — clickable suggestions to lower activation friction.
// ---------------------------------------------------------------------

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = [
    "find me 15 heads of marketing at fintech startups in India",
    "research Priya Sharma at Razorpay",
    "get me 20 founders running B2B SaaS in Bangalore",
  ]
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
  )
}
