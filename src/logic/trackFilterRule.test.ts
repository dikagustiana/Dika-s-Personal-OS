/**
 * §7 — WHEN THE JALUR CONTROL EARNS ITS PLACE.
 *
 * The rule is derived from the data, never from a list of entity codes, so
 * these tests pin the DECISION for the three chains that exist and the
 * PROPERTY that makes a fourth one decide for itself.
 *
 * The coverage numbers come from the real seeds: SAMB and ARBI from their
 * fixtures, KGR from a fixture built here to its live track distribution
 * (1 KARKAS, 3 OLAHAN, 34 KEDUANYA over 38 steps) — the rule reads nothing
 * else off a step, so reproducing the distribution reproduces the decision.
 */
import { describe, expect, it } from 'vitest';
import type { ProcessStep, ProcessTrack, ProcessTrackDef } from '../data/types';
import {
  TRACK_FILTER_COVERAGE_CEILING,
  branchCoverage,
  trackFilterDiscriminates,
} from './process';
import { arbiSteps, arbiTracks } from './process/arbiFixture';
import { fixtureSteps, fixtureTracks } from './process/seedFixture';

/** KGR's live shape: 34 shared, 1 carcass-only, 3 further-processing-only. */
function kgrTracks(): ProcessTrackDef[] {
  return [
    { entityCode: 'KGR', code: 'KARKAS' as ProcessTrack, label: 'KARKAS', ordinal: 1, isShared: false },
    { entityCode: 'KGR', code: 'OLAHAN' as ProcessTrack, label: 'OLAHAN', ordinal: 2, isShared: false },
    { entityCode: 'KGR', code: 'KEDUANYA' as ProcessTrack, label: 'BERSAMA', ordinal: 3, isShared: true },
  ];
}

function kgrSteps(): ProcessStep[] {
  // Slots 14, 15 and 21 are OLAHAN and 17 is KARKAS in the live v0.2 chain.
  const branch: Record<number, ProcessTrack> = {
    14: 'OLAHAN' as ProcessTrack,
    15: 'OLAHAN' as ProcessTrack,
    17: 'KARKAS' as ProcessTrack,
    21: 'OLAHAN' as ProcessTrack,
  };
  return Array.from({ length: 38 }, (_, index) => {
    const slot = index + 1;
    return {
      id: `kgr-${slot}`,
      entityCode: 'KGR',
      label: String(slot),
      slot,
      laneKey: 'ACCOUNTING',
      track: branch[slot] ?? ('KEDUANYA' as ProcessTrack),
      name: `step ${slot}`,
      docs: [],
      coa: [],
      drivers: [],
    } as ProcessStep;
  });
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

describe('§7 the jalur control is shown only where a branch narrows something', () => {
  it('SAMB keeps it — both branches are genuinely narrow', () => {
    const steps = fixtureSteps();
    const coverage = branchCoverage(steps, fixtureTracks());
    expect(coverage.map((c) => `${c.label} ${c.covered}/${c.total}`)).toEqual([
      'TRADE 19/30',
      'LP 20/30',
    ]);
    expect(coverage.every((c) => c.ratio <= TRACK_FILTER_COVERAGE_CEILING)).toBe(true);
    expect(trackFilterDiscriminates(steps, fixtureTracks())).toBe(true);
  });

  it('ARBI keeps it — ONE narrow branch is enough, even beside a 91% one', () => {
    const steps = arbiSteps();
    const coverage = branchCoverage(steps, arbiTracks());
    expect(coverage.map((c) => `${c.label} ${c.covered}/${c.total}`)).toEqual([
      'FORWARD 21/23',
      'REVERSE 8/23',
    ]);
    // This is the case that decides the rule's SHAPE. Requiring every branch to
    // be narrow would take ARBI's filter away, and pressing Reverse is a real
    // answer to a real question.
    const [forward, reverse] = coverage;
    expect(forward.ratio).toBeGreaterThan(TRACK_FILTER_COVERAGE_CEILING);
    expect(reverse.ratio).toBeLessThanOrEqual(TRACK_FILTER_COVERAGE_CEILING);
    expect(trackFilterDiscriminates(steps, arbiTracks())).toBe(true);
  });

  it('KGR loses it — every branch shows almost the whole chain', () => {
    const steps = kgrSteps();
    const coverage = branchCoverage(steps, kgrTracks());
    expect(coverage.map((c) => `${c.label} ${c.covered}/${c.total} ${pct(c.ratio)}`)).toEqual([
      'KARKAS 35/38 92%',
      'OLAHAN 37/38 97%',
    ]);
    expect(coverage.every((c) => c.ratio > TRACK_FILTER_COVERAGE_CEILING)).toBe(true);
    expect(trackFilterDiscriminates(steps, kgrTracks())).toBe(false);
  });

  it('nothing sits near the line — the decision is not a coin flip', () => {
    // The closest a SHOWN entity gets to being hidden, and the closest a HIDDEN
    // one gets to being shown. Both are far from 80%, so the threshold could
    // move a long way before any of the three changed side.
    const shownWorst = Math.min(
      ...branchCoverage(arbiSteps(), arbiTracks()).map((c) => c.ratio),
      ...branchCoverage(fixtureSteps(), fixtureTracks()).map((c) => c.ratio),
    );
    const hiddenBest = Math.min(...branchCoverage(kgrSteps(), kgrTracks()).map((c) => c.ratio));
    expect(shownWorst).toBeLessThan(0.4);
    expect(hiddenBest).toBeGreaterThan(0.9);
  });
});

describe('§7 the rule is a property of the data, not a list of entities', () => {
  it('a chain whose branches all cover everything hides its control', () => {
    const tracks = kgrTracks();
    const allShared = kgrSteps().map((step) => ({ ...step, track: 'KEDUANYA' as ProcessTrack }));
    expect(trackFilterDiscriminates(allShared, tracks)).toBe(false);
  });

  it('the same chain shows it again as soon as one branch narrows', () => {
    const tracks = kgrTracks();
    // Move half the chain onto KARKAS: OLAHAN now covers ~50%, so the control
    // comes back with no code change. This is what a fourth entity relies on.
    const steps = kgrSteps().map((step, index) =>
      index < 19 ? { ...step, track: 'KARKAS' as ProcessTrack } : step,
    );
    expect(trackFilterDiscriminates(steps, tracks)).toBe(true);
  });

  it('no branch tracks at all means nothing to choose between', () => {
    const sharedOnly = kgrTracks().filter((track) => track.isShared);
    expect(trackFilterDiscriminates(kgrSteps(), sharedOnly)).toBe(false);
  });

  it('an entity with no steps does not divide by zero', () => {
    expect(trackFilterDiscriminates([], kgrTracks())).toBe(false);
    expect(branchCoverage([], kgrTracks()).every((c) => c.ratio === 1)).toBe(true);
  });
});
