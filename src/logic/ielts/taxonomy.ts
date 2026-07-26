/**
 * THE IELTS ERROR TAXONOMY — one file, one source of truth.
 *
 * The prompt builder (marking.ts) and the paste validator (parseErrorLog.ts)
 * both read THIS object. Nothing else in the codebase may hold a second copy of
 * a mode name. If the taxonomy lived in two places it would drift, drift breaks
 * counting, and counting is the only thing this feature does.
 *
 * MODE NAMES ARE STABLE IDENTIFIERS. They are English and are never translated,
 * pluralised, reworded, abbreviated, or prettified — not in the UI, not in the
 * prompt, not when the surrounding commentary is in Bahasa Indonesia. A
 * translated name is a different string, and a different string is a separate
 * count. The validator enforces exact, case-sensitive equality rather than
 * trusting documentation to hold the line.
 *
 * Writing splits into Task 1 and Task 2 because they fail in completely
 * different ways, even though IELTS bands them together.
 *
 * Two names repeat across skills by design — broken_clause and
 * function_word_slip under both writing tasks, paraphrase_missed and
 * answer_form_error under both listening and reading. Identical definitions,
 * and grouping is per skill, so they count separately while keeping the
 * vocabulary small.
 */
import type { IeltsErrorSkill } from '../../data/types';

/** The literal a model must emit when nothing in the taxonomy fits. */
export const UNCLASSIFIED = 'UNCLASSIFIED';

export interface FailureMode {
  /** Stable identifier. Never translated, pluralised, or reworded. */
  readonly mode: string;
  /** Layer 1 for this mode — must be one of the skill's `criteria`. */
  readonly criterion: string;
  readonly definition: string;
  /**
   * The thing to LEARN, one sentence. Shown for the *unresolved* class only —
   * where explanation has been tried once and might still work.
   */
  readonly rule: string;
  /**
   * A literal, mechanical search instruction. Shown for the
   * *correction-resistant* class, where explanation has demonstrably failed
   * twice and the remedy has to be checkable in seconds without judgement.
   *
   * For speaking these are listen-back instructions rather than draft
   * searches: there is no draft to search, and a check that cannot be
   * performed is not a check.
   */
  readonly check: string;
}

export interface SkillTaxonomy {
  readonly skill: IeltsErrorSkill;
  readonly label: string;
  /** Layer 1 — the criteria a row of this skill may name. */
  readonly criteria: readonly string[];
  readonly modes: readonly FailureMode[];
  /**
   * question_type is metadata about WHERE the error happened (matching
   * headings, T/F/NG, summary completion). It is only meaningful for the two
   * skills that have question types at all.
   */
  readonly usesQuestionType: boolean;
}

// Layer 1 for the two productive skills is the official band-descriptor set.
const WRITING_CRITERIA = [
  'Task Achievement',
  'Task Response',
  'Coherence & Cohesion',
  'Lexical Resource',
  'Grammatical Range & Accuracy',
] as const;

const SPEAKING_CRITERIA = [
  'Fluency & Coherence',
  'Lexical Resource',
  'Grammatical Range & Accuracy',
  'Pronunciation',
] as const;

/**
 * Listening and reading use a DIFFERENT Layer 1, deliberately. They have no
 * band descriptors — only a raw score and a conversion table. Forcing "Lexical
 * Resource" onto a wrong T/F/NG answer produces a category that explains
 * nothing. These four are points of failure in the answer pipeline: for any
 * wrong answer exactly one is true, and each maps to a different fix, which is
 * the only reason a Layer 1 is worth having.
 */
const RECEPTIVE_CRITERIA = ['comprehension', 'location', 'transfer', 'timing'] as const;

export const RECEPTIVE_CRITERION_MEANING: Record<string, string> = {
  comprehension: 'Did not understand the source at the point the answer lived',
  location: 'Understood it but did not find it, or matched the wrong place',
  transfer: 'Had the right answer, wrote it in a form that scores zero',
  timing: 'Never reached the question',
};

// Shared definitions for the names that repeat across skills. Written once so
// the two copies cannot drift into meaning different things.
const FUNCTION_WORD_SLIP_DEFINITION =
  'Wrong or missing article, preposition, plural, countability, or comparative — including fixed-phrase prepositions';

const writingTask1: SkillTaxonomy = {
  skill: 'writing_task1',
  label: 'Writing Task 1',
  criteria: WRITING_CRITERIA,
  usesQuestionType: false,
  // Seven rather than six: highest-volume skill, several errors per essay, so
  // counts accumulate regardless.
  //
  // NO Coherence & Cohesion mode here, and that is not an oversight. Paragraph
  // structure and grouping logic were repeatedly the thing that WORKED across
  // everything marked. A CC mode would sit at zero and dilute every other
  // count. The criterion stays in `criteria` because it is part of writing's
  // Layer 1; it simply has no mode attached.
  modes: [
    {
      mode: 'data_misreport',
      criterion: 'Task Achievement',
      definition:
        'A figure, year, or proportion cited does not match the chart — wrong number, invented year, or a comparison the data does not support',
      rule: 'Every figure, year and proportion must be traceable to a specific point on the chart before it is written.',
      check: 'Check every year and every number in the draft appears on the chart axis or in its legend.',
    },
    {
      mode: 'coverage_gap',
      criterion: 'Task Achievement',
      definition:
        'A prompt category, period, or group never mentioned; a figure promised and never given; or under 150 words',
      rule: 'Cover every category, period and group the prompt names, and give a figure for each one you promise.',
      check: 'Count the words, then list the prompt categories and tick each one off in the draft.',
    },
    {
      mode: 'overview_not_synthesised',
      criterion: 'Task Achievement',
      definition:
        'The overview lists figures, restates one trend, or omits the highest/lowest/main contrast instead of naming all three',
      rule: 'The overview names the highest, the lowest and the main contrast — it does not list figures or restate one trend.',
      check: 'Read the overview alone and search it for the highest value, the lowest value, and a named contrast.',
    },
    {
      mode: 'broken_clause',
      criterion: 'Grammatical Range & Accuracy',
      definition: 'A clause with no subject, no finite verb, or a doubled subject',
      rule: 'Every clause needs exactly one subject and one finite verb.',
      check: 'Read each sentence on its own and point at its subject and its finite verb.',
    },
    {
      mode: 'tense_drift',
      criterion: 'Grammatical Range & Accuracy',
      definition:
        'Tense changes within a paragraph without cause, or historical data written in present/present perfect instead of Simple Past',
      rule: 'Historical data is Simple Past throughout; the tense changes only when the time frame changes.',
      check: 'Search the draft for "has", "have", "is" and "are" in any sentence describing past data.',
    },
    {
      mode: 'function_word_slip',
      criterion: 'Grammatical Range & Accuracy',
      definition: FUNCTION_WORD_SLIP_DEFINITION,
      rule: 'Articles, prepositions, plurals and comparatives are chosen together with the noun, not added afterwards.',
      check: 'Search for "another" followed by a number, and for every plural noun preceded by "a".',
    },
    {
      mode: 'trend_expression_error',
      criterion: 'Lexical Resource',
      definition:
        'The verb, noun, or adverb expressing a change is the wrong form or collocation, or contradicts the data direction',
      rule: 'Match the verb, noun and adverb to the direction and the size of the change the data actually shows.',
      check: 'Search for "increase", "decrease", "rise", "fall" and "dramatically" and check each against the chart direction.',
    },
  ],
};

const writingTask2: SkillTaxonomy = {
  skill: 'writing_task2',
  label: 'Writing Task 2',
  criteria: WRITING_CRITERIA,
  usesQuestionType: false,
  modes: [
    {
      mode: 'position_unclear',
      criterion: 'Task Response',
      definition:
        'No thesis in the introduction, or the stated position is not the one the body defends',
      rule: 'State one position in the introduction and defend that same position in every body paragraph.',
      check: 'Underline the thesis sentence, then read only the topic sentences and check each one supports it.',
    },
    {
      mode: 'body_idea_duplication',
      criterion: 'Task Response',
      definition: 'Two body paragraphs advance the same underlying argument in different words',
      rule: 'Each body paragraph advances a different argument, not the same one reworded.',
      check: 'Write each body paragraph argument in five words and check the two lines differ.',
    },
    {
      mode: 'claim_unsupported',
      criterion: 'Task Response',
      definition:
        'A topic sentence is asserted and the paragraph moves on without mechanism, consequence, or specific example',
      rule: 'Every topic sentence is followed by a mechanism, a consequence, or a specific example.',
      check: 'After each topic sentence, search the paragraph for "because", "for example" or "which means".',
    },
    {
      mode: 'conclusion_without_synthesis',
      criterion: 'Task Response',
      definition: 'The conclusion paraphrases the introduction without weighing the arguments',
      rule: 'The conclusion weighs the arguments the essay made; it does not paraphrase the introduction.',
      check: 'Read the introduction and the conclusion side by side and check no clause repeats.',
    },
    {
      mode: 'verb_phrase_breakdown',
      criterion: 'Grammatical Range & Accuracy',
      definition: 'Stacked modals, missing auxiliary, or a relative clause with no verb',
      rule: 'One modal per verb phrase, and every clause keeps its auxiliary.',
      check: 'Search for "can be able", "will can", "must to", and for "which" or "that" with no verb after it.',
    },
    {
      mode: 'function_word_slip',
      criterion: 'Grammatical Range & Accuracy',
      definition: FUNCTION_WORD_SLIP_DEFINITION,
      rule: 'Articles, prepositions, plurals and comparatives are chosen together with the noun, not added afterwards.',
      check: 'Search for "another" followed by a number, and for every plural noun preceded by "a".',
    },
  ],
};

const speaking: SkillTaxonomy = {
  skill: 'speaking',
  label: 'Speaking',
  criteria: SPEAKING_CRITERIA,
  usesQuestionType: false,
  modes: [
    {
      mode: 'answer_underlength',
      criterion: 'Fluency & Coherence',
      definition:
        'A Part 1 or Part 3 answer ends after one sentence with no reason, example, or contrast',
      rule: 'Every Part 1 and Part 3 answer carries a reason, an example, or a contrast after the direct answer.',
      check: 'Listen back and count the sentences in each answer; mark every answer that stops at one.',
    },
    {
      mode: 'self_repair_loop',
      criterion: 'Fluency & Coherence',
      definition:
        'Restarting a sentence mid-way, or repeating words while hunting for the next',
      rule: 'Finish the sentence you started, imperfectly if necessary, rather than restarting it.',
      check: 'Listen back and mark every restart and every repeated word; the count is the score.',
    },
    {
      mode: 'topic_vocabulary_gap',
      criterion: 'Lexical Resource',
      definition:
        'A general word where the topic needs a specific one, or audibly talking around a missing word',
      rule: 'Prepare eight to ten specific nouns and verbs per common topic so the general word is not the only one available.',
      check: 'Listen back for "thing", "stuff", "kind of", "like that" and "you know".',
    },
    {
      mode: 'tense_drift',
      criterion: 'Grammatical Range & Accuracy',
      definition: 'A Part 2 narrative slips into present tense, or past forms drop mid-story',
      rule: 'A Part 2 narrative stays in past tense from the first verb to the last.',
      check: 'Listen back to the Part 2 answer and mark every present-tense verb.',
    },
    {
      mode: 'inflection_dropped',
      criterion: 'Pronunciation',
      definition:
        'Final -ed, -s, or consonant clusters not articulated, so the grammar is correct on paper and absent in the audio',
      rule: 'Final -ed, -s and consonant clusters are articulated, not implied.',
      check: 'Listen back at half speed to the ends of past-tense verbs and plural nouns.',
    },
  ],
};

const listening: SkillTaxonomy = {
  skill: 'listening',
  label: 'Listening',
  criteria: RECEPTIVE_CRITERIA,
  usesQuestionType: true,
  modes: [
    {
      mode: 'paraphrase_missed',
      criterion: 'comprehension',
      definition:
        'The answer was signalled by a synonym and the keyword was still being waited for',
      rule: 'The answer arrives as a synonym; the keyword from the question usually never appears.',
      check: 'Before the audio starts, write one synonym beside each question keyword.',
    },
    {
      mode: 'distractor_taken',
      criterion: 'comprehension',
      definition: "The first option written; the speaker's correction or retraction missed",
      rule: 'Wait for the speaker to finish — a correction usually follows the first candidate answer.',
      check: 'Listen for "actually", "sorry", "no wait" and "in fact", and hold the pen until after them.',
    },
    {
      mode: 'lost_place',
      criterion: 'location',
      definition: 'One miss cascaded into the next question or two while searching',
      rule: 'A missed question is abandoned immediately; the next question is the only one still winnable.',
      check: 'Mark the skipped question with a dash and move your finger to the next question number.',
    },
    {
      mode: 'number_or_name_slip',
      criterion: 'transfer',
      definition: 'A digit, date, time, or spelled-out name transcribed wrongly',
      rule: 'Digits, dates, times and spelled names are written as heard and read back once.',
      check: 'In the transfer time, read every number and every name answer back aloud.',
    },
    {
      mode: 'answer_form_error',
      criterion: 'transfer',
      definition:
        'Right answer, unscoreable form — spelling, singular/plural, capitalisation, over the word limit, or repeating a stem word',
      rule: 'The answer must be scoreable as written: spelling, plural, capitalisation, word limit, no stem words.',
      check: 'Count the words in every answer against the stated limit, and check each capital letter.',
    },
  ],
};

const reading: SkillTaxonomy = {
  skill: 'reading',
  label: 'Reading',
  criteria: RECEPTIVE_CRITERIA,
  usesQuestionType: true,
  modes: [
    {
      mode: 'not_given_confusion',
      criterion: 'comprehension',
      definition:
        'False chosen where the passage is silent, or Not Given where it actually contradicts',
      rule: 'False needs a contradicting statement in the passage; silence is Not Given.',
      check: 'For every False, point at the line that contradicts it; if there is none, change it to Not Given.',
    },
    {
      mode: 'paraphrase_missed',
      criterion: 'comprehension',
      definition:
        'The passage restates the question and it was read past while hunting the original wording',
      rule: 'The passage restates the question rather than repeating its words.',
      check: 'Underline the question keywords and write one synonym for each before scanning.',
    },
    {
      mode: 'keyword_trap',
      criterion: 'location',
      definition:
        'The option, paragraph, or line containing the literal keyword picked over the one carrying the meaning',
      rule: 'The option holding the literal keyword is usually the trap; the meaning sits elsewhere.',
      check: 'For each answer, check the chosen line MEANS the question, not merely shares a word with it.',
    },
    {
      mode: 'answer_form_error',
      criterion: 'transfer',
      definition:
        'Right answer located, wrong grammatical form copied, or over the word limit',
      rule: 'Copy the answer in the grammatical form the gap requires, within the word limit.',
      check: 'Count the words in every answer and re-read the gap sentence with the answer inserted.',
    },
    {
      mode: 'time_ran_out',
      criterion: 'timing',
      definition:
        'Questions left blank or guessed because the last passage got under ten minutes',
      rule: 'Twenty minutes per passage, enforced — an unfinished passage costs more than a rushed one.',
      check: 'Write the clock time you must leave each passage at the top of that passage.',
    },
  ],
};

export const IELTS_ERROR_TAXONOMY: Record<IeltsErrorSkill, SkillTaxonomy> = {
  listening,
  reading,
  writing_task1: writingTask1,
  writing_task2: writingTask2,
  speaking,
};

/** Display order: writing first — it is the highest-volume skill. */
export const IELTS_ERROR_SKILLS: readonly IeltsErrorSkill[] = [
  'writing_task1',
  'writing_task2',
  'speaking',
  'listening',
  'reading',
] as const;

export function isIeltsErrorSkill(value: string): value is IeltsErrorSkill {
  return Object.prototype.hasOwnProperty.call(IELTS_ERROR_TAXONOMY, value);
}

/** Exact, case-sensitive lookup. A reworded name is a different mode. */
export function findMode(skill: IeltsErrorSkill, mode: string): FailureMode | undefined {
  return IELTS_ERROR_TAXONOMY[skill].modes.find((entry) => entry.mode === mode);
}

export function isValidCriterion(skill: IeltsErrorSkill, criterion: string): boolean {
  return IELTS_ERROR_TAXONOMY[skill].criteria.includes(criterion);
}

/** UNCLASSIFIED passes — §6 depends on it reaching the table. */
export function isValidFailureMode(skill: IeltsErrorSkill, mode: string): boolean {
  return mode === UNCLASSIFIED || findMode(skill, mode) !== undefined;
}

/**
 * A model proposing a new mode writes `PROPOSED: <name> — <definition>` in the
 * note. Parsed here rather than in the view so the count in §6 is computed from
 * the same reading of the note everywhere.
 *
 * Accepts an em dash, an en dash, or a hyphen as the separator: the prompt asks
 * for an em dash and models substitute freely, and a substituted dash must not
 * silently drop the proposal.
 */
export function parseProposal(note: string | undefined): { name: string; definition: string } | null {
  if (!note) return null;
  const match = /PROPOSED:\s*([^—–\-\n]+?)\s*[—–-]\s*(.+)/.exec(note);
  if (!match) {
    // A proposal with no definition is still a proposal — the name is what
    // gets counted, and losing it because the model omitted the dash would
    // silently discard the signal §6 exists to surface.
    const nameOnly = /PROPOSED:\s*([^\n]+)/.exec(note);
    if (!nameOnly) return null;
    return { name: nameOnly[1].trim(), definition: '' };
  }
  return { name: match[1].trim(), definition: match[2].trim() };
}
