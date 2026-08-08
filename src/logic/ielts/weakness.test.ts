import { describe, expect, it } from 'vitest';
import type { IeltsError, IeltsPractice, IeltsPracticeTopic, IeltsTopic } from '../../data/types';
import {
  aggregateWeakness,
  bindingConstraint,
  daysUntil,
  deriveWeaknessFromErrors,
  loggedThisWeek,
  missRate,
  skillStandings,
} from './weakness';

const topic = (slug: string, label: string, skill: IeltsTopic['skill']): IeltsTopic => ({
  slug,
  skill,
  kind: skill === 'reading' || skill === 'listening' ? 'question_type' : 'criterion',
  label,
  sortOrder: 10,
  hasMethod: true,
});

const TOPICS: IeltsTopic[] = [
  topic('reading/matching-headings', 'Matching Headings', 'reading'),
  topic('reading/true-false-notgiven', 'True / False / Not Given', 'reading'),
  topic('reading/short-answer', 'Short Answer', 'reading'),
  topic('writing/criterion-coherence-cohesion', 'Coherence & Cohesion', 'writing'),
];

const practice = (id: string, over: Partial<IeltsPractice> = {}): IeltsPractice => ({
  id,
  skill: 'reading',
  source: 'Cambridge 18 Test 2',
  attemptedOn: '2026-08-01',
  timed: true,
  createdAt: '2026-08-01T00:00:00Z',
  ...over,
});

describe('aggregateWeakness', () => {
  it('sums attempted and missed for one topic across several attempts', () => {
    const practices = [practice('p1'), practice('p2', { attemptedOn: '2026-08-03' })];
    const tags: IeltsPracticeTopic[] = [
      { practiceId: 'p1', topicSlug: 'reading/matching-headings', attempted: 6, missed: 4 },
      { practiceId: 'p2', topicSlug: 'reading/matching-headings', attempted: 4, missed: 2 },
    ];
    const [row] = aggregateWeakness(TOPICS, practices, tags);
    expect(row.attempted).toBe(10);
    expect(row.missed).toBe(6);
    expect(row.sessions).toBe(2);
    expect(missRate(row)).toBeCloseTo(0.6);
  });

  it('carries the slug that addresses the method page', () => {
    // The whole integration in one assertion: the row knows its own content
    // path, because the slug IS the path under content/ielts/.
    const [row] = aggregateWeakness(
      TOPICS,
      [practice('p1')],
      [{ practiceId: 'p1', topicSlug: 'reading/matching-headings', attempted: 10, missed: 6 }],
    );
    expect(row.topic.slug).toBe('reading/matching-headings');
  });

  it('does NOT let a single unlucky question outrank a real pattern', () => {
    // The defect this ranking exists to avoid: 1-of-1 is a 100% miss rate and
    // would top a raw-rate sort, sending him to practise a non-problem.
    const practices = [practice('p1')];
    const tags: IeltsPracticeTopic[] = [
      { practiceId: 'p1', topicSlug: 'reading/short-answer', attempted: 1, missed: 1 },
      { practiceId: 'p1', topicSlug: 'reading/matching-headings', attempted: 10, missed: 6 },
    ];
    const ranked = aggregateWeakness(TOPICS, practices, tags);
    expect(ranked.map((row) => row.topic.slug)).toEqual([
      'reading/matching-headings',
      'reading/short-answer',
    ]);
  });

  it('still ranks a small but total failure above a large partial one', () => {
    const tags: IeltsPracticeTopic[] = [
      { practiceId: 'p1', topicSlug: 'reading/short-answer', attempted: 3, missed: 3 },
      { practiceId: 'p1', topicSlug: 'reading/matching-headings', attempted: 10, missed: 6 },
    ];
    const ranked = aggregateWeakness(TOPICS, [practice('p1')], tags);
    expect(ranked[0].topic.slug).toBe('reading/short-answer');
  });

  it('ranks a clean topic last', () => {
    const tags: IeltsPracticeTopic[] = [
      { practiceId: 'p1', topicSlug: 'reading/true-false-notgiven', attempted: 10, missed: 0 },
      { practiceId: 'p1', topicSlug: 'reading/matching-headings', attempted: 10, missed: 6 },
    ];
    const ranked = aggregateWeakness(TOPICS, [practice('p1')], tags);
    expect(ranked[ranked.length - 1].topic.slug).toBe('reading/true-false-notgiven');
  });

  it('aggregates severity for the skills where counting is meaningless', () => {
    const practices = [
      practice('w1', { skill: 'writing', attemptedOn: '2026-08-01' }),
      practice('w2', { skill: 'writing', attemptedOn: '2026-08-05' }),
    ];
    const tags: IeltsPracticeTopic[] = [
      { practiceId: 'w1', topicSlug: 'writing/criterion-coherence-cohesion', severity: 3 },
      { practiceId: 'w2', topicSlug: 'writing/criterion-coherence-cohesion', severity: 2 },
    ];
    const [row] = aggregateWeakness(TOPICS, practices, tags);
    expect(row.measurement).toBe('severity');
    expect(row.timesTagged).toBe(2);
    expect(row.meanSeverity).toBeCloseTo(2.5);
    expect(missRate(row)).toBeNull();
  });

  it('ignores tags whose practice row is absent', () => {
    // A deleted attempt's tags must not keep counting against the topic.
    const rows = aggregateWeakness(TOPICS, [], [
      { practiceId: 'gone', topicSlug: 'reading/matching-headings', attempted: 10, missed: 10 },
    ]);
    expect(rows).toEqual([]);
  });

  it('ignores tags for slugs outside the taxonomy', () => {
    const rows = aggregateWeakness(TOPICS, [practice('p1')], [
      { practiceId: 'p1', topicSlug: 'reading/invented-type', attempted: 5, missed: 5 },
    ]);
    expect(rows).toEqual([]);
  });
});

describe('skillStandings and bindingConstraint', () => {
  const practices: IeltsPractice[] = [
    practice('l1', { skill: 'listening', band: 7.5, attemptedOn: '2026-08-01' }),
    practice('r1', { skill: 'reading', band: 7, attemptedOn: '2026-08-02' }),
    practice('w1', { skill: 'writing', band: 5.5, attemptedOn: '2026-08-03' }),
    // An older, better writing score must NOT win over the recent worse one.
    practice('w0', { skill: 'writing', band: 8, attemptedOn: '2026-07-01' }),
  ];

  it('takes the most recent band per skill', () => {
    const writing = skillStandings(practices, 6.5).find((s) => s.skill === 'writing');
    expect(writing?.latestBand).toBe(5.5);
    expect(writing?.attemptedOn).toBe('2026-08-03');
  });

  it('names the skill furthest below the floor, not the average', () => {
    // Mean of 7.5, 7 and 5.5 is 6.67 — above a 6.5 floor. The average says
    // fine; the binding constraint says writing, and writing is what fails.
    const constraint = bindingConstraint(skillStandings(practices, 6.5));
    expect(constraint?.skill).toBe('writing');
    expect(constraint?.gapToFloor).toBeCloseTo(-1);
  });

  it('reports an unmeasured skill as unknown rather than as passing', () => {
    const speaking = skillStandings(practices, 6.5).find((s) => s.skill === 'speaking');
    expect(speaking?.latestBand).toBeNull();
    expect(speaking?.gapToFloor).toBeNull();
  });

  it('has no binding constraint when every measured skill clears the floor', () => {
    expect(bindingConstraint(skillStandings(practices, 5))).toBeNull();
  });
});

describe('daysUntil', () => {
  it('counts whole days to the test date', () => {
    expect(daysUntil('2026-09-20', new Date(2026, 7, 8))).toBe(43);
  });

  it('is zero on the day and negative after it', () => {
    expect(daysUntil('2026-09-20', new Date(2026, 8, 20))).toBe(0);
    expect(daysUntil('2026-09-20', new Date(2026, 8, 21))).toBe(-1);
  });
});

describe('loggedThisWeek', () => {
  it('counts the rolling 7 days including today, and excludes the 8th', () => {
    const today = new Date(2026, 7, 8); // 2026-08-08
    const practices = [
      practice('a', { attemptedOn: '2026-08-08' }),
      practice('b', { attemptedOn: '2026-08-02' }), // 6 days back — inside
      practice('c', { attemptedOn: '2026-08-01' }), // 7 days back — outside
    ];
    expect(loggedThisWeek(practices, today)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The error-log provenance
// ---------------------------------------------------------------------------

const errorRow = (over: Partial<IeltsError> = {}): IeltsError => ({
  id: 'e0',
  date: '2026-08-01',
  skill: 'writing_task1',
  criterion: 'Grammatical Range & Accuracy',
  failureMode: 'broken_clause',
  quote: 'The chart show the number.',
  createdAt: '2026-08-01T00:00:00Z',
  ...over,
});

const BRIDGE_TOPICS: IeltsTopic[] = [
  ...TOPICS,
  topic('writing/criterion-grammatical-range', 'Grammatical Range & Accuracy', 'writing'),
  topic('writing/criterion-task-response', 'Task Response', 'writing'),
];

describe('deriveWeaknessFromErrors', () => {
  it('groups occurrences by topic and counts distinct dates as sessions', () => {
    const { evidence } = deriveWeaknessFromErrors([
      errorRow({ id: '1' }),
      errorRow({ id: '2', failureMode: 'function_word_slip' }),
      errorRow({ id: '3', date: '2026-08-05', failureMode: 'tense_drift' }),
    ]);
    expect(evidence).toEqual([
      {
        topicSlug: 'writing/criterion-grammatical-range',
        occurrences: 3,
        errorSessions: 2,
        modes: ['broken_clause', 'function_word_slip', 'tense_drift'],
      },
    ]);
  });

  it('merges function_word_slip from both writing tasks into one topic', () => {
    // The merge decision, asserted end to end rather than only in the map.
    const { evidence, mappedErrors } = deriveWeaknessFromErrors([
      errorRow({ id: '1', skill: 'writing_task1', failureMode: 'function_word_slip' }),
      errorRow({ id: '2', skill: 'writing_task2', failureMode: 'function_word_slip' }),
    ]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].occurrences).toBe(2);
    expect(mappedErrors).toBe(2);
  });

  it('accounts for every row that did not map, by reason', () => {
    // Nothing disappears quietly — an unmapped row is a fact about the
    // taxonomy or the alias table, and this is where it gets stated.
    const { unresolved, totalErrors, mappedErrors } = deriveWeaknessFromErrors([
      errorRow({ id: '1', skill: 'writing_task1', failureMode: 'UNCLASSIFIED' }),
      errorRow({ id: '2', skill: 'reading', criterion: 'timing', failureMode: 'time_ran_out' }),
      errorRow({ id: '3', skill: 'listening', criterion: 'location', failureMode: 'lost_place' }),
      errorRow({ id: '4', skill: 'reading', criterion: 'comprehension', failureMode: 'paraphrase_missed' }),
      errorRow({
        id: '5',
        skill: 'reading',
        criterion: 'location',
        failureMode: 'keyword_trap',
        questionType: 'some invented type',
      }),
      errorRow({ id: '6' }),
    ]);
    expect(totalErrors).toBe(6);
    expect(mappedErrors).toBe(1);
    expect(unresolved).toEqual({
      unclassified: 1,
      unknown_skill: 0,
      unknown_mode: 0,
      mode_unmapped: 2,
      question_type_missing: 1,
      question_type_unknown: 1,
    });
  });

  it('returns an empty result for an empty log rather than throwing', () => {
    expect(deriveWeaknessFromErrors([])).toEqual({
      evidence: [],
      unresolved: {
        unclassified: 0,
        unknown_skill: 0,
        unknown_mode: 0,
        mode_unmapped: 0,
        question_type_missing: 0,
        question_type_unknown: 0,
      },
      totalErrors: 0,
      mappedErrors: 0,
    });
  });
});

describe('aggregateWeakness with error-log evidence', () => {
  it('leaves the hand-tagged list untouched when no errors are supplied', () => {
    // The parameter is optional and defaults to empty, so every pre-existing
    // ranking must be bit-for-bit what it was before the bridge existed.
    const practices = [practice('p1')];
    const tags: IeltsPracticeTopic[] = [
      { practiceId: 'p1', topicSlug: 'reading/matching-headings', attempted: 10, missed: 6 },
    ];
    const [row] = aggregateWeakness(BRIDGE_TOPICS, practices, tags);
    expect(row.provenance).toBe('tagged');
    expect(row.occurrences).toBe(0);
    expect(row.concern).toBeCloseTo(7 / 14);
  });

  it('NEVER gives a derived row an attempted or a missed', () => {
    // THE CONSTRAINT: os_ielts_errors has no denominator. Inventing one puts a
    // fabricated ratio on screen that looks exactly like a measured one.
    const { evidence } = deriveWeaknessFromErrors([errorRow({ id: '1' }), errorRow({ id: '2' })]);
    const [row] = aggregateWeakness(BRIDGE_TOPICS, [], [], evidence);
    expect(row.attempted).toBe(0);
    expect(row.missed).toBe(0);
    expect(row.measurement).toBe('severity');
    expect(missRate(row)).toBeNull();
    expect(row.provenance).toBe('derived');
    expect(row.occurrences).toBe(2);
  });

  it('reads recurrence per session as the severity, and shrinks small samples', () => {
    // One occurrence in one session is the floor; three in one session is the
    // ceiling. Same estimator as the rated path, occurrences standing in.
    const once = aggregateWeakness(
      BRIDGE_TOPICS,
      [],
      [],
      deriveWeaknessFromErrors([errorRow({ id: '1' })]).evidence,
    );
    expect(once[0].concern).toBeCloseTo(3 / 3 / 3); // 0.333

    const thrice = aggregateWeakness(
      BRIDGE_TOPICS,
      [],
      [],
      deriveWeaknessFromErrors([
        errorRow({ id: '1' }),
        errorRow({ id: '2', failureMode: 'tense_drift' }),
        errorRow({ id: '3', failureMode: 'function_word_slip' }),
      ]).evidence,
    );
    expect(thrice[0].concern).toBeCloseTo(5 / 3 / 3); // 0.556
  });

  it('clamps a dense session so it cannot normalise above 1', () => {
    // Twenty occurrences in one session is 22/3 = 7.33 unclamped, which is
    // 2.44 after dividing by the ceiling — it would outrank every other row by
    // an unbounded margin and break the shared 0..1 scale.
    const evidence = deriveWeaknessFromErrors(
      Array.from({ length: 20 }, (_, i) => errorRow({ id: String(i) })),
    ).evidence;
    const [row] = aggregateWeakness(BRIDGE_TOPICS, [], [], evidence);
    expect(row.occurrences).toBe(20);
    expect(row.concern).toBe(1);
    expect(row.concern).toBeLessThanOrEqual(1);
  });

  it('takes the max of the two provenances, never a sum', () => {
    // A blend of two scales with no common unit is the fabrication this file
    // exists to avoid. Max is a rule: rank by the most alarming evidence.
    const practices = [practice('p1', { skill: 'writing' })];
    const tags: IeltsPracticeTopic[] = [
      { practiceId: 'p1', topicSlug: 'writing/criterion-grammatical-range', severity: 1 },
    ];
    const evidence = deriveWeaknessFromErrors([
      errorRow({ id: '1' }),
      errorRow({ id: '2', failureMode: 'tense_drift' }),
      errorRow({ id: '3', failureMode: 'function_word_slip' }),
    ]).evidence;

    const [row] = aggregateWeakness(BRIDGE_TOPICS, practices, tags, evidence);
    expect(row.provenance).toBe('both');
    expect(row.timesTagged).toBe(1);
    expect(row.meanSeverity).toBe(1);
    expect(row.occurrences).toBe(3);
    // tagged  = (1 + 2) / (1 + 2) / 3           = 0.333
    // derived = (3 + 2) / (1 + 2) / 3           = 0.556   <- three occurrences, one date
    expect(row.concern).toBeCloseTo(5 / 3 / 3);
    // A sum would be 0.889; max must not be a sum.
    expect(row.concern).toBeLessThan(0.6);
  });

  it('keeps practice sessions and error sessions as separate numbers', () => {
    // One counts practice attempts, the other counts marking pastes. A single
    // number covering both would mean two different things at once.
    const practices = [practice('p1', { skill: 'writing' })];
    const tags: IeltsPracticeTopic[] = [
      { practiceId: 'p1', topicSlug: 'writing/criterion-grammatical-range', severity: 2 },
    ];
    const evidence = deriveWeaknessFromErrors([
      errorRow({ id: '1', date: '2026-08-01' }),
      errorRow({ id: '2', date: '2026-08-04' }),
    ]).evidence;
    const [row] = aggregateWeakness(BRIDGE_TOPICS, practices, tags, evidence);
    expect(row.sessions).toBe(1);
    expect(row.errorSessions).toBe(2);
  });

  it('drops derived evidence for a slug the topic table does not hold', () => {
    // Same guard the hand tags already use: a row that cannot be attributed to
    // a real page is skipped rather than counted against nothing.
    const evidence = deriveWeaknessFromErrors([errorRow({ id: '1' })]).evidence;
    expect(aggregateWeakness(TOPICS, [], [], evidence)).toEqual([]);
  });

  it('breaks a concern tie toward the row with more occurrences behind it', () => {
    // Without occurrences in the tiebreaker, twelve would tie with one and
    // fall through to an alphabetical order that reads as a ranking.
    const evidence = [
      { topicSlug: 'writing/criterion-grammatical-range', occurrences: 4, errorSessions: 4, modes: ['broken_clause'] },
      { topicSlug: 'writing/criterion-task-response', occurrences: 1, errorSessions: 1, modes: ['coverage_gap'] },
    ];
    const ranked = aggregateWeakness(BRIDGE_TOPICS, [], [], evidence);
    expect(ranked.map((row) => row.topic.slug)).toEqual([
      'writing/criterion-grammatical-range',
      'writing/criterion-task-response',
    ]);
  });
});
