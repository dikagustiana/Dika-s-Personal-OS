/**
 * Tests over the REAL seed (sambProcessSeed.json — the source migration
 * 20260806000051 was generated from), because the DoD counts are properties
 * of that data: 30 steps and 12 handoffs are facts about the SAMB chain, not
 * about synthetic fixtures. THERE ARE NO FIGURES ANYWHERE IN THIS FILE.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_TRACKS,
  cellKey,
  chainFor,
  defaultPhases,
  deriveEdges,
  duplicateChainSlots,
  groupCells,
  handoffs,
  maxSlot,
  phaseCoverageProblems,
  processStats,
  ribbonSegments,
  scopedPhaseProblems,
  stepVisible,
  unknownGateRefs,
  unusedGates,
  visibleSteps,
} from './process';
import type { ProcessPhase, ProcessStep, ProcessTrackDef } from '../data/types';
import {
  fixtureGates,
  fixtureLanes,
  fixtureNeeds,
  fixturePhases,
  fixtureSteps,
  fixtureTracks,
} from './process/seedFixture';
import { sharedTrackCodes } from './process';

const lanes = fixtureLanes();
const phases = fixturePhases();
const gates = fixtureGates();
const steps = fixtureSteps();
const needs = fixtureNeeds();
const tracks = fixtureTracks();
const shared = sharedTrackCodes(tracks);

describe('§10.2 the seed counts are exact — mismatches mean the seed was misread', () => {
  it('carries 6 lanes, 7 phases, 15 gates, 30 steps, 118 needs', () => {
    expect(lanes).toHaveLength(6);
    expect(phases).toHaveLength(7);
    expect(gates).toHaveLength(15);
    expect(steps).toHaveLength(30);
    expect(needs).toHaveLength(118);
  });

  it('gives every lane a description and marks exactly KLIEN as external', () => {
    expect(lanes.every((lane) => Boolean(lane.description))).toBe(true);
    expect(lanes.filter((lane) => lane.isExternal).map((lane) => lane.key)).toEqual(['KLIEN']);
    expect(lanes.find((lane) => lane.key === 'KLIEN')?.label).toBe('KLIEN LP');
  });

  it('keeps step labels unique — the label is the identity', () => {
    expect(new Set(steps.map((step) => step.label)).size).toBe(30);
  });
});

describe('§10.3 phases tile slot 1..max(slot) exactly once', () => {
  it('reports no gap and no overlap over the seed', () => {
    expect(maxSlot(steps)).toBe(21);
    expect(phaseCoverageProblems(phases, maxSlot(steps))).toEqual([]);
  });

  it('reports a gap when a slot is uncovered', () => {
    const holed = phases.filter((phase) => phase.name !== 'PENYIMPANAN');
    expect(phaseCoverageProblems(holed, 21)).toEqual(['celah slot 6–7']);
  });

  it('reports an overlap when two phases share a slot', () => {
    const doubled = phases.map((phase) =>
      phase.name === 'PENYIMPANAN' ? { ...phase, slotFrom: phase.slotFrom - 1 } : phase,
    );
    expect(phaseCoverageProblems(doubled, 21).some((p) => p.includes('tumpang tindih'))).toBe(
      true,
    );
  });

  it('reports a tail gap when the last phase stops short of max(slot)', () => {
    expect(phaseCoverageProblems(phases, 23)).toEqual(['celah slot 22–23']);
  });
});

describe('§10.4 every gate reference resolves; three gates are deliberately unused', () => {
  it('finds no unknown gate id on any step', () => {
    expect(unknownGateRefs(steps, gates)).toEqual([]);
  });

  it('leaves exactly G03, G07 and G09 unreferenced — kept for numbering, never deleted', () => {
    expect(unusedGates(steps, gates)).toEqual(['G03', 'G07', 'G09']);
  });
});

describe('§6.5 the walks are unambiguous and the filters produce the pinned counts', () => {
  it('has no duplicated slot inside either walk — the tripwire stays silent', () => {
    expect(duplicateChainSlots(steps, tracks)).toEqual([]);
  });

  it('walks 19 TRADE steps and 20 LP steps in slot order', () => {
    expect(chainFor(steps, 'TRADE', shared)).toHaveLength(19);
    expect(chainFor(steps, 'LP', shared)).toHaveLength(20);
  });

  it('Semua: 30 steps visible, 12 handoffs after label dedupe', () => {
    expect(visibleSteps(steps, 'ALL', shared)).toHaveLength(30);
    expect(handoffs(deriveEdges(steps, 'ALL', tracks))).toHaveLength(12);
  });

  it('Trade: 19 steps, 6 handoffs', () => {
    expect(visibleSteps(steps, 'TRADE', shared)).toHaveLength(19);
    expect(handoffs(deriveEdges(steps, 'TRADE', tracks))).toHaveLength(6);
  });

  it('LP: 20 steps, 7 handoffs', () => {
    expect(visibleSteps(steps, 'LP', shared)).toHaveLength(20);
    expect(handoffs(deriveEdges(steps, 'LP', tracks))).toHaveLength(7);
  });

  it('deduplicates the shared spine: 12→13 is one edge in Semua though both walks carry it', () => {
    const edges = deriveEdges(steps, 'ALL', tracks);
    expect(edges.filter((edge) => edge.from.label === '12' && edge.to.label === '13')).toHaveLength(
      1,
    );
  });

  it('emerges convergence: step 8 receives two arrows, from 7a and 7b', () => {
    const into8 = deriveEdges(steps, 'ALL', tracks).filter((edge) => edge.to.label === '8');
    expect(into8.map((edge) => edge.from.label).sort()).toEqual(['7a', '7b']);
  });

  it('emerges divergence: step 17 sends two arrows, to 18a and 18b', () => {
    const outOf17 = deriveEdges(steps, 'ALL', tracks).filter((edge) => edge.from.label === '17');
    expect(outOf17.map((edge) => edge.to.label).sort()).toEqual(['18a', '18b']);
  });

  it('flags a duplicated slot when a step is forced onto an occupied one', () => {
    const broken = steps.map((step) =>
      step.label === '3' ? { ...step, slot: 1 } : step,
    );
    expect(duplicateChainSlots(broken, tracks)).toEqual([{ track: 'TRADE', slot: 1 }]);
  });
});

describe('§10.7 stacked cells — parallel branches and same-slot tracks, never duplicates', () => {
  it('stacks the six pinned cells PLUS the two chain heads sharing SALES slot 1', () => {
    // The DoD names six stacked cells, but the seed itself puts both chain
    // heads — 1 (LP) and 2 (TRADE) — in SALES slot 1, and §6.4's rule (same
    // slot + same lane ⇒ stacked) admits exactly one rendering for that.
    // Same phenomenon as 19/20 and 21/23: different tracks on one slot.
    // Asserting six would mean asserting something the seed contradicts;
    // the deviation is recorded in the PR.
    const cells = groupCells(visibleSteps(steps, 'ALL', shared));
    const stacked = [...cells.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => [key, group.map((step) => step.label)] as const);
    expect(Object.fromEntries(stacked)).toEqual({
      [cellKey('SALES', 1)]: ['1', '2'],
      [cellKey('WAREHOUSE', 4)]: ['6a', '6b'],
      [cellKey('WAREHOUSE', 5)]: ['7a', '7b'],
      [cellKey('WAREHOUSE', 12)]: ['15a', '15b'],
      [cellKey('FLEET', 15)]: ['18a', '18b'],
      [cellKey('FINANCE', 16)]: ['19', '20'],
      [cellKey('FINANCE', 17)]: ['21', '23'],
    });
  });

  it('un-stacks the track-split cells under a single-track filter', () => {
    const trade = groupCells(visibleSteps(steps, 'TRADE', shared));
    expect(trade.get(cellKey('SALES', 1))?.map((step) => step.label)).toEqual(['2']);
    expect(trade.get(cellKey('WAREHOUSE', 4))?.map((step) => step.label)).toEqual(['6a']);
    const lp = groupCells(visibleSteps(steps, 'LP', shared));
    expect(lp.get(cellKey('SALES', 1))?.map((step) => step.label)).toEqual(['1']);
    expect(lp.get(cellKey('WAREHOUSE', 4))?.map((step) => step.label)).toEqual(['6b']);
  });
});

describe('§6.8 the stats line follows the jalur filter', () => {
  it('counts all 118 needs in Semua', () => {
    const stats = processStats(steps, needs, 'ALL', tracks);
    expect(stats).toMatchObject({ visible: 30, total: 30, handoffCount: 12, needCount: 118 });
    expect(stats.needBelum).toBe(needs.filter((need) => need.status === 'BELUM').length);
  });

  it('narrows the need count to the visible steps for a single track', () => {
    const trade = processStats(steps, needs, 'TRADE', tracks);
    const lp = processStats(steps, needs, 'LP', tracks);
    expect(trade.visible).toBe(19);
    expect(lp.visible).toBe(20);
    expect(trade.needCount + lp.needCount).toBeGreaterThan(118); // KEDUANYA counted in both
    expect(trade.needCount).toBeLessThan(118);
    expect(lp.needCount).toBeLessThan(118);
  });

  it('keeps KEDUANYA steps visible under both single-track filters', () => {
    const shared8 = steps.find((step) => step.label === '8');
    expect(shared8 && stepVisible(shared8, 'TRADE', shared)).toBe(true);
    expect(shared8 && stepVisible(shared8, 'LP', shared)).toBe(true);
  });
});

describe('§track-scope — the default ribbon tiles, scoped ribbons may gap but never lie', () => {
  // A compressed KGR-shaped fixture: ten slots, a default ribbon that tiles
  // them, one TRADING-scoped ribbon that covers only the reachable slots.
  const kind = (over: Partial<ProcessPhase>): ProcessPhase => ({
    id: 'p?',
    entityCode: 'KGR',
    name: '?',
    slotFrom: 1,
    slotTo: 1,
    ...over,
  });
  const base = [
    kind({ id: 'pA', name: 'AWAL', slotFrom: 1, slotTo: 4 }),
    kind({ id: 'pB', name: 'TENGAH', slotFrom: 5, slotTo: 7 }),
    kind({ id: 'pC', name: 'AKHIR', slotFrom: 8, slotTo: 10 }),
  ];
  const scoped = [
    kind({ id: 'pT1', name: 'BELI', slotFrom: 1, slotTo: 3, track: 'TRADING' }),
    kind({ id: 'pT2', name: 'LAPOR', slotFrom: 9, slotTo: 10, track: 'TRADING' }),
  ];
  const twoTracks: ProcessTrackDef[] = [
    { entityCode: 'KGR', code: 'RPA', label: 'RPA', ordinal: 1, isShared: false },
    { entityCode: 'KGR', code: 'TRADING', label: 'TRADING', ordinal: 2, isShared: false },
    { entityCode: 'KGR', code: 'KEDUANYA', label: 'BERSAMA', ordinal: 3, isShared: true },
  ];
  const mini = (slot: number, track: string): ProcessStep =>
    ({
      id: `s${track}-${slot}`,
      entityCode: 'KGR',
      label: `${track}-${slot}`,
      slot,
      laneKey: 'GUDANG',
      track,
      name: `step ${slot}`,
      docs: [],
      coa: [],
      drivers: [],
    }) as ProcessStep;
  // TRADING reaches slots 1–3 (its own) and 9 (shared); RPA runs 1..10.
  const miniSteps = [
    ...[1, 2, 3].map((slot) => mini(slot, 'TRADING')),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 10].map((slot) => mini(slot, 'RPA')),
    mini(9, 'KEDUANYA'),
  ];

  it('splits default from scoped rows', () => {
    expect(defaultPhases([...base, ...scoped])).toEqual(base);
  });

  it('renders the default ribbon alone when no filter is active', () => {
    const segments = ribbonSegments([...base, ...scoped], ALL_TRACKS, 10);
    expect(segments.map((s) => `${s.name} ${s.slotFrom}-${s.slotTo}`)).toEqual([
      'AWAL 1-4',
      'TENGAH 5-7',
      'AKHIR 8-10',
    ]);
  });

  it('lets a scoped row win its slots and splits the shadowed default into fragments that keep their id', () => {
    const segments = ribbonSegments([...base, ...scoped], 'TRADING', 10);
    expect(segments.map((s) => `${s.name} ${s.slotFrom}-${s.slotTo}`)).toEqual([
      'BELI 1-3',
      'AWAL 4-4',
      'TENGAH 5-7',
      'AKHIR 8-8',
      'LAPOR 9-10',
    ]);
    // The fragment still opens the REAL phase row.
    expect(segments[1].phaseId).toBe('pA');
    expect(segments[3].phaseId).toBe('pC');
    // Fragment keys stay unique even when one phase renders twice.
    expect(new Set(segments.map((s) => s.key)).size).toBe(segments.length);
  });

  it('reports nothing on a clean scoped ribbon — the gap over unreachable slots is not a problem', () => {
    expect(scopedPhaseProblems([...base, ...scoped], miniSteps, twoTracks)).toEqual([]);
  });

  it('reports an overlap within one track', () => {
    const overlapping = [...scoped, kind({ id: 'pT3', name: 'GANDA', slotFrom: 2, slotTo: 4, track: 'TRADING' })];
    expect(
      scopedPhaseProblems([...base, ...overlapping], miniSteps, twoTracks).some((p) =>
        p.includes('tumpang tindih'),
      ),
    ).toBe(true);
  });

  it('reports a reachable slot no scoped row covers', () => {
    const short = [kind({ id: 'pT1', name: 'BELI', slotFrom: 1, slotTo: 3, track: 'TRADING' })];
    expect(scopedPhaseProblems([...base, ...short], miniSteps, twoTracks)).toEqual([
      'TRADING: slot terjangkau tanpa fase — 9',
    ]);
  });

  it('is vacuous for a track with no scoped rows — it falls back to the default ribbon everywhere', () => {
    expect(scopedPhaseProblems(base, miniSteps, twoTracks)).toEqual([]);
  });
});

describe('§walk-fan — a branch step beside a shared step in one slot is parallel, not broken', () => {
  const fanTracks: ProcessTrackDef[] = [
    { entityCode: 'KGR', code: 'RPA', label: 'RPA', ordinal: 1, isShared: false },
    { entityCode: 'KGR', code: 'TRADING', label: 'TRADING', ordinal: 2, isShared: false },
    { entityCode: 'KGR', code: 'KEDUANYA', label: 'BERSAMA', ordinal: 3, isShared: true },
  ];
  const mk = (label: string, slot: number, track: string, laneKey: string): ProcessStep =>
    ({
      id: label,
      entityCode: 'KGR',
      label,
      slot,
      laneKey,
      track,
      name: label,
      docs: [],
      coa: [],
      drivers: [],
    }) as ProcessStep;
  // KGR trading's shape in miniature: T5 → [shared 6 ∥ T6] → T7.
  const fanSteps = [
    mk('T5', 5, 'TRADING', 'GUDANG'),
    mk('6', 6, 'KEDUANYA', 'ACCOUNTING'),
    mk('T6', 6, 'TRADING', 'QC'),
    mk('T7', 7, 'TRADING', 'VETERINER'),
  ];

  it('keeps the tripwire silent for the branch+shared pair', () => {
    expect(duplicateChainSlots(fanSteps, fanTracks)).toEqual([]);
  });

  it('draws the column as a fan: both follow T5, both precede T7, no order between them', () => {
    const edges = deriveEdges(fanSteps, 'TRADING', fanTracks).map(
      (edge) => `${edge.from.label}>${edge.to.label}`,
    );
    expect(edges.sort()).toEqual(['6>T7', 'T5>6', 'T5>T6', 'T6>T7']);
  });

  it('still trips on two BRANCH steps sharing a slot — that order would be a guess', () => {
    const broken = [...fanSteps, mk('T6b', 6, 'TRADING', 'GUDANG')];
    expect(duplicateChainSlots(broken, fanTracks)).toEqual([{ track: 'TRADING', slot: 6 }]);
  });

  it('still trips on two SHARED steps sharing a slot, reported per walk', () => {
    const broken = [...fanSteps, mk('6b', 6, 'KEDUANYA', 'SALES')];
    expect(duplicateChainSlots(broken, fanTracks)).toEqual([
      { track: 'RPA', slot: 6 },
      { track: 'TRADING', slot: 6 },
    ]);
  });
});
