/**
 * CLASSIFICATION — derived on every read, never stored.
 *
 * A count is not an answer. For every failure mode this says WHICH of six
 * classes it is, because the remedy differs per class and applying the wrong
 * remedy is why nine tracked errors in the owner's real history went
 * eight-unfixed with one new one appearing.
 *
 * SESSIONS PER SKILL = COUNT(DISTINCT date) for that skill. Not error rows —
 * two errors on one date are one session — and not os_ielts_results rows, since
 * a skill-only session has no score row at all.
 *
 * THE LOG IS THE FLAG RECORD. If a mode appears in session 1's log it was
 * flagged in session 1; appearing again in session 2 means it survived a
 * flagging. No "was flagged" field is needed — the earlier row is the evidence.
 *
 * Nothing here is persisted. A mode that moves from two sessions to three
 * reclassifies on the next read, which is the whole reason no class is stored:
 * a stale classification is worse than none because it will be trusted.
 */
import type { IeltsError, IeltsErrorSkill } from '../../data/types';
import { findMode, UNCLASSIFIED, type FailureMode } from './taxonomy';

/** Below this many sessions for a skill, nothing about it is classified. */
export const MIN_SESSIONS_TO_CLASSIFY = 3;

export type PatternClass =
  | 'correction-resistant'
  | 'induced'
  | 'unresolved'
  | 'within-session-cluster'
  | 'too-early'
  | 'isolated';

/**
 * Descending in urgency. The view orders by THIS, not by count — count is the
 * input to classification, not the headline.
 */
export const CLASS_ORDER: readonly PatternClass[] = [
  'correction-resistant',
  'induced',
  'unresolved',
  'within-session-cluster',
  'too-early',
  'isolated',
] as const;

export const CLASS_LABEL: Record<PatternClass, string> = {
  'correction-resistant': 'Correction-resistant',
  induced: 'Induced',
  unresolved: 'Unresolved — one flagging',
  'within-session-cluster': 'Within-session cluster',
  'too-early': 'Too early',
  isolated: 'Isolated',
};

export const CLASS_MEANING: Record<PatternClass, string> = {
  'correction-resistant':
    'Flagged at least twice and still recurring. Explanation has demonstrably failed.',
  induced: 'Caused by applying feedback in the wrong place.',
  unresolved: 'Flagged once, recurred once. Genuinely might be a capability gap.',
  'within-session-cluster': 'Concentrated in one piece, not spread across sessions.',
  'too-early': 'Not enough evidence to classify.',
  isolated: 'A one-off slip that did not recur.',
};

export const CLASS_REMEDY: Record<PatternClass, string> = {
  'correction-resistant': 'Not more explanation — a pre-submit check. See the checklist below.',
  induced: 'The feedback was ambiguous or over-generalised. Narrow the rule, do not repeat it.',
  unresolved: 'Learn the rule. Explanation is still worth trying.',
  'within-session-cluster': 'Proofreading or conditions that day — not a knowledge gap.',
  'too-early': 'Nothing yet.',
  isolated: 'Nothing. Do not study it — surfacing it costs attention and buys nothing.',
};

export interface ModePattern {
  readonly skill: IeltsErrorSkill;
  /** The stable identifier, or UNCLASSIFIED. */
  readonly mode: string;
  /** Undefined for UNCLASSIFIED rows, which have no taxonomy entry. */
  readonly definition: FailureMode | undefined;
  readonly criterion: string;
  readonly patternClass: PatternClass;
  readonly occurrences: number;
  readonly sessions: number;
  /** Distinct dates this mode appears on, ascending. */
  readonly dates: readonly string[];
  /** Highest number of occurrences landing on any single date. */
  readonly maxPerDate: number;
  /**
   * True when the first occurrence sits on a row with revision_of set and the
   * mode is absent from that earlier date. Kept as a flag as well as a class so
   * a mode that is BOTH induced and correction-resistant still says so — the
   * class reports the more urgent fact, the flag keeps the cause.
   */
  readonly causedByFeedback: boolean;
  /** Why 'too-early' was chosen — the sentence naming what is missing. */
  readonly tooEarlyReason?: string;
  readonly rows: readonly IeltsError[];
}

export interface SkillPatterns {
  readonly skill: IeltsErrorSkill;
  readonly sessions: number;
  readonly sessionDates: readonly string[];
  readonly patterns: readonly ModePattern[];
  /** Present only when at least one row of this skill carries a question_type. */
  readonly byQuestionType: readonly { type: string; occurrences: number }[];
}

const ascending = (a: string, b: string) => a.localeCompare(b);

function distinctDates(rows: readonly IeltsError[]): string[] {
  return [...new Set(rows.map((row) => row.date))].sort(ascending);
}

/**
 * One pattern per (skill, mode). UNCLASSIFIED rows are excluded: they are not a
 * mode, they are a proposal, and counting them as one pattern would merge
 * unrelated errors into a single fictitious count. They surface separately —
 * see pendingProposals.
 */
function classifyMode(
  skill: IeltsErrorSkill,
  mode: string,
  rows: readonly IeltsError[],
  skillSessionDates: readonly string[],
  allSkillRows: readonly IeltsError[],
): ModePattern {
  const dates = distinctDates(rows);
  const perDate = new Map<string, number>();
  for (const row of rows) perDate.set(row.date, (perDate.get(row.date) ?? 0) + 1);
  const maxPerDate = Math.max(...perDate.values());

  // Induced: the FIRST occurrence sits on a rewrite, and the mode is absent
  // from the piece being rewritten. Absent from that earlier date — not merely
  // absent from the rewrite — because the point is that the mode did not exist
  // until the feedback was applied.
  const firstDate = dates[0];
  const firstRows = rows.filter((row) => row.date === firstDate);
  const revisionSource = firstRows.find((row) => row.revisionOf)?.revisionOf;
  const causedByFeedback = Boolean(
    revisionSource &&
      !allSkillRows.some((row) => row.date === revisionSource && row.failureMode === mode),
  );

  const base = {
    skill,
    mode,
    definition: findMode(skill, mode),
    criterion: rows[0].criterion,
    occurrences: rows.length,
    sessions: dates.length,
    dates,
    maxPerDate,
    causedByFeedback,
    rows,
  };

  if (skillSessionDates.length < MIN_SESSIONS_TO_CLASSIFY) {
    return {
      ...base,
      patternClass: 'too-early',
      tooEarlyReason: `${skillSessionDates.length} ${skillSessionDates.length === 1 ? 'session' : 'sessions'} logged; classification needs ${MIN_SESSIONS_TO_CLASSIFY}`,
    };
  }

  // Precedence is the urgency order. A mode can satisfy more than one
  // condition — induced AND correction-resistant, cluster AND isolated — and
  // the more urgent, more specific fact is the one that decides the remedy.
  if (dates.length >= 3) return { ...base, patternClass: 'correction-resistant' };
  if (causedByFeedback) return { ...base, patternClass: 'induced' };
  if (dates.length === 2) return { ...base, patternClass: 'unresolved' };

  // One session from here down.
  if (maxPerDate >= 4) return { ...base, patternClass: 'within-session-cluster' };

  const laterCleanSessions = skillSessionDates.filter((date) => date > firstDate).length;
  if (laterCleanSessions >= 2) return { ...base, patternClass: 'isolated' };

  // Seen once, too recently for "did not recur" to mean anything yet. Calling
  // this isolated would dismiss a mode that has not had the chance to return —
  // the same not-enough-evidence answer as too-early, at mode level.
  return {
    ...base,
    patternClass: 'too-early',
    tooEarlyReason: `seen in 1 session with only ${laterCleanSessions} ${laterCleanSessions === 1 ? 'session' : 'sessions'} after it; isolated needs 2`,
  };
}

export function patternsForSkill(
  skill: IeltsErrorSkill,
  allErrors: readonly IeltsError[],
): SkillPatterns {
  const rows = allErrors.filter((error) => error.skill === skill);
  const sessionDates = distinctDates(rows);

  const byMode = new Map<string, IeltsError[]>();
  for (const row of rows) {
    if (row.failureMode === UNCLASSIFIED) continue;
    const bucket = byMode.get(row.failureMode);
    if (bucket) bucket.push(row);
    else byMode.set(row.failureMode, [row]);
  }

  const patterns = [...byMode.entries()]
    .map(([mode, modeRows]) => classifyMode(skill, mode, modeRows, sessionDates, rows))
    .sort((a, b) => {
      const byClass =
        CLASS_ORDER.indexOf(a.patternClass) - CLASS_ORDER.indexOf(b.patternClass);
      if (byClass !== 0) return byClass;
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return a.mode.localeCompare(b.mode);
    });

  // Only build the question_type breakdown when a row actually carries one, so
  // the section never renders as an empty axis.
  const typeCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.questionType) continue;
    typeCounts.set(row.questionType, (typeCounts.get(row.questionType) ?? 0) + 1);
  }
  const byQuestionType = [...typeCounts.entries()]
    .map(([type, occurrences]) => ({ type, occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences || a.type.localeCompare(b.type));

  return { skill, sessions: sessionDates.length, sessionDates, patterns, byQuestionType };
}

/** Honest at any M. Never a percentage, never a rate. */
export function occurrenceLabel(occurrences: number, sessions: number): string {
  return `${occurrences} ${occurrences === 1 ? 'occurrence' : 'occurrences'} across ${sessions} ${sessions === 1 ? 'session' : 'sessions'}`;
}

export interface PendingProposal {
  /** The proposed name, first-seen spelling. */
  readonly name: string;
  readonly definition: string;
  /**
   * How many times this same name has been proposed. THE SIGNAL — the same
   * principle that governs the whole feature applies to the taxonomy itself:
   * one occurrence is an observation, repetition makes a pattern. A name
   * proposed three times has earned a place in taxonomy.ts; proposed once, it
   * has not.
   */
  readonly count: number;
  readonly rows: readonly IeltsError[];
}

/**
 * UNCLASSIFIED rows, grouped by the name proposed in the note.
 *
 * Names are grouped case-insensitively and whitespace-normalised: a model that
 * writes `Overview_Missing` on one run and `overview_missing` on the next has
 * proposed the same thing twice, and splitting that into two counts of one
 * would hide exactly the repetition this exists to detect.
 *
 * Rows whose note carries no proposal are grouped under a single unnamed entry
 * rather than dropped — an UNCLASSIFIED row with nothing to promote is still a
 * gap in the taxonomy, and dropping it is how it dies silently.
 */
export function pendingProposals(
  allErrors: readonly IeltsError[],
  parseProposal: (note: string | undefined) => { name: string; definition: string } | null,
): PendingProposal[] {
  const groups = new Map<string, { name: string; definition: string; rows: IeltsError[] }>();
  for (const row of allErrors) {
    if (row.failureMode !== UNCLASSIFIED) continue;
    const proposal = parseProposal(row.note);
    const name = proposal?.name ?? '(no name proposed)';
    const key = name.toLowerCase().replace(/\s+/g, '_');
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      if (!existing.definition && proposal?.definition) existing.definition = proposal.definition;
    } else {
      groups.set(key, { name, definition: proposal?.definition ?? '', rows: [row] });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      name: group.name,
      definition: group.definition,
      count: group.rows.length,
      rows: group.rows.sort((a, b) => ascending(a.date, b.date)),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * THE PRE-SUBMIT CHECKLIST — every correction-resistant mode, ordered by
 * occurrence count, as one copyable block to sit beside the draft.
 *
 * Correction-resistant only. When a mode has been flagged twice and still
 * recurs, the owner already knows the rule; what fails is catching it in his
 * own text. So the line is a string to FIND, not a rule to remember.
 *
 * Returns an empty array when nothing qualifies — the section does not render.
 */
export interface ChecklistLine {
  readonly skill: IeltsErrorSkill;
  readonly mode: string;
  readonly check: string;
  readonly occurrences: number;
  readonly sessions: number;
}

export function preSubmitChecklist(
  skillPatterns: readonly SkillPatterns[],
): ChecklistLine[] {
  return skillPatterns
    .flatMap((group) => group.patterns)
    .filter((pattern) => pattern.patternClass === 'correction-resistant' && pattern.definition)
    .map((pattern) => ({
      skill: pattern.skill,
      mode: pattern.mode,
      check: pattern.definition!.check,
      occurrences: pattern.occurrences,
      sessions: pattern.sessions,
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.mode.localeCompare(b.mode));
}

export function checklistText(lines: readonly ChecklistLine[]): string {
  return lines
    .map((line) => `[ ] ${line.check}  (${line.mode}, ${occurrenceLabel(line.occurrences, line.sessions)})`)
    .join('\n');
}
