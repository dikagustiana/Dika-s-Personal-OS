/**
 * ===========================================================================
 * THE REGISTER MUST ARRIVE. NOT "MUST NOT CRASH" — MUST ARRIVE.
 * ===========================================================================
 * On 6 August the swimlane read `30/30 step · 12 handoff · 0 kebutuhan data ·
 * 0 belum ada` and the register tab said the migration had not been applied.
 * Both were rendering without error. Every test in the suite passed. The seed
 * had landed in two transactions and the second — needs and step_items — had
 * not run yet, so os_process_needs answered 200 with zero rows.
 *
 * That is why none of the existing tests could see it: they prove the views
 * RENDER, and a view rendering zero needs renders perfectly. A zero is shaped
 * exactly like a legitimate empty, which is this project's oldest failure
 * (see readResult.ts) wearing a new hat.
 *
 * So these tests do the opposite. They assert POSITIVE COUNTS end to end —
 * 118, 64, 29 owners, 83/35 Trade, 82/50 LP — over the real seed fixture, and
 * they FAIL if needs ever come back empty, whatever the reason. A regression
 * that silently drops the register cannot pass this file.
 *
 * The figures are the live table, verified against production on 6 August:
 *   118 needs · ADA 22 · SEBAGIAN 32 · BELUM 64 · 30/30 steps carry needs
 *   Trade 83 (35 BELUM) · LP 82 (50 BELUM) · 29 owners hold a BELUM
 */
import { describe, expect, it } from 'vitest';
import { okRows, readAbsence, type ReadResult } from '../data/readResult';
import type { ProcessNeed, ProcessStep } from '../data/types';
import { processStats } from './process';
import {
  buildProcessModel,
  buildRegisterState,
  groupByOwner,
  registerRows,
  summarizeNeeds,
} from './processModel';
import {
  fixtureGates,
  fixtureLanes,
  fixtureNeeds,
  fixturePhases,
  fixtureStepItems,
  fixtureSteps,
} from './process/seedFixture';

const ALL_STATUS = { ADA: true, SEBAGIAN: true, BELUM: true };
const BELUM_ONLY = { ADA: false, SEBAGIAN: false, BELUM: true };
const ALL_KIND = { MASTER: true, TRANSAKSI: true, PARAMETER: true, REFERENSI: true };

const ready = () => ({
  lanes: okRows(fixtureLanes()),
  phases: okRows(fixturePhases()),
  steps: okRows(fixtureSteps()),
  gates: okRows(fixtureGates()),
  needs: okRows(fixtureNeeds()),
  stepItems: okRows(fixtureStepItems()),
});

describe('the needs register reaches the canvas — positive counts, not absence of error', () => {
  it('carries 118 needs through buildProcessModel into the stats line', () => {
    const model = buildProcessModel(ready());
    expect(model.kind).toBe('ready');
    if (model.kind !== 'ready') return;

    // The assertion that would have failed on 6 August.
    expect(model.needs.length).toBe(118);
    const stats = processStats(model.steps, model.needs, 'ALL');
    expect(stats).toEqual({
      visible: 30,
      total: 30,
      handoffCount: 12,
      needCount: 118,
      needBelum: 64,
    });
  });

  it('quotes 83/35 on Trade and 82/50 on LP — the jalur filter never zeroes the register', () => {
    const model = buildProcessModel(ready());
    if (model.kind !== 'ready') throw new Error('model must be ready');

    const trade = processStats(model.steps, model.needs, 'TRADE');
    expect([trade.needCount, trade.needBelum]).toEqual([83, 35]);
    const lp = processStats(model.steps, model.needs, 'LP');
    expect([lp.needCount, lp.needBelum]).toEqual([82, 50]);
  });

  it('leaves no step without needs — every one of the 30 boxes can show a count', () => {
    const model = buildProcessModel(ready());
    if (model.kind !== 'ready') throw new Error('model must be ready');

    const withNeeds = new Set(model.needs.map((need) => need.stepId));
    const stepIds = new Set(model.steps.map((step) => step.id));
    expect(withNeeds.size).toBe(30);
    // The join key itself: every need must resolve to a step. A uuid-vs-label
    // mix-up would leave the counts at zero with both reads perfectly healthy.
    for (const stepId of withNeeds) expect(stepIds.has(stepId)).toBe(true);
  });

  it('groups the 64 BELUM rows under 29 owners — the request list is not empty', () => {
    const rows = registerRows(fixtureNeeds(), fixtureSteps(), {
      track: 'ALL',
      status: BELUM_ONLY,
      kind: ALL_KIND,
    });
    expect(rows.length).toBe(64);
    const groups = groupByOwner(rows);
    expect(groups.length).toBe(29);
    expect(groups.reduce((total, group) => total + group.rows.length, 0)).toBe(64);
    // Most-BELUM-first is the order to go asking in; a zeroed register would
    // make this vacuously true, so assert the head is a real group.
    expect(groups[0].belum).toBeGreaterThan(0);
  });

  it('summarises 22 / 32 / 64 of 118 for the proportion bar', () => {
    expect(summarizeNeeds(fixtureNeeds(), fixtureSteps(), 'ALL')).toEqual({
      ada: 22,
      sebagian: 32,
      belum: 64,
      total: 118,
    });
  });

  it('the register tab is ready with the seed, and every filter keeps rows', () => {
    expect(buildRegisterState(okRows(fixtureSteps()), okRows(fixtureNeeds()))).toEqual({
      kind: 'ready',
    });
    for (const track of ['ALL', 'TRADE', 'LP'] as const) {
      const rows = registerRows(fixtureNeeds(), fixtureSteps(), {
        track,
        status: ALL_STATUS,
        kind: ALL_KIND,
      });
      expect(rows.length).toBeGreaterThan(0);
    }
  });
});

describe('a needs read that succeeds with zero rows is its own state, not the migration state', () => {
  it('calls a present-but-empty table unseeded, and a missing one absent', () => {
    expect(buildRegisterState(okRows(fixtureSteps()), okRows<ProcessNeed>([]))).toEqual({
      kind: 'empty',
      cause: 'unseeded',
    });
    expect(
      buildRegisterState(
        okRows(fixtureSteps()),
        readAbsence('listProcessNeeds', { code: '42P01' }) as ReadResult<ProcessNeed>,
      ),
    ).toEqual({ kind: 'empty', cause: 'absent' });
  });

  it('separates the canvas causes the same way', () => {
    expect(buildProcessModel({ ...ready(), steps: okRows<ProcessStep>([]) })).toEqual({
      kind: 'empty',
      cause: 'unseeded',
    });
    expect(
      buildProcessModel({
        ...ready(),
        steps: readAbsence('listProcessSteps', { code: '42P01' }),
      }),
    ).toEqual({ kind: 'empty', cause: 'absent' });
  });
});

describe('the guard swallows an absent relation and nothing else', () => {
  const codes = (code: string, message?: string) =>
    readAbsence('listProcessNeeds', message === undefined ? { code } : { code, message });

  it('treats 42P01 and PGRST205 as the pre-migration empty state', () => {
    expect(codes('42P01').reason).toBe('missing-relation');
    expect(
      codes('PGRST205', "Could not find the table 'public.os_process_needs' in the schema cache")
        .reason,
    ).toBe('missing-relation');
  });

  it('surfaces a renamed column (42703) instead of rendering it as empty', () => {
    const failure = codes('42703', 'column os_process_needs.step_id does not exist');
    expect(failure.reason).toBe('failed');
    expect(failure.detail).toContain('step_id');
    // And the canvas must say so rather than draw a diagram with no register.
    const model = buildProcessModel({
      ...ready(),
      needs: failure as ReadResult<ProcessNeed>,
    });
    expect(model.kind).toBe('failed');
  });

  it('surfaces an unresolvable embed (PGRST200) and an ambiguous one (PGRST201)', () => {
    for (const code of ['PGRST200', 'PGRST201']) {
      const failure = codes(code, "Could not find a relationship between 'x' and 'y'");
      expect(failure.reason).toBe('failed');
      expect(
        buildProcessModel({ ...ready(), needs: failure as ReadResult<ProcessNeed> }).kind,
      ).toBe('failed');
    }
  });

  it('does not classify on prose — "does not exist" alone is not an absent table', () => {
    expect(codes('42883', 'function os_key_valid() does not exist').reason).toBe('failed');
    expect(codes('42501', 'permission denied for table os_process_needs').reason).toBe('failed');
  });
});
