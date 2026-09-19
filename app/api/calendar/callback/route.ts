import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { encryptCredential } from "@/lib/credential-crypto";
import {
  exchangeGoogleCalendarCode,
  verifyGoogleCalendar,
} from "@/lib/providers/google-calendar";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { syncManagedAgentCalendarTools } from "@/lib/voice/calendar-agent-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const settings = `${origin}/app/settings/voice-calling`;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  const code = searchParams.get("code");
  const state = searchParams.get("state") ?? "";
  const [stateUserId, issuedAtText, signature = ""] = state.split(".");
  const secret = process.env.CALENDAR_STATE_SECRET;
  if (!code || !secret) {
    return NextResponse.redirect(`${settings}?error=calendar_oauth_failed`);
  }
  const unsigned = `${stateUserId}.${issuedAtText}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(unsigned)
    .digest("hex");
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(issuedAtText);
  const valid =
    stateUserId === user.id &&
    Number.isFinite(ageSeconds) &&
    ageSeconds >= 0 &&
    ageSeconds <= 600 &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return NextResponse.redirect(`${settings}?error=calendar_bad_state`);

  try {
    const exchanged = await exchangeGoogleCalendarCode(code);
    await verifyGoogleCalendar({
      refreshToken: exchanged.refreshToken,
      calendarId: "primary",
      timezone: "Asia/Kolkata",
    });
    const admin = createAdminClient();
    const { error } = await admin.from("calendar_connections").upsert(
      {
        user_id: user.id,
        provider: "google",
        status: "active",
        account_email: exchanged.email,
        encrypted_refresh_token: encryptCredential(exchanged.refreshToken),
        calendar_id: "primary",
        last_verified_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );
    if (error) throw error;
    let sync;
    try {
      sync = await syncManagedAgentCalendarTools(user.id, true);
    } catch {
      return NextResponse.redirect(`${settings}?calendar_connected=1&error=calendar_agent_sync_failed`);
    }
    return NextResponse.redirect(
      `${settings}?calendar_connected=1&calendar_sync=${sync.synced ? "managed" : "skipped"}`,
    );
  } catch {
    return NextResponse.redirect(`${settings}?error=calendar_exchange_failed`);
  }
}
