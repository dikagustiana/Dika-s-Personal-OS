/**
 * FSRE BUILDING v2 — A DESK'S STATE, AS A PURE FUNCTION.
 *
 * The building never stores a desk state; every surface derives it here, in
 * the fixed precedence of brief v2 §3: escalated, no_signal, waiting,
 * working, idle. Ported from the GLM workspace (src/derive/deskState.ts at
 * 5b5d186) with its words read from statuses.ts.
 */
import { DESK_STATE_WORDS, NO_SIGNAL_AFTER_MIN, UNASSIGNED_DESK_WORD, type DeskState } from './statuses';

const MS_PER_MINUTE = 60_000;

export interface DeskStateInput {
  /** Open escalations on this agent's current work. */
  openEscalations: number;
  /** True when the agent holds an open task (task_started without task_done). */
  hasOpenTask: boolean;
  /** Agent this agent is waiting on, from the latest waiting event. */
  waitingOn: string | null;
  /**
   * Time of the agent's last signal (any event except heartbeat), ISO 8601.
   * Null when nothing has been received yet; a null cannot prove silence,
   * so it never produces no_signal.
   */
  lastSignalAt: string | null;
  /** The current mock or wall time, ISO 8601. */
  now: string;
}

function minutesBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return (to - from) / MS_PER_MINUTE;
}

export function deriveDeskState(input: DeskStateInput): DeskState {
  if (input.openEscalations > 0) return 'escalated';
  if (
    input.hasOpenTask &&
    input.lastSignalAt !== null &&
    minutesBetween(input.lastSignalAt, input.now) >= NO_SIGNAL_AFTER_MIN
  ) {
    return 'no_signal';
  }
  if (input.waitingOn !== null) return 'waiting';
  if (input.hasOpenTask) return 'working';
  return 'idle';
}

/**
 * The words under a desk's status chip, from the one vocabulary. An
 * unassigned desk is always "Idle, no assignment" — never "Working".
 */
export function deskStateWord(state: DeskState, assigned: boolean): string {
  if (!assigned) return UNASSIGNED_DESK_WORD;
  return DESK_STATE_WORDS[state];
}
