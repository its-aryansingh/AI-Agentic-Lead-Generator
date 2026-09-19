import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/server";
import { deliverLeadHandoffNotifications } from "@/lib/unified-lead-handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return Boolean(process.env.CRON_SECRET) && provided === process.env.CRON_SECRET;
}

export async function POST(request: Request) {
  if (!authorized(request)) return new NextResponse("Forbidden", { status: 403 });
  try {
    await deliverLeadHandoffNotifications(createAdminClient(), 50);
    return NextResponse.json({ delivered: true });
  } catch {
    return NextResponse.json({ error: "Handoff notification delivery failed." }, { status: 500 });
  }
}

export { POST as GET };