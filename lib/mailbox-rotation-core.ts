/**
 * Pure mailbox-rotation selector. Given a list of the user's active
 * mailboxes and their current daily-send state, pick the next one
 * to send from.
 *
 * Self-balancing: the mailbox with the lowest current ratio of
 * `daily_sent / effective_cap` wins. A 9/200 mailbox beats a 5/10
 * (the 5/10 is closer to its limit). This naturally rotates load
 * across newly-connected (low-cap) and warmed-up (high-cap) mailboxes
 * without needing per-campaign cursor state.
 *
 * Kept import-free so `node --test --experimental-strip-types` can
 * load it. The DB query that fetches mailboxes lives in
 * app/api/cron/send-due/route.ts.
 */

export interface MailboxRotationCandidate {
  id: string
  daily_sent: number
  effective_cap: number
  /** Tiebreak — pick the mailbox connected longest ago so warmup
   * benefits the older one. */
  warmup_started_at_ms: number
}

/**
 * Choose the next mailbox. Returns null if every candidate is at or
 * over its effective cap.
 */
export function pickRotationMailbox(
  candidates: ReadonlyArray<MailboxRotationCandidate>,
): MailboxRotationCandidate | null {
  let best: MailboxRotationCandidate | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const c of candidates) {
    if (c.effective_cap <= 0) continue
    if (c.daily_sent >= c.effective_cap) continue
    // Lower utilization = better. Tie-break on older warmup so the
    // older mailbox gets used in preference to a brand-new one.
    const score = c.daily_sent / c.effective_cap
    if (score < bestScore || (score === bestScore && best && c.warmup_started_at_ms < best.warmup_started_at_ms)) {
      best = c
      bestScore = score
    }
  }
  return best
}

/**
 * Total send headroom across the pool — how many more emails could
 * be sent today without breaching any individual cap.
 */
export function totalHeadroom(candidates: ReadonlyArray<MailboxRotationCandidate>): number {
  let sum = 0
  for (const c of candidates) {
    sum += Math.max(0, c.effective_cap - c.daily_sent)
  }
  return sum
}
