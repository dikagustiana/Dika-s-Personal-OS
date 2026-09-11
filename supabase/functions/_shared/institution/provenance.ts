// B-8 — provenance as a required field, and the rules that decide whether a
// piece of writing may leave the tool layer.
//
// Three things live here, all pure:
//   1. corpus envelopes — the fields a record must carry for each kind, and
//      the lane it inherits. The database enforces the same rules (099/100);
//      this is the pre-flight so an agent reads a sentence instead of a
//      PostgREST error, exactly as labGuards.ts is to the boundary trigger.
//   2. citations — [corpus:<uuid>] markers, extracted and resolved.
//   3. the synthesis gate — every factual claim carries a citation or is a
//      numbered stated assumption, and every figure passes G-NUMBER with the
//      agent's own tags switched OFF (B-7: no agent mints its own exemption).

import { scanNumbers, type ScanViolation } from '../numberScan.ts';
import { numericTokens, tokenReadings } from '../numberEcho.ts';
import type { CorpusKind, CorpusRecord, DataClass } from './types.ts';

export const CITATION = /\[corpus:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;
export const ASSUMPTION_LINE = /^\s*assumption\s*(\d+)\s*:/i;

/** Every corpus id cited in a piece of text, in order, deduplicated. */
export function citationsIn(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(CITATION)) {
    const id = match[1].toLowerCase();
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

/**
 * The lane a new record must carry. An output derived from ANY internal
 * input is internal — the same rule os_inst_corpus_guard enforces, stated
 * here so the tool layer never proposes a record the database will refuse.
 */
export function deriveDataClass(inputs: {
  agentDataClass: DataClass;
  briefDataClass: DataClass | null;
  sourceClasses: readonly DataClass[];
}): DataClass {
  if (inputs.agentDataClass === 'internal') return 'internal';
  if (inputs.briefDataClass === 'internal') return 'internal';
  return inputs.sourceClasses.includes('internal') ? 'internal' : 'public';
}

export interface EnvelopeProblem {
  field: string;
  message: string;
}

/** What each kind of record must say before it is worth storing. */
export function checkEnvelope(kind: CorpusKind, record: {
  title: string;
  content: string;
  url?: string | null;
  httpStatus?: number | null;
  fetchedAt?: string | null;
  query?: string | null;
  provenance: Record<string, unknown>;
  derivedFrom: readonly string[];
}): EnvelopeProblem[] {
  const problems: EnvelopeProblem[] = [];
  if (record.title.trim().length < 3) problems.push({ field: 'title', message: 'a record needs a title a reader can recognise' });
  if (record.content.length === 0) problems.push({ field: 'content', message: 'an empty record cannot be cited' });
  if (kind === 'retrieval') {
    if (!record.url) problems.push({ field: 'url', message: 'a retrieval records the URL it came from' });
    if (record.httpStatus === null || record.httpStatus === undefined) {
      problems.push({ field: 'httpStatus', message: 'a retrieval records the HTTP status it got' });
    }
    if (!record.fetchedAt) problems.push({ field: 'fetchedAt', message: 'a retrieval records when it was fetched' });
  }
  if (kind === 'dataset' && record.derivedFrom.length === 0) {
    problems.push({ field: 'derivedFrom', message: 'a dataset names the records it was built from — an un-sourced dataset may not enter analysis' });
  }
  if (kind === 'execution') {
    const p = record.provenance;
    for (const field of ['script', 'inputHashes', 'stdlibVersion', 'runtimeMs', 'seed']) {
      if (p[field] === undefined || p[field] === null) {
        problems.push({ field: `provenance.${field}`, message: `an execution record carries ${field} — B-7: a number without its script, inputs, library version and runtime is not a result` });
      }
    }
  }
  if (kind === 'methodology' && String(record.content).trim().length < 200) {
    problems.push({ field: 'content', message: 'a methodology note states the approach, its assumptions, its critiques and its failure modes — under 200 characters it states none of them' });
  }
  return problems;
}

/**
 * Numbers a draft is allowed to state: every figure appearing in a record it
 * CITES, plus years. Not every record handed to the checker — a draft that
 * cites the licence register does not thereby get to state a figure that
 * only appears in the output statistics.
 */
export function allowedNumbersFrom(records: readonly Pick<CorpusRecord, 'content'>[]): Set<number> {
  const allowed = new Set<number>();
  for (const record of records) {
    for (const token of numericTokens(record.content)) {
      for (const reading of tokenReadings(token)) allowed.add(reading);
    }
  }
  for (let year = 1990; year <= 2100; year += 1) allowed.add(year);
  return allowed;
}

/**
 * Blank out the markup a number scan must not read as prose: the digits
 * inside a [corpus:<uuid>] marker are an address, and the N in
 * "Assumption N:" is a list label. Replaced by spaces of the same length so
 * every reported index still points at the draft the author wrote.
 */
export function maskMarkup(text: string): string {
  const blank = (match: string) => ' '.repeat(match.length);
  return text
    .replace(CITATION, blank)
    .replace(/(^|\n)(\s*assumption\s*)(\d+)(\s*:)/gi, (_whole, lead: string, label: string, digits: string, tail: string) =>
      `${lead}${label}${' '.repeat(digits.length)}${tail}`);
}

export interface Sentence {
  text: string;
  index: number;
}

/** Sentence split good enough to locate an unattributed claim, deliberately dumb. */
export function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  let index = 0;
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const trimmed = raw.trim();
    if (trimmed.length > 0) out.push({ text: trimmed, index });
    index += raw.length + 1;
  }
  return out;
}

/** A sentence asserts a fact when it carries a figure or a factual verb, and is not a heading or a question. */
export function isFactualClaim(sentence: string): boolean {
  const text = sentence.trim();
  if (text.length < 20) return false;
  if (text.endsWith('?')) return false;
  if (/^#{1,6}\s/.test(text)) return false;
  if (/^[-*]\s*$/.test(text)) return false;
  if (ASSUMPTION_LINE.test(text)) return false;
  if (/\d/.test(text)) return true;
  return /\b(is|are|was|were|has|have|reached|grew|fell|rose|accounts for|represents|shows|reports|indicates|found|states)\b/i.test(text);
}

export interface SynthesisProblem {
  kind: 'unattributed' | 'dangling-citation' | 'number' | 'empty';
  detail: string;
  excerpt: string;
}

export interface SynthesisCheck {
  ok: boolean;
  problems: SynthesisProblem[];
  citedIds: string[];
  assumptions: number[];
  numberViolations: ScanViolation[];
}

/**
 * The gate every drafted output passes before it becomes a corpus record.
 *
 * allowTags is FALSE and there is no way to turn it on: B-7 says executed
 * code is not an exemption and no agent may mint itself an exemption tag, so
 * a [C] typed by a model buys nothing here. The allowed set comes from the
 * records the draft actually cites, so a figure is permitted exactly when
 * some cited record contains it.
 */
export function checkSynthesis(
  draft: string,
  records: readonly Pick<CorpusRecord, 'id' | 'content'>[],
): SynthesisCheck {
  const problems: SynthesisProblem[] = [];
  const known = new Set(records.map((record) => record.id.toLowerCase()));
  const citedIds = citationsIn(draft);
  for (const id of citedIds) {
    if (!known.has(id)) {
      problems.push({ kind: 'dangling-citation', detail: `no corpus record ${id}`, excerpt: `[corpus:${id}]` });
    }
  }
  if (draft.trim().length === 0) {
    problems.push({ kind: 'empty', detail: 'an empty draft is not an output', excerpt: '' });
  }

  const assumptions: number[] = [];
  for (const sentence of sentencesOf(draft)) {
    const assumption = ASSUMPTION_LINE.exec(sentence.text);
    if (assumption) {
      assumptions.push(Number(assumption[1]));
      continue;
    }
    if (!isFactualClaim(sentence.text)) continue;
    if (citationsIn(sentence.text).length === 0) {
      problems.push({
        kind: 'unattributed',
        detail: 'a factual claim with no citation and no stated assumption',
        excerpt: sentence.text.slice(0, 160),
      });
    }
  }

  const cited = new Set(citedIds);
  const allowed = allowedNumbersFrom(records.filter((record) => cited.has(record.id.toLowerCase())));
  const numberViolations = scanNumbers(maskMarkup(draft), allowed, { allowTags: false, allowQuotes: false });
  for (const violation of numberViolations) {
    problems.push({
      kind: 'number',
      detail: `G-NUMBER: ${violation.token} is backed by no cited record`,
      excerpt: violation.context,
    });
  }

  return { ok: problems.length === 0, problems, citedIds, assumptions, numberViolations };
}
