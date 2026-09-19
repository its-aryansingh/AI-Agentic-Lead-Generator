export const VOICE_RECONCILIATION_STALE_MS = 2 * 60 * 1000;
export const VOICE_RECONCILIATION_ORPHAN_MS = 15 * 60 * 1000;
export const VOICE_RECONCILIATION_ALERT_AFTER = 3;
export const VOICE_RECONCILIATION_BATCH_SIZE = 10;
export const VOICE_RECONCILIATION_MAX_BACKOFF_MS = 30 * 60 * 1000;
export const VOICE_RECONCILIATION_COMPLETED_WINDOW_MS = 10 * 60 * 1000;

export type VoiceReconciliationCandidate = {
  provider_execution_id: string | null;
  temporal_workflow_id: string | null;
  status: "queued" | "in_progress" | "finalizing" | "completed";
  created_at: string;
  last_reconciled_at?: string | null;
  reconciliation_attempts?: number | null;
  reconciliation_error?: string | null;
};

export type VoiceReconciliationDecision =
  | "poll_provider"
  | "fail_orphan"
  | "skip_workflow"
  | "skip_terminal"
  | "wait";

export function reconciliationBackoffMs(attempts: number) {
  return Math.min(30_000 * 2 ** Math.max(0, attempts), VOICE_RECONCILIATION_MAX_BACKOFF_MS);
}

export function decideVoiceReconciliation(
  execution: VoiceReconciliationCandidate,
  now: Date,
): VoiceReconciliationDecision {
  if (execution.last_reconciled_at) {
    const dueAt = new Date(execution.last_reconciled_at).getTime() + reconciliationBackoffMs(Number(execution.reconciliation_attempts ?? 0));
    if (now.getTime() < dueAt) return "wait";
  }
  // A recently completed execution is fetched once when a webhook may have
  // supplied only partial terminal details. A successful reconciliation sets
  // last_reconciled_at without an error, ending terminal polling.
  if (execution.status === "completed") {
    return execution.last_reconciled_at && !execution.reconciliation_error
      ? "skip_terminal"
      : execution.provider_execution_id
        ? "poll_provider"
        : "skip_terminal";
  }
  if (execution.provider_execution_id) return "poll_provider";
  if (execution.temporal_workflow_id) return "skip_workflow";
  if (
    execution.status === "queued" &&
    now.getTime() - new Date(execution.created_at).getTime() >=
      VOICE_RECONCILIATION_ORPHAN_MS
  ) {
    return "fail_orphan";
  }
  return "wait";
}

export function shouldAlertVoiceReconciliation(
  nextAttempt: number,
  alertedAt: string | null,
) {
  return nextAttempt >= VOICE_RECONCILIATION_ALERT_AFTER && !alertedAt;
}
