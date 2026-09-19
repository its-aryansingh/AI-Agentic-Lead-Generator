import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  applyCrmPull,
  previewCrmPull,
  type CrmProvider,
  type CrmPullDatabase,
} from "@/lib/crm-pull";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Request must be JSON.");
  }

  const provider = body.provider;
  const mode = body.mode;
  if (provider !== "hubspot" && provider !== "zoho") {
    return badRequest("provider must be hubspot or zoho.");
  }
  if (mode !== "preview" && mode !== "apply") {
    return badRequest("mode must be preview or apply.");
  }

  const limit = body.limit === undefined ? 100 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return badRequest("limit must be an integer from 1 to 100.");
  }

  const modifiedAfter =
    typeof body.modifiedAfter === "string" ? body.modifiedAfter : undefined;
  if (modifiedAfter && Number.isNaN(new Date(modifiedAfter).getTime())) {
    return badRequest("modifiedAfter must be an ISO date.");
  }

  const cursor = typeof body.cursor === "string" ? body.cursor : undefined;
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const supabase = createAdminClient();

  try {
    if (mode === "preview") {
      const result = await previewCrmPull(
        supabase as unknown as CrmPullDatabase,
        user.id,
        provider as CrmProvider,
        { limit, modifiedAfter, cursor },
      );
      return NextResponse.json({
        mode,
        provider,
        contacts: result.contacts,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        summary: {
          ...result.summary,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        },
        confirmationToken: result.confirmationToken,
      });
    }

    if (
      typeof body.confirmationToken !== "string" ||
      body.confirmationToken.length < 32
    ) {
      return badRequest("A confirmation token from the preview is required.");
    }

    const result = await applyCrmPull(
      supabase as unknown as CrmPullDatabase,
      user.id,
      {
        provider: provider as CrmProvider,
        options: { limit, modifiedAfter, cursor },
        confirmationToken: body.confirmationToken,
      },
    );
    return NextResponse.json({ mode, provider, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CRM pull failed.";
    return NextResponse.json(
      { error: message },
      {
        status:
          /not connected|invalid or has expired|differs from the preview/i.test(
            message,
          )
            ? 409
            : 502,
      },
    );
  }
}
