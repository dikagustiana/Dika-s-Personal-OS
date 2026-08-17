// The G-NUMBER scan exists twice on purpose: src/logic/lab/labNumbers.ts
// gates the owner's editor and both repositories; supabase/functions/
// _shared/numberScan.ts gates the DRAFTER where its write happens. Two
// copies of a gate drift, and a drifted gate is two different truths about
// which numbers may ship.
//
// TWO LAYERS OF PINNING, because each catches what the other cannot:
//  §1 Line invariants — the load-bearing constants must be byte-identical.
//     Catches a constant edited in one copy only.
//  §2 Behaviour vectors — canonical inputs asserting IDENTICAL violation
//     sets from both modules, across locales, quotes, blockquotes, list
//     markers, tags, and every option combination. Catches what §1 cannot:
//     a copy that contains all the pinned lines PLUS an extra exemption
//     branch passes §1 and fails here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanNumbers, type ScanOptions } from '../../../supabase/functions/_shared/numberScan';
import type { LabDatapoint } from '../../data/labEvidenceTypes';
import { backedNumbers, checkOutputNumbers } from './labNumbers';

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
  // The separator-aware parse: both locale branches and the fallback.
  String.raw`if (last === lastComma && (tail === 1 || tail === 2)) {`,
  String.raw`if (last === lastDot && tail === 3 && sepCount > 1) {`,
  String.raw`return Number(t.replaceAll(',', ''));`,
  // Quotation spans: straight and curly.
  String.raw`const patterns = [/"[^"]*"/g, /“[^”]*”/g];`,
  // Blockquote detection.
  String.raw`if (/^\s*>/.test(line)) ranges.push([lineStart, lineStart + line.length]);`,
  // The option gates: exemptions consulted, constants untouched.
  String.raw`if (allowQuotes && (inAnyRange(index, quoted) || inAnyRange(index, blockquoted))) continue;`,
  String.raw`if (allowTags && TRAILING_TAG.test(content.slice(index + token.length))) continue;`,
];

describe('§1 line invariants', () => {
  it.each(INVARIANTS.map((invariant) => [invariant]))('both copies carry: %s', (invariant) => {
    expect(clientSource).toContain(invariant);
    expect(serverSource).toContain(invariant);
  });
});

// ---------------------------------------------------------------------------
// §2 behaviour vectors
// ---------------------------------------------------------------------------

function datapoint(value: number, year: number | null = null): LabDatapoint {
  return {
    id: `dp-${value}`,
    value,
    unit: '',
    year,
    geography: '',
    definitionScope: 'a definition long enough to satisfy the gate',
    sourceDocumentId: 's1',
    locator: 'p.1',
    retrievedAt: '2026-08-17T00:00:00Z',
    status: 'V',
    verificationNote: 'checked',
    verifiedAt: '2026-08-17T00:00:00Z',
    volatilityClass: 'static',
    extractionMethod: 'manual',
    internalCheckPassed: null,
  };
}

interface Vector {
  name: string;
  content: string;
  backing: number[];
  options?: ScanOptions;
  /** The violation tokens BOTH copies must report, in order. */
  expect: string[];
}

const VECTORS: Vector[] = [
  // --- backing, both locales -----------------------------------------------
  { name: 'plain backed', content: 'rate is 7.3 now', backing: [7.3], expect: [] },
  { name: 'plain unbacked', content: 'rate is 7.4 now', backing: [7.3], expect: ['7.4'] },
  { name: 'en grouping backed', content: 'total 1,234.56 units', backing: [1234.56], expect: [] },
  { name: 'id decimal backed', content: 'laju 2,15 persen', backing: [2.15], expect: [] },
  { name: 'id decimal NOT backed by 215', content: 'laju 2,15 persen', backing: [215], expect: ['2,15'] },
  { name: 'id grouping backed', content: 'nilai 1.234.567 rupiah', backing: [1234567], expect: [] },
  { name: 'id mixed backed', content: 'nilai 1.234,56 rupiah', backing: [1234.56], expect: [] },
  { name: 'en decimal fallback', content: 'ratio 2.15 here', backing: [2.15], expect: [] },
  { name: 'ambiguous 1.234 reads en', content: 'angka 1.234 tercatat', backing: [1.234], expect: [] },
  { name: 'percent backed', content: 'grew 12% overall', backing: [12], expect: [] },
  { name: 'year backed', content: 'as of 2025 the rate held', backing: [99], expect: ['2025'] },
  { name: 'two tokens one backed', content: '4.1 against 7.3', backing: [7.3], expect: ['4.1'] },
  // --- list markers ----------------------------------------------------------
  { name: 'list marker exempt', content: '1. First point\n2. Second point', backing: [], expect: [] },
  { name: 'list content not exempt', content: '1. Capacity is 9,100 units', backing: [], expect: ['9,100'] },
  // --- quotes and blockquotes, both option states ----------------------------
  { name: 'quoted exempt by default', content: 'says "9,100 units" verbatim', backing: [], expect: [] },
  {
    name: 'quoted NOT exempt with allowQuotes off',
    content: 'says "9,100 units" verbatim',
    backing: [],
    options: { allowQuotes: false },
    expect: ['9,100'],
  },
  {
    name: 'quoted but backed passes with allowQuotes off',
    content: 'says "7.3 percent" verbatim',
    backing: [7.3],
    options: { allowQuotes: false },
    expect: [],
  },
  { name: 'curly quotes exempt by default', content: 'stated “9,100 units” today', backing: [], expect: [] },
  {
    name: 'curly quotes blocked with allowQuotes off',
    content: 'stated “9,100 units” today',
    backing: [],
    options: { allowQuotes: false },
    expect: ['9,100'],
  },
  { name: 'blockquote exempt by default', content: '> capacity 9,100\n\nour view', backing: [], expect: [] },
  {
    name: 'blockquote blocked with allowQuotes off',
    content: '> capacity 9,100\n\nour view',
    backing: [],
    options: { allowQuotes: false },
    expect: ['9,100'],
  },
  // --- tags, both option states ----------------------------------------------
  { name: '[C] exempt by default', content: 'roughly 9,100 [C] units', backing: [], expect: [] },
  { name: '[sim] exempt by default', content: 'projects 12500 [sim] by then', backing: [], expect: [] },
  {
    name: '[C] blocked with allowTags off',
    content: 'roughly 9,100 [C] units',
    backing: [],
    options: { allowTags: false },
    expect: ['9,100'],
  },
  {
    name: '[sim] blocked with allowTags off',
    content: 'projects 12500 [sim] by then',
    backing: [],
    options: { allowTags: false },
    expect: ['12500'],
  },
  {
    name: 'tagged but backed passes with allowTags off',
    content: 'roughly 7.3 [C] percent',
    backing: [7.3],
    options: { allowTags: false },
    expect: [],
  },
  {
    name: 'tag does not cover its neighbour',
    content: 'between 9,100 [C] and 9,900',
    backing: [],
    expect: ['9,900'],
  },
  // --- the drafter posture: everything off ------------------------------------
  {
    name: 'drafter posture blocks quotes AND tags together',
    content: '"9,100" plus 8,200 [C] plus 7.3',
    backing: [7.3],
    options: { allowTags: false, allowQuotes: false },
    expect: ['9,100', '8,200'],
  },
  {
    name: 'drafter posture with full backing passes',
    content: 'in 2025 the rate was 7.3',
    backing: [7.3, 2025],
    options: { allowTags: false, allowQuotes: false },
    expect: [],
  },
];

describe('§2 behaviour vectors — identical violation sets from both copies', () => {
  it.each(VECTORS.map((vector) => [vector.name, vector] as const))('%s', (_, vector) => {
    const clientViolations = checkOutputNumbers(
      vector.content,
      vector.backing.map((value) => datapoint(value)),
      vector.options,
    ).map((violation) => violation.token);
    const serverViolations = scanNumbers(
      vector.content,
      new Set(vector.backing),
      vector.options,
    ).map((violation) => violation.token);
    expect(clientViolations).toEqual(vector.expect);
    expect(serverViolations).toEqual(vector.expect);
  });

  it('backedNumbers and the raw set agree on years', () => {
    const backed = backedNumbers([datapoint(7.3, 2025)]);
    expect(backed.has(2025)).toBe(true);
  });
});
