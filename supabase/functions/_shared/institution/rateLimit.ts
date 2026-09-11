// Per-host pacing for web_fetch and public_data. The edge function is
// stateless between invocations, so the memory is the archive itself: the
// most recent `fetched_at` for the same host among retrieval records (B-6
// archives every fetch, so the log of what we asked a host is complete by
// construction). Within the interval we wait if the wait is short, refuse
// with a retry-after if it is not.

export type FetchPlan =
  | { action: 'go' }
  | { action: 'wait'; ms: number }
  | { action: 'refuse'; retryAfterMs: number };

export const DEFAULT_MIN_INTERVAL_MS = 2_000;
export const MAX_INLINE_WAIT_MS = 5_000;

export function planFetch(
  recentFetchedAtIso: readonly string[],
  now: Date,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  maxInlineWaitMs = MAX_INLINE_WAIT_MS,
): FetchPlan {
  let latest = Number.NEGATIVE_INFINITY;
  for (const iso of recentFetchedAtIso) {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  if (latest === Number.NEGATIVE_INFINITY) return { action: 'go' };
  const elapsed = now.getTime() - latest;
  if (elapsed >= minIntervalMs) return { action: 'go' };
  const remaining = minIntervalMs - elapsed;
  if (remaining <= maxInlineWaitMs) return { action: 'wait', ms: remaining };
  return { action: 'refuse', retryAfterMs: remaining };
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
