/**
 * FSRE BUILDING — THE EVENT CONTRACT (mount report §3.3).
 *
 * This is the shape the real export from fsre-skills follows, and the shape
 * live events (milestone M5) will arrive in. The building is a pure function
 * of an ordered list of these: the reducer folds them into every piece of
 * state the screen shows, and nothing else feeds it.
 *
 * The provisional replay file predates the contract in two ways, and
 * data.ts normalises both before an event reaches this type: its payloads
 * carry figures as flat numeric fields (`{ factsLoaded: 10142 }`) rather than
 * under `figures`, and its `escalated` events may carry only a title.
 */

export const FSRE_EVENT_KINDS = [
  'stage_started',
  'stage_completed',
  'stage_returned',
  'stage_blocked',
  'gate_passed',
  'gate_failed',
  'gate_passed_with_escalation',
  'issue_raised',
  'escalated',
  'proposal_logged',
  'approved',
  'published',
] as const;
export type FsreEventKind = (typeof FSRE_EVENT_KINDS)[number];

/** A figure is a bare number or a value out of a total ("209 of 209 rows traced"). */
export type FsreFigure = number | { value: number; of?: number };

export interface FsrePayload {
  /** escalated, issue_raised, proposal_logged */
  title?: string;
  detail?: string;
  /** proposal_logged, e.g. "flag-only" */
  mode?: string;
  /** A note id or change id. On `approved` it names the item being decided. */
  ref?: string;
  severity?: string;
  reason?: string;
  /** Gate and stage figures. */
  figures?: Record<string, FsreFigure>;
}

export interface FsreEvent {
  /** Unique within the run. */
  id: string;
  run: string;
  /** Null for run-level events (proposals that apply between waves). */
  ticker: string | null;
  kind: FsreEventKind;
  /** ISO time as the router recorded it; null only when not recorded. */
  at: string | null;
  /** Router stage id; resolves against the stage data, never a literal. */
  stageId?: string;
  /** The skill that ran the stage or raised the item. */
  skill?: string;
  payload?: FsrePayload;
  /** Repository path (or note) the event was read from. */
  source?: string;
}

export type GateEventKind = 'gate_passed' | 'gate_failed' | 'gate_passed_with_escalation';

export function isGateEvent(kind: FsreEventKind): kind is GateEventKind {
  return kind === 'gate_passed' || kind === 'gate_failed' || kind === 'gate_passed_with_escalation';
}

export function figureValue(figure: FsreFigure): number {
  return typeof figure === 'number' ? figure : figure.value;
}

export function figureOf(figure: FsreFigure): number | null {
  return typeof figure === 'number' ? null : (figure.of ?? null);
}
