/**
 * ONE PERSON'S TRAIL, ASSEMBLED FROM FOUR TABLES THAT WERE NEVER DESIGNED
 * TOGETHER.
 *
 * The sources disagree about almost everything — one is keyed by a uuid with a
 * foreign key, one by a uuid without, one by TEXT with no key at all, and one
 * is not a change log but an event log. Merging them is therefore a decision
 * about MEANING, not a map, and it lives here rather than in the component so
 * it can be tested without a DOM.
 *
 * ===========================================================================
 * WHAT COUNTS AS ACTIVITY, AND THE LINE THAT DOES NOT MOVE.
 * ===========================================================================
 * Two things: CHANGES TO ARTEFACTS, and MOMENTS OF ENTRY. That is an audit
 * trail, which is ordinary internal control for a system that carries finance
 * work — the question it answers is "what was done to the numbers, and by
 * whom".
 *
 * It is NOT a record of what anyone looked at. There is no view, no click, no
 * page, no dwell time, no navigation, and no session length anywhere in this
 * module or in the tables behind it. That absence is the feature. Adding any
 * of them turns a control into monitoring of a person, which is a different
 * thing with a different justification, and it has not been asked for.
 *
 * ===========================================================================
 * ATTRIBUTION: actor IS THE FILTER, AND THE OWNER IS DELIBERATELY UNMATCHABLE.
 * ===========================================================================
 * Every history row carries `actorKind` ('owner' | 'contributor') and `actor`
 * (a uuid, or NULL). The owner authenticates with an app-key header and has no
 * auth.users row, so an owner-written row has a kind and no id — and therefore
 * matches no collaborator, which is exactly right. Selecting a person's trail
 * is `actor === userId` and nothing more; there is no fallback that could
 * quietly attribute an owner edit to whoever is on screen.
 *
 * ===========================================================================
 * AN UNRESOLVABLE REFERENCE IS SHOWN, NOT HIDDEN.
 * ===========================================================================
 * os_process_text_history.row_id is text with NO foreign key — one log across
 * five tables whose keys are not even the same type. Translating it into a
 * readable label is a per-table join, and some rows will not translate: a row
 * deleted since, a table this view was not given a lookup for, an id from a
 * future table. Those rows still appear, carrying their raw `table_name` and
 * `row_id`, flagged `unresolved`.
 *
 * Dropping them would be the worse failure by a distance. An audit trail that
 * silently omits the entries it could not pretty-print is not incomplete, it
 * is misleading — it reads as "this person did nine things" when they did ten.
 */

import type {
  CellHistoryEntry,
  FinishLineCell,
  FinishLineItem,
  ProcessGate,
  ProcessLane,
  ProcessNeed,
  ProcessPhase,
  ProcessStep,
  ProcessTextHistoryEntry,
  ProjectTask,
  SignInEvent,
  TaskHistoryEntry,
} from '../data/types';

/** Which source a line came from. Drives the label and the grouping, not the order. */
export type ActivityKind = 'sign-in' | 'cell' | 'task' | 'text';

export interface ActivityEvent {
  /** Stable within one build, so React keys do not collide across sources. */
  id: string;
  kind: ActivityKind;
  /** ISO instant. The ONE axis every source shares, and the only sort key. */
  at: string;
  /** What was touched, resolved to something readable where possible. */
  subject: string;
  /** What happened to it. Empty for a sign-in, which has no object. */
  detail: string;
  /** The subject could not be resolved; `subject` is the raw reference. */
  unresolved: boolean;
  /**
   * The row predates migration 20260809000069 and carries no actor at all.
   * Only reachable for process-text rows, and only before that migration.
   */
  unattributed: boolean;
}

/**
 * The label lookups, passed in rather than fetched here so this module stays
 * pure. Every one is optional in effect: a missing entry yields a raw
 * reference, never a dropped row.
 */
export interface ActivityLabels {
  /** cellId -> "Row label · ENTITY" */
  cells: Map<string, string>;
  /** taskId -> task title */
  tasks: Map<string, string>;
  /** `${table_name}:${row_id}` -> readable label */
  processRows: Map<string, string>;
}

export interface ActivitySources {
  signIns: SignInEvent[];
  cellHistory: CellHistoryEntry[];
  taskHistory: TaskHistoryEntry[];
  textHistory: ProcessTextHistoryEntry[];
}

/**
 * cellId -> "Rincian biaya gudang · SAMB".
 *
 * Both halves matter and neither is sufficient: the same Finish line row
 * exists across seven entities, and three row labels are duplicated across
 * sections, so "which cell" is only answered by the pair.
 */
export function buildCellLabels(
  cells: FinishLineCell[],
  items: FinishLineItem[],
): Map<string, string> {
  const itemLabel = new Map(items.map((item) => [item.id, item.item]));
  const labels = new Map<string, string>();
  for (const cell of cells) {
    const row = itemLabel.get(cell.itemId);
    if (!row) continue; // No label to give; the event falls back to its raw id.
    labels.set(cell.id, `${row} · ${cell.entityCode}`);
  }
  return labels;
}

export function buildTaskLabels(tasks: ProjectTask[]): Map<string, string> {
  return new Map(tasks.map((task) => [task.id, task.title]));
}

/**
 * The polymorphic index, keyed `${table_name}:${row_id}` to match how
 * os_process_text_history addresses a row.
 *
 * Lanes are keyed by the PAIR (entity_code, key) rather than a single column,
 * so their row_id is whatever the write path recorded; both the bare key and
 * the composite are registered, because getting a lane label wrong is silent
 * and registering twice costs nothing.
 */
export function buildProcessRowLabels(sources: {
  steps: ProcessStep[];
  needs: ProcessNeed[];
  gates: ProcessGate[];
  lanes: ProcessLane[];
  phases: ProcessPhase[];
}): Map<string, string> {
  const labels = new Map<string, string>();
  for (const step of sources.steps) {
    labels.set(`os_process_steps:${step.id}`, `${step.label} ${step.name} · ${step.entityCode}`);
  }
  for (const need of sources.needs) {
    labels.set(`os_process_needs:${need.id}`, need.item);
  }
  for (const gate of sources.gates) {
    labels.set(`os_process_gates:${gate.id}`, `${gate.id} ${gate.title}`);
  }
  for (const lane of sources.lanes) {
    labels.set(`os_process_lanes:${lane.key}`, `${lane.label} · ${lane.entityCode}`);
    labels.set(
      `os_process_lanes:${lane.entityCode}/${lane.key}`,
      `${lane.label} · ${lane.entityCode}`,
    );
  }
  for (const phase of sources.phases) {
    labels.set(`os_process_phases:${phase.id}`, `${phase.name} · ${phase.entityCode}`);
  }
  return labels;
}

/** `input → figure`, or `catatan diubah` when only the note moved. */
function describeCellChange(row: CellHistoryEntry): string {
  const moved = row.fromState !== row.toState;
  const transition = `${row.fromState ?? '—'} → ${row.toState ?? '—'}`;
  if (moved && row.noteChanged) return `${transition}, catatan diubah`;
  if (moved) return transition;
  return 'catatan diubah';
}

/** Empty strings are how os_task_history spells "was absent". */
function describeValue(value: string): string {
  return value.length === 0 ? '—' : value;
}

/**
 * Everything one person did, newest first.
 *
 * SORTED ON `at` ALONE. The four sources have no other shared axis, and any
 * tie-break on kind would impose an order on events that happened in the same
 * second — which is a claim about sequence that the data does not support.
 */
export function buildCollaboratorActivity(
  userId: string,
  sources: ActivitySources,
  labels: ActivityLabels,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const row of sources.signIns) {
    if (row.userId !== userId) continue;
    // No subject and no detail: a sign-in has no object, and the kind label
    // already says what it is. Repeating "Masuk" in both columns would be one
    // more thing to read for zero information.
    events.push({
      id: `sign-in:${row.userId}:${row.signedInAt}`,
      kind: 'sign-in',
      at: row.signedInAt,
      subject: '',
      detail: '',
      unresolved: false,
      unattributed: false,
    });
  }

  for (const row of sources.cellHistory) {
    if (row.actor !== userId) continue;
    const label = labels.cells.get(row.cellId);
    events.push({
      id: `cell:${row.id}`,
      kind: 'cell',
      at: row.changedAt,
      subject: label ?? `sel ${row.cellId}`,
      detail: describeCellChange(row),
      unresolved: !label,
      unattributed: false,
    });
  }

  for (const row of sources.taskHistory) {
    if (row.actor !== userId) continue;
    const label = labels.tasks.get(row.taskId);
    events.push({
      id: `task:${row.id}`,
      kind: 'task',
      at: row.changedAt,
      subject: label ?? `task ${row.taskId}`,
      detail: `${row.field}: ${describeValue(row.fromValue)} → ${describeValue(row.toValue)}`,
      unresolved: !label,
      unattributed: false,
    });
  }

  for (const row of sources.textHistory) {
    // A pre-69 row has NO actor and so belongs to nobody in particular. It is
    // excluded from a named person's trail rather than guessed at — the flag
    // exists so the surface can say how many were left out, not so this
    // function can assign them.
    if (row.actor !== userId) continue;
    const label = labels.processRows.get(`${row.tableName}:${row.rowId}`);
    events.push({
      id: `text:${row.id}`,
      kind: 'text',
      at: row.changedAt,
      subject: label ?? `${row.tableName} · ${row.rowId}`,
      detail: row.field,
      unresolved: !label,
      unattributed: row.actorKind === null,
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * How many text-history rows exist that no person can be named for, because
 * migration 20260809000069 had not run when they were written.
 *
 * Surfaced as a count rather than folded into a trail: these edits are real
 * and they happened, and a screen claiming a complete trail while silently
 * holding some back would be making a stronger claim than the data supports.
 */
export function countUnattributedTextEdits(rows: ProcessTextHistoryEntry[]): number {
  return rows.filter((row) => row.actorKind === null).length;
}
