// The G-NUMBER scan exists twice on purpose: src/logic/lab/labNumbers.ts
// gates the owner's editor and both repositories; supabase/functions/
// _shared/numberScan.ts gates the DRAFTER where its write happens. Two
// copies of a gate drift, and a drifted gate is two different truths about
// which numbers may ship — so this test reads BOTH FILES OFF DISK and fails
// when the token grammar, the exception markers, or the parsing rule differ.
// (The same mechanism the design-invariant tests use for token discipline.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const clientSource = readFileSync(join(__dirname, 'labNumbers.ts'), 'utf8');
const serverSource = readFileSync(
  join(__dirname, '../../../supabase/functions/_shared/numberScan.ts'),
  'utf8',
);

/** The load-bearing lines that must be byte-identical in both copies. */
const INVARIANTS = [
  // The token grammar: what counts as a number at all.
  String.raw`const NUMBER_TOKEN = /\d+(?:[.,]\d+)*%?/g;`,
  // The exception markers: the only escape hatches.
  String.raw`const TRAILING_TAG = /^\s*\[(?:C|sim)\]/;`,
  String.raw`const LIST_MARKER = /(?:^|\n)\s*$/;`,
  // Numeric parsing: how "1,234" becomes a comparable number.
  String.raw`return Number(token.replace(/%$/, '').replaceAll(',', ''));`,
  // Quotation spans: straight and curly.
  String.raw`const patterns = [/"[^"]*"/g, /“[^”]*”/g];`,
  // Blockquote detection.
  String.raw`if (/^\s*>/.test(line)) ranges.push([lineStart, lineStart + line.length]);`,
];

describe('G-NUMBER client/server drift', () => {
  it.each(INVARIANTS.map((invariant) => [invariant]))('both copies carry: %s', (invariant) => {
    expect(clientSource).toContain(invariant);
    expect(serverSource).toContain(invariant);
  });
});
