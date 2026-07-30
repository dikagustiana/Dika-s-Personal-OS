/**
 * prIeltsMarking — the marking prompt, one per skill.
 *
 * Same pattern as the research pipeline's builders: a pure function returning a
 * string, rendered in a monospace block with a copy button.
 *
 * IT QUOTES THE TAXONOMY FROM THE §3 CONSTANT, never from a hardcoded copy.
 * That is the entire mechanism preventing name drift, and drift breaks
 * counting. marking.test.ts asserts the generated text contains every mode of
 * the chosen skill byte-identically, so a paraphrase fails the suite.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS PROMPT IS DELIBERATELY COPY-PASTE ONLY. THERE IS NO SEND PATH AND THE
 * ABSENCE IS THE DECISION, NOT AN OVERSIGHT.
 *
 * The research pipeline has a send button per prompt card and a per-task model
 * routing table (logic/research/modelRouting.ts). Neither reaches here, and no
 * routing entry should be added for marking, because the whole error-pattern
 * system rests on marking accuracy. The layer-2 taxonomy was derived from
 * observations of this owner's ACTUAL essays, and the six classification classes
 * in classify.ts — correction-resistant, induced, unresolved,
 * within-session-cluster, too-early, isolated — count occurrences PER CATEGORY.
 * A marker that categorises more loosely does not produce slightly worse data;
 * it fills the log with wrong categories, and the classification becomes noise
 * that looks like data. Wrong counts read exactly like right ones.
 *
 * The test is 52 days out as of 2026-07-30. This is not the moment to swap the
 * marker for an untested one.
 *
 * If automated marking is wanted later, that is a decision with a quality bar
 * attached — agreement measured against known-good markings on real essays,
 * per category — and not a routing entry.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { IeltsErrorSkill } from '../../data/types';
import {
  IELTS_ERROR_TAXONOMY,
  RECEPTIVE_CRITERION_MEANING,
  UNCLASSIFIED,
} from './taxonomy';

function taxonomyBlock(skill: IeltsErrorSkill): string {
  const taxonomy = IELTS_ERROR_TAXONOMY[skill];
  const layerOne = taxonomy.criteria
    .map((criterion) => {
      const meaning = RECEPTIVE_CRITERION_MEANING[criterion];
      return meaning ? ` ${criterion} — ${meaning}` : ` ${criterion}`;
    })
    .join('\n');
  const layerTwo = taxonomy.modes
    .map((mode) => ` ${mode.mode} | ${mode.criterion} | ${mode.definition}`)
    .join('\n');
  return `LAYER 1 — criterion (use exactly one of these strings)
${layerOne}

LAYER 2 — failure_mode (use exactly one of these strings)
failure_mode | criterion | definition
${layerTwo}`;
}

/**
 * The receptive skills have no band descriptors, so the prompt has to say why
 * its Layer 1 looks nothing like the writing one — otherwise a model
 * "helpfully" substitutes the familiar four.
 */
function layerOneNote(skill: IeltsErrorSkill): string {
  return IELTS_ERROR_TAXONOMY[skill].usesQuestionType
    ? `Listening and reading have no band descriptors — only a raw score. Their Layer 1 is the POINT OF FAILURE in the answer pipeline, not a band criterion. For any wrong answer exactly one of the four is true. Do not substitute writing criteria such as "Lexical Resource"; they explain nothing about a wrong answer.`
    : `Layer 1 is the official band criterion the error is scored against.`;
}

function questionTypeNote(skill: IeltsErrorSkill): string {
  return IELTS_ERROR_TAXONOMY[skill].usesQuestionType
    ? `\nIf you know the question type (matching headings, T/F/NG, summary completion, multiple choice, sentence completion…), append it as a SEVENTH field. Omit the field entirely if you do not know it — do not guess.`
    : '';
}

export function prIeltsMarking(skill: IeltsErrorSkill): string {
  const taxonomy = IELTS_ERROR_TAXONOMY[skill];

  return `TASK — mark one IELTS ${taxonomy.label} practice piece. Produce TWO outputs, in this order, both in full.

I will paste the piece (and the prompt or task it answers) after this message.

═══════════════════════════════════════════════════════════════════════
OUTPUT 1 — EXAMINER REVIEW
═══════════════════════════════════════════════════════════════════════
Format as I already use it:
 · Per-paragraph review, quoting the exact text you are commenting on.
 · A score against each criterion, with one sentence of justification each.
 · An overall band estimate.
 · What improved since the last piece, if I have told you.
 · What still needs work.
 · One concrete positive — something specific that worked, not encouragement.

Labels and commentary in Bahasa Indonesia. English only for quotes from my
writing and for corrections. Fundamental errors must pull the band estimate
DOWN — do not average a broken clause away against good vocabulary.

═══════════════════════════════════════════════════════════════════════
OUTPUT 2 — ERROR LOG
═══════════════════════════════════════════════════════════════════════
${layerOneNote(skill)}

${taxonomyBlock(skill)}

RULES FOR THE LOG — these are the load-bearing part.

1. ONE ROW PER DISTINCT OCCURRENCE. The same failure_mode three times in one
   piece is THREE rows, each with its own quote. Do not merge them and do not
   write "×3".

2. EVERY ROW CARRIES A VERBATIM QUOTE from my text. Never paraphrased, never
   corrected, never tidied. Where nothing is quotable because the problem is
   something MISSING, write [absent: what is missing] — for example
   [absent: no overview paragraph].

3. NEVER INVENT A failure_mode. If something cost marks and none of the listed
   modes fits, put the literal ${UNCLASSIFIED} in the failure_mode field and
   write PROPOSED: <name> — <one-line definition> in the note. DO NOT force it
   into the nearest existing mode. An imprecise fit is worse than an
   unclassified row, because it corrupts a count I use to decide what to
   practise. Proposed names follow the same style as the list: lowercase,
   underscores, English.

4. The note says WHY it cost marks against that criterion. One sentence, Bahasa
   Indonesia.

5. Output the log as a fenced block, pipe-delimited, six fields per row:

   date | skill | criterion | failure_mode | quote | note

   date        the date of the piece, YYYY-MM-DD
   skill       exactly: ${skill}
   quote       verbatim, or [absent: …]
   A literal | inside the quote must be written \\| so the row still splits
   into six fields.
   NO header row. NO blank lines inside the fence. NOTHING inside the fence
   but rows.${questionTypeNote(skill)}

6. If there are genuinely no loggable errors, output an EMPTY fenced block. Do
   not pad it with rows to look thorough.

Output 1 first, in full, then Output 2. I paste your entire reply into a parser
that finds the rows itself, so do not strip the review and do not repeat the
log.`;
}
