/**
 * The mechanics most likely to be softened later by someone making this
 * "consistent" with the rest of the app. Each test names what it protects.
 */
import { describe, expect, it } from 'vitest';
import type {
  Project,
  ResearchCycle,
  ResearchItem,
  ResearchProject,
  ResearchSettings,
} from '../../data/types';
import { gatesFor } from './templates';
import {
  canTickGate,
  citeCount,
  curStage,
  gatePass,
  invalidateFrom,
  loopDue,
  monthsSince,
  stageStatus,
} from './pipeline';

const SETTINGS: ResearchSettings = { wipLimit: 2, staleMonths: 12 };
const NOW = new Date('2026-07-25T12:00:00Z');

function base(over: Partial<ResearchProject> = {}): ResearchProject {
  return {
    project: {
      id: 'p',
      domain: 'growth',
      title: 'Study',
      type: 'research',
      status: 'active',
      milestones: [],
      order: 1,
    } as Project,
    meta: {
      projectId: 'p',
      template: 'min',
      question: 'q',
      output: '',
      audience: '',
      gates: gatesFor('min'),
    },
    items: [],
    claims: [],
    cycles: [],
    log: [],
    ...over,
  };
}

function item(over: Partial<ResearchItem> = {}): ResearchItem {
  return {
    id: Math.random().toString(36).slice(2),
    projectId: 'p',
    name: 'thing',
    unit: '',
    type: 'parameter',
    crit: false,
    status: 'IND',
    value: '',
    source: '',
    asof: '',
    note: '',
    order: 0,
    ...over,
  };
}

function cycle(over: Partial<ResearchCycle> = {}): ResearchCycle {
  return {
    id: 'c',
    projectId: 'p',
    loop: 'data',
    n: 1,
    date: '2026-07-01',
    verdict: 'clean',
    findings: '',
    itemCount: 0,
    citeCount: 0,
    invalidated: 0,
    backLabel: '',
    ...over,
  };
}

describe('hard gate: a stage is locked until its predecessor passes', () => {
  it('reports locked and names the stage it waits on', () => {
    const p = base();
    expect(stageStatus(p, 1).state).toBe('locked');
    expect(stageStatus(p, 1).txt).toBe('terkunci · stage 00');
  });

  it('refuses the tick outright — locked, not merely warned', () => {
    const p = base();
    expect(canTickGate(p, 1)).toBe(false);
    expect(canTickGate(p, 2)).toBe(false);
  });

  it('unlocks the next stage only once every criterion of the previous passes', () => {
    const p = base();
    p.meta.gates[0] = [true, false];
    expect(gatePass(p, 0)).toBe(false);
    expect(canTickGate(p, 1)).toBe(false);
    p.meta.gates[0] = [true, true];
    expect(gatePass(p, 0)).toBe(true);
    expect(canTickGate(p, 1)).toBe(true);
  });

  it('never passes an empty gate vacuously', () => {
    const p = base();
    p.meta.gates[0] = [];
    expect(gatePass(p, 0)).toBe(false);
  });
});

describe('hard gate: stage 00 cannot pass while a critical item is IND', () => {
  it('reports the open blocker rather than an open gate', () => {
    const p = base({ items: [item({ crit: true, status: 'IND' })] });
    expect(stageStatus(p, 0).state).toBe('blocked');
    expect(stageStatus(p, 0).txt).toBe('blocker terbuka');
  });

  it('refuses the tick while the critical item is unverified', () => {
    const p = base({ items: [item({ crit: true, status: 'IND' })] });
    expect(canTickGate(p, 0)).toBe(false);
  });

  it('allows it once the critical item is verified or established unavailable', () => {
    const verified = base({ items: [item({ crit: true, status: 'V' })] });
    expect(canTickGate(verified, 0)).toBe(true);
    const unavailable = base({ items: [item({ crit: true, status: 'NA' })] });
    expect(canTickGate(unavailable, 0)).toBe(true);
  });

  it('ignores non-critical items that are still IND', () => {
    const p = base({ items: [item({ crit: false, status: 'IND' })] });
    expect(canTickGate(p, 0)).toBe(true);
    expect(stageStatus(p, 0).state).toBe('open');
  });
});

describe('rework invalidates every gate from a chosen stage downward', () => {
  it('clears from the target down, leaves earlier stages alone, and counts', () => {
    const gates = [
      [true, true],
      [true, true],
      [true, false],
      [true, true],
    ];
    const { gates: next, invalidated } = invalidateFrom(gates, 2);
    expect(next[0]).toEqual([true, true]);
    expect(next[1]).toEqual([true, true]);
    expect(next[2]).toEqual([false, false]);
    expect(next[3]).toEqual([false, false]);
    // Only the three that were actually set count as invalidated.
    expect(invalidated).toBe(3);
  });

  it('returns a new matrix so a failed write cannot half-invalidate a project', () => {
    const gates = [[true], [true]];
    const { gates: next } = invalidateFrom(gates, 0);
    expect(gates[0][0]).toBe(true);
    expect(next[0][0]).toBe(false);
  });

  it('reports zero when nothing downstream was set', () => {
    const { invalidated } = invalidateFrom([[true], [false], [false]], 1);
    expect(invalidated).toBe(0);
  });

  it('rolls the current stage back to the invalidated one', () => {
    const p = base({ meta: { ...base().meta, gates: [[true, true], [true, true], [false, false], [false, false]] } });
    expect(curStage(p)).toBe(2);
    p.meta.gates = invalidateFrom(p.meta.gates, 1).gates;
    expect(curStage(p)).toBe(1);
  });
});

describe('loopDue fires on each independent trigger', () => {
  it('never run', () => {
    const due = loopDue(base(), 'data', SETTINGS, NOW);
    expect(due.due).toBe(true);
    expect(due.never).toBe(true);
    expect(due.why).toBe('belum pernah dijalankan');
  });

  it('last verdict was rework', () => {
    const p = base({ cycles: [cycle({ verdict: 'rework' })] });
    const due = loopDue(p, 'data', SETTINGS, NOW);
    expect(due.due).toBe(true);
    expect(due.why).toContain('rework');
  });

  it('stale verified items past the staleness bound (data)', () => {
    const p = base({
      items: [item({ status: 'V', asof: '2015' })],
      cycles: [cycle({ itemCount: 1 })],
    });
    const due = loopDue(p, 'data', SETTINGS, NOW);
    expect(due.due).toBe(true);
    expect(due.why).toBe('1 item V melewati batas kebasian 12 bulan');
  });

  it('new items since the last cycle (data)', () => {
    const p = base({
      items: [item(), item(), item()],
      cycles: [cycle({ itemCount: 1 })],
    });
    const due = loopDue(p, 'data', SETTINGS, NOW);
    expect(due.due).toBe(true);
    expect(due.why).toBe('2 item baru sejak siklus terakhir');
  });

  it('new sources or (b) claims since the last cycle (cite)', () => {
    const p = base({
      items: [item({ type: 'paper' }), item({ type: 'dokumen' })],
      claims: [{ id: 'c', projectId: 'p', text: 't', layer: 'b', ev: '', order: 0 }],
      cycles: [cycle({ loop: 'cite', citeCount: 1 })],
    });
    expect(citeCount(p)).toBe(3);
    const due = loopDue(p, 'cite', SETTINGS, NOW);
    expect(due.due).toBe(true);
    expect(due.why).toBe('2 sumber atau klaim (b) baru sejak siklus terakhir');
  });

  it('more than three months elapsed (method)', () => {
    const p = base({ cycles: [cycle({ loop: 'method', date: '2026-01-01' })] });
    const due = loopDue(p, 'method', SETTINGS, NOW);
    expect(due.due).toBe(true);
    expect(due.why).toBe('lebih dari 3 bulan sejak siklus terakhir');
  });

  it('reports clean, with the date, when no trigger fires', () => {
    const p = base({ cycles: [cycle({ loop: 'method', date: '2026-07-01' })] });
    const due = loopDue(p, 'method', SETTINGS, NOW);
    expect(due.due).toBe(false);
    expect(due.why).toBe('bersih per 2026-07-01');
  });

  it('treats a missing or unparseable as_of as infinitely old', () => {
    expect(monthsSince(undefined, NOW)).toBe(Infinity);
    expect(monthsSince('not a date', NOW)).toBe(Infinity);
    expect(monthsSince('2026-07-25', NOW)).toBeCloseTo(0, 1);
  });
});
