/**
 * CLASSIFICATION — derived on every read, never stored.
 *
 * A count is not an answer. For every failure mode this says WHICH of six
 * classes it is, because the remedy differs per class and applying the wrong
 * remedy is why nine tracked errors in the owner's real history went
 * eight-unfixed with one new one appearing.
 *
 * SESSIONS PER SKILL COME FROM os_ielts_sessions — never from distinct error
 * dates. That was the spec's own bug: a clean session produced no error row,
 * no date, and no session, so `isolated` (a slip that did NOT recur across
 * clean sessions — the strongest evidence something stopped happening) was
 * unreachable, and the denominator understated practice. Two session rows on
 * one date for one skill still count once: the distinct DATE is the session
 * identity on read.
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
import { findMode, IELTS_ERROR_TAXONOMY, UNCLASSIFIED, type FailureMode } from './taxonomy';

/** Below this many sessions for a skill, nothing about it is classified. */
export const MIN_SESSIONS_TO_CLASSIFY = 3;

/**
 * The slice of IeltsSession classification reads. Structural rather than the
 * full row so tests and previews can pass lightweight fixtures.
 */
export interface SessionLike {
  readonly date: string;
  readonly skill: IeltsErrorSkill;
  /** Session-level: the date of the piece this session rewrites. */
  readonly revisionOf?: string;
}

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
   * True when the first occurrence sits in a session that rewrites an EARLIER
   * piece and the mode is absent from that earlier date. Kept as a flag as
   * well as a class so a mode that is BOTH induced and correction-resistant
   * still says so — the class reports the more urgent fact, the flag keeps
   * the cause.
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
  revisionByDate: ReadonlyMap<string, string>,
  allSkillRows: readonly IeltsError[],
): ModePattern {
  const dates = distinctDates(rows);
  const perDate = new Map<string, number>();
  for (const row of rows) perDate.set(row.date, (perDate.get(row.date) ?? 0) + 1);
  const maxPerDate = Math.max(...perDate.values());

  // Induced: the FIRST occurrence sits in a session that rewrites an earlier
  // piece, and the mode is absent from the piece being rewritten. Three checks,
  // each load-bearing: the session (not some rows in it) is the rewrite, since
  // revision_of is a session property; the source must be strictly EARLIER
  // than the first occurrence, because "rewrites a later piece" is a data
  // error, not evidence, and a wrong `induced` is worse than none; and the
  // mode must be absent from that earlier date — the point is that it did not
  // exist until the feedback was applied.
  const firstDate = dates[0];
  const revisionSource = revisionByDate.get(firstDate);
  const causedByFeedback = Boolean(
    revisionSource &&
      revisionSource < firstDate &&
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

  // Sessions AFTER the mode's one appearance, clean of it by construction —
  // if a later session carried the mode, dates.length would be 2 and this
  // branch unreachable. Clean sessions with zero errors count here too, which
  // is what makes `isolated` reachable at all.
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
  allSessions: readonly SessionLike[],
): SkillPatterns {
  const rows = allErrors.filter((error) => error.skill === skill);

  // THE ONE DEFINITION OF A SESSION COUNT. Distinct dates in the sessions
  // table for this skill — never distinct error dates, which miss clean
  // sessions. Do not add a second derivation anywhere.
  const skillSessions = allSessions.filter((session) => session.skill === skill);
  const sessionDates = [...new Set(skillSessions.map((session) => session.date))].sort(ascending);

  // Session-level rewrite mapping for the induced check. Two rows on one date
  // (two pieces in one evening) with different revision_of: the first with a
  // value wins — a same-date tie carries no better signal either way.
  const revisionByDate = new Map<string, string>();
  for (const session of skillSessions) {
    if (session.revisionOf && !revisionByDate.has(session.date)) {
      revisionByDate.set(session.date, session.revisionOf);
    }
  }

  const byMode = new Map<string, IeltsError[]>();
  for (const row of rows) {
    if (row.failureMode === UNCLASSIFIED) continue;
    const bucket = byMode.get(row.failureMode);
    if (bucket) bucket.push(row);
    else byMode.set(row.failureMode, [row]);
  }

  const patterns = [...byMode.entries()]
    .map(([mode, modeRows]) =>
      classifyMode(skill, mode, modeRows, sessionDates, revisionByDate, rows),
    )
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
 * occurrence count, GROUPED PER SKILL: a Task 1 draft is checked against
 * Task 1 items, not against listening items. One flat unlabelled block was
 * the earlier shape and it made every check cost a mental "is this even my
 * skill?" — the grouping is the fix.
 *
 * Correction-resistant only. When a mode has been flagged twice and still
 * recurs, the owner already knows the rule; what fails is catching it in his
 * own text. So the line is a string to FIND, not a rule to remember.
 *
 * Returns an empty array when nothing qualifies — the section does not render.
 * Skills with no qualifying mode are omitted, never rendered empty.
 */
export interface ChecklistLine {
  readonly skill: IeltsErrorSkill;
  readonly mode: string;
  readonly check: string;
  readonly occurrences: number;
  readonly sessions: number;
}

export interface SkillChecklist {
  readonly skill: IeltsErrorSkill;
  readonly label: string;
  readonly lines: readonly ChecklistLine[];
}

export function preSubmitChecklist(
  skillPatterns: readonly SkillPatterns[],
): SkillChecklist[] {
  return skillPatterns
    .map((group) => ({
      skill: group.skill,
      label: IELTS_ERROR_TAXONOMY[group.skill].label,
      lines: group.patterns
        .filter((pattern) => pattern.patternClass === 'correction-resistant' && pattern.definition)
        .map((pattern) => ({
          skill: pattern.skill,
          mode: pattern.mode,
          check: pattern.definition!.check,
          occurrences: pattern.occurrences,
          sessions: pattern.sessions,
        }))
        .sort((a, b) => b.occurrences - a.occurrences || a.mode.localeCompare(b.mode)),
    }))
    .filter((group) => group.lines.length > 0);
}

/** One skill's block — copied beside the draft of THAT skill. */
export function checklistText(lines: readonly ChecklistLine[]): string {
  return lines
    .map((line) => `[ ] ${line.check}  (${line.mode}, ${occurrenceLabel(line.occurrences, line.sessions)})`)
    .join('\n');
}
