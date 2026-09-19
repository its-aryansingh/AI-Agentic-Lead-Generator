import { NextResponse } from "next/server";

import { getUserFromRequest } from "@/lib/api-auth";
import { applyApprovedChatAction } from "@/lib/agent/tool-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * UI-only confirmation boundary for Phase 6 chat previews. The model cannot
 * call this route: it requires the authenticated browser's scoped approval
 * token and never accepts arbitrary provider or execution parameters.
 */
export async function POST(request: Request) {
  const { user } = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.sessionId !== "string" || typeof body.approvalId !== "string" || typeof body.confirmationToken !== "string") {
    return NextResponse.json({ error: "invalid_confirmation" }, { status: 400 });
  }
  const result = await applyApprovedChatAction({
    userId: user.id,
    sessionId: body.sessionId,
    approvalId: body.approvalId,
    confirmationToken: body.confirmationToken,
    overrideConfirmed: body.overrideConfirmed === true,
  });
  const status = "error" in result ? (result.error === "approval_not_found_or_expired" ? 404 : 409) : 200;
  return NextResponse.json(result, { status });
}
