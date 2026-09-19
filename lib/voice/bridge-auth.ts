import crypto from "node:crypto";

export function validTemporalBridgeAuthorization(
  authorization: string | null,
  secret = process.env.TEMPORAL_BRIDGE_SECRET,
) {
  if (!secret || secret.length < 32) return false;
  const provided = (authorization ?? "").replace(/^Bearer\s+/i, "");
  const providedDigest = crypto.createHash("sha256").update(provided).digest();
  const expectedDigest = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}
