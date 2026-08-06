/**
 * Tests over the REAL ARBI seed (arbiProcessSeed.json — the source migration
 * 20260806000053 was generated from), plus the cross-entity properties the
 * schema change exists for. The DoD counts are facts about the ARBI chain:
 * 23 steps, FORWARD 15 · REVERSE 2 · KEDUANYA 6, Forward 21/8, Reverse 8/4,
 * 112 needs (22/30/60), 28 owners (24 with BELUM), 37 bridge pairs over 15
 * rows, B12 unused, ZERO stacked cells. THERE ARE NO FIGURES ANYWHERE IN
 * THIS FILE.
 */
import { describe, expect, it } from 'vitest';
import {
  branchTracks,
  chainFor,
  deriveEdges,
  duplicateChainSlots,
  groupCells,
  handoffs,
  maxSlot,
  phaseCoverageProblems,
  processStats,
  sharedTrackCodes,
  unknownGateRefs,
  unusedGates,
  visibleSteps,
} from './process';
import { closingConditionsForItem, groupByOwner, registerRows } from './processModel';
import {
  arbiGates,
  arbiLanes,
  arbiNeeds,
  arbiPhases,
  arbiStepItems,
  arbiSteps,
  arbiTracks,
} from './process/arbiFixture';
import {
  fixtureNeeds,
  fixtureStepItems,
  fixtureSteps,
} from './process/seedFixture';

const lanes = arbiLanes();
const phases = arbiPhases();
const gates = arbiGates();
const steps = arbiSteps();
const needs = arbiNeeds();
const tracks = arbiTracks();
const shared = sharedTrackCodes(tracks);

const ALL_STATUS = { ADA: true, SEBAGIAN: true, BELUM: true };
const BELUM_ONLY = { ADA: false, SEBAGIAN: false, BELUM: true };
const ALL_KIND = { MASTER: true, TRANSAKSI: true, PARAMETER: true, REFERENSI: true };

/** Storing cost — fed by BOTH chains, through different steps. */
const STORING_COST = '10b151a5-5c45-454c-a13b-ffbc786ec645';

describe('the ARBI seed counts are exact — mismatches mean the seed was misread', () => {
  it('carries 6 lanes, 3 tracks, 7 phases, 12 gates, 23 steps, 112 needs, 37 bridge pairs', () => {
    expect(lanes).toHaveLength(6);
    expect(tracks).toHaveLength(3);
    expect(phases).toHaveLength(7);
    expect(gates).toHaveLength(12);
    expect(steps).toHaveLength(23);
    expect(needs).toHaveLength(112);
    expect(arbiStepItems()).toHaveLength(37);
  });

  it('marks exactly MARKETPLACE and KURIR as external, MARKETPLACE at ordinal 1', () => {
    expect(
      lanes
        .filter((lane) => lane.isExternal)
        .map((lane) => lane.key)
        .sort(),
    ).toEqual(['KURIR', 'MARKETPLACE']);
    expect(lanes.find((lane) => lane.ordinal === 1)?.key).toBe('MARKETPLACE');
  });

  it("carries ARBI's own WAREHOUSE description — the reason lanes are per entity", () => {
    expect(lanes.find((lane) => lane.key === 'WAREHOUSE')?.description).toBe(
      'Terima, simpan, pick, pack, dispatch',
    );
  });

  it('splits FORWARD 15 · REVERSE 2 · KEDUANYA 6, and labels are unique within ARBI', () => {
    const byTrack = new Map<string, number>();
    for (const step of steps) byTrack.set(step.track, (byTrack.get(step.track) ?? 0) + 1);
    expect(Object.fromEntries(byTrack)).toEqual({ FORWARD: 15, REVERSE: 2, KEDUANYA: 6 });
    expect(new Set(steps.map((step) => step.label)).size).toBe(23);
  });

  it('tiles phases over slots 1..23 exactly once', () => {
    expect(maxSlot(steps)).toBe(23);
    expect(phaseCoverageProblems(phases, maxSlot(steps))).toEqual([]);
  });

  it('resolves every gate reference and leaves exactly B12 unused — kept for numbering', () => {
    expect(unknownGateRefs(steps, gates)).toEqual([]);
    expect(unusedGates(steps, gates)).toEqual(['B12']);
  });

  it('orders the filter vocabulary FORWARD, REVERSE with BERSAMA as the shared backbone', () => {
    expect(branchTracks(tracks).map((track) => track.code)).toEqual(['FORWARD', 'REVERSE']);
    expect([...shared]).toEqual(['KEDUANYA']);
    expect(tracks.find((track) => track.isShared)?.label).toBe('BERSAMA');
  });
});

describe('the ARBI walks produce the pinned counts', () => {
  it('has no duplicated slot inside either walk', () => {
    expect(duplicateChainSlots(steps, tracks)).toEqual([]);
  });

  it('Forward: 21 steps, 8 handoffs', () => {
    expect(chainFor(steps, 'FORWARD', shared)).toHaveLength(21);
    expect(visibleSteps(steps, 'FORWARD', shared)).toHaveLength(21);
    expect(handoffs(deriveEdges(steps, 'FORWARD', tracks))).toHaveLength(8);
  });

  it('Reverse: 8 steps, 4 handoffs', () => {
    expect(chainFor(steps, 'REVERSE', shared)).toHaveLength(8);
    expect(visibleSteps(steps, 'REVERSE', shared)).toHaveLength(8);
    expect(handoffs(deriveEdges(steps, 'REVERSE', tracks))).toHaveLength(4);
  });

  it('Semua: 23 steps, 12 handoffs after dedupe', () => {
    const stats = processStats(steps, needs, 'ALL', tracks);
    expect(stats).toEqual({
      visible: 23,
      total: 23,
      handoffCount: 12,
      needCount: 112,
      needBelum: 60,
    });
  });

  it('stacks NOTHING — ARBI has no parallel branches, and the stacking path proves it live', () => {
    // The same groupCells that stacks SAMB's 6a/6b must return only
    // single-step groups here: the code path runs, and renders nothing
    // stacked. Asserting over ALL and both branch walks so no filter can
    // hide an accidental pair.
    for (const filter of ['ALL', 'FORWARD', 'REVERSE']) {
      const cells = groupCells(visibleSteps(steps, filter, shared));
      const stacked = [...cells.values()].filter((group) => group.length > 1);
      expect(stacked).toEqual([]);
    }
  });
});

describe('the ARBI register composes the request list', () => {
  it('counts 112 needs — ADA 22 · SEBAGIAN 30 · BELUM 60', () => {
    const byStatus = new Map<string, number>();
    for (const need of needs) byStatus.set(need.status, (byStatus.get(need.status) ?? 0) + 1);
    expect(Object.fromEntries(byStatus)).toEqual({ ADA: 22, SEBAGIAN: 30, BELUM: 60 });
  });

  it('groups all rows under 28 owners, 24 of them holding a BELUM', () => {
    const all = registerRows(
      needs,
      steps,
      { track: 'ALL', status: ALL_STATUS, kind: ALL_KIND },
      shared,
    );
    expect(all).toHaveLength(112);
    expect(groupByOwner(all)).toHaveLength(28);
    const belum = registerRows(
      needs,
      steps,
      { track: 'ALL', status: BELUM_ONLY, kind: ALL_KIND },
      shared,
    );
    expect(belum).toHaveLength(60);
    expect(groupByOwner(belum)).toHaveLength(24);
  });
});

describe('§6 lintas entitas — the two chains stay apart', () => {
  const combinedSteps = [...fixtureSteps(), ...arbiSteps()];
  const combinedNeeds = [...fixtureNeeds(), ...arbiNeeds()];
  const combinedStepItems = [...fixtureStepItems(), ...arbiStepItems()];

  it('19 labels exist twice across entities — once per entity, never within one', () => {
    const byLabel = new Map<string, number>();
    for (const step of combinedSteps) byLabel.set(step.label, (byLabel.get(step.label) ?? 0) + 1);
    const twice = [...byLabel.values()].filter((count) => count === 2).length;
    expect(twice).toBe(19);
    for (const entity of ['SAMB', 'ARBI']) {
      const labels = combinedSteps
        .filter((step) => step.entityCode === entity)
        .map((step) => step.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('(Storing cost, SAMB) is fed by 6 steps; (Storing cost, ARBI) by 6 DIFFERENT steps', () => {
    const samb = closingConditionsForItem(
      STORING_COST,
      'SAMB',
      combinedStepItems,
      combinedNeeds,
      combinedSteps,
    );
    const arbi = closingConditionsForItem(
      STORING_COST,
      'ARBI',
      combinedStepItems,
      combinedNeeds,
      combinedSteps,
    );
    expect(samb?.stepCount).toBe(6);
    expect(arbi?.stepCount).toBe(6);
    // The step sets differ even where labels overlap: SAMB 6a/8/9/13/14/15a
    // versus ARBI 6/7/8/9/13/14 — resolved by step id, which carries the
    // entity, never by label.
    const sambLabels = new Set(
      combinedStepItems
        .filter((edge) => edge.itemId === STORING_COST)
        .map((edge) => combinedSteps.find((step) => step.id === edge.stepId))
        .filter((step) => step?.entityCode === 'SAMB')
        .map((step) => step?.label),
    );
    const arbiLabels = new Set(
      combinedStepItems
        .filter((edge) => edge.itemId === STORING_COST)
        .map((edge) => combinedSteps.find((step) => step.id === edge.stepId))
        .filter((step) => step?.entityCode === 'ARBI')
        .map((step) => step?.label),
    );
    expect([...sambLabels].sort()).toEqual(['13', '14', '15a', '6a', '8', '9']);
    expect([...arbiLabels].sort()).toEqual(['13', '14', '6', '7', '8', '9']);
  });

  it('(Storing cost, ASI) shows no block at all — no chain, no special case', () => {
    expect(
      closingConditionsForItem(
        STORING_COST,
        'ASI',
        combinedStepItems,
        combinedNeeds,
        combinedSteps,
      ),
    ).toBeNull();
  });

  it('needs never leak across entities: every ARBI need resolves to an ARBI step', () => {
    const arbiStepIds = new Set(steps.map((step) => step.id));
    for (const need of needs) expect(arbiStepIds.has(need.stepId)).toBe(true);
    const sambStepIds = new Set(fixtureSteps().map((step) => step.id));
    for (const need of needs) expect(sambStepIds.has(need.stepId)).toBe(false);
  });

  it('deriving edges over ONE entity is unaffected by the other being loaded', () => {
    // The view slices steps by entity before deriving; this pins that the
    // slice is sufficient — the same edges come out whether or not the other
    // entity exists in memory.
    const alone = deriveEdges(steps, 'ALL', tracks);
    const sliced = deriveEdges(
      combinedSteps.filter((step) => step.entityCode === 'ARBI'),
      'ALL',
      tracks,
    );
    expect(sliced.map((edge) => `${edge.from.label}>${edge.to.label}`).sort()).toEqual(
      alone.map((edge) => `${edge.from.label}>${edge.to.label}`).sort(),
    );
  });

  it('six ARBI steps feed no Finish line row yet — recorded, not an omission', () => {
    const feeding = new Set(arbiStepItems().map((edge) => edge.stepId));
    const unfed = steps
      .filter((step) => !feeding.has(step.id))
      .map((step) => step.label)
      .sort((a, b) => Number(a) - Number(b));
    expect(unfed).toEqual(['1', '3', '5', '11', '12', '18']);
  });

  it('the ARBI bridge spans 15 Finish line rows', () => {
    expect(new Set(arbiStepItems().map((edge) => edge.itemId)).size).toBe(15);
  });
});
