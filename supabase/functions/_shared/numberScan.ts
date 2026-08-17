// G-NUMBER, server-side: the same deterministic scan as
// src/logic/lab/labNumbers.ts, ported so the DRAFTER's writes are gated
// where they happen — an agent draft whose numbers nothing stands behind is
// refused before any output row exists, not flagged after.
//
// KEPT IN LOCKSTEP WITH THE CLIENT COPY BY TEST:
// src/logic/lab/numberScanDrift.test.ts reads both files and fails the
// build when the token grammar or the exception markers drift apart. If you
// change one, change both, and the test says so. Pure TS, no Deno APIs, so
// the drift test can also execute it directly.

export interface ScanViolation {
  token: string;
  index: number;
  context: string;
}

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*%?/g;
const TRAILING_TAG = /^\s*\[(?:C|sim)\]/;
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
}

/** Scans content against the allowed numbers (datapoint values and years). */
export function scanNumbers(
  content: string,
  allowed: ReadonlySet<number>,
  { allowTags = true, allowQuotes = true }: ScanOptions = {},
): ScanViolation[] {
  const quoted = quotedRanges(content);
  const blockquoted = blockquoteRanges(content);
  const violations: ScanViolation[] = [];
  for (const match of content.matchAll(NUMBER_TOKEN)) {
    const token = match[0];
    const index = match.index;
    if (
      /^\d+$/.test(token) &&
      LIST_MARKER.test(content.slice(0, index)) &&
      content.slice(index + token.length).startsWith('. ')
    ) {
      continue;
    }
    if (allowQuotes && (inAnyRange(index, quoted) || inAnyRange(index, blockquoted))) continue;
    if (allowTags && TRAILING_TAG.test(content.slice(index + token.length))) continue;
    if (allowed.has(parseToken(token))) continue;
    violations.push({
      token,
      index,
      context: content.slice(Math.max(0, index - 40), index + token.length + 20).trim(),
    });
  }
  return violations;
}
