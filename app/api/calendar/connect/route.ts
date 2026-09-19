import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { googleCalendarConsentUrl } from "@/lib/providers/google-calendar";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  const secret = process.env.CALENDAR_STATE_SECRET;
  if (!secret) {
    return NextResponse.redirect(
      `${origin}/app/settings/voice-calling?error=calendar_state_secret_missing`,
    );
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${user.id}.${issuedAt}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(unsigned)
    .digest("hex");
  const url = googleCalendarConsentUrl(`${unsigned}.${signature}`);
  if (!url) {
    return NextResponse.redirect(
      `${origin}/app/settings/voice-calling?error=google_calendar_not_configured`,
    );
  }
  return NextResponse.redirect(url);
}

