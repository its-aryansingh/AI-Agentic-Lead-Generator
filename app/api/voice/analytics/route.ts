import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getVoiceAnalytics } from "@/lib/voice/voice-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const list = (value: string | null) =>
  value ? value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20) : undefined;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  try {
    const analytics = await getVoiceAnalytics(user.id, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      status: list(url.searchParams.get("status")),
      outcome: list(url.searchParams.get("outcome")),
      prospectId: url.searchParams.get("prospectId") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25), 1), 100),
    }, supabase);
    const { data: account } = await supabase
      .from("users")
      .select("credits_remaining")
      .eq("id", user.id)
      .maybeSingle();
    return NextResponse.json({
      ...analytics,
      platformCreditsRemaining: Number(account?.credits_remaining ?? 0),
    });
  } catch {
    return NextResponse.json({ error: "Could not load call intelligence." }, { status: 500 });
  }
}
