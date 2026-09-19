/**
 * Pure helpers for the enrichment enqueue path.
 *
 * Ported verbatim from SalesEngAIMVP: it depends only on node:crypto and
 * node:url, so it carries no assumptions about either repo's schema.
 * lib/enrichment/enqueue.ts is the part that had to be rewritten.
 */

import { createHash, randomUUID } from "node:crypto";
import { domainToASCII } from "node:url";

export class EnqueueError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "EnqueueError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeCompanyDomain(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new EnqueueError("COMPANY_DOMAIN_REQUIRED", 422);
  }
  let parsed: URL;
  try {
    parsed = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw new EnqueueError("INVALID_COMPANY_DOMAIN", 422);
  }
  const domain = domainToASCII(parsed.hostname.toLowerCase()).replace(
    /^www\./,
    "",
  );
  if (
    !domain.includes(".") ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new EnqueueError("INVALID_COMPANY_DOMAIN", 422);
  }
  return domain;
}

export function cleanIdempotencyHint(
  value: string | null | undefined,
): string | null {
  const hint = value?.trim();
  return hint && hint.length <= 200 ? hint : null;
}

export function boundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

export function computeEnrichmentIdempotencyKey(input: {
  userId: string;
  prospectId: string;
  domain: string;
  idempotencyHint?: string | null;
  force?: boolean;
}): string {
  const bucket = new Date().toISOString().slice(0, 10);
  const requestPart = input.force
    ? randomUUID()
    : (cleanIdempotencyHint(input.idempotencyHint) ?? bucket);
  return createHash("sha256")
    .update(
      `public-enrich:v1:${input.userId}:${input.prospectId}:${input.domain}:${requestPart}`,
    )
    .digest("hex");
}

export function captureEnrichmentDispatchCounts(
  outcomes: PromiseSettledResult<unknown>[],
): {
  enqueued: number;
  failed: number;
} {
  const enqueued = outcomes.filter((o) => o.status === "fulfilled").length;
  const failed = outcomes.filter((o) => o.status === "rejected").length;
  return { enqueued, failed };
}
