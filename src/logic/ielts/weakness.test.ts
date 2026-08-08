import { describe, expect, it } from 'vitest';
import type { IeltsPractice, IeltsPracticeTopic, IeltsTopic } from '../../data/types';
import {
  aggregateWeakness,
  bindingConstraint,
  daysUntil,
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
