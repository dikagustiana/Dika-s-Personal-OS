// B-4 at the tool boundary. These are the cases that decide whether a SAMB
// figure can leave in a search box, so they are written as attempts: build
// an internal context, hand the gate an outbound string, and assert what it
// does. The edge function runs THIS module — there is one copy of the rule.

import { describe, expect, it } from 'vitest';
import {
  checkEgress,
  indexInternal,
  isSensitiveFigure,
  normaliseWords,
} from '../../../supabase/functions/_shared/institution/egress';

const INTERNAL = [
  'KGR poultry processing recorded revenue of 12.847.500.000 for the period, against a budget of 14.200.000.000.',
  'The plant ran 2 shifts with a yield of 73,4% and an idle cost of 480.000.000.',
];

describe('isSensitiveFigure', () => {
  it('treats years as ordinary language, not as figures', () => {
    expect(isSensitiveFigure(2023)).toBe(false);
    expect(isSensitiveFigure(1999)).toBe(false);
  });

  it('treats small counts as ordinary language', () => {
    expect(isSensitiveFigure(3)).toBe(false);
    expect(isSensitiveFigure(12)).toBe(false);
    expect(isSensitiveFigure(1.5)).toBe(false);
  });

  it('treats large integers and precise decimals as figures', () => {
    expect(isSensitiveFigure(12_847_500_000)).toBe(true);
    expect(isSensitiveFigure(1200)).toBe(true);
    expect(isSensitiveFigure(73.4)).toBe(false); // one decimal under 100 reads as language
    expect(isSensitiveFigure(73.45)).toBe(true);
    expect(isSensitiveFigure(480.25)).toBe(true);
  });
});

describe('checkEgress', () => {
  const index = indexInternal(INTERNAL);

  it('blocks an internal figure placed in a search query', () => {
    const verdict = checkEgress(['poultry margin benchmark 12.847.500.000'], index);
    expect(verdict.blocked).toBe(true);
    expect(verdict.matches[0].kind).toBe('number');
  });

  it('blocks an internal figure hidden in a percent-encoded URL', () => {
    const verdict = checkEgress(['https://example.org/search?q=revenue%2012.847.500.000%20benchmark'], index);
    expect(verdict.blocked).toBe(true);
  });

  it('blocks a lifted sentence fragment even with no figure in it', () => {
    const verdict = checkEgress(['the plant ran 2 shifts with a yield of'], index);
    expect(verdict.blocked).toBe(true);
    expect(verdict.matches.some((match) => match.kind === 'phrase')).toBe(true);
  });

  it('lets an ordinary public query through', () => {
    const verdict = checkEgress(['indonesia poultry processing margin benchmarks 2024'], index);
    expect(verdict.blocked).toBe(false);
    expect(verdict.matches).toHaveLength(0);
  });

  it('does not block on a year or a small count that also appears internally', () => {
    expect(checkEgress(['broiler yield studies 2 shifts'], index).blocked).toBe(false);
  });

  it('reads both locale spellings of the same figure', () => {
    // The internal text writes 12.847.500.000 (id grouping); a query writing
    // 12,847,500,000 (en grouping) is the same number and is blocked.
    expect(checkEgress(['12,847,500,000 poultry'], index).blocked).toBe(true);
  });

  it('truncates the logged excerpt so the log is not itself the leak', () => {
    const long = indexInternal(['secret phrase alpha beta gamma delta epsilon zeta eta theta iota kappa lambda']);
    const verdict = checkEgress(['secret phrase alpha beta gamma delta epsilon zeta eta theta iota kappa lambda'], long);
    expect(verdict.blocked).toBe(true);
    for (const match of verdict.matches) expect(match.excerpt.length).toBeLessThanOrEqual(48);
  });

  it('has an empty index for an empty context, so nothing is blocked', () => {
    expect(checkEgress(['anything at all 12.847.500.000'], indexInternal([])).blocked).toBe(false);
  });
});

describe('normaliseWords', () => {
  it('strips punctuation and case so a reformatted lift still matches', () => {
    expect(normaliseWords('Revenue: 12.847.500.000 (KGR)!')).toEqual(['revenue', '12', '847', '500', '000', 'kgr']);
  });
});
