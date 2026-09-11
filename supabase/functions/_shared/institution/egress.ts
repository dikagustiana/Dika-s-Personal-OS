// B-4 — the egress check at the tool boundary.
//
// The existing rule is that SAMB internal data may only be processed by
// Anthropic models. A search box, a fetch URL and an API query are third
// parties too. For an internal-lane agent every outbound string — query
// text, URL, request body — is scanned against the internal content in that
// run's context before the request leaves. A match BLOCKS the call and is
// logged (os_inst_egress_blocks + an 'egress.blocked' event the floor shows
// as a refusal at the desk). Not a warning.
//
// What counts as internal content leaving:
//   numbers  — any numeric literal in the outbound text whose reading equals
//              a figure in the internal context, excluding small integers
//              and plausible years (they would block every query: "2023",
//              "3 entities"). Tokenised by numberEcho.numericTokens so the
//              same literal the extractor accepts as "present in the text"
//              is the literal the gate sees leaving.
//   phrases  — any run of SHINGLE consecutive normalised words that also
//              occurs in the internal context. Five words is long enough
//              that ordinary vocabulary does not collide and short enough
//              that a lifted sentence fragment does.
//
// The check is deterministic and over-refuses by design: a false block costs
// a rephrased query; a false pass costs the boundary.

import { numericTokens, tokenReadings } from '../numberEcho.ts';

export interface EgressMatch {
  kind: 'number' | 'phrase';
  excerpt: string;
}

export interface EgressVerdict {
  blocked: boolean;
  matches: EgressMatch[];
}

const SHINGLE = 5;
const EXCERPT_CHARS = 48;
const MAX_HAYSTACK_CHARS = 400_000;

/** Figures small enough, or year-like enough, that blocking them would block language itself. */
export function isSensitiveFigure(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const magnitude = Math.abs(value);
  const isInteger = Number.isInteger(value);
  if (isInteger && magnitude >= 1900 && magnitude <= 2100) return false; // a year
  if (isInteger) return magnitude >= 1000;
  // A decimal: 23.4 (a margin), 0.125 (a rate) are figures; 1.5 alone is not.
  const decimals = String(value).split('.')[1] ?? '';
  return magnitude >= 100 || decimals.length >= 2;
}

export function normaliseWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function shingles(words: string[], size: number): string[] {
  if (words.length < size) return words.length >= 3 ? [words.join(' ')] : [];
  const out: string[] = [];
  for (let i = 0; i + size <= words.length; i += 1) out.push(words.slice(i, i + size).join(' '));
  return out;
}

export interface InternalIndex {
  figures: Set<number>;
  phrases: Set<string>;
}

/** Built once per tool call from the run's internal context. */
export function indexInternal(internal: readonly string[]): InternalIndex {
  const figures = new Set<number>();
  const phrases = new Set<string>();
  let budget = MAX_HAYSTACK_CHARS;
  for (const chunk of internal) {
    if (budget <= 0) break;
    const text = chunk.length > budget ? chunk.slice(0, budget) : chunk;
    budget -= text.length;
    for (const token of numericTokens(text)) {
      for (const reading of tokenReadings(token)) {
        if (isSensitiveFigure(reading)) figures.add(reading);
      }
    }
    for (const shingle of shingles(normaliseWords(text), SHINGLE)) phrases.add(shingle);
  }
  return { figures, phrases };
}

export function checkEgress(outbound: readonly string[], index: InternalIndex): EgressVerdict {
  const matches: EgressMatch[] = [];
  const seen = new Set<string>();
  const record = (kind: EgressMatch['kind'], excerpt: string) => {
    const key = `${kind}:${excerpt}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({ kind, excerpt: excerpt.slice(0, EXCERPT_CHARS) });
  };
  for (const text of outbound) {
    if (!text) continue;
    const decoded = safeDecode(text);
    for (const token of numericTokens(decoded)) {
      if (tokenReadings(token).some((reading) => index.figures.has(reading))) record('number', token);
    }
    for (const shingle of shingles(normaliseWords(decoded), SHINGLE)) {
      if (index.phrases.has(shingle)) record('phrase', shingle);
    }
  }
  return { blocked: matches.length > 0, matches };
}

/** URLs carry their query percent-encoded; the gate reads what the server would. */
function safeDecode(text: string): string {
  try {
    return `${text} ${decodeURIComponent(text.replace(/\+/g, ' '))}`;
  } catch {
    return text;
  }
}
