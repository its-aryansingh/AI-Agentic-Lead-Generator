/**
 * Temporal client — NOT WIRED on this deployment.
 *
 * SalesEngAIMVP runs voice calls through a Temporal workflow with a
 * Python worker (backend-python/) and a Temporal server
 * (infra/temporal/compose.dev.yml). Neither was ported: Temporal is an
 * always-on service, not a library, and standing one up alongside the
 * Railway app is a deployment decision rather than a code one.
 *
 * Nothing is broken by its absence. The rollout is gated per connection
 * by voice_connections.temporal_enabled, which defaults to false, so
 * lib/voice/start-qualification-call.ts takes the `direct` branch and
 * calls the provider itself. That is the same path SalesEngAIMVP used
 * before the Temporal cutover.
 *
 * This module keeps the real one's exported surface so no caller needed
 * editing, and throws loudly rather than silently doing nothing — a
 * queued call that never runs is worse than one that fails visibly.
 *
 * To enable Temporal: restore this file from SalesEngAIMVP, add
 * @temporalio/client, port backend-python/, run a Temporal server, and
 * only then set temporal_enabled on a connection.
 */

export { temporalClientSettings, voiceCallWorkflowId } from "./core"

const NOT_WIRED =
  "Temporal is not configured on this deployment. voice_connections." +
  "temporal_enabled must stay false — see lib/temporal/client.ts."

export function getTemporalClient(): Promise<never> {
  return Promise.reject(new Error(NOT_WIRED))
}

export async function startVoiceCallWorkflow(_input: {
  workspaceId: string
  leadId: string
  voiceExecutionId: string
  scheduledFor?: string
  allowOverride?: boolean
  overrideReason?: string
  approvalId?: string
  idempotencyKey?: string
}): Promise<{ workflowId: string; runId: string | undefined; alreadyStarted: boolean }> {
  throw new Error(NOT_WIRED)
}

export async function signalVoiceCallWorkflow(
  _voiceExecutionId: string,
  _event: {
    kind:
      | "queued" | "ringing" | "answered" | "completed"
      | "no_answer" | "busy" | "voicemail" | "failed"
    providerCallId: string
    providerStatus: string
    eventId?: string
  },
): Promise<void> {
  throw new Error(NOT_WIRED)
}

export async function signalBolnaCallEvent(
  _voiceExecutionId: string,
  _payload: Record<string, unknown>,
): Promise<void> {
  throw new Error(NOT_WIRED)
}
