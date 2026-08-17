/**
 * Client-side mirrors of the epistemic gates — the fast failure in front of
 * the database triggers that are the actual boundary (20260817000077), same
 * posture as labGuards/researchGuards. Every blocker NAMES the condition
 * and the offending record: a gate that fails without naming the cause will
 * be worked around.
 *
 * These run in both repository implementations (the mock IS these rules;
 * Supabase gets them as pre-flight so the owner reads a sentence instead of
 * a PostgREST error). The SQL suite proves the database enforces the same
 * rules with this file bypassed entirely.
 */
import { checkOutputNumbers, type NumberViolation } from '../logic/lab/labNumbers';
import type {
  LabClaim,
  LabClaimContradiction,
  LabDatapoint,
  LabDatapointConflict,
  LabDatapointWrite,
  LabEvidenceRequirement,
  LabReference,
} from './labEvidenceTypes';

export class LabGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabGateError';
  }
}

/** G-EXTRACT: no source, no locator, no real definition — no row. */
export function guardDatapointWrite(input: LabDatapointWrite): LabDatapointWrite {
  if (!input.sourceDocumentId) {
    throw new LabGateError('G-EXTRACT: a datapoint cannot exist without its source document.');
  }
  if (!input.locator.trim()) {
    throw new LabGateError(
      'G-EXTRACT: no locator — a datapoint you cannot point to inside its document is a rumour with a bibliography.',
    );
  }
  if (input.definitionScope.trim().length < 20) {
    throw new LabGateError(
      'G-EXTRACT: definition_scope must state the exact concept measured (min 20 characters) — a label is not a definition.',
    );
  }
  return input;
}

/** G-VERIFY: why this datapoint cannot reach V (source-matched), or null. */
export function verifyBlockedReason(datapoint: LabDatapoint, note: string): string | null {
  if (datapoint.status === 'V') return null;
  if (!note.trim()) {
    return 'G-VERIFY: a verification_note saying what was compared against what is required.';
  }
  if (datapoint.extractionMethod !== 'manual' && datapoint.internalCheckPassed !== true) {
    return `G-VERIFY: datapoint ${datapoint.id} was agent-extracted and its internal check has not passed — source-match it manually or reconcile the document structure first.`;
  }
  return null;
}

/**
 * G-CLAIM: every reason this claim cannot be approved, each naming its
 * offending record. Empty array = approvable.
 */
export function claimApprovalBlockers(input: {
  claim: LabClaim;
  datapoints: readonly LabDatapoint[];
  references: readonly LabReference[];
  conflicts: readonly LabDatapointConflict[];
  contradictions?: readonly LabClaimContradiction[];
}): string[] {
  const blockers: string[] = [];
  const linkedDatapoints = input.datapoints.filter((dp) =>
    input.claim.datapointIds.includes(dp.id),
  );
  for (const datapoint of linkedDatapoints) {
    if (datapoint.status !== 'V') {
      blockers.push(
        `G-CLAIM: supporting datapoint ${datapoint.id} is not source-matched (${datapoint.status}).`,
      );
    }
    for (const conflict of input.conflicts) {
      if (
        conflict.resolutionStatus === 'unresolved' &&
        (conflict.datapointAId === datapoint.id || conflict.datapointBId === datapoint.id)
      ) {
        blockers.push(
          `G-CLAIM: conflict ${conflict.id} on supporting datapoint ${datapoint.id} is unresolved.`,
        );
      }
    }
  }
  for (const reference of input.references) {
    if (
      input.claim.referenceIds.includes(reference.id) &&
      reference.verificationLevel === 'abstract_only'
    ) {
      blockers.push(
        `G-CLAIM: reference ${reference.id} is abstract_only — an abstract locates a paper, it cannot cite a finding.`,
      );
    }
  }
  if (input.claim.layer === 'A' && !input.claim.commitmentSourceId) {
    blockers.push('G-CLAIM: a layer A claim requires its commitment source.');
  }
  // 1.13: a DIRECT open contradiction blocks approval of either side —
  // tension and scope_difference stay advisory, on purpose.
  for (const contradiction of input.contradictions ?? []) {
    if (
      contradiction.status === 'open' &&
      contradiction.severity === 'direct' &&
      (contradiction.claimAId === input.claim.id || contradiction.claimBId === input.claim.id)
    ) {
      const opposing =
        contradiction.claimAId === input.claim.id ? contradiction.claimBId : contradiction.claimAId;
      blockers.push(
        `G-CLAIM: this claim is one side of open DIRECT contradiction ${contradiction.id} with claim ${opposing} — resolve it first.`,
      );
    }
  }
  // Phase 2: the step from evidence to statement is part of the claim. B
  // names its evidence and how the evidence yields the statement; for C the
  // step IS the contribution, so it gets recorded, not implied.
  if (input.claim.layer === 'B') {
    if (input.claim.datapointIds.length === 0 && input.claim.referenceIds.length === 0) {
      blockers.push(
        `G-CLAIM: claim ${input.claim.id} is layer B (a verified finding) and cannot be approved with no evidence linked — link the datapoints or references it rests on, or record it as layer C.`,
      );
    }
    if (input.claim.inferenceStep.trim().length < 20) {
      blockers.push(
        `G-CLAIM: claim ${input.claim.id} is layer B and cannot be approved without an inference step (min 20 chars) saying how the linked evidence yields the statement.`,
      );
    }
  }
  if (input.claim.layer === 'C' && input.claim.inferenceStep.trim().length < 20) {
    blockers.push(
      `G-CLAIM: claim ${input.claim.id} is layer C (an inference) and cannot be approved without an inference step (min 20 chars) — the step is the contribution.`,
    );
  }
  return blockers;
}

/**
 * G-OUTPUT: every reason this output cannot finalize. Empty = may.
 * The optional G-FALSIFY inputs (phase 2): when the output declares which
 * sub-questions it addresses, each must carry at least one SATISFIED
 * evidence requirement — otherwise the falsifier never got its chance to
 * bite. Callers without the question layer omit both and lose nothing.
 */
export function outputFinalizeBlockers(input: {
  stale: boolean;
  citedClaims: readonly LabClaim[];
  contradictions: readonly LabClaimContradiction[];
  addressedSubQuestionIds?: readonly string[];
  requirements?: readonly LabEvidenceRequirement[];
}): string[] {
  const blockers: string[] = [];
  if (input.stale) {
    blockers.push(
      'G-OUTPUT: this output is stale — supporting evidence moved; re-review its claims and clear the flag first.',
    );
  }
  for (const claim of input.citedClaims) {
    if (claim.status !== 'approved') {
      blockers.push(`G-OUTPUT: cited claim ${claim.id} is not approved (${claim.status}).`);
    }
  }
  const citedIds = new Set(input.citedClaims.map((claim) => claim.id));
  for (const contradiction of input.contradictions) {
    if (
      contradiction.status === 'open' &&
      citedIds.has(contradiction.claimAId) &&
      citedIds.has(contradiction.claimBId)
    ) {
      blockers.push(
        `G-LAYER: this output cites both sides of open contradiction ${contradiction.id} — resolve it first.`,
      );
    }
  }
  for (const subQuestionId of input.addressedSubQuestionIds ?? []) {
    const satisfied = (input.requirements ?? []).some(
      (requirement) =>
        requirement.subQuestionId === subQuestionId &&
        (requirement.satisfiedByDatapointId !== null || requirement.satisfiedByReferenceId !== null),
    );
    if (!satisfied) {
      blockers.push(
        `G-FALSIFY: sub-question ${subQuestionId} has no satisfied evidence requirement — the falsifier was never given its chance to bite. Satisfy a requirement or unlink the sub-question.`,
      );
    }
  }
  return blockers;
}

/**
 * G-NUMBER on the save path: throws with every offending token named. The
 * route forward is exactly what the panel offers — create a verified
 * datapoint, or tag the figure [C] (inference) / [sim] (model output).
 */
export function guardOutputContent(
  content: string,
  backingDatapoints: readonly LabDatapoint[],
): NumberViolation[] {
  return checkOutputNumbers(content, backingDatapoints);
}

export function formatNumberViolations(violations: readonly NumberViolation[]): string {
  return (
    'G-NUMBER: ' +
    violations
      .map((violation) => `"${violation.token}" (…${violation.context}…)`)
      .join('; ') +
    ' — no datapoint stands behind these. Create one, or tag the figure [C] (inference) or [sim] (model output).'
  );
}
