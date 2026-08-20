/**
 * §7 — WHEN THE JALUR CONTROL EARNS ITS PLACE.
 *
 * The rule is derived from the data, never from a list of entity codes, so
 * these tests pin the DECISION for the three chains that exist and the
 * PROPERTY that makes a fourth one decide for itself.
 *
 * The coverage numbers come from the real seeds: SAMB and ARBI from their
 * fixtures, KGR from fixtures built here to its live track distributions —
 * the rule reads nothing else off a step, so reproducing the distribution
 * reproduces the decision. KGR appears twice on purpose: the PRE-RETRACK
 * shape (KARKAS/OLAHAN — four excursions, control hidden) is kept as the
 * proof the rule can say no, and the LIVE shape since the sourcing retrack
 * (RPA/TRADING over 48 steps) is the proof the same rule turns the control
 * back on with no code change.
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

/** KGR BEFORE the sourcing retrack: 34 shared, 1 carcass, 3 further-processing. */
function kgrTracks(): ProcessTrackDef[] {
  return [
    { entityCode: 'KGR', code: 'KARKAS' as ProcessTrack, label: 'KARKAS', ordinal: 1, isShared: false },
    { entityCode: 'KGR', code: 'OLAHAN' as ProcessTrack, label: 'OLAHAN', ordinal: 2, isShared: false },
    { entityCode: 'KGR', code: 'KEDUANYA' as ProcessTrack, label: 'BERSAMA', ordinal: 3, isShared: true },
  ];
}

function kgrSteps(): ProcessStep[] {
  // Slots 14, 15 and 21 were OLAHAN and 17 KARKAS before the retrack moved
  // that distinction to os_process_forms.
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

/** KGR SINCE the sourcing retrack: 25 RPA, 13 shared, 10 TRADING over 48 steps. */
function kgrSourcingTracks(): ProcessTrackDef[] {
  return [
    { entityCode: 'KGR', code: 'RPA' as ProcessTrack, label: 'RPA', ordinal: 1, isShared: false },
    { entityCode: 'KGR', code: 'TRADING' as ProcessTrack, label: 'TRADING', ordinal: 2, isShared: false },
    { entityCode: 'KGR', code: 'KEDUANYA' as ProcessTrack, label: 'BERSAMA', ordinal: 3, isShared: true },
  ];
}

function kgrSourcingSteps(): ProcessStep[] {
  const sharedSlots = new Set([6, 18, 25, 26, 27, 28, 32, 33, 34, 35, 36, 37, 38]);
  const rpa = Array.from({ length: 38 }, (_, index) => {
    const slot = index + 1;
    return {
      id: `kgr-${slot}`,
      entityCode: 'KGR',
      label: String(slot),
      slot,
      laneKey: 'ACCOUNTING',
      track: (sharedSlots.has(slot) ? 'KEDUANYA' : 'RPA') as ProcessTrack,
      name: `step ${slot}`,
      docs: [],
      coa: [],
      drivers: [],
    } as ProcessStep;
  });
  const trading = Array.from({ length: 10 }, (_, index) => {
    const slot = index + 1;
    return {
      id: `kgr-T${slot}`,
      entityCode: 'KGR',
      label: `T${slot}`,
      slot,
      laneKey: 'PURCHASING',
      track: 'TRADING' as ProcessTrack,
      name: `trading step ${slot}`,
      docs: [],
      coa: [],
      drivers: [],
    } as ProcessStep;
  });
  return [...rpa, ...trading];
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

  it('KGR before the retrack lost it — every branch showed almost the whole chain', () => {
    const steps = kgrSteps();
    const coverage = branchCoverage(steps, kgrTracks());
    expect(coverage.map((c) => `${c.label} ${c.covered}/${c.total} ${pct(c.ratio)}`)).toEqual([
      'KARKAS 35/38 92%',
      'OLAHAN 37/38 97%',
    ]);
    expect(coverage.every((c) => c.ratio > TRACK_FILTER_COVERAGE_CEILING)).toBe(true);
    expect(trackFilterDiscriminates(steps, kgrTracks())).toBe(false);
  });

  it('KGR since the retrack shows it — sourcing mode partitions the chain', () => {
    const steps = kgrSourcingSteps();
    const coverage = branchCoverage(steps, kgrSourcingTracks());
    expect(coverage.map((c) => `${c.label} ${c.covered}/${c.total} ${pct(c.ratio)}`)).toEqual([
      'RPA 38/48 79%',
      'TRADING 23/48 48%',
    ]);
    // RPA sits ONE POINT under the ceiling, deliberately stated: RPA ∪ shared
    // is the whole slaughter chain, and its button is really the button that
    // hides the ten trading boxes. The decisive branch is TRADING at 48%.
    const [rpa, trading] = coverage;
    expect(rpa.ratio).toBeLessThanOrEqual(TRACK_FILTER_COVERAGE_CEILING);
    expect(rpa.ratio).toBeGreaterThan(0.75);
    expect(trading.ratio).toBeLessThan(0.5);
    expect(trackFilterDiscriminates(steps, kgrSourcingTracks())).toBe(true);
  });

  it('every SHOWN chain has one branch far below the line; the hidden shape stays far above', () => {
    // Since the retrack the margins are no longer uniform: KGR's RPA sits one
    // point under the ceiling (stated in its own test). What still holds, and
    // what this pins, is that every shown chain earns it through at least one
    // DECISIVELY narrow branch, and the shape the rule hides stays far above.
    const decisive = (steps: ProcessStep[], tracks: ProcessTrackDef[]) =>
      Math.min(...branchCoverage(steps, tracks).map((c) => c.ratio));
    expect(decisive(fixtureSteps(), fixtureTracks())).toBeLessThan(0.7);
    expect(decisive(arbiSteps(), arbiTracks())).toBeLessThan(0.4);
    expect(decisive(kgrSourcingSteps(), kgrSourcingTracks())).toBeLessThan(0.5);
    const hiddenBest = Math.min(...branchCoverage(kgrSteps(), kgrTracks()).map((c) => c.ratio));
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
