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
 *   2. Tagged [sim] — a model or simulation output, asserted as such rather
 *      than as an empirical datum.
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
/** An accepted tag immediately after a token: [C] inference, [sim] model output. */
const TRAILING_TAG = /^\s*\[(?:C|sim)\]/;
/** An ordered-list marker: the token is the line's own numbering, not a figure. */
const LIST_MARKER = /(?:^|\n)\s*$/;

function parseToken(token: string): number {
  // "1,234.56" and "1234.56" both parse; the en-style comma is grouping.
  return Number(token.replace(/%$/, '').replaceAll(',', ''));
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
 * Scans output content and returns every numeric token that nothing stands
 * behind. Empty array = the output may be saved.
 */
export function checkOutputNumbers(
  content: string,
  datapoints: readonly LabDatapoint[],
): NumberViolation[] {
  const backed = backedNumbers(datapoints);
  const quoted = quotedRanges(content);
  const blockquoted = blockquoteRanges(content);
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
    if (inAnyRange(index, quoted) || inAnyRange(index, blockquoted)) continue;
    if (TRAILING_TAG.test(content.slice(index + token.length))) continue;
    if (backed.has(parseToken(token))) continue;

    violations.push({
      token,
      index,
      context: content.slice(Math.max(0, index - 40), index + token.length + 20).trim(),
    });
  }
  return violations;
}
