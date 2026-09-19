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
    .select("id,prospect_id,status,provider_status,outcome,outcome_data,summary,duration_seconds,answered,started_at,answered_at,completed_at,cost_minor_units,cost_currency,cost_unit,cost_breakdown,recording_metadata,created_at,prospects(input_name,input_company)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load call details." }, { status: 500 });
  // Use the same response for absent and cross-tenant IDs.
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
