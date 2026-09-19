import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/server";
import { reconcileStaleVoiceExecutions } from "@/lib/voice/reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const provided = (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  return Boolean(process.env.CRON_SECRET) && provided === process.env.CRON_SECRET;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const summary = await reconcileStaleVoiceExecutions(createAdminClient());
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json(
      { error: "Voice reconciliation failed." },
      { status: 500 },
    );
  }
}

export { POST as GET };
