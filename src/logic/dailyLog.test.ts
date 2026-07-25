import { describe, expect, it } from 'vitest';
import { isScoredTask, scoreFromSnapshot, scoredTasks } from './dailyLog';
import type { DailyLog, HabitEntry, TaskEntry, TimeBlockEntry } from '../data/types';

const TODAY = '2026-07-24';

function task(overrides: Partial<TaskEntry> & { id: string }): TaskEntry {
  return {
    type: 'task',
    domain: 'work',
    title: overrides.id,
    priority: 'urgent',
    done: false,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    tags: [],
    ...overrides,
  };
}

function habit(id: string): HabitEntry {
  return {
    id,
    type: 'habit',
    domain: 'work',
    title: id,
    active: true,
    order: 0,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    tags: [],
  };
}

function block(id: string, status: TimeBlockEntry['status']): TimeBlockEntry {
  return {
    id,
    type: 'timeblock',
    domain: 'work',
    date: TODAY,
    start: '09:00',
    end: '09:30',
    label: id,
    status,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    tags: [],
  };
}

const emptyLog: DailyLog = { date: TODAY, domain: 'work', habits: {}, score: 0 };

describe('isScoredTask', () => {
  it('scores urgent tasks that are open or completed today', () => {
    expect(isScoredTask(task({ id: 'a' }), TODAY)).toBe(true);
    expect(
      isScoredTask(task({ id: 'b', done: true, completedAt: `${TODAY}T10:00:00.000Z` }), TODAY),
    ).toBe(true);
  });

  it('leaves Inbox tasks out of the score entirely', () => {
    expect(isScoredTask(task({ id: 'c', priority: 'normal' }), TODAY)).toBe(false);
  });

  it('drops tasks completed on an earlier day', () => {
    expect(
      isScoredTask(task({ id: 'd', done: true, completedAt: '2026-07-23T10:00:00.000Z' }), TODAY),
    ).toBe(false);
  });
});

describe('scoreFromSnapshot', () => {
  it('applies the locked 40/40/20 weighting', () => {
    const score = scoreFromSnapshot({
      habits: [habit('h1'), habit('h2'), habit('h3'), habit('h4')],
      tasks: [task({ id: 't1', done: true }), task({ id: 't2' })],
      blocks: [block('b1', 'done'), block('b2', 'done')],
      log: { ...emptyLog, habits: { h1: true, h2: true, h3: true } },
    });
    expect(score).toBe(70);
  });

  it('renormalizes for GROWTH, which has no timebox', () => {
    const score = scoreFromSnapshot({
      habits: [habit('h1'), habit('h2')],
      tasks: [task({ id: 't1', done: true })],
      blocks: [],
      log: { ...emptyLog, habits: { h1: true } },
    });
    // habits 50% and tasks 100%, renormalized over 0.4 + 0.4.
    expect(score).toBe(75);
  });
});

describe('score persistence inputs', () => {
  // B3: adding a task, deleting one, and completing one through a timeblock
  // each used to persist either nothing or a score computed against a stale
  // task list. These assert the inputs the single write path is handed.

  it('does not move the score when a task is captured to the Inbox', () => {
    const habits = [habit('h1')];
    const before = scoredTasks([task({ id: 't1', done: true })], TODAY);
    const after = scoredTasks(
      [task({ id: 't1', done: true }), task({ id: 'new', priority: 'normal' })],
      TODAY,
    );
    const log = { ...emptyLog, habits: { h1: true } };
    expect(scoreFromSnapshot({ habits, tasks: before, blocks: [], log })).toBe(
      scoreFromSnapshot({ habits, tasks: after, blocks: [], log }),
    );
  });

  it('moves the score when a task is deleted', () => {
    const habits = [habit('h1')];
    const log = { ...emptyLog, habits: { h1: true } };
    const before = [task({ id: 't1', done: true }), task({ id: 't2' })];
    const after = before.filter((item) => item.id !== 't2');
    // habits 1/1 and tasks 1/2, renormalized over 0.4 + 0.4.
    expect(scoreFromSnapshot({ habits, tasks: before, blocks: [], log })).toBe(75);
    expect(scoreFromSnapshot({ habits, tasks: after, blocks: [], log })).toBe(100);
  });

  it('scores a timeblock completion against the task it just completed', () => {
    const habits = [habit('h1')];
    const log = { ...emptyLog, habits: { h1: true } };
    const linked = task({ id: 't1' });
    const staleTasks = [linked];
    const freshTasks = [
      task({ id: 't1', done: true, completedAt: `${TODAY}T11:00:00.000Z` }),
    ];
    const blocks = [block('b1', 'done')];

    // What the old stale-closure path would have written…
    expect(scoreFromSnapshot({ habits, tasks: staleTasks, blocks, log })).toBe(60);
    // …versus the truth, with the linked task actually complete.
    expect(scoreFromSnapshot({ habits, tasks: freshTasks, blocks, log })).toBe(100);
  });
});
