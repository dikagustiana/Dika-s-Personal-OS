/**
 * G-NUMBER — the gate that matters most, and the direct answer to the
 * failure mode this layer exists for: the system could emit a figure with
 * nothing standing behind it.
 *
 * Every numeric token in an output must be traceable to a backing datapoint
 * (its value or its year), or fall under one of exactly three exceptions:
 *
 *   1. Inside a cited quotation — a "double-quoted span" or a markdown
 *      blockquote line. Quoted numbers belong to the quoted source.
 *   2. Tagged [sim:<model_result_id>] — a model output naming the exact
 *      evaluator result it came from, value-checked against that result.
 *   3. Tagged [C] — a layer C inference, explicitly owned as the
 *      researcher's own number.
 *
 * Anything else blocks the save, and the violation NAMES THE TOKEN — a gate
 * that fails without naming the cause will be worked around. This runs on
 * the mutation path (both repository implementations call it), not only in
 * the UI: a warning label is not a control, and the owner at 1am is not a
 * reviewer.
 *
 * Deliberately strict: dates, section numbers and other innocent-looking
 * figures are violations too unless quoted or tagged. The escape hatch is
 * one keystroke wide and leaves a mark, which is the design — the mark is
 * what keeps the layers from blending in a draft.
 */
import type { LabDatapoint } from '../../data/labEvidenceTypes';

export interface NumberViolation {
  /** The token exactly as written, e.g. "7.3" or "1,234". */
  token: string;
  index: number;
  /** A short window around the token, for the review panel. */
  context: string;
}

/** Numeric tokens: digits with optional thousands/decimal parts and %. */
const NUMBER_TOKEN = /\d+(?:[.,]\d+)*%?/g;
/**
 * An accepted tag immediately after a token: [C] inference, or
 * [sim:<model_result_id>] naming the EXACT evaluator result the figure came
 * from. A bare [sim] exempts nothing any more — an untraceable simulation
 * claim was the drafter-shaped hole in this gate.
 */
const TRAILING_TAG = /^\s*\[(C|sim:([0-9a-fA-F][0-9a-fA-F-]{7,}))\]/;
/** An ordered-list marker: the token is the line's own numbering, not a figure. */
const LIST_MARKER = /(?:^|\n)\s*$/;

function parseToken(token: string): number {
  // Separator-aware, both locales: "2,15" is 2.15 (id decimal), "1.234.567"
  // is 1234567 (id grouping), "1,234.56" stays 1234.56 (en). The old
  // strip-all-commas parse read "2,15" as 215, which both missed real id
  // figures and let a datapoint of 215 wrongly back the token "2,15".
  const t = token.replace(/%$/, '');
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  const last = Math.max(lastComma, lastDot);
  if (last === -1) return Number(t);
  const tail = t.length - last - 1;
  const sepCount = (t.match(/[.,]/g) ?? []).length;
  // id decimal: the LAST separator is a comma with 1–2 decimal digits.
  if (last === lastComma && (tail === 1 || tail === 2)) {
    return Number(`${t.slice(0, last).replace(/[.,]/g, '')}.${t.slice(last + 1)}`);
  }
  // id grouping: last separator is a period over exactly 3 digits, with
  // other separators present ("1.234.567").
  if (last === lastDot && tail === 3 && sepCount > 1) {
    return Number(t.replace(/[.,]/g, ''));
  }
  // Historical en behaviour: commas group, periods decimal.
  return Number(t.replaceAll(',', ''));
}

/** Character ranges lying inside "..." / “...” quotation spans. */
function quotedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const patterns = [/"[^"]*"/g, /“[^”]*”/g];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

/** Character ranges of markdown blockquote lines. */
function blockquoteRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let lineStart = 0;
  for (const line of content.split('\n')) {
    if (/^\s*>/.test(line)) ranges.push([lineStart, lineStart + line.length]);
    lineStart += line.length + 1;
  }
  return ranges;
}

function inAnyRange(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/** The spans of well-formed tags themselves: a tag id's digits are markup,
 *  not figures — skipped only while tags are consulted at all. */
const TAG_SPAN = /\[(?:C|sim:[0-9a-fA-F][0-9a-fA-F-]{7,})\]/g;

function tagRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of content.matchAll(TAG_SPAN)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** Condition 5 of the [sim:<id>] exemption: the token IS the result's value. */
function simValueMatches(tokenValue: number, resultValue: number): boolean {
  return (
    Math.abs(tokenValue - resultValue) <=
    1e-9 * Math.max(1, Math.abs(tokenValue), Math.abs(resultValue))
  );
}


/** The numbers a set of datapoints can stand behind: values and years. */
export function backedNumbers(datapoints: readonly LabDatapoint[]): Set<number> {
  const backed = new Set<number>();
  for (const datapoint of datapoints) {
    backed.add(datapoint.value);
    if (datapoint.year !== null) backed.add(datapoint.year);
  }
  return backed;
}

/**
 * The exemptions a caller may switch OFF. The owner's editor keeps both on:
 * a human typing [C] is exactly what the tag asserts, and a human quoting a
 * source is a two-keystroke convenience. The DRAFTER gets neither — an
 * agent minting its own escape hatch (any figure + [C], or any figure in
 * quotes) is the hole these flags close. The exemption CONSTANTS are never
 * touched, only whether they are consulted.
 */
export interface ScanOptions {
  allowTags?: boolean;
  allowQuotes?: boolean;
  /**
   * The model results a [sim:<id>] tag may point at. The CALLER pre-filters
   * to results that (1) exist, (2) passed every check, (3) passed the
   * sensitivity smoke test, and (4) have no stale inputs; the scan enforces
   * (5): the tagged token equals the result's value within tolerance. Five
   * conditions, none of them the model's to assert.
   */
  simResults?: ReadonlyArray<{ id: string; value: number }>;
}

/**
 * Scans output content and returns every numeric token that nothing stands
 * behind. Empty array = the output may be saved.
 */
export function checkOutputNumbers(
  content: string,
  datapoints: readonly LabDatapoint[],
  { allowTags = true, allowQuotes = true, simResults = [] }: ScanOptions = {},
): NumberViolation[] {
  const backed = backedNumbers(datapoints);
  const quoted = quotedRanges(content);
  const blockquoted = blockquoteRanges(content);
  const tagged = tagRanges(content);
  const violations: NumberViolation[] = [];

  for (const match of content.matchAll(NUMBER_TOKEN)) {
    const token = match[0];
    const index = match.index;

    // Ordered-list numbering: "3. " at the start of a line is structure.
    if (
      /^\d+$/.test(token) &&
      LIST_MARKER.test(content.slice(0, index)) &&
      content.slice(index + token.length).startsWith('. ')
    ) {
      continue;
    }
    if (allowQuotes && (inAnyRange(index, quoted) || inAnyRange(index, blockquoted))) continue;
    if (allowTags && inAnyRange(index, tagged)) continue;
    if (allowTags) {
      const tag = TRAILING_TAG.exec(content.slice(index + token.length));
      if (tag && tag[1] === 'C') continue;
      if (tag && tag[2]) {
        const result = simResults.find((entry) => entry.id === tag[2]);
        if (result && simValueMatches(parseToken(token), result.value)) continue;
      }
    }
    if (backed.has(parseToken(token))) continue;

    violations.push({
      token,
      index,
      context: content.slice(Math.max(0, index - 40), index + token.length + 20).trim(),
    });
  }
  return violations;
}
