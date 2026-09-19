export interface TemporalClientSettings {
  address: string;
  namespace: string;
  taskQueue: string;
  apiKey?: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}

export function temporalClientSettings(
  env: NodeJS.ProcessEnv = process.env,
): TemporalClientSettings {
  const tlsCertPath = env.TEMPORAL_TLS_CERT?.trim() || undefined;
  const tlsKeyPath = env.TEMPORAL_TLS_KEY?.trim() || undefined;
  if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) {
    throw new Error("TEMPORAL_TLS_CERT and TEMPORAL_TLS_KEY must be set together.");
  }
  return {
    address:
      env.TEMPORAL_CLIENT_ADDRESS?.trim() ||
      env.TEMPORAL_ADDRESS?.trim() ||
      "localhost:7233",
    namespace: env.TEMPORAL_NAMESPACE?.trim() || "default",
    taskQueue: env.TEMPORAL_TASK_QUEUE?.trim() || "aravya-lead",
    apiKey: env.TEMPORAL_API_KEY?.trim() || undefined,
    tlsCertPath,
    tlsKeyPath,
  };
}

export function voiceCallWorkflowId(voiceExecutionId: string) {
  if (!voiceExecutionId.trim()) throw new Error("voiceExecutionId is required.");
  return `voice-call:${voiceExecutionId}`;
}
