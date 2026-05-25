/**
 * Streaming chat endpoint.
 *
 * POST /api/chat
 * Body: { sessionId?: string, messages: UIMessage[] }
 *
 * - Authenticates via Supabase cookies (middleware refreshes session).
 * - Creates a chat_session lazily on first message.
 * - Persists user + assistant messages around each streamText call.
 * - When ANTHROPIC_API_KEY isn't set, returns a single canned assistant
 *   message instead of streaming so the UI still demos end-to-end.
 */

import { NextResponse } from "next/server"
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-session-id",
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders })
}

import { createAdminClient } from "@/lib/supabase/server"
import { getUserFromRequest } from "@/lib/api-auth"
import { getChatModel } from "@/lib/providers/anthropic"
import { ORCHESTRATOR_PROMPT } from "@/lib/agent/orchestrator-prompt"
import { makeOrchestratorTools } from "@/lib/agent/orchestrator-tools"
import { hasKey } from "@/lib/utils"
import { maybeResetCredits } from "@/lib/credits"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: Request) {
  // Accept Authorization: Bearer <jwt> (Chrome extension, native callers)
  // OR the existing Supabase cookie session (browser). Browser behaviour
  // is unchanged because bearer is only attempted when the header exists.
  const { user } = await getUserFromRequest(req)
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401, headers: corsHeaders })
  }

  let body: { sessionId?: string; messages: UIMessage[] }
  try {
    body = await req.json()
  } catch {
    return new NextResponse("Invalid JSON", { status: 400, headers: corsHeaders })
  }

  const admin = createAdminClient()

  // Ensure a public.users row exists. This is normally done at OAuth
  // callback time, but new-user races (or fresh dev DBs) can miss it.
  await admin
    .from("users")
    .upsert(
      { id: user.id, email: user.email! },
      { onConflict: "id", ignoreDuplicates: true },
    )

  // Refresh free-tier credits if the previous reset window has lapsed.
  // No-op for users whose reset_at is still in the future.
  await maybeResetCredits(user.id)

  // Resolve or create the chat session.
  //
  // Security: when the caller supplies a sessionId we MUST verify it
  // belongs to this user before writing into it. The admin client below
  // bypasses RLS, so without this check an authenticated user could
  // append messages to any other user's chat by guessing the UUID.
  let sessionId = body.sessionId
  if (sessionId) {
    const { data: owned } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!owned) {
      return new NextResponse("Forbidden", { status: 403, headers: corsHeaders })
    }
  } else {
    const firstUserMessage =
      body.messages.find((m) => m.role === "user")?.parts
        ?.map((p) => (p.type === "text" ? p.text : ""))
        .join(" ")
        .slice(0, 80) ?? "New chat"
    const { data: session, error } = await admin
      .from("chat_sessions")
      .insert({ user_id: user.id, title: firstUserMessage })
      .select("id")
      .single()
    if (error || !session) {
      return new NextResponse("Failed to create session", { status: 500, headers: corsHeaders })
    }
    sessionId = session.id as string
  }

  // Persist the most-recent user message (if any).
  const lastMessage = body.messages[body.messages.length - 1]
  if (lastMessage?.role === "user") {
    await admin.from("chat_messages").insert({
      session_id: sessionId,
      role: "user",
      content: lastMessage as unknown as Record<string, unknown>,
    })
  }

  // ------------------------------------------------------------------
  // Mock branch — no Anthropic key. Return a canned reply so the UI
  // remains demoable without external accounts.
  // ------------------------------------------------------------------
  if (!hasKey("anthropic")) {
    const canned = mockAssistantReply(lastMessage)
    await admin.from("chat_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: canned as unknown as Record<string, unknown>,
    })

    return new NextResponse(
      JSON.stringify({ mock: true, sessionId, assistant: canned }),
      { headers: { ...corsHeaders, "content-type": "application/json", "x-session-id": sessionId } },
    )
  }

  // ------------------------------------------------------------------
  // Real streaming branch.
  // ------------------------------------------------------------------
  const tools = makeOrchestratorTools({ userId: user.id, sessionId })

  const modelMessages = await convertToModelMessages(body.messages)

  const result = streamText({
    model: getChatModel(),
    system: ORCHESTRATOR_PROMPT,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(10),
    onFinish: async ({ text, toolCalls, toolResults }) => {
      try {
        // Persist enough to replay the message on resume: the final text
        // PLUS each tool call's name+result so the UI can re-render its
        // ToolCallCard exactly as it appeared during streaming.
        const persistedToolCalls = (toolCalls ?? []).map((tc) => {
          const matchingResult = (toolResults ?? []).find(
            (tr) => tr.toolCallId === tc.toolCallId,
          )
          return {
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
            input: tc.input,
            result: matchingResult ? (matchingResult as { output: unknown }).output : null,
          }
        })

        await admin.from("chat_messages").insert({
          session_id: sessionId!,
          role: "assistant",
          content: {
            text,
            toolCalls: persistedToolCalls,
          } as Record<string, unknown>,
        })
      } catch {
        // best-effort persistence — never break the response
      }
    },
  })

  return result.toUIMessageStreamResponse({
    headers: { ...corsHeaders, "x-session-id": sessionId! },
  })
}

// ---------------------------------------------------------------------
// Mock reply — deterministic by user text so demos feel coherent.
// ---------------------------------------------------------------------

function mockAssistantReply(userMsg: UIMessage | undefined) {
  const text =
    userMsg?.parts
      ?.map((p) => (p.type === "text" ? p.text : ""))
      .join(" ") ?? ""
  const lower = text.toLowerCase()

  if (lower.includes("find") || lower.includes("show") || lower.includes("get me")) {
    return {
      text: "I'd run a Brave search for that and surface ~15 candidates with role + company + LinkedIn URL. Once you confirm the list looks right, I'd kick off bulk enrichment: research summary + personalized cold email + 3 talking points per prospect, exported to a Google Sheet plus a downloadable CSV.\n\nNote: running on demo data — set ANTHROPIC_API_KEY and BRAVE_SEARCH_KEY in .env.local to get real results.",
    }
  }
  if (lower.includes("research") || lower.includes("enrich")) {
    return {
      text: "I'd enrich that single prospect inline: pull recent public signals, draft a ≤60-word cold email that opens with a specific factual hook (not 'I noticed you...'), and surface 3 follow-up talking points. Takes ~15s with real keys.\n\nNote: running on demo data — set ANTHROPIC_API_KEY in .env.local to get real drafts.",
    }
  }
  return {
    text: "Welcome to LeadGenAI. Describe your ideal customer in one sentence — e.g. 'find me 20 heads of marketing at fintech startups in India' — and I'll surface candidates plus draft personalized cold emails.\n\nNote: running on demo data — drop your Anthropic + Brave keys into .env.local to enable real enrichment.",
  }
}
