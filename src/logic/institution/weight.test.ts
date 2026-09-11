// B-10. The estimate is arithmetic the director can check, and Verification
// is in every class.

import { describe, expect, it } from 'vitest';
import {
  ALWAYS_ROUTED,
  checkOverrun,
  estimate,
  SHAPES,
  suggestClass,
  withMandatoryStops,
  type CallEstimate,
} from '../../../supabase/functions/_shared/institution/weight';

const measured: CallEstimate = { tokensPerCall: 4_000, measured: true, costPerMillionTokensUsd: 3 };
const fallback: CallEstimate = { tokensPerCall: 4_000, measured: false, costPerMillionTokensUsd: 3 };

describe('class shapes', () => {
  it('gives brief no committee and full everything', () => {
    expect(SHAPES.brief.committeeReview).toBe(false);
    expect(SHAPES.standard.committeeReview).toBe(true);
    expect(SHAPES.standard.proposals).toBe(false);
    expect(SHAPES.full.debate && SHAPES.full.proposals && SHAPES.full.evals).toBe(true);
  });

  it('keeps peer review in every class, including brief', () => {
    for (const shape of Object.values(SHAPES)) expect(shape.peerReviewPerOutput).toBe(true);
  });
});

describe('routing', () => {
  it('puts Verification in every routing at every class', () => {
    for (const weightClass of ['brief', 'standard', 'full'] as const) {
      expect(withMandatoryStops(['framing-office'], weightClass)).toContain(ALWAYS_ROUTED);
    }
  });

  it('puts Verification last, after the work and before Editorial', () => {
    expect(withMandatoryStops(['framing-office', 'editorial', 'quantitative-analysis'], 'standard'))
      .toEqual(['framing-office', 'quantitative-analysis', 'verification', 'editorial']);
  });

  it('drops Editorial from a brief-class run but never Verification', () => {
    expect(withMandatoryStops(['framing-office', 'editorial'], 'brief')).toEqual(['framing-office', 'verification']);
  });

  it('does not duplicate Verification when the caller already asked for it', () => {
    const routing = withMandatoryStops(['verification', 'framing-office'], 'standard');
    expect(routing.filter((slug) => slug === ALWAYS_ROUTED)).toHaveLength(1);
  });
});

describe('estimate', () => {
  it('costs a brief-class run at a fraction of a full one', () => {
    const routing = ['framing-office', 'verification'];
    const small = estimate('brief', routing, measured);
    const large = estimate('full', ['framing-office', 'methodology-desk', 'evidence-acquisition', 'data-engineering', 'quantitative-analysis', 'domain-synthesis', 'verification', 'editorial'], measured);
    expect(small.calls).toBeLessThan(large.calls / 3);
    expect(small.costUsd).toBeLessThan(large.costUsd);
  });

  it('prices tokens at the provider rate, to the millionth of a dollar', () => {
    const result = estimate('brief', ['framing-office', 'verification'], measured);
    expect(result.tokens).toBe(result.calls * 4_000);
    expect(result.costUsd).toBeCloseTo((result.tokens / 1e6) * 3, 6);
  });

  it('caps the departments it counts at the class maximum', () => {
    const result = estimate('brief', ['a', 'b', 'c', 'd'], measured);
    expect(result.departments).toEqual(['a', 'b']);
  });

  it('carries whether the per-call figure was measured, so the UI can say so', () => {
    expect(estimate('standard', ['a'], measured).measured).toBe(true);
    expect(estimate('standard', ['a'], fallback).measured).toBe(false);
  });

  it('breaks the count into stages a reader can check', () => {
    const result = estimate('full', ['a', 'b'], measured);
    const stages = result.breakdown.map((line) => line.stage);
    expect(stages).toContain('peer review');
    expect(stages).toContain('committee review');
    expect(stages).toContain('evaluations before and after');
    expect(result.breakdown.reduce((total, line) => total + line.calls, 0)).toBe(result.calls);
  });
});

describe('suggestClass', () => {
  it('suggests brief for a lookup', () => {
    expect(suggestClass('What is the current PSAK number for consolidation?', 1).weightClass).toBe('brief');
  });

  it('suggests full for a decision-grade question', () => {
    expect(suggestClass('Build the market entry strategy for CNG in Priangan Timur', 3).weightClass).toBe('full');
  });

  it('suggests standard for an ordinary research question', () => {
    expect(suggestClass('How has Indonesian poultry processing capacity changed since 2019?', 3).weightClass).toBe('standard');
  });

  it('gives a reason with every suggestion', () => {
    for (const question of ['What is X?', 'Build the business plan', 'How has Y changed?']) {
      expect(suggestClass(question, 2).reason.length).toBeGreaterThan(20);
    }
  });
});

describe('checkOverrun', () => {
  it('does not cry overrun at a slightly wrong estimate', () => {
    expect(checkOverrun(1, 1.4).overrun).toBe(false);
  });

  it('surfaces a real overrun with the ratio', () => {
    const verdict = checkOverrun(1, 2.2);
    expect(verdict.overrun).toBe(true);
    expect(verdict.message).toContain('2.20x');
  });

  it('says plainly when nothing was estimated', () => {
    expect(checkOverrun(0, 5).message).toContain('no estimate');
  });
});
