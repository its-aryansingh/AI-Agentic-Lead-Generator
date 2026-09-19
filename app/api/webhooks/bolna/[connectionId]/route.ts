import { after, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/server";
import { signalBolnaCallEvent } from "@/lib/temporal/client";
import { validBolnaWebhookSource, validVoiceWebhookSignature } from "@/lib/voice-compliance";
import { applyBolnaOutcome, bolnaExecutionId } from "@/lib/voice-outcome";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const signature = new URL(req.url).searchParams.get("signature") ?? "";
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  const supabase = createAdminClient();
  const { data: connection } = await supabase
    .from("voice_connections")
    .select("id,user_id,webhook_version,temporal_enabled")
    .eq("id", connectionId)
    .eq("provider", "bolna")
    .maybeSingle();
  if (!connection) return new NextResponse("Unknown connection", { status: 404 });
  if (
    !validVoiceWebhookSignature(
      connectionId,
      signature,
      Number(connection.webhook_version),
    )
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!validBolnaWebhookSource(req.headers)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const providerExecutionId = bolnaExecutionId(payload);
  const { data: execution } = connection.temporal_enabled
    ? await supabase
        .from("voice_executions")
        .select("id,temporal_workflow_id")
        .eq("connection_id", connectionId)
        .eq("user_id", connection.user_id)
        .eq("provider_execution_id", providerExecutionId)
        .maybeSingle()
    : { data: null };
  const result = await applyBolnaOutcome(supabase, connectionId, payload, String(connection.user_id));
  if (execution?.temporal_workflow_id) {
    after(async () => {
      try {
        await signalBolnaCallEvent(String(execution.id), payload);
      } catch {
        // The database write is durable; reconciliation will retry the provider
        // state. Do not log execution payloads, transcripts, or provider errors.
      }
    });
  }
  return NextResponse.json(result, { status: result.matched ? 200 : 202 });
}
