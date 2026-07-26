/**
 * Finds error rows inside a WHOLE, UNEDITED marking response.
 *
 * The entry path is: paste the model's entire reply — examiner review in
 * Bahasa Indonesia, fenced log, prose and all — and let the parser find the
 * rows. If the box only accepted a hand-extracted block, every session would
 * cost three extra steps (copy the reply, hunt for the fence, copy just that,
 * paste), and that interaction cost is exactly what left the timebox with zero
 * uses across the whole app.
 *
 * SO THE PARSER IS TOLERANT, NOT STRICT. The prompt asks for a clean fenced
 * block with no header; models do not reliably obey formatting instructions and
 * this one will run twenty-plus times over eight weeks. Every assumption about
 * shape is therefore dropped:
 *
 *   - rows may sit inside a fence, or not
 *   - the fence may be ```, ```text, or absent
 *   - a header row may appear despite the instruction — discarded, not rejected
 *   - prose may sit before, after, and between blocks; there may be many blocks
 *   - blank lines may appear inside a block
 *   - row order is not guaranteed
 *
 * DETECTION RULE: scan EVERY line of the paste for the pipe shape, wherever it
 * sits. A line qualifies when splitting on unescaped `|` yields at least six
 * fields, field 1 parses as YYYY-MM-DD, and field 2 is one of the five skills.
 * Everything else in the paste is ignored silently — the examiner review is
 * expected to be there and is not an error.
 */
import type { IeltsError, IeltsErrorSkill } from '../../data/types';
import {
  IELTS_ERROR_TAXONOMY,
  UNCLASSIFIED,
  isIeltsErrorSkill,
  isValidCriterion,
  isValidFailureMode,
} from './taxonomy';

/** The six documented fields, in order. */
export const LOG_FIELDS = [
  'date',
  'skill',
  'criterion',
  'failure_mode',
  'quote',
  'note',
] as const;

export type ParsedFields = Pick<
  IeltsError,
  'date' | 'criterion' | 'failureMode' | 'quote' | 'note' | 'questionType' | 'revisionOf'
> & { skill: IeltsErrorSkill };

export interface ParsedRow {
  /** 1-based line number in the pasted text, so the preview can point at it. */
  readonly line: number;
  /** The line exactly as pasted, for the preview's "this is what I read". */
  readonly raw: string;
  readonly fields: ParsedFields;
  /** Empty when the row is valid. One entry per distinct problem. */
  readonly problems: readonly string[];
}

export interface ParseResult {
  readonly rows: readonly ParsedRow[];
  /** Header rows and other pipe-shaped noise that was discarded silently. */
  readonly discardedHeaders: number;
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A literal pipe inside a quote arrives escaped as `\|`. Split on pipes that
 * are NOT preceded by a backslash, then unescape each field — done in one pass
 * so a quote containing `\|` survives intact instead of being torn into two
 * fields.
 */
function splitUnescaped(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\' && line[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (char === '|') {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/** True for a row the model emitted as a header despite being told not to. */
function isHeaderRow(fields: string[]): boolean {
  return fields
    .slice(0, LOG_FIELDS.length)
    .every((field, index) => field.toLowerCase().replace(/\s+/g, '_') === LOG_FIELDS[index]);
}

function isRealDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validate(fields: ParsedFields): string[] {
  const problems: string[] = [];
  const taxonomy = IELTS_ERROR_TAXONOMY[fields.skill];

  if (!isRealDate(fields.date)) {
    problems.push(`"${fields.date}" is not a YYYY-MM-DD date.`);
  }
  if (!isValidCriterion(fields.skill, fields.criterion)) {
    problems.push(
      `"${fields.criterion}" is not a ${taxonomy.label} criterion. Expected one of: ${taxonomy.criteria.join(', ')}.`,
    );
  }
  if (!isValidFailureMode(fields.skill, fields.failureMode)) {
    problems.push(
      `"${fields.failureMode}" is not a ${taxonomy.label} failure mode. Expected ${UNCLASSIFIED} or one of: ${taxonomy.modes
        .map((mode) => mode.mode)
        .join(', ')}.`,
    );
  }
  if (!fields.quote) {
    problems.push('The quote is empty. Use [absent: what is missing] where nothing is quotable.');
  }
  if (fields.revisionOf && !isRealDate(fields.revisionOf)) {
    problems.push(`revision_of "${fields.revisionOf}" is not a YYYY-MM-DD date.`);
  }
  return problems;
}

/** Re-run validation after the preview edits a row in place. */
export function validateFields(fields: ParsedFields): string[] {
  return validate(fields);
}

/**
 * Scan the whole paste. Never throws, never rejects the paste as a unit: a
 * malformed row is returned WITH its reasons so the preview can show it,
 * editable, beside the valid ones.
 */
export function parseErrorLog(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  let discardedHeaders = 0;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line.includes('|')) return;

    // Markdown table pipes at the ends produce empty leading/trailing fields;
    // drop them before counting so a model that formats the log as a markdown
    // table is still read rather than silently ignored.
    let fields = splitUnescaped(line);
    if (fields.length > 1 && fields[0] === '') fields = fields.slice(1);
    if (fields.length > 1 && fields[fields.length - 1] === '') fields = fields.slice(0, -1);

    if (fields.length < LOG_FIELDS.length) return;
    if (isHeaderRow(fields)) {
      discardedHeaders += 1;
      return;
    }
    // A markdown separator row (|---|---|) is noise, not a row.
    if (fields.every((field) => /^:?-{2,}:?$/.test(field))) return;

    const [date, skill, criterion, failureMode, quote, note] = fields;
    if (!DATE_SHAPE.test(date)) return;
    if (!isIeltsErrorSkill(skill)) return;

    // Fields seven and eight are not in the documented shape and the prompt
    // never emits them. They are read when present for the same reason the
    // fence is optional: tolerating more than was asked for costs nothing, and
    // question_type / revision_of are otherwise unreachable from a paste.
    const questionType = fields[6]?.trim() || undefined;
    const revisionOf = fields[7]?.trim() || undefined;

    const parsed: ParsedFields = {
      date,
      skill,
      criterion,
      failureMode,
      quote,
      note: note || undefined,
      questionType,
      revisionOf,
    };
    rows.push({ line: index + 1, raw: line, fields: parsed, problems: validate(parsed) });
  });

  return { rows, discardedHeaders };
}

/** What the parser was looking for, shown verbatim when a paste yields zero rows. */
export const PARSER_EXPECTATION = `date | skill | criterion | failure_mode | quote | note

Six fields separated by | on one line, anywhere in the paste — fence or no fence.
  date          YYYY-MM-DD
  skill         listening, reading, writing_task1, writing_task2, speaking
  quote         verbatim, or [absent: what is missing]
A literal pipe inside the quote is written \\|.`;
