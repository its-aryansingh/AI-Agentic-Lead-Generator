import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase
    .from("voice_executions")
    .select("id,transcript,summary")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load transcript." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // JSON is rendered as text by the client; no transcript HTML is trusted.
  return NextResponse.json({ transcript: data.transcript ?? null, summary: data.summary ?? null });
}
