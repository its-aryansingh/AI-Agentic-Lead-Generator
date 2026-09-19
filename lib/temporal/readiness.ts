export function temporalVoiceRolloutReady(
  env: NodeJS.ProcessEnv = process.env,
) {
  return Boolean(
    (env.TEMPORAL_ADDRESS?.trim() || env.TEMPORAL_CLIENT_ADDRESS?.trim()) &&
      env.TEMPORAL_BRIDGE_SECRET &&
      env.TEMPORAL_BRIDGE_SECRET.length >= 32 &&
      env.VOICE_LEGAL_LAUNCH_APPROVED === "true",
  );
}
