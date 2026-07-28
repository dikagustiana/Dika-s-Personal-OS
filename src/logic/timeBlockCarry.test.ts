import { describe, expect, it } from 'vitest';
import type { Milestone, Project, TimeBlockEntry } from '../data/types';
import { scoreFromSnapshot } from './dailyLog';
import {
  blockMinutes,
  carryOverFor,
  chainFor,
  formatDuration,
  isUnfinished,
  latestPriorBlockDate,
  scheduleAgainDraft,
} from './timeBlockCarry';

// Synthetic throughout. Real block labels name entity work; this repo is public.
function block(over: Partial<TimeBlockEntry> & { date: string }): TimeBlockEntry {
  return {
    id: `${over.date}-${over.start ?? '09:00'}`,
    type: 'timeblock',
    domain: 'work',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    tags: [],
    start: '09:00',
    end: '11:00',
    label: 'A block',
    status: 'planned',
    ...over,
  };
}

function project(milestones: Milestone[]): Project {
  return {
    id: 'p1',
    domain: 'work',
    title: 'A project',
    type: 'other',
    status: 'active',
    milestones,
    order: 1,
  };
}

describe('duration is derived, never stored', () => {
  it('reads minutes from start and end', () => {
    expect(blockMinutes(block({ date: 'd', start: '09:00', end: '11:00' }))).toBe(120);
    expect(blockMinutes(block({ date: 'd', start: '09:30', end: '10:00' }))).toBe(30);
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(30)).toBe('30m');
  });
});

describe('only carried and blocked mean unfinished work', () => {
  it('excludes planned, done and skipped', () => {
    expect(isUnfinished(block({ date: 'd', status: 'carried' }))).toBe(true);
    expect(isUnfinished(block({ date: 'd', status: 'blocked' }))).toBe(true);
    expect(isUnfinished(block({ date: 'd', status: 'planned' }))).toBe(false);
    expect(isUnfinished(block({ date: 'd', status: 'done' }))).toBe(false);
    // The whole point of the split: skipped no longer absorbs "didn't finish".
    expect(isUnfinished(block({ date: 'd', status: 'skipped' }))).toBe(false);
  });
});

describe('lookback is the most recent day with blocks, NOT a rolling window', () => {
  it('picks the latest prior day that has any block', () => {
    const blocks = [
      block({ date: '2026-07-20' }),
      block({ date: '2026-07-24' }),
      block({ date: '2026-07-28' }),
    ];
    expect(latestPriorBlockDate(blocks, '2026-07-28')).toBe('2026-07-24');
  });

  it('after a multi-day gap, shows only that one day — not every unfinished day', () => {
    const blocks = [
      block({ id: 'mon', date: '2026-07-20', status: 'carried', label: 'Monday thing' }),
      block({ id: 'tue', date: '2026-07-21', status: 'blocked', blockedOn: 'x', label: 'Tuesday thing' }),
      block({ id: 'fri', date: '2026-07-24', status: 'carried', label: 'Friday thing' }),
    ];
    const rows = carryOverFor(blocks, [], '2026-07-28');
    expect(rows).toHaveLength(1);
    expect(rows[0].block.label).toBe('Friday thing');
  });

  it('a day whose work was all finished ends the chain — it does not hunt backwards', () => {
    const blocks = [
      block({ id: 'old', date: '2026-07-20', status: 'carried', label: 'Older unfinished' }),
      block({ id: 'new', date: '2026-07-27', status: 'done', label: 'Finished' }),
    ];
    expect(carryOverFor(blocks, [], '2026-07-28')).toEqual([]);
  });

  it('returns nothing when there is no prior day at all', () => {
    expect(carryOverFor([block({ date: '2026-07-28' })], [], '2026-07-28')).toEqual([]);
  });
});

describe('a three-day chain reports accumulated time', () => {
  const chain = [
    block({ id: 'd1', date: '2026-07-24', start: '09:00', end: '11:00', label: 'Long thing', status: 'carried' }),
    block({
      id: 'd2',
      date: '2026-07-25',
      start: '09:00',
      end: '10:00',
      label: 'Long thing',
      status: 'carried',
      carriedFrom: '2026-07-24',
    }),
    block({
      id: 'd3',
      date: '2026-07-27',
      start: '09:00',
      end: '10:00',
      label: 'Long thing',
      status: 'blocked',
      blockedOn: 'a figure from another team',
      carriedFrom: '2026-07-25',
    }),
  ];

  it('walks carriedFrom back through every day', () => {
    expect(chainFor(chain[2], chain).map((item) => item.date)).toEqual([
      '2026-07-27',
      '2026-07-25',
      '2026-07-24',
    ]);
  });

  it('sums 2h + 1h + 1h across 3 days', () => {
    const rows = carryOverFor(chain, [], '2026-07-28');
    expect(rows).toHaveLength(1);
    expect(rows[0].chainMinutes).toBe(240);
    expect(rows[0].chainDays).toBe(3);
    expect(formatDuration(rows[0].chainMinutes)).toBe('4h');
    // The single block is still 1h — the chain figure never overwrites it.
    expect(rows[0].minutes).toBe(60);
  });

  it('does not hang on a carriedFrom cycle', () => {
    const a = block({ id: 'a', date: '2026-07-24', label: 'Loop', status: 'carried', carriedFrom: '2026-07-25' });
    const b = block({ id: 'b', date: '2026-07-25', label: 'Loop', status: 'carried', carriedFrom: '2026-07-24' });
    expect(chainFor(b, [a, b]).length).toBeLessThanOrEqual(2);
  });
});

describe('attribution on a carry-over row', () => {
  const milestone: Milestone = { id: 'm1', text: 'A milestone', done: false, status: 'in-progress' };

  it('resolves the milestone and its project', () => {
    const blocks = [
      block({ date: '2026-07-27', status: 'carried', projectId: 'p1', milestoneId: 'm1' }),
    ];
    const rows = carryOverFor(blocks, [project([milestone])], '2026-07-28');
    expect(rows[0].milestoneText).toBe('A milestone');
    expect(rows[0].projectTitle).toBe('A project');
    expect(rows[0].brokenMilestone).toBe(false);
  });

  it('flags a deleted milestone as broken rather than dropping the row', () => {
    // Silently blanking it would read as unattributed time, which is worse
    // than an obvious error.
    const blocks = [
      block({ date: '2026-07-27', status: 'carried', projectId: 'p1', milestoneId: 'gone' }),
    ];
    const rows = carryOverFor(blocks, [project([milestone])], '2026-07-28');
    expect(rows).toHaveLength(1);
    expect(rows[0].brokenMilestone).toBe(true);
    expect(rows[0].projectTitle).toBe('A project');
  });
});

describe('Schedule again', () => {
  const source = block({
    date: '2026-07-27',
    start: '09:00',
    end: '11:00',
    label: 'Continues tomorrow',
    status: 'blocked',
    blockedOn: 'a figure from another team',
    category: 'deep-work',
    projectId: 'p1',
    milestoneId: 'm1',
  });

  it('copies label, attribution and category, and sets carriedFrom', () => {
    const draft = scheduleAgainDraft(source, '2026-07-28');
    expect(draft.label).toBe('Continues tomorrow');
    expect(draft.category).toBe('deep-work');
    expect(draft.projectId).toBe('p1');
    expect(draft.milestoneId).toBe('m1');
    expect(draft.carriedFrom).toBe('2026-07-27');
    expect(draft.date).toBe('2026-07-28');
  });

  it('resets status to planned and does NOT inherit the old reason', () => {
    // Inheriting `blocked` would claim a wall was hit today that was hit
    // yesterday, and the reason belongs to the day it was captured.
    const draft = scheduleAgainDraft(source, '2026-07-28');
    expect(draft.status).toBe('planned');
    expect('blockedOn' in draft).toBe(false);
  });
});

describe('the new statuses move NO progress figure', () => {
  // A block records where time went; progress comes from completion. If two
  // hours on something unfinished nudged a number upward, it would flatter
  // effort rather than report completion — the same failure as the habit
  // consistency bug that read 100% from a single logged day.
  const log = { date: '2026-07-28', domain: 'work' as const, habits: {}, score: 0 };
  const scoreWith = (status: TimeBlockEntry['status']) =>
    scoreFromSnapshot({
      habits: [],
      tasks: [],
      blocks: [
        block({ date: '2026-07-28', status: 'done', start: '09:00', end: '10:00', id: 'a' }),
        block({ date: '2026-07-28', status, start: '10:00', end: '11:00', id: 'b' }),
      ],
      log,
    });

  it('scores carried and blocked exactly as planned does — not as done', () => {
    expect(scoreWith('carried')).toBe(scoreWith('planned'));
    expect(scoreWith('blocked')).toBe(scoreWith('planned'));
    expect(scoreWith('skipped')).toBe(scoreWith('planned'));
    expect(scoreWith('done')).not.toBe(scoreWith('planned'));
  });

  it('leaves the timebox denominator alone — a carried block still counts as a block', () => {
    // 1 of 2 done, whatever the other block's status is.
    expect(scoreWith('carried')).toBe(50);
    expect(scoreWith('blocked')).toBe(50);
  });
});
