import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { ChatClient } from "../components/chat-client"

interface ChatMessageRow {
  id: string
  role: "user" | "assistant" | "tool" | "system"
  content: Record<string, unknown>
  created_at: string
}

interface PersistedToolCall {
  toolName: string
  result?: unknown
}

interface InitialMessage {
  id: string
  role: "user" | "assistant"
  text: string
  toolCalls?: PersistedToolCall[]
}

/**
 * /app/chat/[sessionId] — resume a previous chat.
 *
 * RLS scopes chat_sessions + chat_messages to the current user, so the
 * "does this session belong to me?" check is implicit in the query
 * returning data vs. nothing.
 */
export default async function ResumeChatPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Confirm the session belongs to this user (RLS would block but a
  // 404 is friendlier than an empty page).
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id,title,user_id")
    .eq("id", sessionId)
    .maybeSingle()
  if (!session) notFound()

  const { data: rows } = await supabase
    .from("chat_messages")
    .select("id,role,content,created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })

  const initialMessages: InitialMessage[] = (rows ?? [])
    .filter(
      (r): r is ChatMessageRow =>
        r.role === "user" || r.role === "assistant",
    )
    .map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      text: extractText(r.content),
      toolCalls: extractToolCalls(r.content),
    }))

  let creditsRemaining = 25
  if (user) {
    const { data } = await supabase
      .from("users")
      .select("credits_remaining")
      .eq("id", user.id)
      .maybeSingle()
    if (data?.credits_remaining !== undefined) {
      creditsRemaining = data.credits_remaining as number
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h1 className="text-base font-semibold truncate max-w-md">
          {(session.title as string | null) ?? "Resumed chat"}
        </h1>
        <span className="text-xs text-muted-foreground">
          credits: {creditsRemaining} / free tier
        </span>
      </header>
      <ChatClient initialSessionId={sessionId} initialMessages={initialMessages} />
    </div>
  )
}

/**
 * chat_messages.content is stored as flexible JSON — user messages come
 * in as full UIMessage objects (with parts[]), assistant messages from
 * onFinish persist as { text }. Handle both shapes defensively.
 */
function extractText(content: Record<string, unknown>): string {
  if (typeof content.text === "string") return content.text
  const parts = content.parts as Array<{ type: string; text?: string }> | undefined
  if (Array.isArray(parts)) {
    return parts
      .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("")
  }
  return ""
}

function extractToolCalls(content: Record<string, unknown>): PersistedToolCall[] {
  const raw = content.toolCalls
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is { toolName: string; result?: unknown } => {
      return (
        typeof c === "object" &&
        c !== null &&
        typeof (c as { toolName?: unknown }).toolName === "string"
      )
    })
    .map((c) => ({ toolName: c.toolName, result: c.result }))
}
