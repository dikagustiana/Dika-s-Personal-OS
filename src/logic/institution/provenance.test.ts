// B-8 and the synthesis gate. The interesting cases are the refusals: an
// unattributed claim, a citation that resolves to nothing, a figure no cited
// record contains, and an agent trying to wave a number through with its own
// [C] tag.

import { describe, expect, it } from 'vitest';
import {
  allowedNumbersFrom,
  checkEnvelope,
  checkSynthesis,
  citationsIn,
  deriveDataClass,
  isFactualClaim,
} from '../../../supabase/functions/_shared/institution/provenance';

const ID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const RECORDS = [
  { id: ID_A, content: 'BPS reports poultry output of 3.850.000 tonnes in 2023, up from 3.600.000 in 2022.' },
  { id: ID_B, content: 'The regulator lists 412 licensed processors and an average utilisation of 61,5%.' },
];

describe('deriveDataClass', () => {
  it('makes anything an internal agent produces internal', () => {
    expect(deriveDataClass({ agentDataClass: 'internal', briefDataClass: 'public', sourceClasses: ['public'] })).toBe('internal');
  });

  it('makes anything on an internal brief internal', () => {
    expect(deriveDataClass({ agentDataClass: 'public', briefDataClass: 'internal', sourceClasses: [] })).toBe('internal');
  });

  it('propagates the lane through a single internal source', () => {
    expect(deriveDataClass({ agentDataClass: 'public', briefDataClass: 'public', sourceClasses: ['public', 'internal'] })).toBe('internal');
  });

  it('leaves public work public', () => {
    expect(deriveDataClass({ agentDataClass: 'public', briefDataClass: 'public', sourceClasses: ['public'] })).toBe('public');
  });
});

describe('checkEnvelope', () => {
  const base = { title: 'A source', content: 'text', provenance: {}, derivedFrom: [] as string[] };

  it('demands URL, status and timestamp on a retrieval (B-6)', () => {
    const problems = checkEnvelope('retrieval', base);
    expect(problems.map((problem) => problem.field).sort()).toEqual(['fetchedAt', 'httpStatus', 'url']);
  });

  it('accepts a complete retrieval', () => {
    expect(checkEnvelope('retrieval', {
      ...base,
      url: 'https://bps.go.id/x',
      httpStatus: 200,
      fetchedAt: '2026-09-11T00:00:00.000Z',
    })).toEqual([]);
  });

  it('refuses a dataset that names no sources', () => {
    expect(checkEnvelope('dataset', base).map((problem) => problem.field)).toContain('derivedFrom');
  });

  it('demands script, inputs, library version, runtime and seed on an execution (B-7)', () => {
    const problems = checkEnvelope('execution', base).map((problem) => problem.field);
    expect(problems).toEqual([
      'provenance.script',
      'provenance.inputHashes',
      'provenance.stdlibVersion',
      'provenance.runtimeMs',
      'provenance.seed',
    ]);
  });

  it('refuses a methodology note too short to state a method', () => {
    expect(checkEnvelope('methodology', base).map((problem) => problem.field)).toContain('content');
  });
});

describe('citationsIn', () => {
  it('finds corpus markers and drops duplicates', () => {
    expect(citationsIn(`a [corpus:${ID_A}] b [corpus:${ID_A}] c [corpus:${ID_B}]`)).toEqual([ID_A, ID_B]);
  });

  it('ignores a marker that is not a uuid', () => {
    expect(citationsIn('[corpus:not-an-id]')).toEqual([]);
  });
});

describe('isFactualClaim', () => {
  it('counts a sentence with a figure', () => {
    expect(isFactualClaim('Output reached 3.850.000 tonnes in 2023.')).toBe(true);
  });

  it('ignores headings, questions and short fragments', () => {
    expect(isFactualClaim('## Findings')).toBe(false);
    expect(isFactualClaim('What does the regulator publish about utilisation rates?')).toBe(false);
    expect(isFactualClaim('Next.')).toBe(false);
  });

  it('ignores a numbered stated assumption', () => {
    expect(isFactualClaim('Assumption 2: utilisation holds at its 2023 level.')).toBe(false);
  });
});

describe('checkSynthesis', () => {
  it('passes a draft whose every claim cites a record that contains its figures', () => {
    const draft = [
      `Poultry output was 3.850.000 tonnes in 2023 [corpus:${ID_A}].`,
      `There are 412 licensed processors [corpus:${ID_B}].`,
      'Assumption 1: the licence register is complete as published.',
    ].join('\n');
    const check = checkSynthesis(draft, RECORDS);
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.citedIds).toEqual([ID_A, ID_B]);
    expect(check.assumptions).toEqual([1]);
  });

  it('refuses an unattributed factual claim', () => {
    const check = checkSynthesis('Demand grew strongly last year across the sector.', RECORDS);
    expect(check.ok).toBe(false);
    expect(check.problems.some((problem) => problem.kind === 'unattributed')).toBe(true);
  });

  it('refuses a citation that resolves to nothing', () => {
    const check = checkSynthesis('Output rose [corpus:cccccccc-3333-4333-8333-cccccccccccc].', RECORDS);
    expect(check.problems.some((problem) => problem.kind === 'dangling-citation')).toBe(true);
  });

  it('refuses a figure that no cited record contains (G-NUMBER)', () => {
    const check = checkSynthesis(`Output was 4.100.000 tonnes in 2023 [corpus:${ID_A}].`, RECORDS);
    expect(check.problems.some((problem) => problem.kind === 'number')).toBe(true);
    expect(check.numberViolations[0].token).toBe('4.100.000');
  });

  it('does not let an agent mint its own [C] exemption (B-7)', () => {
    const check = checkSynthesis(`Output was 4.100.000 tonnes [C] [corpus:${ID_A}].`, RECORDS);
    expect(check.problems.some((problem) => problem.kind === 'number')).toBe(true);
  });

  it('does not let an agent hide a figure inside quotation marks', () => {
    const check = checkSynthesis(`The analyst wrote "output was 4.100.000 tonnes" [corpus:${ID_A}].`, RECORDS);
    expect(check.problems.some((problem) => problem.kind === 'number')).toBe(true);
  });

  it('only allows numbers from the records the draft cites, not from every record it was given', () => {
    // 412 lives in record B. A draft that cites only record A may not state
    // it, even though the checker was handed B: citing the licence register
    // is what buys the licence figures.
    const check = checkSynthesis(`There are 412 processors [corpus:${ID_A}].`, RECORDS);
    expect(check.problems.some((problem) => problem.kind === 'number')).toBe(true);
    // A draft citing B may.
    expect(checkSynthesis(`There are 412 processors [corpus:${ID_B}].`, RECORDS)
      .problems.some((problem) => problem.kind === 'number')).toBe(false);
    // A draft citing nothing gets nothing allowed, and is unattributed too.
    const none = checkSynthesis('There are 412 processors.', RECORDS);
    expect(none.problems.some((problem) => problem.kind === 'number')).toBe(true);
    expect(none.problems.some((problem) => problem.kind === 'unattributed')).toBe(true);
  });

  it('does not read the digits of a citation marker as figures', () => {
    // [corpus:aaaaaaaa-1111-4111-8111-...] is an address, not prose.
    const check = checkSynthesis(`Output was 3.850.000 tonnes in 2023 [corpus:${ID_A}].`, RECORDS);
    expect(check.numberViolations).toEqual([]);
  });

  it('allows years without a citation, because a year is language', () => {
    expect(allowedNumbersFrom([]).has(2024)).toBe(true);
  });

  it('refuses an empty draft', () => {
    expect(checkSynthesis('   ', RECORDS).problems.some((problem) => problem.kind === 'empty')).toBe(true);
  });
});
