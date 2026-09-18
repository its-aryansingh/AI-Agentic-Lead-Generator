/**
 * Streaming chat endpoint.
 *
 * POST /api/chat
 * Body: { sessionId?: string, messages: UIMessage[] }
 *
 * - Authenticates via Supabase cookies (middleware refreshes session).
 * - Creates a chat_session lazily on first message.
 * - Persists user + assistant messages around each streamText call.
 * - When no verified customer/environment AI provider exists, returns a canned assistant
 *   message instead of streaming so the UI still demos end-to-end.
 */

import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-session-id",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

import { createAdminClient } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { getChatModel } from "@/lib/providers/anthropic";
import { ORCHESTRATOR_PROMPT } from "@/lib/agent/orchestrator-prompt";
import { makeOrchestratorTools } from "@/lib/agent/orchestrator-tools";
import { maybeResetCredits, checkCredits } from "@/lib/credits";
import { recordAiUsage, deductCreditsForAiOp } from "@/lib/ai-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  // Accept Authorization: Bearer <jwt> (Chrome extension, native callers)
  // OR the existing Supabase cookie session (browser). Browser behaviour
  // is unchanged because bearer is only attempted when the header exists.
  const { user } = await getUserFromRequest(req);
  if (!user) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: corsHeaders,
    });
  }

  let body: { sessionId?: string; messages: UIMessage[] };
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const admin = createAdminClient();

  // Ensure a public.users row exists. This is normally done at OAuth
  // callback time, but new-user races (or fresh dev DBs) can miss it.
  await admin
    .from("users")
    .upsert(
      { id: user.id, email: user.email! },
      { onConflict: "id", ignoreDuplicates: true },
    );

  // Refresh free-tier credits if the previous reset window has lapsed.
  // No-op for users whose reset_at is still in the future.
  await maybeResetCredits(user.id);

  // Resolve or create the chat session.
  //
  // Security: when the caller supplies a sessionId we MUST verify it
  // belongs to this user before writing into it. The admin client below
  // bypasses RLS, so without this check an authenticated user could
  // append messages to any other user's chat by guessing the UUID.
  let sessionId = body.sessionId;
  if (sessionId) {
    const { data: owned } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!owned) {
      return new NextResponse("Forbidden", {
        status: 403,
        headers: corsHeaders,
      });
    }
  } else {
    const firstUserMessage =
      body.messages
        .find((m) => m.role === "user")
        ?.parts?.map((p) => (p.type === "text" ? p.text : ""))
        .join(" ")
        .slice(0, 80) ?? "New chat";
    const { data: session, error } = await admin
      .from("chat_sessions")
      .insert({ user_id: user.id, title: firstUserMessage })
      .select("id")
      .single();
    if (error || !session) {
      return new NextResponse("Failed to create session", {
        status: 500,
        headers: corsHeaders,
      });
    }
    sessionId = session.id as string;
  }

  // Persist the most-recent user message (if any).
  const lastMessage = body.messages[body.messages.length - 1];
  if (lastMessage?.role === "user") {
    await admin.from("chat_messages").insert({
      session_id: sessionId,
      role: "user",
      content: lastMessage as unknown as Record<string, unknown>,
    });
  }

  // ------------------------------------------------------------------
  // Mock branch — no Anthropic key. Return a canned reply so the UI
  // remains demoable without external accounts.
  // ------------------------------------------------------------------
  const resolvedAi = await getChatModel(user.id);
  if (!resolvedAi) {
    const canned = mockAssistantReply(lastMessage);
    await admin.from("chat_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: canned as unknown as Record<string, unknown>,
    });

    return new NextResponse(
      JSON.stringify({ mock: true, sessionId, assistant: canned }),
      {
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
          "x-session-id": sessionId,
        },
      },
    );
  }

  // ------------------------------------------------------------------
  // Pre-flight credit check — 1 credit minimum to start a chat turn.
  // ------------------------------------------------------------------
  const creditCheck = await checkCredits(user.id, 1);
  if (!creditCheck.ok) {
    return new NextResponse(
      JSON.stringify({
        error: "insufficient_credits",
        message: "You have 0 credits remaining. Top up at Settings → Billing.",
        remaining: creditCheck.remaining,
      }),
      {
        status: 402,
        headers: { ...corsHeaders, "content-type": "application/json" },
      },
    );
  }

  // ------------------------------------------------------------------
  // Real streaming branch.
  // ------------------------------------------------------------------
  const tools = makeOrchestratorTools({ userId: user.id, sessionId });

  const modelMessages = await convertToModelMessages(body.messages);

  const result = streamText({
    model: resolvedAi.model,
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
          );
          return {
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
            input: tc.input,
            result: matchingResult
              ? (matchingResult as { output: unknown }).output
              : null,
          };
        });

        await admin.from("chat_messages").insert({
          session_id: sessionId!,
          role: "assistant",
          content: {
            text,
            toolCalls: persistedToolCalls,
          } as Record<string, unknown>,
        });
        const creditCost = (
          await import("@/lib/credit-costs")
        ).creditsForOperation(resolvedAi.modelId, "chat");
        await recordAiUsage({
          userId: user.id,
          provider: resolvedAi.provider,
          model: resolvedAi.modelId,
          operation: "chat_orchestration",
          status: "completed",
          durationMs: 0,
          creditCost,
        });
        await deductCreditsForAiOp({
          userId: user.id,
          modelId: resolvedAi.modelId,
          purpose: "chat",
          operationLabel: "chat_orchestration",
        });
      } catch {
        // best-effort persistence — never break the response
      }
    },
  });

  return result.toUIMessageStreamResponse({
    headers: { ...corsHeaders, "x-session-id": sessionId! },
  });
}

// ---------------------------------------------------------------------
// Mock reply — deterministic by user text so demos feel coherent.
// ---------------------------------------------------------------------

function mockAssistantReply(userMsg: UIMessage | undefined) {
  const text =
    userMsg?.parts?.map((p) => (p.type === "text" ? p.text : "")).join(" ") ??
    "";
  const lower = text.toLowerCase();

  if (
    lower.includes("find") ||
    lower.includes("show") ||
    lower.includes("get me")
  ) {
    return {
      text: "I'd run a Brave search and surface candidates with role, company, and public profile details.\n\nNote: running on demo data — connect OpenAI or Anthropic under Settings → Providers.",
    };
  }
  if (lower.includes("research") || lower.includes("enrich")) {
    return {
      text: "I'd enrich that prospect and draft a concise factual email.\n\nNote: running on demo data — connect OpenAI or Anthropic under Settings → Providers.",
    };
  }
  return {
    text: "Welcome to Aravya SalesEngAI. Describe your ideal customer in one sentence and I'll surface candidates plus draft personalized emails.\n\nNote: configure your model preferences under Settings → AI Models.",
  };
}
