// The client-side gate mirrors. The SQL suite proves the database enforces
// the same rules with this file bypassed; these tests prove the fast
// failures say the right things, with the offending record named.
import { describe, expect, it } from 'vitest';
import {
  claimApprovalBlockers,
  guardDatapointWrite,
  LabGateError,
  outputFinalizeBlockers,
  verifyBlockedReason,
} from './labEvidenceGuards';
import type {
  LabClaim,
  LabClaimContradiction,
  LabDatapoint,
  LabDatapointConflict,
  LabDatapointWrite,
  LabReference,
} from './labEvidenceTypes';

function write(partial: Partial<LabDatapointWrite>): LabDatapointWrite {
  return {
    value: 1,
    unit: '',
    year: null,
    geography: '',
    definitionScope: 'the exact concept measured, stated fully',
    sourceDocumentId: 'src-1',
    locator: 'p.1',
    volatilityClass: 'static',
    extractionMethod: 'manual',
    ...partial,
  };
}

function datapoint(partial: Partial<LabDatapoint> & Pick<LabDatapoint, 'id'>): LabDatapoint {
  return {
    value: 1,
    unit: '',
    year: null,
    geography: '',
    definitionScope: 'the exact concept measured, stated fully',
    sourceDocumentId: 'src-1',
    locator: 'p.1',
    retrievedAt: '2026-08-17T00:00:00Z',
    status: 'IND',
    verificationNote: '',
    verifiedAt: null,
    volatilityClass: 'static',
    extractionMethod: 'manual',
    internalCheckPassed: null,
    ...partial,
  };
}

function claim(partial: Partial<LabClaim> & Pick<LabClaim, 'id'>): LabClaim {
  return {
    projectId: 'p1',
    statement: 's',
    layer: 'B',
    commitmentSourceId: null,
    evidenceDirection: 'untested',
    status: 'draft',
    approvedByHumanAt: null,
    createdByRunId: null,
    datapointIds: [],
    referenceIds: [],
    ...partial,
  };
}

describe('guardDatapointWrite (G-EXTRACT)', () => {
  it('refuses a short definition_scope, a blank locator, a missing source', () => {
    expect(() => guardDatapointWrite(write({ definitionScope: 'GDP' }))).toThrow(LabGateError);
    expect(() => guardDatapointWrite(write({ locator: '  ' }))).toThrow(LabGateError);
    expect(() => guardDatapointWrite(write({ sourceDocumentId: '' }))).toThrow(LabGateError);
  });
  it('passes a fully-specified write unchanged', () => {
    const input = write({});
    expect(guardDatapointWrite(input)).toBe(input);
  });
});

describe('verifyBlockedReason (G-VERIFY)', () => {
  it('requires a note, and an internal check for agent extractions', () => {
    expect(verifyBlockedReason(datapoint({ id: 'd1' }), '')).toContain('verification_note');
    const agentDp = datapoint({ id: 'd2', extractionMethod: 'agent_from_full_pdf' });
    expect(verifyBlockedReason(agentDp, 'checked')).toContain('internal check');
    expect(
      verifyBlockedReason({ ...agentDp, internalCheckPassed: true }, 'checked'),
    ).toBeNull();
    expect(verifyBlockedReason(datapoint({ id: 'd3' }), 'checked')).toBeNull();
  });
});

describe('claimApprovalBlockers (G-CLAIM)', () => {
  const conflicts: LabDatapointConflict[] = [
    {
      id: 'k1',
      datapointAId: 'dp-v',
      datapointBId: 'dp-other',
      conflictType: 'value_mismatch',
      resolutionStatus: 'unresolved',
      resolutionNote: '',
    },
  ];
  const references: LabReference[] = [
    {
      id: 'r1',
      title: 't',
      authors: '',
      container: '',
      publicationYear: null,
      doi: '',
      url: '',
      verificationLevel: 'abstract_only',
      fullTextPath: '',
    },
  ];

  it('names every failing condition and record', () => {
    const blockers = claimApprovalBlockers({
      claim: claim({ id: 'c1', datapointIds: ['dp-ind', 'dp-v'], referenceIds: ['r1'] }),
      datapoints: [
        datapoint({ id: 'dp-ind', status: 'IND' }),
        datapoint({ id: 'dp-v', status: 'V' }),
      ],
      references,
      conflicts,
    });
    expect(blockers.some((blocker) => blocker.includes('dp-ind'))).toBe(true);
    expect(blockers.some((blocker) => blocker.includes('k1'))).toBe(true);
    expect(blockers.some((blocker) => blocker.includes('r1'))).toBe(true);
  });

  it('requires a commitment source for layer A', () => {
    const blockers = claimApprovalBlockers({
      claim: claim({ id: 'c2', layer: 'A' }),
      datapoints: [],
      references: [],
      conflicts: [],
    });
    expect(blockers.some((blocker) => blocker.includes('commitment source'))).toBe(true);
  });

  it('is empty when every condition holds', () => {
    expect(
      claimApprovalBlockers({
        claim: claim({ id: 'c3', datapointIds: ['dp-clean'] }),
        datapoints: [datapoint({ id: 'dp-clean', status: 'V' })],
        references: [],
        conflicts: [],
      }),
    ).toEqual([]);
  });
});

describe('outputFinalizeBlockers (G-OUTPUT / G-LAYER)', () => {
  const contradictions: LabClaimContradiction[] = [
    {
      id: 'x1',
      claimAId: 'c-yes',
      claimBId: 'c-no',
      severity: 'direct',
      status: 'open',
      resolutionNote: '',
    },
  ];

  it('blocks stale outputs, unapproved citations, and both-sides citation', () => {
    const blockers = outputFinalizeBlockers({
      stale: true,
      citedClaims: [
        claim({ id: 'c-yes', status: 'approved' }),
        claim({ id: 'c-no', status: 'draft' }),
      ],
      contradictions,
    });
    expect(blockers.some((blocker) => blocker.includes('stale'))).toBe(true);
    expect(blockers.some((blocker) => blocker.includes('c-no'))).toBe(true);
    expect(blockers.some((blocker) => blocker.includes('x1'))).toBe(true);
  });

  it('is empty for a clean finalization', () => {
    expect(
      outputFinalizeBlockers({
        stale: false,
        citedClaims: [claim({ id: 'c-ok', status: 'approved' })],
        contradictions: [],
      }),
    ).toEqual([]);
  });
});
