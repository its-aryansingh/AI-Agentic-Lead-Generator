import type { CompatClient } from "@/lib/supabase/server";

import { decryptCredential } from "@/lib/credential-crypto";
import { notifyPush, notifySlack } from "@/lib/notifications";
import { applyBolnaOutcome } from "@/lib/voice-outcome";
import { getBolnaExecution } from "@/lib/voice/providers/bolna";
import {
  decideVoiceReconciliation,
  shouldAlertVoiceReconciliation,
  VOICE_RECONCILIATION_BATCH_SIZE,
  VOICE_RECONCILIATION_COMPLETED_WINDOW_MS,
  VOICE_RECONCILIATION_STALE_MS,
} from "@/lib/voice/reconciliation-core";

type StaleVoiceExecution = {
  id: string;
  user_id: string;
  connection_id: string;
  prospect_id: string | null;
  provider_execution_id: string | null;
  temporal_workflow_id: string | null;
  status: "queued" | "in_progress" | "finalizing" | "completed";
  provider_status: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  reconciliation_attempts: number | null;
  last_reconciled_at: string | null;
  reconciliation_error: string | null;
  reconciliation_alerted_at: string | null;
  voice_connections:
    | { encrypted_api_key: string; agent_id: string }
    | Array<{ encrypted_api_key: string; agent_id: string }>;
};

export type VoiceReconciliationSummary = {
  scanned: number;
  repaired: number;
  current: number;
  failed: number;
  orphaned: number;
  alerted: number;
  skipped: number;
};

type ReconciliationDependencies = {
  getExecution?: typeof getBolnaExecution;
  applyOutcome?: typeof applyBolnaOutcome;
  alert?: (execution: StaleVoiceExecution, message: string) => Promise<void>;
};

function connectionCredential(execution: StaleVoiceExecution) {
  const connection = Array.isArray(execution.voice_connections)
    ? execution.voice_connections[0]
    : execution.voice_connections;
  if (!connection?.encrypted_api_key) {
    throw new Error("Voice connection credential is unavailable.");
  }
  return { apiKey: decryptCredential(connection.encrypted_api_key), agentId: connection.agent_id };
}

async function sendOperationalAlert(
  execution: StaleVoiceExecution,
  message: string,
) {
  const destination = execution.prospect_id
    ? `/app/leads/${execution.prospect_id}`
    : "/app/analytics";
  await Promise.all([
    notifyPush(execution.user_id, {
      title: "Voice call needs attention",
      body: message,
      priority: "high",
      data: {
        kind: "voice_reconciliation_failed",
        voice_execution_id: execution.id,
        prospect_id: execution.prospect_id,
      },
    }),
    notifySlack(execution.user_id, {
      emoji: "🚨",
      text: `Voice call reconciliation needs attention: ${message}`,
      link: { url: destination, label: "Review call" },
    }),
  ]);
}

async function markOrphaned(
  supabase: CompatClient,
  execution: StaleVoiceExecution,
  nowIso: string,
) {
  const message =
    "The call request never received a provider execution ID and was not dialed.";
  const { error } = await supabase
    .from("voice_executions")
    .update({
      status: "failed",
      provider_status: "reconciliation_orphan",
      outcome: "request_not_started",
      error_message: message,
      reconciliation_attempts:
        Number(execution.reconciliation_attempts ?? 0) + 1,
      last_reconciled_at: nowIso,
      reconciliation_error: message,
      reconciliation_alerted_at: nowIso,
      completed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", execution.id)
    .eq("user_id", execution.user_id)
    .in("status", ["queued", "in_progress", "finalizing"]);
  if (error) throw error;

  if (execution.prospect_id) {
    const { error: leadError } = await supabase
      .from("prospects")
      .update({ next_action: "human_review", next_action_at: null })
      .eq("id", execution.prospect_id)
      .eq("user_id", execution.user_id);
    if (leadError) throw leadError;
  }
  return message;
}

export async function reconcileStaleVoiceExecutions(
  supabase: CompatClient,
  options: {
    now?: Date;
    batchSize?: number;
    dependencies?: ReconciliationDependencies;
  } = {},
): Promise<VoiceReconciliationSummary> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(
    now.getTime() - VOICE_RECONCILIATION_STALE_MS,
  ).toISOString();
  const recentlyCompletedAfter = new Date(
    now.getTime() - VOICE_RECONCILIATION_COMPLETED_WINDOW_MS,
  ).toISOString();
  const batchSize = Math.min(
    Math.max(options.batchSize ?? VOICE_RECONCILIATION_BATCH_SIZE, 1),
    100,
  );
  const fetchExecution = options.dependencies?.getExecution ?? getBolnaExecution;
  const persistOutcome = options.dependencies?.applyOutcome ?? applyBolnaOutcome;
  const alert = options.dependencies?.alert ?? sendOperationalAlert;

  const { data: activeData, error: activeError } = await supabase
    .from("voice_executions")
    .select(
      "id,user_id,connection_id,prospect_id,provider_execution_id,temporal_workflow_id,status,provider_status,created_at,updated_at,completed_at,reconciliation_attempts,last_reconciled_at,reconciliation_error,reconciliation_alerted_at,voice_connections!inner(encrypted_api_key,agent_id)",
    )
    .in("status", ["queued", "in_progress", "finalizing"])
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(batchSize);
  if (activeError) throw activeError;
  const remaining = Math.max(batchSize - (activeData?.length ?? 0), 0);
  const { data: completedData, error: completedError } = remaining
    ? await supabase
        .from("voice_executions")
        .select(
          "id,user_id,connection_id,prospect_id,provider_execution_id,temporal_workflow_id,status,provider_status,created_at,updated_at,completed_at,reconciliation_attempts,last_reconciled_at,reconciliation_error,reconciliation_alerted_at,voice_connections!inner(encrypted_api_key,agent_id)",
        )
        .eq("status", "completed")
        .gte("completed_at", recentlyCompletedAfter)
        .or("last_reconciled_at.is.null,reconciliation_error.not.is.null")
        .order("completed_at", { ascending: true })
        .limit(remaining)
    : { data: [], error: null };
  if (completedError) throw completedError;

  const executions = [...(activeData ?? []), ...(completedData ?? [])] as unknown as StaleVoiceExecution[];
  const summary: VoiceReconciliationSummary = {
    scanned: executions.length,
    repaired: 0,
    current: 0,
    failed: 0,
    orphaned: 0,
    alerted: 0,
    skipped: 0,
  };

  async function reconcileOne(execution: StaleVoiceExecution) {
    const decision = decideVoiceReconciliation(execution, now);
    if (decision === "skip_workflow" || decision === "skip_terminal" || decision === "wait") {
      summary.skipped += 1;
      return;
    }

    if (decision === "fail_orphan") {
      const message = await markOrphaned(supabase, execution, nowIso);
      await alert(execution, message);
      summary.orphaned += 1;
      summary.alerted += 1;
      return;
    }

    try {
      const credential = connectionCredential(execution);
      const payload = await fetchExecution(
        credential.apiKey,
        String(execution.provider_execution_id),
        credential.agentId,
      );
      const result = await persistOutcome(
        supabase,
        execution.connection_id,
        payload,
        execution.user_id,
      );
      const { error: updateError } = await supabase
        .from("voice_executions")
        .update({
          reconciliation_attempts: 0,
          last_reconciled_at: nowIso,
          reconciliation_error: null,
        })
        .eq("id", execution.id)
        .eq("user_id", execution.user_id);
      if (updateError) throw updateError;
      if (result.terminal) summary.repaired += 1;
      else summary.current += 1;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message.slice(0, 500)
          : "Voice execution reconciliation failed.";
      const nextAttempt = Number(execution.reconciliation_attempts ?? 0) + 1;
      const alertNow = shouldAlertVoiceReconciliation(
        nextAttempt,
        execution.reconciliation_alerted_at,
      );
      const { error: updateError } = await supabase
        .from("voice_executions")
        .update({
          reconciliation_attempts: nextAttempt,
          last_reconciled_at: nowIso,
          reconciliation_error: message,
          ...(alertNow ? { reconciliation_alerted_at: nowIso } : {}),
        })
        .eq("id", execution.id)
        .eq("user_id", execution.user_id);
      if (updateError) throw updateError;
      if (alertNow) {
        await alert(execution, message);
        summary.alerted += 1;
      }
      summary.failed += 1;
    }
  }

  let nextIndex = 0;
  // Reconciliation favors webhook repair over throughput. Serial requests avoid
  // burst polling a tenant's organization-level Bolna rate limit.
  const workerCount = Math.min(1, executions.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < executions.length) {
        const execution = executions[nextIndex];
        nextIndex += 1;
        await reconcileOne(execution);
      }
    }),
  );

  return summary;
}
