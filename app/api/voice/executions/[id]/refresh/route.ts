import { NextResponse } from "next/server";

import { decryptCredential } from "@/lib/credential-crypto";
import { getBolnaExecution } from "@/lib/providers/bolna";
import { createClient } from "@/lib/supabase/server";
import { signalBolnaCallEvent } from "@/lib/temporal/client";
import { applyBolnaOutcome } from "@/lib/voice-outcome";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: execution, error } = await supabase
    .from("voice_executions")
    .select(
      "id,provider_execution_id,connection_id,temporal_workflow_id,voice_connections!inner(encrypted_api_key,agent_id)",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!execution?.provider_execution_id) {
    return NextResponse.json({ error: "Execution not ready" }, { status: 409 });
  }
  try {
    const connection = execution.voice_connections as unknown as {
      encrypted_api_key: string;
      agent_id: string;
    };
    const payload = await getBolnaExecution(
      decryptCredential(connection.encrypted_api_key),
      String(execution.provider_execution_id),
      connection.agent_id,
    );
    const result = await applyBolnaOutcome(
      supabase,
      String(execution.connection_id),
      payload,
    );
    if (execution.temporal_workflow_id) {
      try {
        await signalBolnaCallEvent(String(execution.id), payload);
      } catch {
      }
    }
    return NextResponse.json(result);
  } catch (cause) {
    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "Could not fetch the Bolna execution.",
      },
      { status: 502 },
    );
  }
}
