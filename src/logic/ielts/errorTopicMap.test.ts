import { describe, expect, it } from 'vitest';
import {
  MODE_TOPIC_MAP,
  QUESTION_TYPE_ALIASES,
  allMappedModes,
  allTargetSlugs,
  normaliseQuestionType,
  questionTypeLookup,
  resolveTopicSlug,
} from './errorTopicMap';
import { IELTS_ERROR_SKILLS, IELTS_ERROR_TAXONOMY, UNCLASSIFIED } from './taxonomy';
import { IELTS_TOPICS, isTaggable, topicBySlug } from './topics';

/**
 * THE TEST THIS BRIDGE EXISTS FOR is the first one: a taxonomy mode that is
 * neither mapped nor explicitly declared unmapped. The type system already
 * catches it — ModeTargets<S> is keyed by ModeNameOf<S>, so a new mode breaks
 * the build — but a type check is only as good as the absence of an `as` cast,
 * and this map is exactly the kind of object someone quietens with one. This
 * asserts the same thing at runtime, where a cast cannot hide it.
 *
 * Silent omission is the failure the whole mapping exists to fix. It gets its
 * own test rather than being a clause inside another one.
 */

describe('every taxonomy mode is accounted for', () => {
  it('maps or explicitly unmaps every (skill, mode) pair — never omits one', () => {
    const missing: string[] = [];
    for (const skill of IELTS_ERROR_SKILLS) {
      const targets = MODE_TOPIC_MAP[skill] as Record<string, unknown>;
      for (const mode of IELTS_ERROR_TAXONOMY[skill].modes) {
        if (!Object.prototype.hasOwnProperty.call(targets, mode.mode)) {
          missing.push(`${skill}/${mode.mode}`);
        }
      }
    }
    expect(missing, 'taxonomy modes with no entry in MODE_TOPIC_MAP').toEqual([]);
  });

  it('holds no entry for a mode the taxonomy does not have', () => {
    const stray: string[] = [];
    for (const skill of IELTS_ERROR_SKILLS) {
      const known = new Set<string>(IELTS_ERROR_TAXONOMY[skill].modes.map((mode) => mode.mode));
      for (const mode of Object.keys(MODE_TOPIC_MAP[skill])) {
        if (!known.has(mode)) stray.push(`${skill}/${mode}`);
      }
    }
    expect(stray, 'MODE_TOPIC_MAP entries with no taxonomy mode').toEqual([]);
  });

  it('covers all 28 pairs — 7 / 6 / 5 / 5 / 5', () => {
    expect(allMappedModes()).toHaveLength(28);
    expect(Object.keys(MODE_TOPIC_MAP.writing_task1)).toHaveLength(7);
    expect(Object.keys(MODE_TOPIC_MAP.writing_task2)).toHaveLength(6);
    expect(Object.keys(MODE_TOPIC_MAP.speaking)).toHaveLength(5);
    expect(Object.keys(MODE_TOPIC_MAP.listening)).toHaveLength(5);
    expect(Object.keys(MODE_TOPIC_MAP.reading)).toHaveLength(5);
  });

  it('gives every entry a stated reason — an unmapped mode is a decision, not a gap', () => {
    for (const { skill, mode, target } of allMappedModes()) {
      expect(target.why.length, `${skill}/${mode} has no rationale`).toBeGreaterThan(30);
    }
  });
});

describe('targets are real, reachable pages', () => {
  it('names only slugs that exist in the topic taxonomy', () => {
    const unknown = allTargetSlugs().filter((slug) => topicBySlug(slug) === undefined);
    expect(unknown, 'mapping targets with no row in IELTS_TOPICS').toEqual([]);
  });

  it('never targets an overview page', () => {
    // isTaggable() forbids it: an overview is reference prose, not a
    // diagnosis. The two modes whose remedy genuinely lives on one are
    // unmapped instead, which is the honest outcome.
    const untaggable = allTargetSlugs()
      .map((slug) => topicBySlug(slug))
      .filter((topic) => topic !== undefined && !isTaggable(topic));
    expect(untaggable, 'mapping targets an overview page').toEqual([]);
  });

  it('never targets a task_type slug from writing or speaking', () => {
    // THE ONE RULE for the productive skills. An error row records a criterion
    // and never records which chart or which speaking part, so a task_type
    // target would fabricate context that was never logged.
    const offenders: string[] = [];
    for (const { skill, mode, target } of allMappedModes()) {
      if (target.kind !== 'topic') continue;
      if (skill === 'listening' || skill === 'reading') continue;
      const topic = topicBySlug(target.slug);
      if (topic?.kind !== 'criterion') offenders.push(`${skill}/${mode} -> ${target.slug}`);
    }
    expect(offenders, 'a writing or speaking mode targets a non-criterion slug').toEqual([]);
  });

  it('routes every writing and speaking mode to a fixed slug, never by question type', () => {
    // usesQuestionType is false for all three; a question_type target there
    // would be metadata the prompt never asks these skills to produce.
    for (const { skill, mode, target } of allMappedModes()) {
      if (skill === 'listening' || skill === 'reading') continue;
      expect(target.kind, `${skill}/${mode}`).toBe('topic');
    }
  });

  it('never routes a listening or reading mode to a fixed slug', () => {
    // The receptive half has no criterion pages, so a fixed slug there is a
    // claim about WHERE the error happened rather than what to practise.
    for (const { skill, mode, target } of allMappedModes()) {
      if (skill !== 'listening' && skill !== 'reading') continue;
      expect(target.kind, `${skill}/${mode}`).not.toBe('topic');
    }
  });

  it('lands every writing and speaking mode on its own criterion', () => {
    // The map must not re-diagnose: the slug it picks has to agree with the
    // criterion the taxonomy already assigned. Task Achievement is the one
    // documented exception — it shares the Task Response page, which says so
    // in its own text.
    const CRITERION_SLUG: Record<string, string> = {
      'writing:Task Achievement': 'writing/criterion-task-response',
      'writing:Task Response': 'writing/criterion-task-response',
      'writing:Coherence & Cohesion': 'writing/criterion-coherence-cohesion',
      'writing:Lexical Resource': 'writing/criterion-lexical-resource',
      'writing:Grammatical Range & Accuracy': 'writing/criterion-grammatical-range',
      'speaking:Fluency & Coherence': 'speaking/criterion-fluency-coherence',
      'speaking:Lexical Resource': 'speaking/criterion-lexical-resource',
      'speaking:Grammatical Range & Accuracy': 'speaking/criterion-grammatical-range',
      'speaking:Pronunciation': 'speaking/criterion-pronunciation',
    };
    const wrong: string[] = [];
    for (const skill of ['writing_task1', 'writing_task2', 'speaking'] as const) {
      const prepSkill = skill === 'speaking' ? 'speaking' : 'writing';
      for (const mode of IELTS_ERROR_TAXONOMY[skill].modes) {
        const target = (MODE_TOPIC_MAP[skill] as Record<string, { kind: string; slug?: string }>)[
          mode.mode
        ];
        const expected = CRITERION_SLUG[`${prepSkill}:${mode.criterion}`];
        if (target.slug !== expected) {
          wrong.push(`${skill}/${mode.mode}: ${target.slug} != ${expected}`);
        }
      }
    }
    expect(wrong, 'a mode was filed under a criterion page its taxonomy criterion disagrees with').toEqual(
      [],
    );
  });
});

describe('the repeated names merge or split deliberately', () => {
  it('merges function_word_slip across both writing tasks into one page', () => {
    // Identical shared definition, and there is exactly one GRA page. The
    // per-task split survives where it belongs, in os_ielts_errors.
    const t1 = MODE_TOPIC_MAP.writing_task1.function_word_slip;
    const t2 = MODE_TOPIC_MAP.writing_task2.function_word_slip;
    expect(t1.kind).toBe('topic');
    expect(t2.kind).toBe('topic');
    expect(t1.kind === 'topic' && t1.slug).toBe('writing/criterion-grammatical-range');
    expect(t2.kind === 'topic' && t2.slug).toBe('writing/criterion-grammatical-range');
  });

  it('splits tense_drift between writing and speaking', () => {
    // Different definitions and different checks: a draft search versus a
    // listen-back. Same name, genuinely different remedy.
    const writing = MODE_TOPIC_MAP.writing_task1.tense_drift;
    const spoken = MODE_TOPIC_MAP.speaking.tense_drift;
    expect(writing.kind === 'topic' && writing.slug).toBe('writing/criterion-grammatical-range');
    expect(spoken.kind === 'topic' && spoken.slug).toBe('speaking/criterion-grammatical-range');
  });

  it('never merges a listening mode with its reading namesake', () => {
    // A text can be re-read and audio cannot, so the remedy differs even where
    // the cognitive failure does not. Routed per row, into separate namespaces.
    for (const mode of ['paraphrase_missed', 'answer_form_error'] as const) {
      const listening = resolveTopicSlug({
        skill: 'listening',
        failureMode: mode,
        questionType: 'multiple choice',
      });
      const reading = resolveTopicSlug({
        skill: 'reading',
        failureMode: mode,
        questionType: 'multiple choice',
      });
      expect(listening.slug).toBe('listening/multiple-choice');
      expect(reading.slug).toBe('reading/multiple-choice');
    }
  });
});

describe('the two hard-unmapped pacing modes', () => {
  it('leaves lost_place and time_ran_out unmapped rather than guessing', () => {
    expect(MODE_TOPIC_MAP.listening.lost_place.kind).toBe('unmapped');
    expect(MODE_TOPIC_MAP.reading.time_ran_out.kind).toBe('unmapped');
  });

  it('does not let a question_type rescue them', () => {
    // 'unmapped' means unmapped. The item type the clock ran out on is
    // incidental, and routing by it would be actively wrong.
    expect(
      resolveTopicSlug({
        skill: 'reading',
        failureMode: 'time_ran_out',
        questionType: 'matching headings',
      }),
    ).toEqual({ slug: null, reason: 'mode_unmapped' });
    expect(
      resolveTopicSlug({
        skill: 'listening',
        failureMode: 'lost_place',
        questionType: 'short answer',
      }),
    ).toEqual({ slug: null, reason: 'mode_unmapped' });
  });
});

describe('the question_type alias table', () => {
  it('points every alias at a slug that exists and belongs to that skill', () => {
    const wrong: string[] = [];
    for (const skill of ['listening', 'reading'] as const) {
      for (const [alias, slug] of questionTypeLookup(skill)) {
        const topic = topicBySlug(slug);
        if (!topic) wrong.push(`${skill}: "${alias}" -> ${slug} (no such slug)`);
        else if (topic.skill !== skill) wrong.push(`${skill}: "${alias}" -> ${slug} (wrong skill)`);
        else if (topic.kind !== 'question_type') {
          wrong.push(`${skill}: "${alias}" -> ${slug} (not a question type)`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never lets two slugs claim the same alias within one skill', () => {
    // buildLookup writes into a Map, so a collision would silently resolve to
    // whichever slug was declared last — a wrong page with no symptom.
    const collisions: string[] = [];
    for (const skill of ['listening', 'reading'] as const) {
      const seen = new Map<string, string>();
      for (const [slug, aliases] of Object.entries(QUESTION_TYPE_ALIASES[skill])) {
        const tail = normaliseQuestionType(slug.slice(slug.indexOf('/') + 1));
        for (const alias of [tail, ...aliases]) {
          const key = normaliseQuestionType(alias);
          const owner = seen.get(key);
          if (owner !== undefined && owner !== slug) {
            collisions.push(`${skill}: "${key}" claimed by ${owner} and ${slug}`);
          }
          seen.set(key, slug);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('leaves no receptive question-type page unreachable', () => {
    // A page no alias can resolve to can never appear in the weakness list
    // from the error log, however often the mistake is made.
    const reachable = new Set<string>();
    for (const skill of ['listening', 'reading'] as const) {
      for (const slug of questionTypeLookup(skill).values()) reachable.add(slug);
    }
    const unreachable = IELTS_TOPICS.filter(
      (topic) => topic.kind === 'question_type' && !reachable.has(topic.slug),
    ).map((topic) => topic.slug);
    expect(unreachable, 'question-type pages the error log can never reach').toEqual([]);
  });

  it('normalises case, punctuation and spacing to one key', () => {
    expect(normaliseQuestionType('T/F/NG')).toBe('t f ng');
    expect(normaliseQuestionType('  Matching   Headings  ')).toBe('matching headings');
    expect(normaliseQuestionType('True/False/Not Given')).toBe('true false not given');
  });

  it('resolves the prompt’s own examples, which is the vocabulary it teaches', () => {
    // marking.ts suggests these five by name. If the alias table cannot read
    // its own prompt's examples, nothing else in it can be trusted.
    const cases: Array<[('listening' | 'reading'), string, string]> = [
      ['reading', 'matching headings', 'reading/matching-headings'],
      ['reading', 'T/F/NG', 'reading/true-false-notgiven'],
      ['reading', 'summary completion', 'reading/summary-completion'],
      ['reading', 'multiple choice', 'reading/multiple-choice'],
      ['reading', 'sentence completion', 'reading/sentence-completion'],
      ['listening', 'multiple choice', 'listening/multiple-choice'],
      ['listening', 'sentence completion', 'listening/sentence-completion'],
    ];
    for (const [skill, raw, slug] of cases) {
      expect(
        resolveTopicSlug({ skill, failureMode: 'paraphrase_missed', questionType: raw }).slug,
        `${skill}: ${raw}`,
      ).toBe(slug);
    }
  });
});

describe('resolveTopicSlug', () => {
  it('never resolves UNCLASSIFIED, for any skill', () => {
    // It has no criterion, no mode and no remedy, so every possible target is
    // a page for a problem the taxonomy cannot name. Counted, not discarded.
    for (const skill of IELTS_ERROR_SKILLS) {
      expect(resolveTopicSlug({ skill, failureMode: UNCLASSIFIED }), skill).toEqual({
        slug: null,
        reason: 'unclassified',
      });
    }
  });

  it('resolves a writing mode without needing a question type', () => {
    expect(
      resolveTopicSlug({ skill: 'writing_task1', failureMode: 'overview_not_synthesised' }),
    ).toEqual({ slug: 'writing/criterion-task-response', via: 'mode' });
  });

  it('ignores a stray question_type on a writing or speaking row', () => {
    // The parser only reads field seven for the receptive skills, but a
    // hand-edited row could carry one. It must not redirect a criterion.
    expect(
      resolveTopicSlug({
        skill: 'speaking',
        failureMode: 'tense_drift',
        questionType: 'matching headings',
      }),
    ).toEqual({ slug: 'speaking/criterion-grammatical-range', via: 'mode' });
  });

  it('routes a receptive row by its own question type', () => {
    expect(
      resolveTopicSlug({
        skill: 'reading',
        failureMode: 'keyword_trap',
        questionType: 'Matching Information',
      }),
    ).toEqual({ slug: 'reading/matching-information', via: 'question_type' });
  });

  it('reports a missing question type rather than picking a default', () => {
    expect(resolveTopicSlug({ skill: 'reading', failureMode: 'paraphrase_missed' })).toEqual({
      slug: null,
      reason: 'question_type_missing',
    });
    expect(
      resolveTopicSlug({ skill: 'listening', failureMode: 'answer_form_error', questionType: '  ' }),
    ).toEqual({ slug: null, reason: 'question_type_missing' });
  });

  it('reports an unreadable question type rather than falling back', () => {
    // A recorded-but-unrecognised value is a gap in the alias table. Quietly
    // downgrading it to the fallback would hide the gap AND file the row on a
    // page it does not belong to.
    expect(
      resolveTopicSlug({
        skill: 'reading',
        failureMode: 'not_given_confusion',
        questionType: 'gap fill thing',
      }),
    ).toEqual({ slug: null, reason: 'question_type_unknown' });
  });

  it('uses the definition-bound fallback only where the mode has one', () => {
    // not_given_confusion is the single receptive mode whose definition names
    // an item type, so its default is recorded rather than inferred.
    expect(resolveTopicSlug({ skill: 'reading', failureMode: 'not_given_confusion' })).toEqual({
      slug: 'reading/true-false-notgiven',
      via: 'mode_fallback',
    });
    // …and the row's own question_type still wins over it.
    expect(
      resolveTopicSlug({
        skill: 'reading',
        failureMode: 'not_given_confusion',
        questionType: 'yes no not given',
      }),
    ).toEqual({ slug: 'reading/yes-no-notgiven', via: 'question_type' });
  });

  it('reports an unknown skill or mode instead of throwing', () => {
    expect(resolveTopicSlug({ skill: 'writing', failureMode: 'broken_clause' })).toEqual({
      slug: null,
      reason: 'unknown_skill',
    });
    expect(resolveTopicSlug({ skill: 'reading', failureMode: 'broken_clause' })).toEqual({
      slug: null,
      reason: 'unknown_mode',
    });
  });
});
