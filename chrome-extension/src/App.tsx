/**
 * LeadGenAI side panel.
 *
 * Calls the same /api/chat the web app does, but authenticates via
 * `Authorization: Bearer <supabase access_token>` because cookies
 * don't cross the chrome-extension://[id] origin boundary. The token
 * is fetched from the background service worker (which reads the
 * Supabase auth cookie from the web app origin).
 *
 * Stream handling: identical pattern to app/app/chat/components/
 * chat-client.tsx — peek content-type, branch on mock JSON vs the AI
 * SDK UI-message stream. Tool cards are deliberately not rendered in
 * the side panel; the user can open the main app for those.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, Send, Bell, ExternalLink } from "lucide-react"

type Role = "user" | "assistant"

interface ChatMessage {
  id: string
  role: Role
  text: string
}

interface ExtensionAlert {
  kind: "hot_reply" | "automation_done"
  id: string
  ts: string
  title: string
  body: string
}

interface MeResponse {
  user: { id: string; email: string | null }
  plan: string
  credits_remaining: number
}

interface PageContext {
  url: string
  title: string
  metaDescription: string
}

interface TokenResponse {
  token: string | null
  apiBase: string
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

async function getTokenFromBackground(): Promise<TokenResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getToken" }, (resp: TokenResponse | undefined) => {
      if (!resp) {
        resolve({ token: null, apiBase: "http://localhost:3000" })
        return
      }
      resolve(resp)
    })
  })
}

async function fetchPageContext(): Promise<PageContext | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) {
        resolve(null)
        return
      }
      chrome.tabs.sendMessage(tab.id, { action: "getPageContext" }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          resolve(null)
          return
        }
        resolve(resp as PageContext)
      })
    })
  })
}

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [apiBase, setApiBase] = useState<string>("http://localhost:3000")
  const [me, setMe] = useState<MeResponse | null>(null)
  const [alerts, setAlerts] = useState<ExtensionAlert[]>([])
  const [pageContext, setPageContext] = useState<PageContext | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // ---- Bootstrap: token, page context, me, alerts ------------------------

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { token: t, apiBase: base } = await getTokenFromBackground()
      if (cancelled) return
      setToken(t)
      setApiBase(base)
      const ctx = await fetchPageContext()
      if (!cancelled && ctx) setPageContext(ctx)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refreshAlerts = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${apiBase}/api/extension/alerts`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = (await res.json()) as { alerts: ExtensionAlert[] }
      setAlerts(data.alerts ?? [])
    } catch {
      // network blips — silent
    }
  }, [token, apiBase])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/extension/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!cancelled && res.ok) {
          setMe((await res.json()) as MeResponse)
        }
      } catch {
        // ignore
      }
    })()
    void refreshAlerts()
    const interval = window.setInterval(refreshAlerts, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [token, apiBase, refreshAlerts])

  // ---- Auto-scroll on new content ----------------------------------------

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // ---- Submit ------------------------------------------------------------

  const submit = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim()
      if (!content || pending) return
      if (!token) {
        setError("Sign in to LeadGenAI at " + apiBase + " first.")
        return
      }

      setError(null)
      const userMsg: ChatMessage = { id: uid(), role: "user", text: content }
      const assistantId = uid()
      const placeholder: ChatMessage = { id: assistantId, role: "assistant", text: "" }
      const next = [...messages, userMsg, placeholder]
      setMessages(next)
      setInput("")
      setPending(true)

      try {
        // Inject page context as a leading system-style user note so the
        // orchestrator can ground its answer in what the user is viewing.
        const contextPreamble =
          pageContext && messages.length === 0
            ? `[Context: I'm currently on "${pageContext.title}" at ${pageContext.url}]\n\n`
            : ""

        const apiMessages = next
          .filter((m) => m.id !== assistantId)
          .map((m, i) => ({
            id: m.id,
            role: m.role,
            parts: [
              {
                type: "text" as const,
                text: i === 0 ? contextPreamble + m.text : m.text,
              },
            ],
          }))

        const res = await fetch(`${apiBase}/api/chat`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId, messages: apiMessages }),
        })

        if (!res.ok) {
          throw new Error(`Chat API ${res.status}`)
        }

        const newSession = res.headers.get("x-session-id")
        if (newSession) setSessionId(newSession)

        const contentType = res.headers.get("content-type") ?? ""
        if (contentType.includes("application/json")) {
          const data = (await res.json()) as {
            mock?: boolean
            assistant?: { text: string }
            sessionId?: string
          }
          if (data.sessionId) setSessionId(data.sessionId)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, text: data.assistant?.text ?? "" } : m,
            ),
          )
          return
        }

        // AI SDK UI-message stream — accumulate plain text from `text-delta`
        // events. We don't render tool cards in the side panel; for those
        // the user opens the main app.
        if (!res.body) throw new Error("Empty stream")
        await consumeTextDeltas(res.body, (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)),
          )
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong"
        setError(msg)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: m.text || "Sorry — I hit an error. Try again?" }
              : m,
          ),
        )
      } finally {
        setPending(false)
      }
    },
    [input, pending, token, apiBase, messages, pageContext, sessionId],
  )

  // ---- Render ------------------------------------------------------------

  const signedOut = token === null

  return (
    <div className="flex flex-col h-[600px] w-[400px] bg-background text-foreground overflow-hidden font-sans">
      <header className="flex items-center gap-3 p-3 border-b border-border bg-card">
        <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
          <Bot className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm">LeadGenAI Copilot</h1>
          <p className="text-xs text-muted-foreground truncate">
            {me?.user.email
              ? `${me.user.email} · ${me.credits_remaining} credits`
              : pageContext?.title ?? "Loading…"}
          </p>
        </div>
        {alerts.length > 0 && (
          <a
            href={`${apiBase}/app/inbox`}
            target="_blank"
            rel="noreferrer"
            className="relative inline-flex items-center justify-center h-8 w-8 rounded-full border border-border hover:bg-muted transition-colors"
            title={`${alerts.length} new alerts`}
          >
            <Bell className="h-4 w-4" />
            <span className="absolute -top-1 -right-1 text-[10px] leading-none bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">
              {alerts.length > 9 ? "9+" : alerts.length}
            </span>
          </a>
        )}
      </header>

      <main ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-muted/20">
        {signedOut ? (
          <SignedOutState apiBase={apiBase} />
        ) : messages.length === 0 ? (
          <EmptyState onPick={(s) => void submit(s)} />
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
        {pending && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm p-3 text-sm inline-flex gap-1">
              <span className="h-2 w-2 bg-muted-foreground/50 rounded-full animate-pulse" />
              <span
                className="h-2 w-2 bg-muted-foreground/50 rounded-full animate-pulse"
                style={{ animationDelay: "0.15s" }}
              />
              <span
                className="h-2 w-2 bg-muted-foreground/50 rounded-full animate-pulse"
                style={{ animationDelay: "0.3s" }}
              />
            </div>
          </div>
        )}
      </main>

      {error && (
        <div className="px-3 pb-2 text-xs text-destructive">{error}</div>
      )}

      <footer className="p-3 border-t border-border bg-card">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex items-center relative"
        >
          <input
            className="w-full bg-muted border-none rounded-full pl-4 pr-12 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            value={input}
            placeholder={signedOut ? "Sign in first…" : "Ask LeadGenAI…"}
            onChange={(e) => setInput(e.target.value)}
            disabled={signedOut || pending}
          />
          <button
            type="submit"
            disabled={!input.trim() || pending || signedOut}
            className="absolute right-1.5 h-7 w-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-40 transition-opacity"
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </footer>
    </div>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          "max-w-[85%] rounded-2xl p-3 text-sm whitespace-pre-wrap " +
          (isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-card border border-border rounded-tl-sm")
        }
      >
        {message.text || (isUser ? "" : "…")}
      </div>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  const prompts = [
    "Summarize this page for outreach context",
    "Find 10 prospects similar to the company on this page",
    "Draft a cold email referencing this page",
  ]
  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-8 opacity-80">
      <Bot className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">How can I help on this page?</p>
      <div className="flex flex-col gap-1.5 w-full px-4">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="text-xs text-left rounded-lg border border-border bg-card hover:bg-muted px-3 py-2 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function SignedOutState({ apiBase }: { apiBase: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-8">
      <Bot className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm">Sign in to LeadGenAI to use the side panel.</p>
      <a
        href={`${apiBase}/login`}
        target="_blank"
        rel="noreferrer"
        className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-primary-foreground"
      >
        Open sign-in <ExternalLink className="h-3 w-3" />
      </a>
      <p className="text-[11px] text-muted-foreground px-4">
        Once signed in, re-open this side panel.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stream parsing
// ---------------------------------------------------------------------------

/**
 * Drain the AI SDK UI-message stream body, surfacing only text deltas via
 * the `onText` callback. The protocol emits newline-delimited JSON events;
 * each `text-delta` event carries the `delta` field we want to render.
 * Anything else (tool-call events, finish, etc.) is intentionally ignored
 * — the side panel renders prose only.
 */
async function consumeTextDeltas(
  body: ReadableStream<Uint8Array>,
  onText: (delta: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl = buffer.indexOf("\n")
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf("\n")
      if (!line) continue
      const colon = line.indexOf(":")
      const payload = colon === -1 ? line : line.slice(colon + 1).trim()
      if (!payload) continue
      try {
        const parsed = JSON.parse(payload) as unknown
        const delta = extractTextDelta(parsed)
        if (delta) onText(delta)
      } catch {
        // not JSON — skip
      }
    }
  }
}

function extractTextDelta(event: unknown): string | null {
  if (!event || typeof event !== "object") return null
  const e = event as Record<string, unknown>
  const type = typeof e.type === "string" ? e.type : null
  if (type === "text-delta" || type === "text") {
    const delta = e.delta ?? e.text ?? e.textDelta
    return typeof delta === "string" ? delta : null
  }
  return null
}
