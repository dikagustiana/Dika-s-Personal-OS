import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DailyLog,
  Domain,
  HabitEntry,
  TaskEntry,
  TimeBlockEntry,
} from '../data/types';
import { scoreFromSnapshot } from '../logic/dailyLog';
import { useAppStore } from '../store/appStore';

export interface ScoreInputs {
  habits: HabitEntry[];
  tasks: TaskEntry[];
  blocks: TimeBlockEntry[];
}

const EMPTY_INPUTS: ScoreInputs = { habits: [], tasks: [], blocks: [] };

export interface RecomputeOverrides extends Partial<ScoreInputs> {
  /** The habit tick-state to score against, when a habit was just toggled. */
  habitState?: Record<string, boolean>;
}

/**
 * Owns the daily log for one (date, domain) and exposes the single write path
 * for it.
 *
 * The subtlety this exists to remove: a mutation runs *before* React has
 * re-rendered with its result, so anything the mutation closes over is one
 * step behind. Views therefore hand `recomputeAndPersistDailyLog` the values
 * they just produced, and those win over the mirrored state. Nothing else may
 * write a score.
 */
export function useDailyLog(date: string, domain: Domain) {
  const repository = useAppStore((state) => state.repository);
  const [log, setLogState] = useState<DailyLog | null>(null);
  const logRef = useRef<DailyLog | null>(null);
  const inputsRef = useRef<ScoreInputs>(EMPTY_INPUTS);

  // Reset when the day rolls over or the workspace switches, so a stale log
  // from the previous key can never be persisted under the new one.
  useEffect(() => {
    logRef.current = null;
    inputsRef.current = EMPTY_INPUTS;
    setLogState(null);
  }, [date, domain]);

  const setLog = useCallback((next: DailyLog | null) => {
    logRef.current = next;
    setLogState(next);
  }, []);

  /** Mirror of the current scoring inputs, refreshed on every render pass. */
  const syncInputs = useCallback((next: ScoreInputs) => {
    inputsRef.current = next;
  }, []);

  const emptyLog = useCallback(
    (): DailyLog => ({ date, domain, habits: {}, score: 0 }),
    [date, domain],
  );

  const recomputeAndPersistDailyLog = useCallback(
    async (overrides: RecomputeOverrides = {}): Promise<DailyLog> => {
      const base = logRef.current ?? emptyLog();
      const next: DailyLog = overrides.habitState
        ? { ...base, habits: overrides.habitState }
        : base;
      const score = scoreFromSnapshot({
        habits: overrides.habits ?? inputsRef.current.habits,
        tasks: overrides.tasks ?? inputsRef.current.tasks,
        blocks: overrides.blocks ?? inputsRef.current.blocks,
        log: next,
      });
      const saved = await repository.upsertDailyLog({ ...next, score });
      setLog(saved);
      return saved;
    },
    [emptyLog, repository, setLog],
  );

  return { log, setLog, syncInputs, recomputeAndPersistDailyLog, emptyLog };
}
