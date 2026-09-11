// Per-host pacing. The archive is the memory: the plan is computed from the
// fetched_at timestamps of retrieval records for the same host.

import { describe, expect, it } from 'vitest';
import { hostOf, planFetch } from '../../../supabase/functions/_shared/institution/rateLimit';

const now = new Date('2026-09-11T10:00:00.000Z');

describe('planFetch', () => {
  it('goes when the host has never been fetched', () => {
    expect(planFetch([], now)).toEqual({ action: 'go' });
  });

  it('goes when the interval has passed', () => {
    expect(planFetch(['2026-09-11T09:59:50.000Z'], now)).toEqual({ action: 'go' });
  });

  it('waits a short remainder inline', () => {
    expect(planFetch(['2026-09-11T09:59:59.500Z'], now)).toEqual({ action: 'wait', ms: 1500 });
  });

  it('refuses with a retry-after when the wait is long', () => {
    const plan = planFetch(['2026-09-11T09:59:59.900Z'], now, 30_000);
    expect(plan).toEqual({ action: 'refuse', retryAfterMs: 29_900 });
  });

  it('uses the most recent timestamp, not the first', () => {
    const plan = planFetch(['2026-09-11T09:00:00.000Z', '2026-09-11T09:59:59.000Z'], now);
    expect(plan).toEqual({ action: 'wait', ms: 1000 });
  });

  it('ignores an unparseable timestamp rather than treating it as now', () => {
    expect(planFetch(['not a date'], now)).toEqual({ action: 'go' });
  });
});

describe('hostOf', () => {
  it('lowercases the host and drops the rest', () => {
    expect(hostOf('https://WWW.BPS.go.id/statistics?x=1')).toBe('www.bps.go.id');
  });

  it('returns null for a non-URL', () => {
    expect(hostOf('not a url')).toBeNull();
  });
});
