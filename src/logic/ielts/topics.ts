/**
 * THE IELTS PREP TAXONOMY — the repo's copy of what os_ielts_topic holds.
 *
 * Two axes, because the failure mode differs by skill:
 *
 *   - Listening and reading fail at QUESTION TYPE. "6 misses in 10 matching-
 *     headings questions" is a ratio that means something, and the fix is a
 *     technique for that one question type.
 *   - Writing and speaking fail at BAND CRITERION. Tagging an essay "opinion
 *     question" diagnoses nothing; tagging it "coherence and cohesion" names
 *     the thing to practise. Task types are kept as context, not as the tag
 *     that carries the diagnosis.
 *
 * WHY THIS LIST EXISTS TWICE (here and in the seed migration). The database
 * is the source of truth at runtime — the weakness view reads os_ielts_topic,
 * not this file. But topicContent.test.ts runs in CI with no database, and
 * the parity it has to prove is slug ↔ MDX FILE. So the test needs a
 * database-free list of slugs, which is this. The two are kept honest by a
 * live query, not by hope; see REVIEW.md for the check.
 *
 * `slug` is also the path under content/ielts/. reading/matching-headings is
 * content/ielts/reading/matching-headings.mdx. That equality is the entire
 * integration: a weakness row knows its slug, therefore it knows its page.
 */

export const IELTS_PREP_SKILLS = ['listening', 'reading', 'writing', 'speaking'] as const;
export type IeltsPrepSkill = (typeof IELTS_PREP_SKILLS)[number];

/**
 * `overview` is reference-only. It exists because the Notion study sheets are
 * written PER SKILL, so prose that is general to a skill belongs to no
 * question type — it needs somewhere to live that is not a lie about being
 * about matching headings. Overview topics are never offered as a weakness
 * tag, which is what `isTaggable` below enforces.
 */
export type IeltsTopicKind = 'question_type' | 'task_type' | 'criterion' | 'overview';

export interface IeltsTopic {
  slug: string;
  skill: IeltsPrepSkill;
  kind: IeltsTopicKind;
  label: string;
  sortOrder: number;
  /**
   * FALSE where the MDX page records a gap rather than a method — the Notion
   * study sheets are written per skill and name most question types without
   * explaining any of them, so 30 of these 45 pages are honest stubs.
   *
   * It is a declared field and not a runtime scan of the file, because the
   * only reliable scan (`import.meta.glob` with `?raw`) is intercepted by the
   * MDX plugin, which hands back a compiled component instead of text. It is
   * kept truthful by topicContent.test.ts, which reads the files and fails if
   * any flag disagrees with what is actually on the page.
   *
   * The weakness view surfaces this BEFORE the click: arriving at "no method
   * captured" from the top-ranked row is worse when it is a surprise.
   */
  hasMethod: boolean;
}

/**
 * How a topic is measured. Listening and reading questions are countable, so
 * a weakness is missed/attempted. Writing and speaking are not — "wrong on 4
 * of 11 coherence questions" is not a sentence — so they carry a 1..3
 * severity instead. This follows the SKILL, not the kind: a writing task type
 * is as uncountable as a writing criterion.
 */
export function measurementFor(skill: IeltsPrepSkill): 'count' | 'severity' {
  return skill === 'listening' || skill === 'reading' ? 'count' : 'severity';
}

/** Overview pages are reference material, never a diagnosis. */
export function isTaggable(topic: IeltsTopic): boolean {
  return topic.kind !== 'overview';
}

export const IELTS_TOPICS: readonly IeltsTopic[] = [
  { slug: 'listening/overview', skill: 'listening', kind: 'overview', label: 'Listening Overview', sortOrder: 0, hasMethod: true },
  { slug: 'reading/overview', skill: 'reading', kind: 'overview', label: 'Reading Overview', sortOrder: 0, hasMethod: true },
  { slug: 'writing/overview', skill: 'writing', kind: 'overview', label: 'Writing Overview', sortOrder: 0, hasMethod: true },
  { slug: 'speaking/overview', skill: 'speaking', kind: 'overview', label: 'Speaking Overview', sortOrder: 0, hasMethod: true },

  { slug: 'listening/form-note-table-completion', skill: 'listening', kind: 'question_type', label: 'Form, Note & Table Completion', sortOrder: 10, hasMethod: false },
  { slug: 'listening/multiple-choice', skill: 'listening', kind: 'question_type', label: 'Multiple Choice', sortOrder: 20, hasMethod: false },
  { slug: 'listening/matching', skill: 'listening', kind: 'question_type', label: 'Matching', sortOrder: 30, hasMethod: false },
  { slug: 'listening/plan-map-diagram-labelling', skill: 'listening', kind: 'question_type', label: 'Plan, Map & Diagram Labelling', sortOrder: 40, hasMethod: false },
  { slug: 'listening/sentence-completion', skill: 'listening', kind: 'question_type', label: 'Sentence Completion', sortOrder: 50, hasMethod: false },
  { slug: 'listening/short-answer', skill: 'listening', kind: 'question_type', label: 'Short Answer', sortOrder: 60, hasMethod: false },

  { slug: 'reading/matching-headings', skill: 'reading', kind: 'question_type', label: 'Matching Headings', sortOrder: 10, hasMethod: false },
  { slug: 'reading/matching-information', skill: 'reading', kind: 'question_type', label: 'Matching Information', sortOrder: 20, hasMethod: false },
  { slug: 'reading/matching-features', skill: 'reading', kind: 'question_type', label: 'Matching Features', sortOrder: 30, hasMethod: false },
  { slug: 'reading/matching-sentence-endings', skill: 'reading', kind: 'question_type', label: 'Matching Sentence Endings', sortOrder: 40, hasMethod: false },
  { slug: 'reading/true-false-notgiven', skill: 'reading', kind: 'question_type', label: 'True / False / Not Given', sortOrder: 50, hasMethod: false },
  { slug: 'reading/yes-no-notgiven', skill: 'reading', kind: 'question_type', label: 'Yes / No / Not Given', sortOrder: 60, hasMethod: false },
  { slug: 'reading/sentence-completion', skill: 'reading', kind: 'question_type', label: 'Sentence Completion', sortOrder: 70, hasMethod: false },
  { slug: 'reading/summary-completion', skill: 'reading', kind: 'question_type', label: 'Summary Completion', sortOrder: 80, hasMethod: false },
  { slug: 'reading/note-table-flowchart-completion', skill: 'reading', kind: 'question_type', label: 'Note, Table & Flow-chart Completion', sortOrder: 90, hasMethod: false },
  { slug: 'reading/diagram-label-completion', skill: 'reading', kind: 'question_type', label: 'Diagram Label Completion', sortOrder: 100, hasMethod: false },
  { slug: 'reading/multiple-choice', skill: 'reading', kind: 'question_type', label: 'Multiple Choice', sortOrder: 110, hasMethod: false },
  { slug: 'reading/short-answer', skill: 'reading', kind: 'question_type', label: 'Short Answer', sortOrder: 120, hasMethod: false },

  { slug: 'writing/task1-line-graph', skill: 'writing', kind: 'task_type', label: 'Task 1: Line Graph', sortOrder: 10, hasMethod: false },
  { slug: 'writing/task1-bar-chart', skill: 'writing', kind: 'task_type', label: 'Task 1: Bar Chart', sortOrder: 20, hasMethod: false },
  { slug: 'writing/task1-pie-chart', skill: 'writing', kind: 'task_type', label: 'Task 1: Pie Chart', sortOrder: 30, hasMethod: false },
  { slug: 'writing/task1-table', skill: 'writing', kind: 'task_type', label: 'Task 1: Table', sortOrder: 40, hasMethod: false },
  { slug: 'writing/task1-process-diagram', skill: 'writing', kind: 'task_type', label: 'Task 1: Process Diagram', sortOrder: 50, hasMethod: false },
  { slug: 'writing/task1-map', skill: 'writing', kind: 'task_type', label: 'Task 1: Map', sortOrder: 60, hasMethod: false },
  { slug: 'writing/task1-mixed', skill: 'writing', kind: 'task_type', label: 'Task 1: Mixed Charts', sortOrder: 70, hasMethod: false },
  { slug: 'writing/task2-opinion', skill: 'writing', kind: 'task_type', label: 'Task 2: Opinion', sortOrder: 80, hasMethod: false },
  { slug: 'writing/task2-discussion', skill: 'writing', kind: 'task_type', label: 'Task 2: Discussion', sortOrder: 90, hasMethod: false },
  { slug: 'writing/task2-advantages-disadvantages', skill: 'writing', kind: 'task_type', label: 'Task 2: Advantages & Disadvantages', sortOrder: 100, hasMethod: false },
  { slug: 'writing/task2-problem-solution', skill: 'writing', kind: 'task_type', label: 'Task 2: Problem & Solution', sortOrder: 110, hasMethod: false },
  { slug: 'writing/task2-two-part', skill: 'writing', kind: 'task_type', label: 'Task 2: Two-part Question', sortOrder: 120, hasMethod: false },

  { slug: 'speaking/part1-interview', skill: 'speaking', kind: 'task_type', label: 'Part 1: Interview', sortOrder: 10, hasMethod: true },
  { slug: 'speaking/part2-long-turn', skill: 'speaking', kind: 'task_type', label: 'Part 2: Long Turn', sortOrder: 20, hasMethod: true },
  { slug: 'speaking/part3-discussion', skill: 'speaking', kind: 'task_type', label: 'Part 3: Discussion', sortOrder: 30, hasMethod: true },

  { slug: 'writing/criterion-task-response', skill: 'writing', kind: 'criterion', label: 'Task Response', sortOrder: 200, hasMethod: true },
  { slug: 'writing/criterion-coherence-cohesion', skill: 'writing', kind: 'criterion', label: 'Coherence & Cohesion', sortOrder: 210, hasMethod: true },
  { slug: 'writing/criterion-lexical-resource', skill: 'writing', kind: 'criterion', label: 'Lexical Resource', sortOrder: 220, hasMethod: true },
  { slug: 'writing/criterion-grammatical-range', skill: 'writing', kind: 'criterion', label: 'Grammatical Range & Accuracy', sortOrder: 230, hasMethod: true },

  { slug: 'speaking/criterion-fluency-coherence', skill: 'speaking', kind: 'criterion', label: 'Fluency & Coherence', sortOrder: 200, hasMethod: true },
  { slug: 'speaking/criterion-lexical-resource', skill: 'speaking', kind: 'criterion', label: 'Lexical Resource', sortOrder: 210, hasMethod: true },
  { slug: 'speaking/criterion-grammatical-range', skill: 'speaking', kind: 'criterion', label: 'Grammatical Range & Accuracy', sortOrder: 220, hasMethod: true },
  { slug: 'speaking/criterion-pronunciation', skill: 'speaking', kind: 'criterion', label: 'Pronunciation', sortOrder: 230, hasMethod: true },
];

const BY_SLUG = new Map(IELTS_TOPICS.map((topic) => [topic.slug, topic]));

export function topicBySlug(slug: string): IeltsTopic | undefined {
  return BY_SLUG.get(slug);
}

/** Reading order within a skill: overview, then question/task types, then criteria. */
export function topicsForSkill(skill: IeltsPrepSkill): IeltsTopic[] {
  return IELTS_TOPICS.filter((topic) => topic.skill === skill).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );
}
