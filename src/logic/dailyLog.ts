import { calculateDailyScore } from './score';
import type { DailyLog, HabitEntry, TaskEntry, TimeBlockEntry } from '../data/types';

/**
 * Everything a daily score is computed from, at one instant in time.
 *
 * `tasks` is already narrowed to the tasks that count — for WORK that is the
 * urgent, pinned-to-today set; Inbox tasks are deliberately not scored, so
 * capturing a thought never moves the number. `blocks` is empty for GROWTH,
 * which has no timebox; the score renormalizes over the components that are
 * actually present.
 */
export interface DailyScoreSnapshot {
  habits: HabitEntry[];
  tasks: TaskEntry[];
  blocks: TimeBlockEntry[];
  log: DailyLog;
}

/**
 * The one place a daily score is derived from state.
 *
 * The weighting itself (40% habits / 40% tasks / 20% timebox, renormalized
 * when a component is empty) lives in `calculateDailyScore` and is not
 * touched here — this only decides which counts get fed into it.
 *
 * Every score-affecting mutation routes through a single caller of this
 * function, holding the freshly-computed state rather than a closed-over
 * snapshot. Previously each view recalculated inline, and several mutations
 * either skipped the write entirely (adding or deleting a task) or scored
 * against a stale closure (completing a task through a timeblock) — so the
 * number on screen could disagree with the number in the database.
 */
export function scoreFromSnapshot({ habits, tasks, blocks, log }: DailyScoreSnapshot): number {
  return calculateDailyScore({
    habits: {
      completed: habits.filter((habit) => log.habits[habit.id]).length,
      total: habits.length,
    },
    tasks: {
      completed: tasks.filter((task) => task.done).length,
      total: tasks.length,
    },
    timeblocks: {
      completed: blocks.filter((block) => block.status === 'done').length,
      total: blocks.length,
    },
  }).score;
}

/** A task counts toward the day's score when it is urgent and lands on today. */
export function isScoredTask(task: TaskEntry, todayKey: string): boolean {
  if (task.priority !== 'urgent') return false;
  if (!task.done) return true;
  return Boolean(task.completedAt?.startsWith(todayKey));
}

export function scoredTasks(tasks: TaskEntry[], todayKey: string): TaskEntry[] {
  return tasks.filter((task) => isScoredTask(task, todayKey));
}
