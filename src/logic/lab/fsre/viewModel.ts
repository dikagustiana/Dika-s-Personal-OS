/**
 * FSRE BUILDING — WHAT THE PANELS SAY. PURE, NO REACT.
 *
 * The words and counts the header, metrics, notes, panels and controls put
 * on screen, built from the reducer's state and the run. Components render
 * these and add nothing: no arithmetic, no number literals, no word of
 * their own for a state (rule 2, rule 5), and every number already through
 * formatNumber (rule 7).
 */
import type { FsreRun } from './data';
import type { FsreEvent } from './events';
import { formatCount, formatNumber, formatOf } from './format';
import { GATE_GLYPHS, GATE_TONES, PROVISIONAL_GLYPH, type Tone } from './glyphs';
import { FALLBACK_DESK_KEY, FLOOR_LABELS, type DeskKey, type FloorPlan } from './layout';
import {
  gateBreakdown,
  partnerItems,
  type CompanyState,
  type FsreContext,
  type FsreState,
  type RunTotals,
  type StateCache,
} from './reducer';
import { EVENT_KIND_WORDS, FILE_WORDS, GATE_RESULTS, GATE_RESULT_WORDS, GATE_SEVERITY, figureLabel, type GateResult } from './statuses';

/* ---------- stepping ---------- */

export interface Step {
  before: FsreState;
  after: FsreState;
  /** The event the cursor last applied, or null at the start. */
  event: FsreEvent | null;
}

/** The states either side of the last applied event — what motion compares. */
export function stepAt(cache: StateCache, events: readonly FsreEvent[], cursor: number): Step {
  const target = Math.max(0, Math.min(cursor, events.length));
  if (target === 0) {
    const state = cache.stateAt(events, 0);
    return { before: state, after: state, event: null };
  }
  const before = cache.stateAt(events, target - 1);
  const after = cache.stateAt(events, target);
  return { before, after, event: events[target - 1] };
}

export function hasApplied(cursor: number): boolean {
  return cursor > 0;
}

export function replayProgress(cursor: number, total: number): string {
  return `${formatCount(cursor, 'event')} of ${formatCount(total, 'event')} applied`;
}

/* ---------- notes ---------- */

export interface Note {
  key: string;
  glyph: string | null;
  text: string;
}

/**
 * What the note bar says: what this screen is, which input file is
 * provisional (by name, with its own stated source), and — only when the
 * run says so — that times were not recorded.
 */
export function runNotes(run: FsreRun, kind: 'replay' | 'live'): Note[] {
  const notes: Note[] = [
    {
      key: 'what',
      glyph: null,
      text:
        kind === 'replay'
          ? 'Replay of a recorded run. Nothing is running now; the building moves only when an event is applied.'
          : 'Live run. The building moves only when the pipeline writes an event.',
    },
  ];
  for (const file of run.provenance) {
    if (!file.provisional) continue;
    const what = `${FILE_WORDS[file.file]} (${file.fileName})`;
    notes.push({
      key: `provisional:${file.file}`,
      glyph: PROVISIONAL_GLYPH,
      text: file.stated
        ? `Provisional: ${what}. ${file.source ?? 'The file gives no source.'}`
        : `${what} does not say whether it is provisional, so it is treated as provisional. ${file.source ?? 'The file gives no source.'}`,
    });
  }
  if (!run.timesRecorded) {
    notes.push({ key: 'times', glyph: null, text: 'Times were not recorded in this run: the replay shows the order of events, not their timing.' });
  }
  if (run.timesNote) {
    notes.push({ key: 'times-note', glyph: null, text: run.timesNote });
  }
  return notes;
}

/* ---------- metrics ---------- */

export interface GatePart {
  result: GateResult;
  glyph: string;
  tone: Tone;
  text: string;
}

/** "✕ 1 failed · ✓ 7 passed · ○ 2 pending", worst first, results with no company left out. */
export function gateParts(state: FsreState, stageId: string): GatePart[] {
  const counts = gateBreakdown(state, stageId);
  return [...GATE_RESULTS]
    .sort((a, b) => GATE_SEVERITY[b] - GATE_SEVERITY[a])
    .filter((result) => counts[result] > 0)
    .map((result) => ({
      result,
      glyph: GATE_GLYPHS[result],
      tone: GATE_TONES[result],
      text: `${formatNumber(counts[result])} ${GATE_RESULT_WORDS[result].toLowerCase()}`,
    }));
}

/** Tie-out checks summed across companies, or null when no company reported any. */
export function tieOutSummary(totals: RunTotals): string | null {
  const checks = totals.figures.tieOutChecks;
  if (!checks) return null;
  const parts = (['passed', 'failed', 'skipped'] as const)
    .filter((key) => totals.figures[key])
    .map((key) => `${formatNumber(totals.figures[key].value)} ${figureLabel(key).toLowerCase()}`);
  return `${formatCount(checks.value, 'check')}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

export function figureTotalText(totals: RunTotals, key: string): string | null {
  const total = totals.figures[key];
  if (!total) return null;
  return total.of === null ? formatNumber(total.value) : formatOf(total.value, total.of);
}

export function countText(value: number, singular: string, plural?: string): string {
  return formatCount(value, singular, plural);
}

export function numberText(value: number): string {
  return formatNumber(value);
}

/* ---------- places ---------- */

/** A desk in words: whose desk, or which gate room. */
export function deskLabel(plan: FloorPlan, key: DeskKey): string {
  if (key === FALLBACK_DESK_KEY) return 'the lobby bench';
  const desk = plan.desks[key];
  if (!desk) return 'the lobby bench';
  if (desk.kind === 'gate' && desk.stageId) return `the ${plan.stagesById[desk.stageId]?.name ?? desk.stageId} room`;
  if (desk.kind === 'partner') return 'the partner desk';
  return `${desk.skill}'s desk, ${FLOOR_LABELS[desk.floorId]}`;
}

export function stageName(plan: FloorPlan, stageId: string | null | undefined): string | null {
  if (!stageId) return null;
  return plan.stagesById[stageId]?.name ?? stageId;
}

/* ---------- histories ---------- */

export interface EventLine {
  index: number;
  id: string;
  kind: string;
  where: string;
  detail: string | null;
}

export function describeEvent(ctx: FsreContext, event: FsreEvent, index: number): EventLine {
  const parts = [event.ticker ?? 'Run', stageName(ctx.plan, event.stageId)].filter(Boolean);
  return {
    index,
    id: event.id,
    kind: EVENT_KIND_WORDS[event.kind],
    where: parts.join(' · '),
    detail: event.payload?.title ?? event.payload?.reason ?? null,
  };
}

/** The newest `limit` lines, newest first, and how many earlier ones are not listed. */
export function recentLines(ctx: FsreContext, events: readonly FsreEvent[], indexes: number[], limit: number): { lines: EventLine[]; earlier: number; total: number } {
  const recent = indexes.slice(-limit).reverse();
  return { lines: recent.map((i) => describeEvent(ctx, events[i], i)), earlier: Math.max(0, indexes.length - recent.length), total: indexes.length };
}

/** Where a company's events were read from, distinct, in order. */
export function eventSources(events: readonly FsreEvent[], cursor: number, ticker: string): string[] {
  const sources: string[] = [];
  for (const event of events.slice(0, cursor)) {
    if (event.ticker === ticker && event.source && !sources.includes(event.source)) sources.push(event.source);
  }
  return sources;
}

/** Words for a gate's results on record, in order: "Failed, then passed". */
export function gateHistoryText(results: Array<{ result: Exclude<GateResult, 'pending'> }>): string {
  return results.map((r, i) => (i === 0 ? GATE_RESULT_WORDS[r.result] : GATE_RESULT_WORDS[r.result].toLowerCase())).join(', then ');
}

export function hasMany<T>(list: readonly T[]): boolean {
  return list.length > 1;
}

/** The open partner items, for the notification badge. */
export function openItemCount(state: FsreState): number {
  return partnerItems(state).filter((item) => item.state === 'open').length;
}

/** Companies with their open-escalation count, for the approval list. */
export function companiesInOrder(state: FsreState): CompanyState[] {
  return state.companyOrder.map((ticker) => state.companies[ticker]);
}
