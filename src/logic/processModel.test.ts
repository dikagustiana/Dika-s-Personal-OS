/**
 * §10.9 / §10.10 at the testable layer: the process views render exactly
 * what these models say, so "42P01 renders the ordinary empty state" and
 * "the closing block does not render at all without mapped needs" are
 * asserted here — by FORCING the failure through readFailure with the real
 * Postgres code, not by assuming it.
 */
import { describe, expect, it } from 'vitest';
import { okRows, readFailure, readThrew } from '../data/readResult';
import type { FinishLineItem, ProcessNeed, ProcessStep } from '../data/types';
import {
  buildProcessModel,
  closingNeedsForItem,
  finishLineRowsForStep,
  groupByOwner,
  registerRows,
  summarizeNeeds,
} from './processModel';
import { fixtureGates, fixtureLanes, fixtureNeeds, fixturePhases, fixtureSteps } from './process/seedFixture';

const ready = () => ({
  lanes: okRows(fixtureLanes()),
  phases: okRows(fixturePhases()),
  steps: okRows(fixtureSteps()),
  gates: okRows(fixtureGates()),
  needs: okRows(fixtureNeeds()),
});

const ALL_STATUS = { ADA: true, SEBAGIAN: true, BELUM: true };
const ALL_KIND = { MASTER: true, TRANSAKSI: true, PARAMETER: true, REFERENSI: true };

describe('§10.9 a missing os_process_* relation is the ordinary empty state', () => {
  it('folds a forced 42P01 on any read into kind empty — never a crash, never a warning', () => {
    const missing = readFailure('listProcessSteps', { code: '42P01' });
    expect(buildProcessModel({ ...ready(), steps: missing })).toEqual({ kind: 'empty' });
    expect(buildProcessModel({ ...ready(), lanes: readFailure('listProcessLanes', { code: '42P01' }) })).toEqual({
      kind: 'empty',
    });
    expect(
      buildProcessModel({ ...ready(), needs: readFailure('listProcessNeeds', { code: 'PGRST205', message: 'Could not find the table' }) }),
    ).toEqual({ kind: 'empty' });
  });

  it('keeps a real failure loud: a network error is failed, not empty', () => {
    const model = buildProcessModel({ ...ready(), steps: readThrew('listProcessSteps', new Error('network down')) });
    expect(model.kind).toBe('failed');
    expect(model.kind === 'failed' && model.detail).toContain('network down');
  });

  it('treats a present-but-unseeded database as empty too', () => {
    const model = buildProcessModel({ ...ready(), steps: okRows<ProcessStep>([]) });
    expect(model).toEqual({ kind: 'empty' });
  });

  it('is ready with the full seed', () => {
    const model = buildProcessModel(ready());
    expect(model.kind).toBe('ready');
    expect(model.kind === 'ready' && model.steps).toHaveLength(30);
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
    const trade = summarizeNeeds(needs, steps, 'TRADE');
    expect(trade.total).toBeLessThan(118);
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

describe('§8.1 the closing block renders nothing without mapped needs', () => {
  const steps = fixtureSteps();

  const mapped = (over: Partial<ProcessNeed>): ProcessNeed => ({
    id: 'n1',
    stepId: '2',
    item: 'Contoh data',
    kind: 'MASTER',
    status: 'BELUM',
    ...over,
  });

  it('returns no group when no need maps to the item — the hidden-block case', () => {
    expect(closingNeedsForItem('item-1', fixtureNeeds(), steps)).toEqual([]);
  });

  it('groups mapped needs BELUM → SEBAGIAN → ADA and resolves step labels', () => {
    const needs = [
      mapped({ id: 'n1', status: 'ADA', finishLineItemId: 'item-1', stepId: '2' }),
      mapped({ id: 'n2', status: 'BELUM', finishLineItemId: 'item-1', stepId: '18a' }),
      mapped({ id: 'n3', status: 'SEBAGIAN', finishLineItemId: 'item-1', stepId: '10' }),
      mapped({ id: 'n4', status: 'BELUM', finishLineItemId: 'other-item', stepId: '2' }),
    ];
    const groups = closingNeedsForItem('item-1', needs, steps);
    expect(groups.map((group) => group.status)).toEqual(['BELUM', 'SEBAGIAN', 'ADA']);
    expect(groups[0].rows[0].stepLabel).toBe('18a');
    expect(groups.flatMap((group) => group.rows)).toHaveLength(3);
  });

  it('omits empty status groups instead of rendering headers over nothing', () => {
    const groups = closingNeedsForItem(
      'item-1',
      [mapped({ status: 'ADA', finishLineItemId: 'item-1' })],
      steps,
    );
    expect(groups.map((group) => group.status)).toEqual(['ADA']);
  });
});

describe('§8.2 a step lists the Finish line rows it feeds, deduped', () => {
  const items: FinishLineItem[] = [
    { id: 'fl-1', item: 'Baris A', kind: 'metric', order: 2 },
    { id: 'fl-2', item: 'Baris B', kind: 'metric', order: 1 },
  ];

  it('dedupes repeated targets and sorts by row order', () => {
    const needs: ProcessNeed[] = [
      { id: 'n1', stepId: '9', item: 'x', kind: 'MASTER', status: 'ADA', finishLineItemId: 'fl-1' },
      { id: 'n2', stepId: '9', item: 'y', kind: 'MASTER', status: 'ADA', finishLineItemId: 'fl-1' },
      { id: 'n3', stepId: '9', item: 'z', kind: 'MASTER', status: 'ADA', finishLineItemId: 'fl-2' },
      { id: 'n4', stepId: '10', item: 'w', kind: 'MASTER', status: 'ADA', finishLineItemId: 'fl-1' },
    ];
    expect(finishLineRowsForStep('9', needs, items).map((item) => item.id)).toEqual([
      'fl-2',
      'fl-1',
    ]);
  });

  it('returns nothing for a step whose needs are all unmapped', () => {
    expect(finishLineRowsForStep('4', fixtureNeeds(), items)).toEqual([]);
  });
});
