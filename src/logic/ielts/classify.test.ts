import { describe, expect, it } from 'vitest';
import type { IeltsError, IeltsErrorSkill } from '../../data/types';
import {
  checklistText,
  occurrenceLabel,
  patternsForSkill,
  pendingProposals,
  preSubmitChecklist,
  type PatternClass,
  type SessionLike,
} from './classify';
import { parseProposal } from './taxonomy';

let counter = 0;

/** Quotes here are placeholders — nothing real is stored in the repo. */
function err(
  date: string,
  mode: string,
  overrides: Partial<IeltsError> = {},
): IeltsError {
  counter += 1;
  return {
    id: `e${counter}`,
    date,
    skill: 'writing_task1',
    criterion: 'Grammatical Range & Accuracy',
    failureMode: mode,
    quote: `quote ${counter}`,
    createdAt: `2026-07-20T00:00:0${counter % 10}.000Z`,
    ...overrides,
  };
}

function ses(
  date: string,
  overrides: Partial<SessionLike> & { skill?: IeltsErrorSkill } = {},
): SessionLike {
  return { date, skill: 'writing_task1', ...overrides };
}

/**
 * One session per distinct (date, skill) in the rows — the shape the app
 * produces, since committing a paste writes the session as a side effect.
 * Tests that need CLEAN sessions (the whole point of the table) add them
 * explicitly on top.
 */
function sessionsFor(rows: readonly IeltsError[]): SessionLike[] {
  const seen = new Map<string, SessionLike>();
  for (const row of rows) {
    seen.set(`${row.date} ${row.skill}`, { date: row.date, skill: row.skill });
  }
  return [...seen.values()];
}

const classOf = (
  rows: IeltsError[],
  mode: string,
  sessions: SessionLike[] = sessionsFor(rows),
  skill: IeltsErrorSkill = 'writing_task1',
) =>
  patternsForSkill(skill, rows, sessions).patterns.find((pattern) => pattern.mode === mode)
    ?.patternClass as PatternClass;

describe('sessions come from the sessions table, never from error dates', () => {
  it('counts a clean session — one with zero error rows — in the denominator', () => {
    const rows = [err('2026-07-01', 'tense_drift')];
    const sessions = [ses('2026-07-01'), ses('2026-07-08'), ses('2026-07-15')];
    expect(patternsForSkill('writing_task1', rows, sessions).sessions).toBe(3);
  });

  it('counts two errors on one date as one session', () => {
    const rows = [err('2026-07-01', 'tense_drift'), err('2026-07-01', 'broken_clause')];
    expect(patternsForSkill('writing_task1', rows, sessionsFor(rows)).sessions).toBe(1);
  });

  it('counts two session rows on one date once — the distinct date is the identity', () => {
    const sessions = [ses('2026-07-01'), ses('2026-07-01')];
    expect(patternsForSkill('writing_task1', [], sessions).sessions).toBe(1);
  });

  it("ignores sessions of other skills when counting a skill's sessions", () => {
    const sessions = [ses('2026-07-01'), ses('2026-07-02', { skill: 'reading' })];
    expect(patternsForSkill('writing_task1', [], sessions).sessions).toBe(1);
    expect(patternsForSkill('reading', [], sessions).sessions).toBe(1);
  });

  it('reaches isolated purely through clean sessions — the class the old counting made unreachable', () => {
    const rows = [err('2026-07-01', 'trend_expression_error', { criterion: 'Lexical Resource' })];
    // Two later sessions, both clean — no error rows at all. Under
    // COUNT(DISTINCT date) over errors these sessions did not exist and the
    // mode could never be dismissed.
    const sessions = [ses('2026-07-01'), ses('2026-07-08'), ses('2026-07-15')];
    expect(classOf(rows, 'trend_expression_error', sessions)).toBe('isolated');
  });
});

describe('the six classes', () => {
  it('too early — fewer than 3 sessions for that skill, nothing is classified', () => {
    const rows = [
      err('2026-07-01', 'tense_drift'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-08', 'broken_clause'),
    ];
    const group = patternsForSkill('writing_task1', rows, sessionsFor(rows));
    expect(group.sessions).toBe(2);
    for (const pattern of group.patterns) {
      expect(pattern.patternClass).toBe('too-early');
    }
    expect(group.patterns[0].tooEarlyReason).toContain('needs 3');
  });

  it('isolated — 1 session, with 2 later sessions of that skill clean of it', () => {
    const rows = [
      err('2026-07-01', 'trend_expression_error', { criterion: 'Lexical Resource' }),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'tense_drift'),
    ];
    expect(classOf(rows, 'trend_expression_error')).toBe('isolated');
  });

  it('unresolved — exactly 2 sessions', () => {
    const rows = [
      err('2026-07-01', 'tense_drift'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'broken_clause'),
    ];
    expect(classOf(rows, 'tense_drift')).toBe('unresolved');
  });

  it('correction-resistant — 3 or more sessions', () => {
    const rows = [
      err('2026-07-01', 'tense_drift'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'tense_drift'),
    ];
    expect(classOf(rows, 'tense_drift')).toBe('correction-resistant');
  });

  it('induced — first occurrence is in a rewrite session, and absent from the piece rewritten', () => {
    const rows = [
      // The earlier piece: a different mode, so function_word_slip did not
      // exist until the feedback on it was applied.
      err('2026-07-01', 'tense_drift'),
      err('2026-07-08', 'function_word_slip'),
      err('2026-07-15', 'broken_clause'),
    ];
    // revision_of is a SESSION property: the 07-08 session rewrites 07-01.
    const sessions = [
      ses('2026-07-01'),
      ses('2026-07-08', { revisionOf: '2026-07-01' }),
      ses('2026-07-15'),
    ];
    const pattern = patternsForSkill('writing_task1', rows, sessions).patterns.find(
      (candidate) => candidate.mode === 'function_word_slip',
    );
    expect(pattern?.patternClass).toBe('induced');
    expect(pattern?.causedByFeedback).toBe(true);
  });

  it('is NOT induced when the mode was already present in the piece being rewritten', () => {
    const rows = [
      err('2026-07-01', 'function_word_slip'),
      err('2026-07-08', 'function_word_slip'),
      err('2026-07-15', 'broken_clause'),
    ];
    const sessions = [
      ses('2026-07-01'),
      ses('2026-07-08', { revisionOf: '2026-07-01' }),
      ses('2026-07-15'),
    ];
    const pattern = patternsForSkill('writing_task1', rows, sessions).patterns.find(
      (candidate) => candidate.mode === 'function_word_slip',
    );
    // Recurred in a rewrite of the same piece: feedback not applied, which is
    // unresolved — a different problem with a different fix.
    expect(pattern?.causedByFeedback).toBe(false);
    expect(pattern?.patternClass).toBe('unresolved');
  });

  it('is NOT induced when the claimed rewrite source is not earlier than the session', () => {
    const rows = [
      err('2026-07-01', 'function_word_slip'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'broken_clause'),
    ];
    // A session cannot rewrite a LATER piece; that is a data error, not
    // evidence, and a wrong `induced` is worse than none.
    const sessions = [
      ses('2026-07-01', { revisionOf: '2026-07-08' }),
      ses('2026-07-08'),
      ses('2026-07-15'),
    ];
    const pattern = patternsForSkill('writing_task1', rows, sessions).patterns.find(
      (candidate) => candidate.mode === 'function_word_slip',
    );
    expect(pattern?.causedByFeedback).toBe(false);
    expect(pattern?.patternClass).not.toBe('induced');
  });

  it('is NOT induced when the session claims to rewrite itself', () => {
    const rows = [err('2026-07-08', 'function_word_slip')];
    const sessions = [
      ses('2026-07-01'),
      ses('2026-07-08', { revisionOf: '2026-07-08' }),
      ses('2026-07-15'),
    ];
    const pattern = patternsForSkill('writing_task1', rows, sessions).patterns.find(
      (candidate) => candidate.mode === 'function_word_slip',
    );
    expect(pattern?.causedByFeedback).toBe(false);
  });

  it('within-session cluster — 4+ on one date, appearing in only 1 session', () => {
    const rows = [
      err('2026-07-01', 'broken_clause'),
      err('2026-07-01', 'broken_clause'),
      err('2026-07-01', 'broken_clause'),
      err('2026-07-01', 'broken_clause'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'tense_drift'),
    ];
    expect(classOf(rows, 'broken_clause')).toBe('within-session-cluster');
  });
});

describe('precedence between overlapping classes', () => {
  it('reports correction-resistant over induced, and keeps the cause as a flag', () => {
    const rows = [
      err('2026-07-01', 'tense_drift'),
      err('2026-07-08', 'function_word_slip'),
      err('2026-07-15', 'function_word_slip'),
      err('2026-07-22', 'function_word_slip'),
    ];
    const sessions = [
      ses('2026-07-01'),
      ses('2026-07-08', { revisionOf: '2026-07-01' }),
      ses('2026-07-15'),
      ses('2026-07-22'),
    ];
    const pattern = patternsForSkill('writing_task1', rows, sessions).patterns.find(
      (candidate) => candidate.mode === 'function_word_slip',
    );
    expect(pattern?.patternClass).toBe('correction-resistant');
    expect(pattern?.causedByFeedback).toBe(true);
  });

  it('reports a cluster rather than isolated when both fit', () => {
    const rows = [
      err('2026-07-01', 'broken_clause'),
      err('2026-07-01', 'broken_clause'),
      err('2026-07-01', 'broken_clause'),
      err('2026-07-01', 'broken_clause'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'tense_drift'),
    ];
    // Two later clean sessions exist, so isolated also fits; the cluster is the
    // more specific fact and its remedy differs.
    expect(classOf(rows, 'broken_clause')).toBe('within-session-cluster');
  });

  it('does not call a mode isolated before two sessions have passed over it', () => {
    const rows = [
      err('2026-07-01', 'tense_drift'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'broken_clause'),
    ];
    // broken_clause has been seen once, in the most recent session. It has had
    // no chance to recur, so "did not recur" would be a claim about nothing.
    const pattern = patternsForSkill('writing_task1', rows, sessionsFor(rows)).patterns.find(
      (candidate) => candidate.mode === 'broken_clause',
    );
    expect(pattern?.patternClass).toBe('too-early');
    expect(pattern?.tooEarlyReason).toContain('isolated needs 2');
  });
});

describe('nothing is stored — a class is a function of the rows', () => {
  it('reclassifies 2 sessions → 3 on the next read', () => {
    const two = [
      err('2026-07-01', 'tense_drift'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'broken_clause'),
    ];
    expect(classOf(two, 'tense_drift')).toBe('unresolved');
    const three = [...two, err('2026-07-22', 'tense_drift')];
    expect(classOf(three, 'tense_drift')).toBe('correction-resistant');
  });
});

describe('ordering', () => {
  it('orders by class urgency, not by count', () => {
    const rows = [
      // isolated, but the highest count of the three
      err('2026-07-01', 'broken_clause'),
      err('2026-07-01', 'broken_clause'),
      err('2026-07-01', 'broken_clause'),
      // correction-resistant with fewer occurrences
      err('2026-07-01', 'tense_drift'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'tense_drift'),
      err('2026-07-22', 'coverage_gap', { criterion: 'Task Achievement' }),
      err('2026-07-29', 'coverage_gap', { criterion: 'Task Achievement' }),
    ];
    const order = patternsForSkill('writing_task1', rows, sessionsFor(rows)).patterns.map(
      (p) => p.mode,
    );
    expect(order[0]).toBe('tense_drift');
    expect(order.indexOf('coverage_gap')).toBeLessThan(order.indexOf('broken_clause'));
  });
});

describe('honesty', () => {
  it('renders counts as N occurrences across M sessions, at any M', () => {
    expect(occurrenceLabel(1, 1)).toBe('1 occurrence across 1 session');
    expect(occurrenceLabel(6, 4)).toBe('6 occurrences across 4 sessions');
  });
});

describe('question_type grouping', () => {
  it('is empty when no row carries one, so the section never renders', () => {
    const rows = [err('2026-07-01', 'time_ran_out', { skill: 'reading', criterion: 'timing' })];
    expect(patternsForSkill('reading', rows, sessionsFor(rows)).byQuestionType).toEqual([]);
  });

  it('groups and counts where present', () => {
    const rows = [
      err('2026-07-01', 'keyword_trap', {
        skill: 'reading',
        criterion: 'location',
        questionType: 'matching headings',
      }),
      err('2026-07-08', 'keyword_trap', {
        skill: 'reading',
        criterion: 'location',
        questionType: 'matching headings',
      }),
      err('2026-07-08', 'not_given_confusion', {
        skill: 'reading',
        criterion: 'comprehension',
        questionType: 'T/F/NG',
      }),
    ];
    expect(patternsForSkill('reading', rows, sessionsFor(rows)).byQuestionType).toEqual([
      { type: 'matching headings', occurrences: 2 },
      { type: 'T/F/NG', occurrences: 1 },
    ]);
  });
});

describe('pending proposals', () => {
  it('counts the same proposed name across sessions, case-insensitively', () => {
    const rows = [
      err('2026-07-01', 'UNCLASSIFIED', {
        note: 'PROPOSED: hedging_absent — klaim tanpa hedging',
      }),
      err('2026-07-08', 'UNCLASSIFIED', {
        note: 'PROPOSED: Hedging_Absent — klaim tanpa hedging',
      }),
      err('2026-07-15', 'UNCLASSIFIED', { note: 'PROPOSED: register_slip — nada terlalu informal' }),
    ];
    const proposals = pendingProposals(rows, parseProposal);
    expect(proposals[0]).toMatchObject({ name: 'hedging_absent', count: 2 });
    expect(proposals[1]).toMatchObject({ name: 'register_slip', count: 1 });
  });

  it('keeps an UNCLASSIFIED row whose note proposes nothing', () => {
    const rows = [err('2026-07-01', 'UNCLASSIFIED', { note: 'tidak cocok dengan mode apa pun' })];
    expect(pendingProposals(rows, parseProposal)).toHaveLength(1);
  });

  it('excludes UNCLASSIFIED from the pattern counts — it is not one mode', () => {
    const rows = [
      err('2026-07-01', 'UNCLASSIFIED', { note: 'PROPOSED: a — x' }),
      err('2026-07-08', 'UNCLASSIFIED', { note: 'PROPOSED: b — y' }),
      err('2026-07-15', 'UNCLASSIFIED', { note: 'PROPOSED: c — z' }),
    ];
    expect(patternsForSkill('writing_task1', rows, sessionsFor(rows)).patterns).toEqual([]);
  });
});

describe('the pre-submit checklist', () => {
  const rows = [
    err('2026-07-01', 'tense_drift'),
    err('2026-07-08', 'tense_drift'),
    err('2026-07-15', 'tense_drift'),
    err('2026-07-15', 'tense_drift'),
    err('2026-07-01', 'broken_clause'),
    err('2026-07-08', 'broken_clause'),
    err('2026-07-15', 'broken_clause'),
  ];
  const patterns = () => [patternsForSkill('writing_task1', rows, sessionsFor(rows))];

  it('contains only correction-resistant modes', () => {
    const groups = preSubmitChecklist(patterns());
    expect(groups.flatMap((group) => group.lines.map((line) => line.mode))).toEqual([
      'tense_drift',
      'broken_clause',
    ]);
  });

  it('orders by occurrence count within a skill', () => {
    const [group] = preSubmitChecklist(patterns());
    expect(group.lines[0].occurrences).toBeGreaterThan(group.lines[1].occurrences);
  });

  it('groups per skill and never mixes two skills into one block', () => {
    const reading = [
      err('2026-07-01', 'keyword_trap', { skill: 'reading', criterion: 'location' }),
      err('2026-07-08', 'keyword_trap', { skill: 'reading', criterion: 'location' }),
      err('2026-07-15', 'keyword_trap', { skill: 'reading', criterion: 'location' }),
    ];
    const all = [...rows, ...reading];
    const groups = preSubmitChecklist([
      patternsForSkill('writing_task1', all, sessionsFor(all)),
      patternsForSkill('reading', all, sessionsFor(all)),
    ]);
    expect(groups.map((group) => group.skill)).toEqual(['writing_task1', 'reading']);
    // Every line in a block belongs to that block's skill — a Task 1 draft is
    // checked against Task 1 items, not listening items.
    for (const group of groups) {
      expect(group.lines.every((line) => line.skill === group.skill)).toBe(true);
    }
    expect(groups[0].label).toBe('Writing Task 1');
  });

  it('emits the check, never the rule', () => {
    const [group] = preSubmitChecklist(patterns());
    const text = checklistText(group.lines);
    expect(text).toContain('Search the draft for "has", "have", "is" and "are"');
    // The rule for the same mode must not appear: explanation has already
    // failed twice for a correction-resistant mode.
    expect(text).not.toContain('Historical data is Simple Past throughout');
  });

  it('is empty when no mode qualifies, so the section does not render', () => {
    const thin = [
      err('2026-07-01', 'tense_drift'),
      err('2026-07-08', 'tense_drift'),
      err('2026-07-15', 'broken_clause'),
    ];
    expect(preSubmitChecklist([patternsForSkill('writing_task1', thin, sessionsFor(thin))])).toEqual(
      [],
    );
  });

  it('never emits a line for UNCLASSIFIED, which has no check to run', () => {
    const unclassified = [
      err('2026-07-01', 'UNCLASSIFIED', { note: 'PROPOSED: x — y' }),
      err('2026-07-08', 'UNCLASSIFIED', { note: 'PROPOSED: x — y' }),
      err('2026-07-15', 'UNCLASSIFIED', { note: 'PROPOSED: x — y' }),
    ];
    expect(
      preSubmitChecklist([
        patternsForSkill('writing_task1', unclassified, sessionsFor(unclassified)),
      ]),
    ).toEqual([]);
  });
});

describe('empty input', () => {
  it('returns nothing to render for a skill with zero rows and zero sessions', () => {
    const group = patternsForSkill('speaking', [], []);
    expect(group).toMatchObject({ sessions: 0, patterns: [], byQuestionType: [] });
    expect(preSubmitChecklist([group])).toEqual([]);
    expect(pendingProposals([], parseProposal)).toEqual([]);
  });
});
