import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserFromRequest } from "@/lib/api-auth";
import {
  enqueueProspectEnrichment,
  EnqueueError,
} from "@/lib/enrichment/enqueue";

export const runtime = "nodejs";
export const maxDuration = 15;

const Body = z
  .object({
    domain: z.string().trim().max(253).optional(),
    force: z.boolean().optional().default(false),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getUserFromRequest(request);
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "INVALID_PROSPECT_ID" }, { status: 400 });
  }

  let body: unknown = {};
  const raw = await request.text();
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
    }
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REQUEST", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await enqueueProspectEnrichment({
      userId: auth.user.id,
      prospectId: id,
      domain: parsed.data.domain,
      idempotencyHint: request.headers.get("idempotency-key"),
      force: parsed.data.force,
    });
    return NextResponse.json(result, {
      status:
        result.status === "completed" || result.status === "partial"
          ? 200
          : 202,
      headers: {
        "Cache-Control": "no-store",
        Location: `/api/prospects/${id}/enrichment-runs/${result.run_id}`,
      },
    });
  } catch (error) {
    if (error instanceof EnqueueError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json(
      { error: "ENRICHMENT_ENQUEUE_FAILED" },
      { status: 500 },
    );
  }
}
