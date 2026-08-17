// G-NUMBER's contract, including the brief's acceptance test in miniature:
// an unbacked figure is caught BY NAME, and the two escape hatches (a
// verified datapoint, an explicit [C]/[sim] tag) both open the gate.
import { describe, expect, it } from 'vitest';
import type { LabDatapoint } from '../../data/labEvidenceTypes';
import { backedNumbers, checkOutputNumbers } from './labNumbers';

function datapoint(partial: Partial<LabDatapoint> & Pick<LabDatapoint, 'id' | 'value'>): LabDatapoint {
  return {
    unit: '',
    year: null,
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
    ...partial,
  };
}

const BACKING = [datapoint({ id: 'dp1', value: 7.3, year: 2025 })];

describe('checkOutputNumbers', () => {
  it('blocks an unbacked figure and names the exact token', () => {
    const violations = checkOutputNumbers(
      'Utilisation stands at 7.3 percent while capacity reached 9,100 units.',
      BACKING,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].token).toBe('9,100');
    expect(violations[0].context).toContain('9,100');
  });

  it('passes a figure a datapoint stands behind — value or year', () => {
    expect(checkOutputNumbers('In 2025 the rate was 7.3 percent.', BACKING)).toEqual([]);
  });

  it('parses grouped tokens numerically: 7,300 is not 7.3', () => {
    const violations = checkOutputNumbers('The figure is 7,300.', BACKING);
    expect(violations.map((violation) => violation.token)).toEqual(['7,300']);
  });

  it('lets quoted numbers through — they belong to the quoted source', () => {
    expect(
      checkOutputNumbers('The report states "capacity reached 9,100 units" verbatim.', BACKING),
    ).toEqual([]);
    expect(
      checkOutputNumbers('> capacity reached 9,100 units\n\nOur own reading differs.', BACKING),
    ).toEqual([]);
  });

  it('lets tagged numbers through: [C] inference and [sim:<id>] naming a matching result', () => {
    expect(checkOutputNumbers('We infer roughly 9,100 [C] units.', BACKING)).toEqual([]);
    // Phase 4: [sim] must NAME the evaluator result and match its value.
    // A bare [sim] — an untraceable simulation claim — no longer exempts.
    expect(
      checkOutputNumbers('The model projects 12500 [sim:aaaabbbb-cccc-dddd-eeee-ffff00001111] by 2025.', BACKING, {
        simResults: [{ id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111', value: 12500 }],
      }),
    ).toEqual([]);
    expect(
      checkOutputNumbers('The model projects 12500 [sim] by 2025.', BACKING).map((violation) => violation.token),
    ).toEqual(['12500']);
  });

  it('does not let a tag on one number cover its neighbour', () => {
    const violations = checkOutputNumbers('Between 9,100 [C] and 9,900 units.', BACKING);
    expect(violations.map((violation) => violation.token)).toEqual(['9,900']);
  });

  it('ignores ordered-list numbering but not list content', () => {
    const violations = checkOutputNumbers('1. First point\n2. Capacity is 9,100 units', BACKING);
    expect(violations.map((violation) => violation.token)).toEqual(['9,100']);
  });

  it('flags every distinct unbacked token, none silently dropped', () => {
    const violations = checkOutputNumbers('Rates of 4.1 and 5.2 against 7.3.', BACKING);
    expect(violations.map((violation) => violation.token)).toEqual(['4.1', '5.2']);
  });
});

describe('backedNumbers', () => {
  it('collects values and years, skipping null years', () => {
    const backed = backedNumbers([
      datapoint({ id: 'a', value: 1.5, year: 2020 }),
      datapoint({ id: 'b', value: 3, year: null }),
    ]);
    expect(backed.has(1.5)).toBe(true);
    expect(backed.has(2020)).toBe(true);
    expect(backed.has(3)).toBe(true);
    expect(backed.size).toBe(3);
  });
});
