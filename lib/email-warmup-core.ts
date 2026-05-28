/**
 * Pure email warm-up ramp. Returns the daily send cap a mailbox
 * should respect given how long ago it was first connected.
 *
 * Why a ramp: cold-sending from a fresh mailbox at full volume burns
 * sender reputation. Every competitor (Instantly, Smartlead, Lemlist)
 * ramps progressively over ~30 days. We do too.
 *
 * Kept import-free so `node --test --experimental-strip-types` can
 * load it directly. The mailbox-row reads + write of effective cap
 * happen in app/api/cron/send-due/route.ts.
 */

export interface RampCheckpoint {
  /** Days since warmup_started_at. */
  day: number
  /** Daily cap at that day. */
  cap: number
}

/**
 * Default ramp — chosen to match Instantly/Smartlead defaults for a
 * "balanced" warm-up profile. The send-due cron always takes the
 * MIN of this, the per-mailbox `daily_send_limit`, and the per-campaign
 * `daily_cap`, so the user can override downward but never upward.
 */
export const DEFAULT_RAMP: ReadonlyArray<RampCheckpoint> = [
  { day: 0, cap: 10 },
  { day: 3, cap: 20 },
  { day: 7, cap: 50 },
  { day: 14, cap: 100 },
  { day: 30, cap: 200 },
  { day: 60, cap: 300 },
]

/**
 * Compute the current daily cap. Linear-interpolates between
 * checkpoints so the cap grows smoothly rather than jumping in steps.
 * `now` defaults to current time; pass it explicitly in tests.
 */
export function dailyCapForMailbox(
  warmupStartedAt: Date | string | number,
  now: Date | string | number = Date.now(),
  ramp: ReadonlyArray<RampCheckpoint> = DEFAULT_RAMP,
): number {
  const startMs = toMs(warmupStartedAt)
  const nowMs = toMs(now)
  if (Number.isNaN(startMs) || Number.isNaN(nowMs)) return ramp[0]?.cap ?? 10
  const days = Math.max(0, (nowMs - startMs) / 86_400_000)

  if (ramp.length === 0) return 10
  if (days <= ramp[0].day) return ramp[0].cap
  if (days >= ramp[ramp.length - 1].day) return ramp[ramp.length - 1].cap

  for (let i = 0; i < ramp.length - 1; i++) {
    const a = ramp[i]
    const b = ramp[i + 1]
    if (days >= a.day && days <= b.day) {
      const t = (days - a.day) / Math.max(1, b.day - a.day)
      return Math.round(a.cap + (b.cap - a.cap) * t)
    }
  }
  return ramp[ramp.length - 1].cap
}

/**
 * Days into warm-up. Useful for surfacing "Day 12 of 30" in the
 * mailbox settings UI.
 */
export function warmupDay(warmupStartedAt: Date | string | number, now: Date | string | number = Date.now()): number {
  const startMs = toMs(warmupStartedAt)
  const nowMs = toMs(now)
  if (Number.isNaN(startMs) || Number.isNaN(nowMs)) return 0
  return Math.max(0, Math.floor((nowMs - startMs) / 86_400_000))
}

/**
 * The total length (in days) of the warm-up ramp — the day at which
 * the cap reaches its maximum. Used by UI to show "complete after X days".
 */
export function warmupLengthDays(ramp: ReadonlyArray<RampCheckpoint> = DEFAULT_RAMP): number {
  if (ramp.length === 0) return 0
  return ramp[ramp.length - 1].day
}

/**
 * True if the mailbox has finished its warm-up — i.e. is past the
 * final checkpoint. UI can hide warm-up progress for these mailboxes.
 */
export function isWarmupComplete(
  warmupStartedAt: Date | string | number,
  now: Date | string | number = Date.now(),
  ramp: ReadonlyArray<RampCheckpoint> = DEFAULT_RAMP,
): boolean {
  return warmupDay(warmupStartedAt, now) >= warmupLengthDays(ramp)
}

function toMs(d: Date | string | number): number {
  if (typeof d === "number") return d
  if (typeof d === "string") return Date.parse(d)
  return d.getTime()
}
