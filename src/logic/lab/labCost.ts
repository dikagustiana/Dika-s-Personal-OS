/**
 * Cost arithmetic and display for the run log. USD IS THE STORED TRUTH —
 * cost_usd is computed by the executor from the provider row's rates — and
 * IDR is a DISPLAY conversion applied here, with the rate in labConfig.ts
 * rather than inline. Nothing in this file prices a token: rates live in
 * os_lab_providers and only there.
 */
import type { LabProvider, LabRun } from '../../data/labTypes';
import { USD_TO_IDR_DISPLAY_RATE } from './labConfig';

export function usdToIdr(usd: number): number {
  return usd * USD_TO_IDR_DISPLAY_RATE;
}

/** IDR, whole rupiah, id-ID grouping: a spend figure, not a price quote. */
export function formatIdr(usd: number): string {
  return `Rp ${Math.round(usdToIdr(usd)).toLocaleString('id-ID')}`;
}

/** USD with enough places that a cheap run does not round to zero. */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd < 0.01 && usd > 0 ? 4 : 2)}`;
}

export function formatTokens(count: number | null): string {
  if (count === null) return '—';
  return count.toLocaleString('en-US');
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export interface ProviderSpend {
  providerId: string;
  providerName: string;
  usd: number;
  runs: number;
}

/**
 * Spend this month by provider, for the aggregate strip. `now` is an
 * argument, not a clock read, so the boundary is testable; "this month" is
 * the calendar month of `now` in the browser's zone — the same convention
 * the rest of the app uses for daily boundaries.
 */
export function spendThisMonthByProvider(
  runs: readonly LabRun[],
  providers: readonly LabProvider[],
  now: Date,
): ProviderSpend[] {
  const year = now.getFullYear();
  const month = now.getMonth();
  const byProvider = new Map<string, ProviderSpend>();
  for (const provider of providers) {
    byProvider.set(provider.id, {
      providerId: provider.id,
      providerName: provider.name,
      usd: 0,
      runs: 0,
    });
  }
  for (const run of runs) {
    const created = new Date(run.createdAt);
    if (created.getFullYear() !== year || created.getMonth() !== month) continue;
    const bucket = byProvider.get(run.providerId);
    if (!bucket) continue;
    bucket.runs += 1;
    bucket.usd += run.costUsd ?? 0;
  }
  // Providers with no spend still render: a zero next to Anthropic and a
  // number next to DeepSeek is information, not clutter.
  return [...byProvider.values()].sort((a, b) => a.providerName.localeCompare(b.providerName));
}
