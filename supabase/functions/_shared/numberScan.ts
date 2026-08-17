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
  return Number(token.replace(/%$/, '').replaceAll(',', ''));
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

/** Scans content against the allowed numbers (datapoint values and years). */
export function scanNumbers(content: string, allowed: ReadonlySet<number>): ScanViolation[] {
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
    if (inAnyRange(index, quoted) || inAnyRange(index, blockquoted)) continue;
    if (TRAILING_TAG.test(content.slice(index + token.length))) continue;
    if (allowed.has(parseToken(token))) continue;
    violations.push({
      token,
      index,
      context: content.slice(Math.max(0, index - 40), index + token.length + 20).trim(),
    });
  }
  return violations;
}
