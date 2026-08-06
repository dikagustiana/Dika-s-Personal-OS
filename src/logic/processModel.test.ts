/**
 * The testable half of §10.9 / §10.12 and the whole of the bridge: "42P01
 * renders the ordinary empty state" is asserted by FORCING the failure
 * through readFailure with the real Postgres code, and the step → Finish
 * line mapping is asserted against the migration itself, so the app-side
 * copy and the SQL cannot drift apart unnoticed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { okRows, readFailure, readThrew, rowsOf } from '../data/readResult';
import type { FinishLineItem, ProcessNeed, ProcessStep, ProcessStepItem } from '../data/types';
import {
  buildProcessModel,
  closingConditionsForItem,
  finishLineRowsForStep,
  groupByOwner,
  registerRows,
  stepLabelsForItem,
  stepsForItem,
  summarizeNeeds,
} from './processModel';
import {
  STEP_ITEM_MAP,
  fixtureGates,
  fixtureLanes,
  fixtureNeeds,
  fixturePhases,
  fixtureStepItems,
  fixtureSteps,
} from './process/seedFixture';

const ready = () => ({
  lanes: okRows(fixtureLanes()),
  phases: okRows(fixturePhases()),
  steps: okRows(fixtureSteps()),
  gates: okRows(fixtureGates()),
  needs: okRows(fixtureNeeds()),
  stepItems: okRows(fixtureStepItems()),
});

const ALL_STATUS = { ADA: true, SEBAGIAN: true, BELUM: true };
const ALL_KIND = { MASTER: true, TRANSAKSI: true, PARAMETER: true, REFERENSI: true };

const SALES_GENERAL_TRADE = '634e675f-4681-4307-b831-6cad1e7d80fa';
const STORING_COST = '10b151a5-5c45-454c-a13b-ffbc786ec645';

describe('§10.9 a missing os_process_* relation is the ordinary empty state', () => {
  it('folds a forced 42P01 on any read into kind empty — never a crash, never a warning', () => {
    const missing = readFailure('listProcessSteps', { code: '42P01' });
    expect(buildProcessModel({ ...ready(), steps: missing })).toEqual({ kind: 'empty' });
    expect(
      buildProcessModel({ ...ready(), lanes: readFailure('listProcessLanes', { code: '42P01' }) }),
    ).toEqual({ kind: 'empty' });
    expect(
      buildProcessModel({
        ...ready(),
        stepItems: readFailure('listProcessStepItems', { code: '42P01' }),
      }),
    ).toEqual({ kind: 'empty' });
    expect(
      buildProcessModel({
        ...ready(),
        needs: readFailure('listProcessNeeds', {
          code: 'PGRST205',
          message: 'Could not find the table',
        }),
      }),
    ).toEqual({ kind: 'empty' });
  });

  it('keeps a real failure loud: a network error is failed, not empty', () => {
    const model = buildProcessModel({
      ...ready(),
      steps: readThrew('listProcessSteps', new Error('network down')),
    });
    expect(model.kind).toBe('failed');
    expect(model.kind === 'failed' && model.detail).toContain('network down');
  });

  it('treats a present-but-unseeded database as empty too', () => {
    expect(buildProcessModel({ ...ready(), steps: okRows<ProcessStep>([]) })).toEqual({
      kind: 'empty',
    });
  });

  it('is ready with the full seed, bridge included', () => {
    const model = buildProcessModel(ready());
    expect(model.kind).toBe('ready');
    expect(model.kind === 'ready' && model.steps).toHaveLength(30);
    expect(model.kind === 'ready' && model.stepItems).toHaveLength(45);
  });

  // The tests above force 42P01 one read at a time. THIS is the actual live
  // state on 6 August: the migration has never run, so all six relations are
  // missing at once and every process read fails together. The Swimlane and
  // Kebutuhan data tabs must both fold to the ordinary empty state, and
  // nothing may reach the console — a warning here is the difference between
  // "not deployed yet" and "the app is broken".
  const allSixMissing = () => ({
    lanes: readFailure('listProcessLanes', { code: '42P01' }),
    phases: readFailure('listProcessPhases', { code: '42P01' }),
    steps: readFailure('listProcessSteps', { code: '42P01' }),
    gates: readFailure('listProcessGates', { code: '42P01' }),
    needs: readFailure('listProcessNeeds', { code: '42P01' }),
    stepItems: readFailure('listProcessStepItems', { code: '42P01' }),
  });

  it('folds all six missing relations at once into empty, not failed', () => {
    expect(buildProcessModel(allSixMissing())).toEqual({ kind: 'empty' });
  });

  it('says nothing to the console while every relation is missing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      buildProcessModel(allSixMissing());
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  // The Matrix tab reads os_finish_line_*, which is applied and populated. Its
  // data path shares no read with the process tables, so a total process
  // outage must leave it fully rendered rather than degrading all three tabs
  // together.
  it('leaves the Matrix tab untouched: closing conditions go quiet, nothing else', () => {
    // FinishLine.tsx reaches the process tables through exactly one call —
    // closingConditionsForItem, fed by rowsOf() over the three process reads.
    // rowsOf() turns each failure into [], so the block returns null, which is
    // what hides it. Every other cell on the Matrix reads os_finish_line_*.
    const missing = allSixMissing();
    expect(
      closingConditionsForItem(
        SALES_GENERAL_TRADE,
        rowsOf(missing.stepItems),
        rowsOf(missing.needs),
        rowsOf(missing.steps),
      ),
    ).toBeNull();
  });
});

describe('§4 the bridge is 45 pairs over 17 rows, and the SQL says the same', () => {
  it('carries 45 edges across 17 distinct Finish line rows', () => {
    const edges = fixtureStepItems();
    expect(edges).toHaveLength(45);
    expect(new Set(edges.map((edge) => edge.itemId)).size).toBe(17);
    expect(new Set(edges.map((edge) => `${edge.stepId}|${edge.itemId}`)).size).toBe(45);
  });

  it('references only step labels that exist in the seed', () => {
    const labels = new Set(fixtureSteps().map((step) => step.label));
    for (const edge of fixtureStepItems()) expect(labels.has(edge.stepId)).toBe(true);
  });

  it('leaves steps 4, 11, 12, 18b, 22 and 26 feeding no row — recorded, not forgotten', () => {
    const fed = new Set(fixtureStepItems().map((edge) => edge.stepId));
    const unfed = fixtureSteps()
      .map((step) => step.label)
      .filter((label) => !fed.has(label));
    expect(unfed).toEqual(['4', '11', '12', '18b', '22', '26']);
  });

  it('matches migration 20260806000051 pair for pair — the anti-drift tripwire', () => {
    // Parses section 6's VALUES rows straight out of the migration. If the SQL
    // and this fixture are edited apart, this fails instead of the app quietly
    // showing a mapping the database does not have.
    const sql = readFileSync(
      new URL('../../supabase/migrations/20260806000051_samb_process_seed.sql', import.meta.url),
      'utf8',
    );
    const section = sql.slice(sql.indexOf('insert into public.os_process_step_items'));
    const fromSql = [...section.matchAll(/^ {2}\('([^']+)', '([0-9a-f-]{36})'\),?$/gm)].map(
      ([, label, itemId]) => `${label}|${itemId}`,
    );
    expect(fromSql).toHaveLength(45);
    expect([...fromSql].sort()).toEqual(
      fixtureStepItems()
        .map((edge) => `${edge.stepId}|${edge.itemId}`)
        .sort(),
    );
  });

  it('never maps the two Margin-layering twins — derived metrics with no accounts', () => {
    const mapped = new Set(STEP_ITEM_MAP.map((entry) => entry.itemId));
    expect(mapped.has('0a948b6d-e7c3-4482-a4d2-207f8d2cadff')).toBe(false);
    expect(mapped.has('965853f6-abc8-4de5-bd4b-4bd5d7506700')).toBe(false);
    expect(STEP_ITEM_MAP.every((entry) => entry.section !== 'Margin layering & cost-to-serve')).toBe(
      true,
    );
  });
});

describe('§7 the register joins needs to steps and filters honestly', () => {
  const steps = fixtureSteps();
  const needs = fixtureNeeds();

  it('shows all 118 rows unfiltered', () => {
    expect(
      registerRows(needs, steps, { track: 'ALL', status: ALL_STATUS, kind: ALL_KIND }),
    ).toHaveLength(118);
  });

  it('drops rows of steps outside the jalur filter', () => {
    const trade = registerRows(needs, steps, { track: 'TRADE', status: ALL_STATUS, kind: ALL_KIND });
    const lp = registerRows(needs, steps, { track: 'LP', status: ALL_STATUS, kind: ALL_KIND });
    expect(trade.length).toBeLessThan(118);
    expect(lp.length).toBeLessThan(118);
    expect(trade.every((row) => row.step.track !== 'LP')).toBe(true);
    expect(lp.every((row) => row.step.track !== 'TRADE')).toBe(true);
  });

  it('applies status and kind toggles together', () => {
    const rows = registerRows(needs, steps, {
      track: 'ALL',
      status: { ...ALL_STATUS, ADA: false, SEBAGIAN: false },
      kind: { ...ALL_KIND, TRANSAKSI: false },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.need.status === 'BELUM' && row.need.kind !== 'TRANSAKSI')).toBe(
      true,
    );
  });

  it('summarizes the proportion bar over the jalur population, not the toggle slice', () => {
    const all = summarizeNeeds(needs, steps, 'ALL');
    expect(all.total).toBe(118);
    expect(all.ada + all.sebagian + all.belum).toBe(118);
    expect(summarizeNeeds(needs, steps, 'TRADE').total).toBeLessThan(118);
  });

  it('groups per owner sorted by BELUM count first — the request-composing order', () => {
    const groups = groupByOwner(
      registerRows(needs, steps, { track: 'ALL', status: ALL_STATUS, kind: ALL_KIND }),
    );
    expect(groups.length).toBeGreaterThan(1);
    for (let i = 1; i < groups.length; i += 1) {
      const prev = groups[i - 1];
      const next = groups[i];
      expect(
        prev.belum > next.belum ||
          (prev.belum === next.belum && prev.owner.localeCompare(next.owner) <= 0),
      ).toBe(true);
    }
    expect(groups.flatMap((group) => group.rows)).toHaveLength(118);
  });
});

describe('§5 the closing-conditions block, derived through the bridge', () => {
  const steps = fixtureSteps();
  const needs = fixtureNeeds();
  const stepItems = fixtureStepItems();

  it('returns null for a row no step feeds — that is what hides the block', () => {
    expect(closingConditionsForItem('not-mapped', stepItems, needs, steps)).toBeNull();
    // A real Finish line row that is deliberately unmapped: the Margin
    // layering twin of Storing cost.
    expect(
      closingConditionsForItem('0a948b6d-e7c3-4482-a4d2-207f8d2cadff', stepItems, needs, steps),
    ).toBeNull();
  });

  it('collects every need of every feeding step, grouped BELUM → SEBAGIAN → ADA', () => {
    const closing = closingConditionsForItem(SALES_GENERAL_TRADE, stepItems, needs, steps);
    expect(closing).not.toBeNull();
    if (!closing) return;
    expect(closing.stepCount).toBe(4);
    const expected = needs.filter((need) => ['2', '10', '18a', '19'].includes(need.stepId));
    expect(closing.groups.flatMap((group) => group.rows)).toHaveLength(expected.length);
    expect(closing.counts.ADA + closing.counts.SEBAGIAN + closing.counts.BELUM).toBe(
      expected.length,
    );
    // Order is the fixed severity order, and empty statuses are omitted
    // rather than rendered as headers over nothing.
    const rank = { BELUM: 0, SEBAGIAN: 1, ADA: 2 };
    const order = closing.groups.map((group) => group.status);
    expect(order).toEqual([...order].sort((a, b) => rank[a] - rank[b]));
    expect(closing.groups.every((group) => group.rows.length > 0)).toBe(true);
  });

  it('carries the step label on every row so each need is traceable back', () => {
    const closing = closingConditionsForItem(STORING_COST, stepItems, needs, steps);
    expect(closing?.stepCount).toBe(6);
    const labels = new Set(
      closing?.groups.flatMap((group) => group.rows.map((row) => row.stepLabel)),
    );
    expect([...labels].sort()).toEqual(['13', '14', '15a', '6a', '8', '9']);
  });

  it('counts a step once even though it feeds several rows', () => {
    // Step 9 feeds COGS — General Trade, Storing cost, Pallet utilisation,
    // Pallet positions used and Inventories. Its needs appear under each,
    // and each row counts it as exactly one feeding step.
    const rowsFedBy9 = stepItems.filter((edge) => edge.stepId === '9');
    expect(rowsFedBy9).toHaveLength(5);
    for (const edge of rowsFedBy9) {
      const closing = closingConditionsForItem(edge.itemId, stepItems, needs, steps);
      expect(closing?.stepCount).toBe(stepsForItem(edge.itemId, stepItems, steps).length);
    }
  });

  it('still returns a value when feeding steps carry no needs', () => {
    const bare: ProcessNeed[] = [];
    const closing = closingConditionsForItem(SALES_GENERAL_TRADE, stepItems, bare, steps);
    expect(closing).toMatchObject({ stepCount: 4, groups: [] });
    expect(closing?.counts).toEqual({ ADA: 0, SEBAGIAN: 0, BELUM: 0 });
  });
});

describe('§2 the pre-filter highlights the feeding steps and nothing else', () => {
  const steps = fixtureSteps();
  const stepItems = fixtureStepItems();

  it('lights 4 of the 30 steps for Sales — General Trade, leaving 26 dimmed', () => {
    const lit = stepLabelsForItem(SALES_GENERAL_TRADE, stepItems, steps);
    expect([...lit].sort()).toEqual(['10', '18a', '19', '2']);
    expect(steps.length - lit.size).toBe(26);
  });

  it('lights nothing for a row outside the bridge, so no step is falsely implicated', () => {
    expect(stepLabelsForItem('not-mapped', stepItems, steps).size).toBe(0);
  });
});

describe('a step lists the Finish line rows it feeds, deduped and in matrix order', () => {
  const items: FinishLineItem[] = [
    { id: 'fl-1', item: 'Baris A', kind: 'metric', order: 2 },
    { id: 'fl-2', item: 'Baris B', kind: 'metric', order: 1 },
  ];
  const edges: ProcessStepItem[] = [
    { stepId: '9', itemId: 'fl-1' },
    { stepId: '9', itemId: 'fl-2' },
    { stepId: '10', itemId: 'fl-1' },
  ];

  it('orders by the row order, not by edge order', () => {
    expect(finishLineRowsForStep('9', edges, items).map((item) => item.id)).toEqual([
      'fl-2',
      'fl-1',
    ]);
  });

  it('drops an edge whose row is not in the loaded items instead of showing a broken link', () => {
    expect(finishLineRowsForStep('9', [{ stepId: '9', itemId: 'ghost' }], items)).toEqual([]);
  });

  it('returns nothing for a step that feeds no row', () => {
    expect(finishLineRowsForStep('4', fixtureStepItems(), items)).toEqual([]);
  });
});
