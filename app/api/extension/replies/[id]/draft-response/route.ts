/**
 * POST /api/extension/replies/[id]/draft-response
 *
 * Bearer-authed direct-call wrapper around the agent's draft_reply
 * tool. Lets the Chrome extension's Inbox + mobile app request a
 * drafted response for a specific reply without going through the
 * chat orchestrator — one round-trip, no streaming overhead.
 *
 * Returns the same shape as the agent tool: { reply_classification_id,
 * recipient_id, category, wants_meeting, draft: {subject, body,
 * next_step}, using_mock_data }.
 *
 * Does NOT send. The client always reviews and presses Send themselves.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { getUserFromBearer } from "@/lib/api-auth"
import { handleDraftReply } from "@/lib/agent/tool-handlers"

export const runtime = "nodejs"
export const maxDuration = 30

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders })
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const req = _req
  const auth = await getUserFromBearer(req)
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauthorized", reason: auth.reason },
      { status: 401, headers: corsHeaders },
    )
  }
  const { user } = auth

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { error: "invalid reply id" },
      { status: 400, headers: corsHeaders },
    )
  }

  // We use the same handler the orchestrator's draft_reply tool uses,
  // so the draft is identical regardless of entry point. The handler
  // gates on the reply being owned by the calling user.
  const result = await handleDraftReply(
    { reply_classification_id: id },
    { userId: user.id, sessionId: "extension-draft-response" },
  )

  if ("error" in result && result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: 404, headers: corsHeaders },
    )
  }

  return NextResponse.json(result, { headers: corsHeaders })
}
