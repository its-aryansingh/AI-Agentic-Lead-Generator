import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function allowedRecordingUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const configured = (process.env.BOLNA_RECORDING_HOSTS ?? "")
      .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
    return [
      "api.bolna.ai",
      "bolna-call-recordings.s3.us-east-1.amazonaws.com",
    ].includes(url.hostname.toLowerCase()) || configured.includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await supabase.from("voice_executions")
    .select("recording_url").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data?.recording_url || !allowedRecordingUrl(String(data.recording_url))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const upstream = await fetch(String(data.recording_url), { redirect: "error", signal: AbortSignal.timeout(20_000) });
    const type = upstream.headers.get("content-type") ?? "audio/mpeg";
    if (!upstream.ok || !type.toLowerCase().startsWith("audio/")) return NextResponse.json({ error: "Recording unavailable" }, { status: 502 });
    return new NextResponse(upstream.body, { headers: { "content-type": type, "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Recording unavailable" }, { status: 502 });
  }
}
