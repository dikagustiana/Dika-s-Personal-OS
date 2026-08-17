import { describe, expect, it } from 'vitest';
import type { LabProvider, LabRun } from '../../data/labTypes';
import { USD_TO_IDR_DISPLAY_RATE } from './labConfig';
import {
  formatDuration,
  formatIdr,
  formatTokens,
  formatUsd,
  spendThisMonthByProvider,
  usdToIdr,
} from './labCost';

const providers: LabProvider[] = [
  {
    id: 'p-anthropic',
    name: 'anthropic',
    adapter: 'anthropic',
    baseUrl: '',
    model: 'm',
    costInPerMtok: 3,
    costOutPerMtok: 15,
    isActive: true,
  },
  {
    id: 'p-kimi',
    name: 'kimi',
    adapter: 'openai',
    baseUrl: '',
    model: 'm',
    costInPerMtok: 0.6,
    costOutPerMtok: 2.5,
    isActive: true,
  },
];

function run(partial: Partial<LabRun> & Pick<LabRun, 'id' | 'providerId' | 'createdAt'>): LabRun {
  return {
    agentId: 'a',
    parentRunId: null,
    chainId: null,
    stepIndex: null,
    input: '',
    output: '',
    status: 'ok',
    error: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    durationMs: null,
    ...partial,
  };
}

describe('display conversion', () => {
  it('converts through the config rate, never an inline number', () => {
    expect(usdToIdr(2)).toBe(2 * USD_TO_IDR_DISPLAY_RATE);
  });

  it('formats IDR as whole rupiah with id-ID grouping', () => {
    // 0.01 USD at 16,500 = Rp 165 — the exact grouping is locale data, so
    // assert the parts rather than a hardcoded string.
    const formatted = formatIdr(1);
    expect(formatted.startsWith('Rp ')).toBe(true);
    expect(formatted).not.toContain(',-');
  });

  it('keeps a cheap run from rounding to zero dollars', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(1.5)).toBe('$1.50');
  });

  it('renders unknown tokens and durations as an em dash, never a zero', () => {
    expect(formatTokens(null)).toBe('—');
    expect(formatDuration(null)).toBe('—');
    expect(formatTokens(12345)).toBe('12,345');
    expect(formatDuration(14200)).toBe('14.2s');
  });
});

describe('spendThisMonthByProvider', () => {
  const now = new Date(2026, 7, 17); // 2026-08-17 local

  it('sums only the calendar month of `now`', () => {
    const runs = [
      run({ id: '1', providerId: 'p-anthropic', createdAt: new Date(2026, 7, 2).toISOString(), costUsd: 0.5 }),
      run({ id: '2', providerId: 'p-anthropic', createdAt: new Date(2026, 7, 16).toISOString(), costUsd: 0.25 }),
      run({ id: '3', providerId: 'p-anthropic', createdAt: new Date(2026, 6, 31).toISOString(), costUsd: 99 }),
    ];
    const spend = spendThisMonthByProvider(runs, providers, now);
    expect(spend.find((row) => row.providerName === 'anthropic')).toMatchObject({
      usd: 0.75,
      runs: 2,
    });
  });

  it('renders a zero row for a provider with no spend — a zero is information', () => {
    const spend = spendThisMonthByProvider([], providers, now);
    expect(spend).toHaveLength(2);
    expect(spend.every((row) => row.usd === 0 && row.runs === 0)).toBe(true);
  });

  it('counts a run with null cost as a run, adding nothing to spend', () => {
    const runs = [
      run({ id: '1', providerId: 'p-kimi', createdAt: now.toISOString(), costUsd: null, status: 'error' }),
    ];
    const spend = spendThisMonthByProvider(runs, providers, now);
    expect(spend.find((row) => row.providerName === 'kimi')).toMatchObject({ usd: 0, runs: 1 });
  });
});
