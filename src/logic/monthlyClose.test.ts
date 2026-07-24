import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import {
  buildMonthlyCloseInputs,
  needsGeneration,
  periodLabel,
  targetPeriod,
} from './monthlyClose';

describe('targetPeriod', () => {
  it('targets the current month from the 22nd onwards', () => {
    expect(targetPeriod(new Date(2026, 6, 22))).toBe('2026-07');
    expect(targetPeriod(new Date(2026, 6, 31))).toBe('2026-07');
  });

  it('targets the previous month before the 22nd (its cycle is still running)', () => {
    expect(targetPeriod(new Date(2026, 7, 3))).toBe('2026-07');
    expect(targetPeriod(new Date(2026, 6, 21))).toBe('2026-06');
  });

  it('rolls across year boundaries', () => {
    expect(targetPeriod(new Date(2027, 0, 5))).toBe('2026-12');
  });
});

describe('periodLabel', () => {
  it('labels with the PERIOD month in Indonesian', () => {
    expect(periodLabel('2026-07')).toBe('Closing Juli');
    expect(periodLabel('2026-12')).toBe('Closing Desember');
    expect(periodLabel('2026-01')).toBe('Closing Januari');
  });
});

describe('buildMonthlyCloseInputs', () => {
  const inputs = buildMonthlyCloseInputs('2026-07');

  it('creates five entity closes plus consolidation, all WORK + recurring', () => {
    expect(inputs).toHaveLength(6);
    expect(inputs.map((p) => p.title)).toEqual([
      'Closing Juli — BMG',
      'Closing Juli — OKI',
      'Closing Juli — KGR',
      'Closing Juli — NMG',
      'Closing Juli — KBF',
      'Closing Juli — Consolidation',
    ]);
    for (const input of inputs) {
      expect(input.domain).toBe('work');
      expect(input.recurring).toBe('monthly');
      expect(input.period).toBe('2026-07');
    }
  });

  it('anchors milestone deadlines to early August (the month after the period)', () => {
    const bmg = inputs[0];
    expect(bmg.milestones.map((m) => m.dueDate)).toEqual(['2026-08-05', '2026-08-08']);
  });

  it('orders consolidation by deadline with Approve TB before the review deck', () => {
    const consolidation = inputs[5];
    const texts = consolidation.milestones.map((m) => m.text);
    expect(texts.slice(-2)).toEqual(['Approve TB', 'Build monthly review deck']);
    const dues = consolidation.milestones.map((m) => m.dueDate as string);
    expect([...dues].sort()).toEqual(dues); // already deadline-ordered
  });

  it('handles the December period rolling into January', () => {
    const december = buildMonthlyCloseInputs('2026-12');
    expect(december[0].milestones[1].dueDate).toBe('2027-01-08');
  });
});

describe('needsGeneration', () => {
  const existing = (period: string): Project[] => [
    {
      id: 'x',
      domain: 'work',
      title: 'Closing Juli — BMG',
      type: 'other',
      status: 'active',
      milestones: [],
      order: 1,
      recurring: 'monthly',
      period,
    },
  ];

  it('is idempotent per period: never regenerates an existing period', () => {
    expect(needsGeneration(existing('2026-07'), '2026-07')).toBe(false);
  });

  it('generates when the period has no cycle yet', () => {
    expect(needsGeneration(existing('2026-06'), '2026-07')).toBe(true);
    expect(needsGeneration([], '2026-07')).toBe(true);
  });

  it('ignores non-recurring projects entirely', () => {
    const oneOff: Project[] = [
      {
        id: 'y',
        domain: 'work',
        title: 'SAMB — Finance Ops',
        type: 'other',
        status: 'active',
        milestones: [],
        order: 1,
        period: '2026-07',
      },
    ];
    expect(needsGeneration(oneOff, '2026-07')).toBe(true);
  });
});
