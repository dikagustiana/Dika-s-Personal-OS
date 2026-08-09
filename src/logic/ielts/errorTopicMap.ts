/**
 * THE BRIDGE: os_ielts_errors → os_ielts_topic.slug. One file, one copy.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The two IELTS stores were built at different times with different grains.
 * os_ielts_errors records CLASSIFIED OCCURRENCES against a five-skill
 * vocabulary; os_ielts_topic records METHOD PAGES against a four-skill one.
 * Migration 20260808000064 says plainly that the older tables have "no
 * QUESTION-TYPE grain and nothing to link to". This map is the missing link,
 * and it is judgement, not a join — which is why it is written down once,
 * with its reasoning attached to each row, rather than derived.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE FOR WRITING AND SPEAKING: CRITERION, NEVER TASK TYPE
 * ---------------------------------------------------------------------------
 * A weakness row's slug is a claim about WHICH PAGE TO OPEN. An error row
 * knows it was Task 1; it does NOT know whether that Task 1 was a line graph,
 * a pie chart, or a map — os_ielts_errors has no column for it. So all twelve
 * writing/task1-* and writing/task2-* slugs are UNREACHABLE from an error row:
 * targeting one would fabricate a chart type that was never recorded.
 *
 * Every writing and speaking mode therefore targets a `criterion` slug. This
 * also resolves the vocabulary mismatch the two tables carry: the errors
 * table's task1/task2 split is a SKILL split, the topic table expresses the
 * same distinction as task_type SLUGS, and the two are different axes that
 * must not be joined. The split is preserved where it belongs (in
 * os_ielts_errors, where classify.ts still reads it) and deliberately dropped
 * here, because there is exactly one writing/criterion-grammatical-range page
 * and a broken clause is a broken clause in either task.
 *
 * The rule costs two targets that look tempting and are wrong:
 *   - speaking tense_drift names "a Part 2 narrative", and
 *     speaking/part2-long-turn HAS a method — but that page teaches how to use
 *     the one-minute prep and structure the long turn. The remedy for a tense
 *     slip is a grammar habit.
 *   - speaking answer_underlength names Part 1 and Part 3, which is two
 *     candidates, which is ambiguous, which is a guess.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE FOR LISTENING AND READING: QUESTION TYPE, PER ROW
 * ---------------------------------------------------------------------------
 * The obvious idea — route paraphrase_missed to a single reading slug because
 * the remedy is the same everywhere — is the wrong one, and for a reason worth
 * writing down. The remedy IS the same everywhere; that is precisely why no
 * single page owns it. The remedy lives in the taxonomy's own `check` field
 * ("write one synonym beside each question keyword"), not on any method page.
 * The receptive half of os_ielts_topic is indexed by question type and by
 * nothing else — there is no listening/criterion-comprehension.
 *
 * So a fixed slug for a mode that occurs across every item type is a claim
 * about WHERE the error happened, and that claim is wrong for most rows. The
 * row's own question_type is the only honest source for it. Where the row has
 * none, the row has no addressable page: it stays unresolved rather than being
 * filed under a guess.
 *
 * The single exception is a mode whose DEFINITION names one item type, where
 * the binding is recorded rather than inferred: not_given_confusion.
 *
 * ---------------------------------------------------------------------------
 * WHAT DOES NOT MAP, AND WHY THAT IS THE RIGHT ANSWER
 * ---------------------------------------------------------------------------
 * lost_place and time_ran_out are whole-paper pacing failures. Their remedy
 * belongs on listening/overview and reading/overview, which isTaggable()
 * forbids as a weakness target — correctly, since an overview is reference
 * prose, not a diagnosis. Routing them by question_type would be ACTIVELY
 * WRONG: the item type the clock ran out on is incidental, not causal.
 *
 * They are marked 'unmapped' with a reason rather than omitted. An omission is
 * indistinguishable from an oversight; a declared UNMAPPED is a decision, and
 * errorTopicMap.test.ts fails if a mode is neither.
 *
 * UNCLASSIFIED never resolves here. It has no criterion, no mode and no
 * remedy, so every possible target is a page for a problem the taxonomy cannot
 * name. It is not discarded either — the caller tallies it, because an
 * UNCLASSIFIED row is evidence about the TAXONOMY rather than about what to
 * practise, and classify.ts §6 already groups the proposals.
 *
 * ---------------------------------------------------------------------------
 * ⚠ THE ALIAS TABLE IS THE WEAK POINT
 * ---------------------------------------------------------------------------
 * question_type is UNVALIDATED FREE TEXT at every layer: `text` with no check
 * constraint (migration 20260726000019), examples rather than an enum in the
 * prompt (marking.ts), zero validation in the parser (parseErrorLog.ts reads
 * `fields[6]?.trim()` and stores it), and a plain text input in the preview.
 * The prompt also instructs the model to OMIT it when unsure, so absence is
 * normal rather than exceptional.
 *
 * QUESTION_TYPE_ALIASES below is therefore derived from the prompt's examples
 * and standard IELTS vocabulary, NOT from observed data — os_ielts_errors held
 * zero rows when this was written. Check it against reality before trusting
 * the receptive half of any ranking:
 *
 *     select question_type, count(*) from os_ielts_errors
 *      where question_type is not null group by 1 order by 2 desc;
 *
 * Unrecognised strings are counted and reported, never silently dropped.
 */
import type { IeltsErrorSkill } from '../../data/types';
import { UNCLASSIFIED, isIeltsErrorSkill, type ModeNameOf } from './taxonomy';
import { IELTS_TOPICS, type IeltsTopicSlug } from './topics';

// ---------------------------------------------------------------------------
// What a mode can point at
// ---------------------------------------------------------------------------

export type ModeTarget =
  /** A fixed page. Every writing and speaking mode is one of these. */
  | { readonly kind: 'topic'; readonly slug: IeltsTopicSlug; readonly why: string }
  /**
   * Resolved per row from that row's own question_type. `fallback` is used
   * only where the mode's DEFINITION binds it to one item type; null means
   * a row without a usable question_type has no page, which is the honest
   * outcome rather than a near-miss.
   */
  | {
      readonly kind: 'question_type';
      readonly fallback: IeltsTopicSlug | null;
      readonly why: string;
    }
  /** Deliberately unmapped. Never a silent omission — see the header. */
  | { readonly kind: 'unmapped'; readonly why: string };

/** Every mode of one skill must appear. Enforced by the mapped type below. */
type ModeTargets<S extends IeltsErrorSkill> = { readonly [M in ModeNameOf<S>]: ModeTarget };

/**
 * THE MAP. Exhaustive over the taxonomy at COMPILE time: renaming a mode in
 * taxonomy.ts, adding one, or removing one changes ModeNameOf and breaks this
 * object on the same commit. Renaming a slug in topics.ts breaks every target
 * that names it. Neither can produce a silently dropped weakness row, which is
 * the failure this whole file exists to prevent.
 */
export const MODE_TOPIC_MAP: { readonly [S in IeltsErrorSkill]: ModeTargets<S> } = {
  // --- Writing Task 1 ------------------------------------------------------
  // Task Achievement has no slug of its own, and does not need one: the
  // criterion-task-response page states in its own text that it is the
  // "Task Achievement / Task Response" column, and two of its three
  // what-costs-marks bullets (skipping the overview, listing data without
  // analysis) are Task 1 failures. Same band slot, two official names.
  writing_task1: {
    data_misreport: {
      kind: 'topic',
      slug: 'writing/criterion-task-response',
      why: 'Citing a figure the chart does not support is a Task Achievement failure; the page lists "listing data without analysis" as exactly this.',
    },
    coverage_gap: {
      kind: 'topic',
      slug: 'writing/criterion-task-response',
      why: 'The descriptor it fails is "addresses all parts of the task", which is the whole subject of that page.',
    },
    overview_not_synthesised: {
      kind: 'topic',
      slug: 'writing/criterion-task-response',
      why: 'The page names "skipping the overview paragraph" verbatim as a Task Achievement failure.',
    },
    broken_clause: {
      kind: 'topic',
      slug: 'writing/criterion-grammatical-range',
      why: 'Direct: a clause missing its subject or finite verb is a Grammatical Range & Accuracy failure and nothing else.',
    },
    tense_drift: {
      kind: 'topic',
      slug: 'writing/criterion-grammatical-range',
      why: 'Direct. Kept separate from speaking tense_drift because the remedy is a search through a draft, not a listen-back.',
    },
    function_word_slip: {
      kind: 'topic',
      slug: 'writing/criterion-grammatical-range',
      why: 'Direct; articles, prepositions and plurals are scored under GRA.',
    },
    trend_expression_error: {
      kind: 'topic',
      slug: 'writing/criterion-lexical-resource',
      why: 'The wrong verb or collocation for a change is a lexical choice, not a grammatical one.',
    },
  },

  // --- Writing Task 2 ------------------------------------------------------
  writing_task2: {
    position_unclear: {
      kind: 'topic',
      slug: 'writing/criterion-task-response',
      why: 'A missing or contradicted thesis is the central Task Response failure.',
    },
    body_idea_duplication: {
      kind: 'topic',
      slug: 'writing/criterion-task-response',
      why: 'Filed under Task Response because the taxonomy files it there; arguably Coherence & Cohesion, but this map must not re-diagnose what the taxonomy already decided.',
    },
    claim_unsupported: {
      kind: 'topic',
      slug: 'writing/criterion-task-response',
      why: 'Matches the page\'s band-7 descriptor "addresses all parts, some underdeveloped ideas".',
    },
    conclusion_without_synthesis: {
      kind: 'topic',
      slug: 'writing/criterion-task-response',
      why: 'A conclusion that weighs nothing leaves the response incomplete, which is a Task Response deduction.',
    },
    verb_phrase_breakdown: {
      kind: 'topic',
      slug: 'writing/criterion-grammatical-range',
      why: 'Direct: stacked modals and missing auxiliaries are GRA.',
    },
    function_word_slip: {
      kind: 'topic',
      slug: 'writing/criterion-grammatical-range',
      why: 'SAME slug as the writing_task1 entry, deliberately merged: identical shared definition, and there is exactly one GRA page. The per-task split stays intact in os_ielts_errors, where classify.ts still reads it.',
    },
  },

  // --- Speaking ------------------------------------------------------------
  // The only skill whose criteria map 1:1 onto slugs.
  speaking: {
    answer_underlength: {
      kind: 'topic',
      slug: 'speaking/criterion-fluency-coherence',
      why: 'NOT part1-interview or part3-discussion despite the definition naming both: two candidates is ambiguous, and the remedy is a fluency habit rather than a task technique.',
    },
    self_repair_loop: {
      kind: 'topic',
      slug: 'speaking/criterion-fluency-coherence',
      why: 'Direct: restarts and hunting repetitions are the textbook Fluency & Coherence deduction.',
    },
    topic_vocabulary_gap: {
      kind: 'topic',
      slug: 'speaking/criterion-lexical-resource',
      why: 'Direct; talking around a missing word is precisely what Lexical Resource measures.',
    },
    tense_drift: {
      kind: 'topic',
      slug: 'speaking/criterion-grammatical-range',
      why: 'NOT part2-long-turn despite the definition naming Part 2 and that page having a method: the Part 2 page teaches prep and structure, while this needs a grammar habit.',
    },
    inflection_dropped: {
      kind: 'topic',
      slug: 'speaking/criterion-pronunciation',
      why: 'Direct: grammar correct on paper and absent in the audio is a Pronunciation deduction by definition.',
    },
  },

  // --- Listening -----------------------------------------------------------
  listening: {
    paraphrase_missed: {
      kind: 'question_type',
      fallback: null,
      why: 'Synonym recognition fails in every item type, so any fixed slug would assert a location most rows do not have. No fallback.',
    },
    distractor_taken: {
      kind: 'question_type',
      fallback: null,
      why: '"Option" points at multiple choice, but the speaker-retraction pattern is a Section 1 form-completion staple; guessing between the two is the near-miss this map refuses.',
    },
    lost_place: {
      kind: 'unmapped',
      why: 'A cascade ACROSS questions, not a failure of any item type. The remedy belongs on listening/overview, which isTaggable() forbids as a target.',
    },
    number_or_name_slip: {
      kind: 'question_type',
      fallback: null,
      why: 'Concentrated in completion items but not confined to them — plan, map and diagram labelling carry names and numbers too.',
    },
    answer_form_error: {
      kind: 'question_type',
      fallback: null,
      why: 'The word limit, spelling and plural rules apply to every gap-fill type; no single item type owns them.',
    },
  },

  // --- Reading -------------------------------------------------------------
  reading: {
    not_given_confusion: {
      kind: 'question_type',
      fallback: 'reading/true-false-notgiven',
      why: 'The ONLY receptive mode whose definition names one item type — it says "False" and "Not Given" literally — so the fallback is recorded, not inferred. A row whose question_type says yes/no still routes to yes-no-notgiven.',
    },
    paraphrase_missed: {
      kind: 'question_type',
      fallback: null,
      why: 'NEVER merged with the listening entry: separate slug namespaces, and the remedy differs physically because a text can be re-read and audio cannot.',
    },
    keyword_trap: {
      kind: 'question_type',
      fallback: null,
      why: 'Its own definition ("option, paragraph, or line") spans multiple choice, matching information, matching headings and T/F/NG at once.',
    },
    answer_form_error: {
      kind: 'question_type',
      fallback: null,
      why: 'NEVER merged with the listening entry, for the same reason as paraphrase_missed.',
    },
    time_ran_out: {
      kind: 'unmapped',
      why: 'Whole-paper pacing. Routing by the last passage\'s question type would be actively wrong — that item type is incidental, not causal. Its remedy belongs on reading/overview, which isTaggable() forbids.',
    },
  },
};

// ---------------------------------------------------------------------------
// question_type → slug
// ---------------------------------------------------------------------------

/**
 * Lowercase, non-alphanumerics to single spaces, trimmed. "T/F/NG" and
 * "true/false/not given" both survive as distinct, matchable keys; case and
 * punctuation stop being three different answers to the same question.
 */
export function normaliseQuestionType(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Written per skill, because the same words name different pages on each side:
 * "note completion" is listening/form-note-table-completion for a listening
 * row and reading/note-table-flowchart-completion for a reading one. The row's
 * skill always disambiguates — it is validated at the paste boundary, so it is
 * never missing.
 *
 * The slug's own last segment is added automatically, so only the aliases that
 * differ from it are listed here.
 */
export const QUESTION_TYPE_ALIASES: Record<
  'listening' | 'reading',
  Record<string, readonly string[]>
> = {
  listening: {
    'listening/form-note-table-completion': [
      'form completion',
      'note completion',
      'notes completion',
      'table completion',
      'form note table completion',
      'form/note/table completion',
      'form filling',
      'notes',
      'form',
    ],
    'listening/multiple-choice': ['multiple choice', 'mcq', 'mc'],
    'listening/matching': ['matching', 'matching questions'],
    'listening/plan-map-diagram-labelling': [
      'plan',
      'map',
      'diagram',
      'labelling',
      'labeling',
      'map labelling',
      'plan labelling',
      'diagram labelling',
      'plan map diagram labelling',
    ],
    'listening/sentence-completion': ['sentence completion'],
    'listening/short-answer': ['short answer', 'short answer questions'],
  },
  reading: {
    'reading/matching-headings': ['matching headings', 'headings', 'heading matching'],
    'reading/matching-information': [
      'matching information',
      'which paragraph contains',
      'locating information',
    ],
    'reading/matching-features': ['matching features', 'features'],
    'reading/matching-sentence-endings': ['matching sentence endings', 'sentence endings'],
    'reading/true-false-notgiven': [
      'true false not given',
      'true false notgiven',
      't f ng',
      'tfng',
      'true/false/not given',
    ],
    'reading/yes-no-notgiven': [
      'yes no not given',
      'yes no notgiven',
      'y n ng',
      'ynng',
      'yes/no/not given',
    ],
    'reading/sentence-completion': ['sentence completion'],
    'reading/summary-completion': ['summary completion', 'summary'],
    'reading/note-table-flowchart-completion': [
      'note completion',
      'notes completion',
      'table completion',
      'flow chart completion',
      'flowchart completion',
      'flowchart',
      'flow chart',
      'note table flow chart completion',
    ],
    'reading/diagram-label-completion': [
      'diagram label completion',
      'diagram labelling',
      'diagram labeling',
      'diagram',
    ],
    'reading/multiple-choice': ['multiple choice', 'mcq', 'mc'],
    'reading/short-answer': ['short answer', 'short answer questions'],
  },
};

/** Built once: normalised alias → slug, per receptive skill. */
function buildLookup(skill: 'listening' | 'reading'): ReadonlyMap<string, IeltsTopicSlug> {
  const lookup = new Map<string, IeltsTopicSlug>();
  for (const [slug, aliases] of Object.entries(QUESTION_TYPE_ALIASES[skill])) {
    // The slug's own tail, so 'matching-headings' resolves without being listed
    // twice. Slugs are unique within a skill, so tails cannot collide.
    const tail = normaliseQuestionType(slug.slice(slug.indexOf('/') + 1));
    for (const alias of [tail, ...aliases]) {
      lookup.set(normaliseQuestionType(alias), slug as IeltsTopicSlug);
    }
  }
  return lookup;
}

const QUESTION_TYPE_LOOKUP: Record<'listening' | 'reading', ReadonlyMap<string, IeltsTopicSlug>> = {
  listening: buildLookup('listening'),
  reading: buildLookup('reading'),
};

/** Exposed for the test that proves every alias points at a real, taggable slug. */
export function questionTypeLookup(
  skill: 'listening' | 'reading',
): ReadonlyMap<string, IeltsTopicSlug> {
  return QUESTION_TYPE_LOOKUP[skill];
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Why a row produced no slug. Every one of these is COUNTED and shown — the
 * whole point of this bridge is that nothing disappears without saying so.
 */
export type UnresolvedReason =
  /** The literal UNCLASSIFIED. Evidence about the taxonomy, not about practice. */
  | 'unclassified'
  /** skill is not one of the five. Only reachable from hand-edited data. */
  | 'unknown_skill'
  /** A mode name the taxonomy does not hold — a rename applied to data but not to code. */
  | 'unknown_mode'
  /** Declared unmapped on purpose: lost_place, time_ran_out. */
  | 'mode_unmapped'
  /** Routes by question_type, and the row carries none. */
  | 'question_type_missing'
  /** Routes by question_type, and the string matched no alias. */
  | 'question_type_unknown';

export type SlugResolution =
  | {
      readonly slug: IeltsTopicSlug;
      /** 'mode' = fixed target, 'question_type' = from the row, 'mode_fallback' = the definition-bound default. */
      readonly via: 'mode' | 'question_type' | 'mode_fallback';
    }
  | { readonly slug: null; readonly reason: UnresolvedReason };

/** Just the fields this needs, so callers can pass a row or a literal. */
export interface ResolvableErrorRow {
  readonly skill: string;
  readonly failureMode: string;
  readonly questionType?: string;
}

/**
 * One error row → one topic slug, or a stated reason for none.
 *
 * question_type is consulted ONLY for modes declared 'question_type'. A
 * writing row carrying a stray seventh field cannot be redirected by it, and
 * an unmapped mode is not rescued by it — 'unmapped' means unmapped.
 */
export function resolveTopicSlug(row: ResolvableErrorRow): SlugResolution {
  if (row.failureMode === UNCLASSIFIED) return { slug: null, reason: 'unclassified' };
  if (!isIeltsErrorSkill(row.skill)) return { slug: null, reason: 'unknown_skill' };

  const targets: Record<string, ModeTarget> = MODE_TOPIC_MAP[row.skill];
  const target = targets[row.failureMode];
  if (!target) return { slug: null, reason: 'unknown_mode' };

  if (target.kind === 'topic') return { slug: target.slug, via: 'mode' };
  if (target.kind === 'unmapped') return { slug: null, reason: 'mode_unmapped' };

  // kind === 'question_type'. Only listening and reading declare it, which is
  // asserted by errorTopicMap.test.ts rather than assumed here.
  const skill = row.skill as 'listening' | 'reading';
  const raw = row.questionType?.trim();
  if (!raw) {
    return target.fallback
      ? { slug: target.fallback, via: 'mode_fallback' }
      : { slug: null, reason: 'question_type_missing' };
  }

  const resolved = QUESTION_TYPE_LOOKUP[skill].get(normaliseQuestionType(raw));
  if (resolved) return { slug: resolved, via: 'question_type' };

  // A question_type that was recorded but not recognised is NOT quietly
  // downgraded to the fallback: the row says where it happened and this map
  // failed to read it, which is a gap in the alias table and must be counted
  // as one rather than hidden behind a default.
  return { slug: null, reason: 'question_type_unknown' };
}

/** Every (skill, mode) pair the taxonomy holds, for tests and for reporting. */
export function allMappedModes(): Array<{
  skill: IeltsErrorSkill;
  mode: string;
  target: ModeTarget;
}> {
  const out: Array<{ skill: IeltsErrorSkill; mode: string; target: ModeTarget }> = [];
  for (const [skill, targets] of Object.entries(MODE_TOPIC_MAP)) {
    for (const [mode, target] of Object.entries(targets as Record<string, ModeTarget>)) {
      out.push({ skill: skill as IeltsErrorSkill, mode, target });
    }
  }
  return out;
}

/** Slugs this map can ever produce. Used by the test that proves they exist. */
export function allTargetSlugs(): IeltsTopicSlug[] {
  const slugs = new Set<IeltsTopicSlug>();
  for (const { target } of allMappedModes()) {
    if (target.kind === 'topic') slugs.add(target.slug);
    if (target.kind === 'question_type' && target.fallback) slugs.add(target.fallback);
  }
  for (const skill of ['listening', 'reading'] as const) {
    for (const slug of QUESTION_TYPE_LOOKUP[skill].values()) slugs.add(slug);
  }
  return [...slugs].sort();
}

/** Guards the tests against IELTS_TOPICS drifting out from under the map. */
export const KNOWN_TOPIC_SLUGS: ReadonlySet<string> = new Set(
  IELTS_TOPICS.map((topic) => topic.slug),
);
