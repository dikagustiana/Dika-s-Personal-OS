/**
 * The epistemic layer's data seam.
 *
 * Same shape as labRepository/researchRepository, and the same philosophy:
 * the invariants ride the mutation path, not the UI. Note what is ABSENT —
 * no setApprovedByHumanAt, no setVerifiedAt, no updateClaimStatement-on-
 * approved, no deleteRun-style escape hatches. Approval and verification
 * happen only through approveClaim/verifyDatapoint, which the database
 * gates re-check with this file bypassed (see 20260817000077 and
 * supabase/tests/lab_epistemic_gates.sql).
 *
 * G-NUMBER runs HERE, in saveOutputContent, in both implementations: an
 * output whose numbers nothing stands behind does not save, whoever calls.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  claimApprovalBlockers,
  formatNumberViolations,
  guardDatapointWrite,
  guardOutputContent,
  LabGateError,
  outputFinalizeBlockers,
  verifyBlockedReason,
} from './labEvidenceGuards';
import { okRows, readAbsence, type ReadResult } from './readResult';
import type {
  LabCandidateSource,
  LabClaim,
  LabModelResult,
  LabModelSpec,
  LabModelSpecParam,
  LabClaimContradiction,
  LabClaimWrite,
  LabCommitmentSource,
  LabConflictResolution,
  LabConflictType,
  LabContradictionSeverity,
  LabDatapoint,
  LabDatapointConflict,
  LabDatapointWrite,
  LabDocType,
  LabEvidenceRequirement,
  LabFramingSource,
  LabOutput,
  LabOutputType,
  LabProject,
  LabQuestion,
  LabReference,
  LabRequirementKind,
  LabSourceDocument,
  LabSubQuestion,
  LabTask,
  LabWorkflow,
} from './labEvidenceTypes';

export interface LabSourceDocumentWrite {
  title: string;
  publisher: string;
  publicationDate: string | null;
  docType: LabDocType;
  url: string;
  localSnapshotPath: string;
  snapshotHash: string;
}

export interface LabReferenceWrite {
  title: string;
  authors: string;
  container: string;
  publicationYear: number | null;
  doi: string;
  url: string;
}

export interface LabCommitmentSourceWrite {
  projectId: string;
  title: string;
  type: LabCommitmentSource['type'];
  committedAt: string;
  documentPath: string;
}

export interface LabEvidenceRepository {
  listProjects(): Promise<ReadResult<LabProject>>;
  createProject(input: { name: string; researchQuestion: string }): Promise<LabProject>;
  /** The five seeded routes plus anything the owner added; canonical first. */
  listWorkflows(): Promise<ReadResult<LabWorkflow>>;
  /** null = back to the canonical route. Owner act; the guard enforces it. */
  setProjectWorkflow(projectId: string, workflowId: string | null): Promise<LabProject>;

  listSourceDocuments(): Promise<ReadResult<LabSourceDocument>>;
  createSourceDocument(input: LabSourceDocumentWrite): Promise<LabSourceDocument>;

  listReferences(): Promise<ReadResult<LabReference>>;
  /** Born abstract_only, always — full_text_read is a claim about reading. */
  createReference(input: LabReferenceWrite): Promise<LabReference>;
  promoteReference(id: string, fullTextPath: string): Promise<LabReference>;

  listCommitmentSources(): Promise<ReadResult<LabCommitmentSource>>;
  createCommitmentSource(input: LabCommitmentSourceWrite): Promise<LabCommitmentSource>;

  listDatapoints(): Promise<ReadResult<LabDatapoint>>;
  createDatapoint(input: LabDatapointWrite): Promise<LabDatapoint>;
  /** The one path to V. The database re-checks every condition. */
  verifyDatapoint(id: string, note: string): Promise<LabDatapoint>;

  listConflicts(): Promise<ReadResult<LabDatapointConflict>>;
  createConflict(input: {
    datapointAId: string;
    datapointBId: string;
    conflictType: LabConflictType;
  }): Promise<LabDatapointConflict>;
  resolveConflict(
    id: string,
    resolution: Exclude<LabConflictResolution, 'unresolved'>,
    note: string,
  ): Promise<LabDatapointConflict>;

  listClaims(): Promise<ReadResult<LabClaim>>;
  createClaim(input: LabClaimWrite): Promise<LabClaim>;
  linkClaimDatapoint(claimId: string, datapointId: string): Promise<void>;
  linkClaimReference(claimId: string, referenceId: string): Promise<void>;
  unlinkClaimDatapoint(claimId: string, datapointId: string): Promise<void>;
  unlinkClaimReference(claimId: string, referenceId: string): Promise<void>;
  /** The only path to approved; the guard stamps approved_by_human_at. */
  approveClaim(id: string): Promise<LabClaim>;
  demoteClaim(id: string, to: 'draft' | 'reviewed'): Promise<LabClaim>;

  listContradictions(): Promise<ReadResult<LabClaimContradiction>>;
  createContradiction(input: {
    claimAId: string;
    claimBId: string;
    severity: LabContradictionSeverity;
  }): Promise<LabClaimContradiction>;
  resolveContradiction(id: string, note: string): Promise<LabClaimContradiction>;

  listOutputs(): Promise<ReadResult<LabOutput>>;
  createOutput(input: { projectId: string; outputType: LabOutputType }): Promise<LabOutput>;
  /**
   * G-NUMBER lives here: refuses (naming every token) when the content
   * carries numbers the backing datapoints cannot stand behind.
   */
  saveOutputContent(
    id: string,
    content: string,
    backingDatapoints: readonly LabDatapoint[],
    simResults?: ReadonlyArray<{ id: string; value: number }>,
  ): Promise<LabOutput>;
  linkOutputClaim(outputId: string, claimId: string): Promise<void>;
  unlinkOutputClaim(outputId: string, claimId: string): Promise<void>;
  finalizeOutput(id: string): Promise<LabOutput>;
  revertOutputToDraft(id: string): Promise<LabOutput>;
  clearOutputStale(id: string): Promise<LabOutput>;

  /** The coordinator's delegations, newest first. */
  listTasks(): Promise<ReadResult<LabTask>>;
  updateTaskStatus(id: string, status: LabTask['status'], detail?: string): Promise<LabTask>;

  // The question layer (FRAMER intake, 080). All writes are owner acts —
  // the framer proposes JSON; nothing here is callable by an agent.
  listQuestions(): Promise<ReadResult<LabQuestion>>;
  createQuestion(input: {
    projectId: string;
    rawStatement: string;
    framedQuestion: string;
    framingSource: LabFramingSource;
  }): Promise<LabQuestion>;
  /** raw_statement is frozen at intake; reframing edits only the framing. */
  reframeQuestion(
    id: string,
    framedQuestion: string,
    framingSource: LabFramingSource,
  ): Promise<LabQuestion>;
  listSubQuestions(): Promise<ReadResult<LabSubQuestion>>;
  createSubQuestion(input: {
    questionId: string;
    statement: string;
    falsifier: string;
    position?: number;
  }): Promise<LabSubQuestion>;
  listEvidenceRequirements(): Promise<ReadResult<LabEvidenceRequirement>>;
  createEvidenceRequirement(input: {
    subQuestionId: string;
    description: string;
    kind: LabRequirementKind;
  }): Promise<LabEvidenceRequirement>;
  /** Only earned evidence lands — G-FALSIFY refuses the rest by name. */
  satisfyRequirement(
    id: string,
    by: { datapointId?: string; referenceId?: string; modelResultId?: string },
  ): Promise<LabEvidenceRequirement>;
  linkOutputSubQuestion(outputId: string, subQuestionId: string): Promise<void>;
  unlinkOutputSubQuestion(outputId: string, subQuestionId: string): Promise<void>;

  // Curation (SCOUT, 081). The tier is trigger-computed from the owner's
  // allowlist on every write; nothing here can set it.
  listCandidateSources(): Promise<ReadResult<LabCandidateSource>>;
  createCandidateSource(input: {
    projectId: string | null;
    title: string;
    publisher: string;
    url: string;
    claimedDate: string | null;
  }): Promise<LabCandidateSource>;
  /** Owner-only, and the source document (with its snapshot) must exist. */
  promoteCandidate(id: string, sourceDocumentId: string): Promise<LabCandidateSource>;
  dismissCandidate(id: string): Promise<LabCandidateSource>;

  // The MODELER (082). Specs are declarative; approval needs the owner's
  // OWN rationale; results are immutable and their checks are rows.
  listModelSpecs(): Promise<ReadResult<LabModelSpec>>;
  listModelSpecParams(): Promise<ReadResult<LabModelSpecParam>>;
  listModelResults(): Promise<ReadResult<LabModelResult>>;
  approveModelSpec(id: string, rationale: string): Promise<LabModelSpec>;
  demoteModelSpec(id: string): Promise<LabModelSpec>;
  /** The manual path: a result computed OUTSIDE this system, owner-registered. */
  registerExternalModelResult(input: {
    specId: string;
    value: number;
    unit: string;
    note: string;
  }): Promise<LabModelResult>;

  /** Applies the standing expiry policy now; returns how many V reverted. */
  staleSweep(): Promise<number>;

  /**
   * The newest sweep heartbeat (079), or none — the Flow rail's honesty
   * anchor: "no flags today" and "the sweep did not run" are different
   * facts, and only this row can tell them apart. Read-only; the sweep
   * function is the only writer.
   */
  latestSweep(): Promise<ReadResult<LabSweepBeat>>;
}

export interface LabSweepBeat {
  ranAt: string;
  rowsDemoted: number;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
  research_question: string;
  status: LabProject['status'];
  wip_slot: number | null;
  workflow_id?: string | null;
}

interface WorkflowRow {
  id: string;
  name: string;
  stage_codes: string[];
  is_canonical: boolean;
}

interface SourceRow {
  id: string;
  title: string;
  publisher: string;
  publication_date: string | null;
  doc_type: LabDocType;
  url: string;
  local_snapshot_path: string;
  snapshot_hash: string;
  retrieved_at: string;
  last_rechecked_at: string | null;
  content_changed_at: string | null;
}

interface CandidateRow {
  id: string;
  project_id: string | null;
  title: string;
  publisher: string;
  url: string;
  claimed_date: string | null;
  tier: 1 | 2 | 3;
  status: LabCandidateSource['status'];
  promoted_source_document_id: string | null;
  created_by_run_id: string | null;
}

function mapCandidate(row: CandidateRow): LabCandidateSource {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    publisher: row.publisher,
    url: row.url,
    claimedDate: row.claimed_date,
    tier: row.tier,
    status: row.status,
    promotedSourceDocumentId: row.promoted_source_document_id,
    createdByRunId: row.created_by_run_id,
  };
}

interface DatapointRow {
  id: string;
  value: number | string;
  unit: string;
  year: number | null;
  geography: string;
  definition_scope: string;
  source_document_id: string;
  locator: string;
  retrieved_at: string;
  status: LabDatapoint['status'];
  verification_note: string;
  verified_at: string | null;
  volatility_class: LabDatapoint['volatilityClass'];
  extraction_method: LabDatapoint['extractionMethod'];
  internal_check_passed: boolean | null;
}

interface ConflictRow {
  id: string;
  datapoint_a_id: string;
  datapoint_b_id: string;
  conflict_type: LabConflictType;
  resolution_status: LabConflictResolution;
  resolution_note: string;
}

interface ReferenceRow {
  id: string;
  title: string;
  authors: string;
  container: string;
  publication_year: number | null;
  doi: string;
  url: string;
  verification_level: LabReference['verificationLevel'];
  full_text_path: string;
}

interface CommitmentRow {
  id: string;
  project_id: string;
  title: string;
  type: LabCommitmentSource['type'];
  committed_at: string;
  document_path: string;
}

interface ClaimRow {
  id: string;
  project_id: string;
  statement: string;
  layer: LabClaim['layer'];
  commitment_source_id: string | null;
  evidence_direction: LabClaim['evidenceDirection'];
  status: LabClaim['status'];
  approved_by_human_at: string | null;
  created_by_run_id: string | null;
  inference_step: string;
  os_lab_claim_datapoints?: Array<{ datapoint_id: string }>;
  os_lab_claim_references?: Array<{ reference_id: string }>;
}

interface QuestionRow {
  id: string;
  project_id: string;
  raw_statement: string;
  framed_question: string;
  framing_source: LabFramingSource;
}

interface SubQuestionRow {
  id: string;
  question_id: string;
  statement: string;
  falsifier: string;
  position: number;
}

interface RequirementRow {
  id: string;
  sub_question_id: string;
  description: string;
  kind: LabRequirementKind;
  satisfied_by_datapoint_id: string | null;
  satisfied_by_reference_id: string | null;
  satisfied_by_model_result_id: string | null;
  satisfied_at: string | null;
}

interface ModelSpecRow {
  id: string;
  project_id: string;
  name: string;
  kind: LabModelSpec['kind'];
  spec: Record<string, unknown>;
  spec_hash: string;
  rationale: string;
  status: LabModelSpec['status'];
  approved_by_human_at: string | null;
  created_by_run_id: string | null;
}

interface ModelParamRow {
  id: string;
  spec_id: string;
  name: string;
  kind: LabModelSpecParam['kind'];
  datapoint_id: string | null;
  value: number | string | null;
  unit: string;
  justification_reference_id: string | null;
  distribution: Record<string, unknown> | null;
}

interface ModelResultRow {
  id: string;
  spec_id: string;
  evaluator_version: string;
  seed: number | null;
  result_value: number | string | null;
  result_unit: string;
  result_summary: Record<string, unknown>;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  checks_passed: boolean;
  sensitivity_passed: boolean | null;
  input_datapoint_ids: string[];
  stale_input: boolean;
  external: boolean;
  external_note: string;
  created_at: string;
}

function mapModelSpec(row: ModelSpecRow): LabModelSpec {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    spec: row.spec,
    specHash: row.spec_hash,
    rationale: row.rationale,
    status: row.status,
    approvedByHumanAt: row.approved_by_human_at,
    createdByRunId: row.created_by_run_id,
  };
}

function mapModelParam(row: ModelParamRow): LabModelSpecParam {
  return {
    id: row.id,
    specId: row.spec_id,
    name: row.name,
    kind: row.kind,
    datapointId: row.datapoint_id,
    value: row.value === null ? null : Number(row.value),
    unit: row.unit,
    justificationReferenceId: row.justification_reference_id,
    distribution: row.distribution,
  };
}

function mapModelResult(row: ModelResultRow): LabModelResult {
  return {
    id: row.id,
    specId: row.spec_id,
    evaluatorVersion: row.evaluator_version,
    seed: row.seed,
    resultValue: row.result_value === null ? null : Number(row.result_value),
    resultUnit: row.result_unit,
    resultSummary: row.result_summary,
    checks: row.checks,
    checksPassed: row.checks_passed,
    sensitivityPassed: row.sensitivity_passed,
    inputDatapointIds: row.input_datapoint_ids,
    staleInput: row.stale_input,
    external: row.external,
    externalNote: row.external_note,
    createdAt: row.created_at,
  };
}

function mapQuestion(row: QuestionRow): LabQuestion {
  return {
    id: row.id,
    projectId: row.project_id,
    rawStatement: row.raw_statement,
    framedQuestion: row.framed_question,
    framingSource: row.framing_source,
  };
}

function mapSubQuestion(row: SubQuestionRow): LabSubQuestion {
  return {
    id: row.id,
    questionId: row.question_id,
    statement: row.statement,
    falsifier: row.falsifier,
    position: row.position,
  };
}

function mapRequirement(row: RequirementRow): LabEvidenceRequirement {
  return {
    id: row.id,
    subQuestionId: row.sub_question_id,
    description: row.description,
    kind: row.kind,
    satisfiedByDatapointId: row.satisfied_by_datapoint_id,
    satisfiedByReferenceId: row.satisfied_by_reference_id,
    satisfiedByModelResultId: row.satisfied_by_model_result_id,
    satisfiedAt: row.satisfied_at,
  };
}

interface ContradictionRow {
  id: string;
  claim_a_id: string;
  claim_b_id: string;
  severity: LabContradictionSeverity;
  status: LabClaimContradiction['status'];
  resolution_note: string;
}

interface TaskRow {
  id: string;
  project_id: string | null;
  title: string;
  agent_slug: string;
  input: string;
  status: LabTask['status'];
  detail: string;
  run_id: string | null;
  created_at: string;
}

function mapTask(row: TaskRow): LabTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    agentSlug: row.agent_slug,
    input: row.input,
    status: row.status,
    detail: row.detail,
    runId: row.run_id,
    createdAt: row.created_at,
  };
}

interface OutputRow {
  id: string;
  project_id: string;
  output_type: LabOutputType;
  content: string;
  status: LabOutput['status'];
  stale: boolean;
  generated_by_run_id: string | null;
  os_lab_output_claims?: Array<{ claim_id: string }>;
  os_lab_output_sub_questions?: Array<{ sub_question_id: string }>;
}

function mapProject(row: ProjectRow): LabProject {
  return {
    id: row.id,
    name: row.name,
    researchQuestion: row.research_question,
    status: row.status,
    wipSlot: row.wip_slot,
    workflowId: row.workflow_id ?? null,
  };
}

function mapWorkflow(row: WorkflowRow): LabWorkflow {
  return {
    id: row.id,
    name: row.name,
    stageCodes: row.stage_codes,
    isCanonical: row.is_canonical,
  };
}

function mapSource(row: SourceRow): LabSourceDocument {
  return {
    id: row.id,
    title: row.title,
    publisher: row.publisher,
    publicationDate: row.publication_date,
    docType: row.doc_type,
    url: row.url,
    localSnapshotPath: row.local_snapshot_path,
    snapshotHash: row.snapshot_hash,
    retrievedAt: row.retrieved_at,
    lastRecheckedAt: row.last_rechecked_at,
    contentChangedAt: row.content_changed_at,
  };
}

function mapDatapoint(row: DatapointRow): LabDatapoint {
  return {
    id: row.id,
    value: Number(row.value),
    unit: row.unit,
    year: row.year,
    geography: row.geography,
    definitionScope: row.definition_scope,
    sourceDocumentId: row.source_document_id,
    locator: row.locator,
    retrievedAt: row.retrieved_at,
    status: row.status,
    verificationNote: row.verification_note,
    verifiedAt: row.verified_at,
    volatilityClass: row.volatility_class,
    extractionMethod: row.extraction_method,
    internalCheckPassed: row.internal_check_passed,
  };
}

function mapConflict(row: ConflictRow): LabDatapointConflict {
  return {
    id: row.id,
    datapointAId: row.datapoint_a_id,
    datapointBId: row.datapoint_b_id,
    conflictType: row.conflict_type,
    resolutionStatus: row.resolution_status,
    resolutionNote: row.resolution_note,
  };
}

function mapReference(row: ReferenceRow): LabReference {
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    container: row.container,
    publicationYear: row.publication_year,
    doi: row.doi,
    url: row.url,
    verificationLevel: row.verification_level,
    fullTextPath: row.full_text_path,
  };
}

function mapCommitment(row: CommitmentRow): LabCommitmentSource {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    type: row.type,
    committedAt: row.committed_at,
    documentPath: row.document_path,
  };
}

function mapClaim(row: ClaimRow): LabClaim {
  return {
    id: row.id,
    projectId: row.project_id,
    statement: row.statement,
    layer: row.layer,
    commitmentSourceId: row.commitment_source_id,
    evidenceDirection: row.evidence_direction,
    status: row.status,
    approvedByHumanAt: row.approved_by_human_at,
    createdByRunId: row.created_by_run_id,
    inferenceStep: row.inference_step,
    datapointIds: (row.os_lab_claim_datapoints ?? []).map((link) => link.datapoint_id),
    referenceIds: (row.os_lab_claim_references ?? []).map((link) => link.reference_id),
  };
}

function mapContradiction(row: ContradictionRow): LabClaimContradiction {
  return {
    id: row.id,
    claimAId: row.claim_a_id,
    claimBId: row.claim_b_id,
    severity: row.severity,
    status: row.status,
    resolutionNote: row.resolution_note,
  };
}

function mapOutput(row: OutputRow): LabOutput {
  return {
    id: row.id,
    projectId: row.project_id,
    outputType: row.output_type,
    content: row.content,
    status: row.status,
    stale: row.stale,
    generatedByRunId: row.generated_by_run_id,
    claimIds: (row.os_lab_output_claims ?? []).map((link) => link.claim_id),
    subQuestionIds: (row.os_lab_output_sub_questions ?? []).map((link) => link.sub_question_id),
  };
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

export function createSupabaseLabEvidenceRepository(client: SupabaseClient): LabEvidenceRepository {
  const fail = (operation: string, message: string): never => {
    throw new Error(`${operation}: ${message}`);
  };

  return {
    async listProjects() {
      const { data, error } = await client.from('os_lab_projects').select('*').order('name');
      if (error) return readAbsence('listLabProjects', error);
      return okRows(((data ?? []) as ProjectRow[]).map(mapProject));
    },
    async createProject(input) {
      const { data, error } = await client
        .from('os_lab_projects')
        .insert({ name: input.name, research_question: input.researchQuestion })
        .select()
        .single();
      if (error) fail('createProject', error.message);
      return mapProject(data as ProjectRow);
    },
    async listWorkflows() {
      const { data, error } = await client
        .from('os_lab_workflows')
        .select('*')
        .order('is_canonical', { ascending: false })
        .order('name');
      if (error) return readAbsence('listLabWorkflows', error);
      return okRows(((data ?? []) as WorkflowRow[]).map(mapWorkflow));
    },
    async setProjectWorkflow(projectId, workflowId) {
      const { data, error } = await client
        .from('os_lab_projects')
        .update({ workflow_id: workflowId })
        .eq('id', projectId)
        .select()
        .single();
      if (error) fail('setProjectWorkflow', error.message);
      return mapProject(data as ProjectRow);
    },

    async listSourceDocuments() {
      const { data, error } = await client
        .from('os_lab_source_documents')
        .select('*')
        .order('retrieved_at', { ascending: false });
      if (error) return readAbsence('listLabSourceDocuments', error);
      return okRows(((data ?? []) as SourceRow[]).map(mapSource));
    },
    async createSourceDocument(input) {
      const { data, error } = await client
        .from('os_lab_source_documents')
        .insert({
          title: input.title,
          publisher: input.publisher,
          publication_date: input.publicationDate,
          doc_type: input.docType,
          url: input.url,
          local_snapshot_path: input.localSnapshotPath,
          snapshot_hash: input.snapshotHash,
        })
        .select()
        .single();
      if (error) fail('createSourceDocument', error.message);
      return mapSource(data as SourceRow);
    },

    async listReferences() {
      const { data, error } = await client.from('os_lab_references').select('*').order('title');
      if (error) return readAbsence('listLabReferences', error);
      return okRows(((data ?? []) as ReferenceRow[]).map(mapReference));
    },
    async createReference(input) {
      const { data, error } = await client
        .from('os_lab_references')
        .insert({
          title: input.title,
          authors: input.authors,
          container: input.container,
          publication_year: input.publicationYear,
          doi: input.doi,
          url: input.url,
        })
        .select()
        .single();
      if (error) fail('createReference', error.message);
      return mapReference(data as ReferenceRow);
    },
    async promoteReference(id, fullTextPath) {
      const { data, error } = await client
        .from('os_lab_references')
        .update({ verification_level: 'full_text_read', full_text_path: fullTextPath })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('promoteReference', error.message);
      return mapReference(data as ReferenceRow);
    },

    async listCommitmentSources() {
      const { data, error } = await client
        .from('os_lab_commitment_sources')
        .select('*')
        .order('committed_at', { ascending: false });
      if (error) return readAbsence('listLabCommitmentSources', error);
      return okRows(((data ?? []) as CommitmentRow[]).map(mapCommitment));
    },
    async createCommitmentSource(input) {
      const { data, error } = await client
        .from('os_lab_commitment_sources')
        .insert({
          project_id: input.projectId,
          title: input.title,
          type: input.type,
          committed_at: input.committedAt,
          document_path: input.documentPath,
        })
        .select()
        .single();
      if (error) fail('createCommitmentSource', error.message);
      return mapCommitment(data as CommitmentRow);
    },

    async listDatapoints() {
      const { data, error } = await client
        .from('os_lab_datapoints')
        .select('*')
        .order('retrieved_at', { ascending: false });
      if (error) return readAbsence('listLabDatapoints', error);
      return okRows(((data ?? []) as DatapointRow[]).map(mapDatapoint));
    },
    async createDatapoint(input) {
      const guarded = guardDatapointWrite(input);
      const { data, error } = await client
        .from('os_lab_datapoints')
        .insert({
          value: guarded.value,
          unit: guarded.unit,
          year: guarded.year,
          geography: guarded.geography,
          definition_scope: guarded.definitionScope,
          source_document_id: guarded.sourceDocumentId,
          locator: guarded.locator,
          volatility_class: guarded.volatilityClass,
          extraction_method: guarded.extractionMethod,
          ...(guarded.status ? { status: guarded.status } : {}),
        })
        .select()
        .single();
      if (error) fail('createDatapoint', error.message);
      return mapDatapoint(data as DatapointRow);
    },
    async verifyDatapoint(id, note) {
      const { data, error } = await client
        .from('os_lab_datapoints')
        .update({ status: 'V', verification_note: note })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('verifyDatapoint', error.message);
      return mapDatapoint(data as DatapointRow);
    },

    async listConflicts() {
      const { data, error } = await client
        .from('os_lab_datapoint_conflicts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabConflicts', error);
      return okRows(((data ?? []) as ConflictRow[]).map(mapConflict));
    },
    async createConflict(input) {
      const { data, error } = await client
        .from('os_lab_datapoint_conflicts')
        .insert({
          datapoint_a_id: input.datapointAId,
          datapoint_b_id: input.datapointBId,
          conflict_type: input.conflictType,
        })
        .select()
        .single();
      if (error) fail('createConflict', error.message);
      return mapConflict(data as ConflictRow);
    },
    async resolveConflict(id, resolution, note) {
      const { data, error } = await client
        .from('os_lab_datapoint_conflicts')
        .update({ resolution_status: resolution, resolution_note: note })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('resolveConflict', error.message);
      return mapConflict(data as ConflictRow);
    },

    async listClaims() {
      const { data, error } = await client
        .from('os_lab_claims')
        .select('*, os_lab_claim_datapoints(datapoint_id), os_lab_claim_references(reference_id)')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabClaims', error);
      return okRows(((data ?? []) as ClaimRow[]).map(mapClaim));
    },
    async createClaim(input) {
      const { data, error } = await client
        .from('os_lab_claims')
        .insert({
          project_id: input.projectId,
          statement: input.statement,
          layer: input.layer,
          commitment_source_id: input.commitmentSourceId,
          evidence_direction: input.evidenceDirection,
          inference_step: input.inferenceStep ?? '',
          created_by_run_id: input.createdByRunId ?? null,
        })
        .select()
        .single();
      if (error) fail('createClaim', error.message);
      return mapClaim(data as ClaimRow);
    },
    async linkClaimDatapoint(claimId, datapointId) {
      const { error } = await client
        .from('os_lab_claim_datapoints')
        .insert({ claim_id: claimId, datapoint_id: datapointId });
      if (error) fail('linkClaimDatapoint', error.message);
    },
    async linkClaimReference(claimId, referenceId) {
      const { error } = await client
        .from('os_lab_claim_references')
        .insert({ claim_id: claimId, reference_id: referenceId });
      if (error) fail('linkClaimReference', error.message);
    },
    async unlinkClaimDatapoint(claimId, datapointId) {
      const { error } = await client
        .from('os_lab_claim_datapoints')
        .delete()
        .eq('claim_id', claimId)
        .eq('datapoint_id', datapointId);
      if (error) fail('unlinkClaimDatapoint', error.message);
    },
    async unlinkClaimReference(claimId, referenceId) {
      const { error } = await client
        .from('os_lab_claim_references')
        .delete()
        .eq('claim_id', claimId)
        .eq('reference_id', referenceId);
      if (error) fail('unlinkClaimReference', error.message);
    },
    async approveClaim(id) {
      const { data, error } = await client
        .from('os_lab_claims')
        .update({ status: 'approved' })
        .eq('id', id)
        .select('*, os_lab_claim_datapoints(datapoint_id), os_lab_claim_references(reference_id)')
        .single();
      if (error) fail('approveClaim', error.message);
      return mapClaim(data as ClaimRow);
    },
    async demoteClaim(id, to) {
      const { data, error } = await client
        .from('os_lab_claims')
        .update({ status: to })
        .eq('id', id)
        .select('*, os_lab_claim_datapoints(datapoint_id), os_lab_claim_references(reference_id)')
        .single();
      if (error) fail('demoteClaim', error.message);
      return mapClaim(data as ClaimRow);
    },

    async listContradictions() {
      const { data, error } = await client
        .from('os_lab_claim_contradictions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabContradictions', error);
      return okRows(((data ?? []) as ContradictionRow[]).map(mapContradiction));
    },
    async createContradiction(input) {
      const { data, error } = await client
        .from('os_lab_claim_contradictions')
        .insert({
          claim_a_id: input.claimAId,
          claim_b_id: input.claimBId,
          severity: input.severity,
        })
        .select()
        .single();
      if (error) fail('createContradiction', error.message);
      return mapContradiction(data as ContradictionRow);
    },
    async resolveContradiction(id, note) {
      const { data, error } = await client
        .from('os_lab_claim_contradictions')
        .update({ status: 'resolved', resolution_note: note })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('resolveContradiction', error.message);
      return mapContradiction(data as ContradictionRow);
    },

    async listOutputs() {
      const { data, error } = await client
        .from('os_lab_outputs')
        .select('*, os_lab_output_claims(claim_id), os_lab_output_sub_questions(sub_question_id)')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabOutputs', error);
      return okRows(((data ?? []) as OutputRow[]).map(mapOutput));
    },
    async createOutput(input) {
      const { data, error } = await client
        .from('os_lab_outputs')
        .insert({ project_id: input.projectId, output_type: input.outputType })
        .select('*, os_lab_output_claims(claim_id), os_lab_output_sub_questions(sub_question_id)')
        .single();
      if (error) fail('createOutput', error.message);
      return mapOutput(data as OutputRow);
    },
    async saveOutputContent(id, content, backingDatapoints, simResults = []) {
      const violations = guardOutputContent(content, backingDatapoints, simResults);
      if (violations.length > 0) {
        throw new LabGateError(formatNumberViolations(violations));
      }
      const { data, error } = await client
        .from('os_lab_outputs')
        .update({ content })
        .eq('id', id)
        .select('*, os_lab_output_claims(claim_id), os_lab_output_sub_questions(sub_question_id)')
        .single();
      if (error) fail('saveOutputContent', error.message);
      return mapOutput(data as OutputRow);
    },
    async linkOutputClaim(outputId, claimId) {
      const { error } = await client
        .from('os_lab_output_claims')
        .insert({ output_id: outputId, claim_id: claimId });
      if (error) fail('linkOutputClaim', error.message);
    },
    async unlinkOutputClaim(outputId, claimId) {
      const { error } = await client
        .from('os_lab_output_claims')
        .delete()
        .eq('output_id', outputId)
        .eq('claim_id', claimId);
      if (error) fail('unlinkOutputClaim', error.message);
    },
    async finalizeOutput(id) {
      // 1.4: G-NUMBER re-runs against the CURRENT cited-claim datapoint set
      // before the status write. The save-time scan can be invalidated by a
      // later unlink (permitted while draft), so finalization is where the
      // guarantee must hold — the DB trigger checks citations and the sweep
      // heartbeat; prose parsing is this layer's half.
      const { data: outputRow, error: readError } = await client
        .from('os_lab_outputs')
        .select('content, os_lab_output_claims(claim_id), os_lab_output_sub_questions(sub_question_id)')
        .eq('id', id)
        .single();
      if (readError) fail('finalizeOutput', readError.message);
      const citedClaimIds = ((outputRow as OutputRow).os_lab_output_claims ?? []).map(
        (link) => link.claim_id,
      );
      let backing: LabDatapoint[] = [];
      if (citedClaimIds.length > 0) {
        const { data: linkRows, error: linkError } = await client
          .from('os_lab_claim_datapoints')
          .select('datapoint_id')
          .in('claim_id', citedClaimIds);
        if (linkError) fail('finalizeOutput', linkError.message);
        const datapointIds = [
          ...new Set(((linkRows ?? []) as Array<{ datapoint_id: string }>).map((r) => r.datapoint_id)),
        ];
        if (datapointIds.length > 0) {
          const { data: dpRows, error: dpError } = await client
            .from('os_lab_datapoints')
            .select('*')
            .in('id', datapointIds);
          if (dpError) fail('finalizeOutput', dpError.message);
          backing = ((dpRows ?? []) as DatapointRow[]).map(mapDatapoint);
        }
      }
      // [sim:<id>] tags stay honest at finalize: only results that passed
      // every check, passed sensitivity, and stand on fresh inputs count.
      const { data: simRows } = await client
        .from('os_lab_model_results')
        .select('id, result_value')
        .eq('checks_passed', true)
        .eq('sensitivity_passed', true)
        .eq('stale_input', false);
      const simResults = ((simRows ?? []) as Array<{ id: string; result_value: number | string | null }>)
        .filter((row) => row.result_value !== null)
        .map((row) => ({ id: row.id, value: Number(row.result_value) }));
      const violations = guardOutputContent((outputRow as OutputRow).content, backing, simResults);
      if (violations.length > 0) {
        throw new LabGateError(
          `G-NUMBER at finalize: ${formatNumberViolations(violations)} (a claim unlinked — or a model result gone stale — since the last save no longer backs these figures).`,
        );
      }
      const { data, error } = await client
        .from('os_lab_outputs')
        .update({ status: 'final' })
        .eq('id', id)
        .select('*, os_lab_output_claims(claim_id), os_lab_output_sub_questions(sub_question_id)')
        .single();
      if (error) fail('finalizeOutput', error.message);
      return mapOutput(data as OutputRow);
    },
    async revertOutputToDraft(id) {
      const { data, error } = await client
        .from('os_lab_outputs')
        .update({ status: 'draft' })
        .eq('id', id)
        .select('*, os_lab_output_claims(claim_id), os_lab_output_sub_questions(sub_question_id)')
        .single();
      if (error) fail('revertOutputToDraft', error.message);
      return mapOutput(data as OutputRow);
    },
    async clearOutputStale(id) {
      const { data, error } = await client
        .from('os_lab_outputs')
        .update({ stale: false })
        .eq('id', id)
        .select('*, os_lab_output_claims(claim_id), os_lab_output_sub_questions(sub_question_id)')
        .single();
      if (error) fail('clearOutputStale', error.message);
      return mapOutput(data as OutputRow);
    },

    async listTasks() {
      const { data, error } = await client
        .from('os_lab_tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return readAbsence('listLabTasks', error);
      return okRows(((data ?? []) as TaskRow[]).map(mapTask));
    },
    async updateTaskStatus(id, status, detail) {
      const { data, error } = await client
        .from('os_lab_tasks')
        .update({ status, ...(detail === undefined ? {} : { detail }) })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('updateTaskStatus', error.message);
      return mapTask(data as TaskRow);
    },

    async listQuestions() {
      const { data, error } = await client
        .from('os_lab_questions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabQuestions', error);
      return okRows(((data ?? []) as QuestionRow[]).map(mapQuestion));
    },
    async createQuestion(input) {
      const { data, error } = await client
        .from('os_lab_questions')
        .insert({
          project_id: input.projectId,
          raw_statement: input.rawStatement,
          framed_question: input.framedQuestion,
          framing_source: input.framingSource,
        })
        .select()
        .single();
      if (error) fail('createQuestion', error.message);
      return mapQuestion(data as QuestionRow);
    },
    async reframeQuestion(id, framedQuestion, framingSource) {
      const { data, error } = await client
        .from('os_lab_questions')
        .update({ framed_question: framedQuestion, framing_source: framingSource })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('reframeQuestion', error.message);
      return mapQuestion(data as QuestionRow);
    },
    async listSubQuestions() {
      const { data, error } = await client
        .from('os_lab_sub_questions')
        .select('*')
        .order('position');
      if (error) return readAbsence('listLabSubQuestions', error);
      return okRows(((data ?? []) as SubQuestionRow[]).map(mapSubQuestion));
    },
    async createSubQuestion(input) {
      const { data, error } = await client
        .from('os_lab_sub_questions')
        .insert({
          question_id: input.questionId,
          statement: input.statement,
          falsifier: input.falsifier,
          position: input.position ?? 0,
        })
        .select()
        .single();
      if (error) fail('createSubQuestion', error.message);
      return mapSubQuestion(data as SubQuestionRow);
    },
    async listEvidenceRequirements() {
      const { data, error } = await client
        .from('os_lab_evidence_requirements')
        .select('*')
        .order('created_at');
      if (error) return readAbsence('listLabEvidenceRequirements', error);
      return okRows(((data ?? []) as RequirementRow[]).map(mapRequirement));
    },
    async createEvidenceRequirement(input) {
      const { data, error } = await client
        .from('os_lab_evidence_requirements')
        .insert({
          sub_question_id: input.subQuestionId,
          description: input.description,
          kind: input.kind,
        })
        .select()
        .single();
      if (error) fail('createEvidenceRequirement', error.message);
      return mapRequirement(data as RequirementRow);
    },
    async satisfyRequirement(id, by) {
      const { data, error } = await client
        .from('os_lab_evidence_requirements')
        .update({
          satisfied_by_datapoint_id: by.datapointId ?? null,
          satisfied_by_reference_id: by.referenceId ?? null,
          satisfied_by_model_result_id: by.modelResultId ?? null,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('satisfyRequirement', error.message);
      return mapRequirement(data as RequirementRow);
    },
    async linkOutputSubQuestion(outputId, subQuestionId) {
      const { error } = await client
        .from('os_lab_output_sub_questions')
        .insert({ output_id: outputId, sub_question_id: subQuestionId });
      if (error) fail('linkOutputSubQuestion', error.message);
    },
    async unlinkOutputSubQuestion(outputId, subQuestionId) {
      const { error } = await client
        .from('os_lab_output_sub_questions')
        .delete()
        .eq('output_id', outputId)
        .eq('sub_question_id', subQuestionId);
      if (error) fail('unlinkOutputSubQuestion', error.message);
    },

    async listCandidateSources() {
      const { data, error } = await client
        .from('os_lab_candidate_sources')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabCandidateSources', error);
      return okRows(((data ?? []) as CandidateRow[]).map(mapCandidate));
    },
    async createCandidateSource(input) {
      const { data, error } = await client
        .from('os_lab_candidate_sources')
        .insert({
          project_id: input.projectId,
          title: input.title,
          publisher: input.publisher,
          url: input.url,
          claimed_date: input.claimedDate,
        })
        .select()
        .single();
      if (error) fail('createCandidateSource', error.message);
      return mapCandidate(data as CandidateRow);
    },
    async promoteCandidate(id, sourceDocumentId) {
      const { data, error } = await client
        .from('os_lab_candidate_sources')
        .update({ status: 'promoted', promoted_source_document_id: sourceDocumentId })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('promoteCandidate', error.message);
      return mapCandidate(data as CandidateRow);
    },
    async dismissCandidate(id) {
      const { data, error } = await client
        .from('os_lab_candidate_sources')
        .update({ status: 'dismissed' })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('dismissCandidate', error.message);
      return mapCandidate(data as CandidateRow);
    },

    async listModelSpecs() {
      const { data, error } = await client
        .from('os_lab_model_specs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabModelSpecs', error);
      return okRows(((data ?? []) as ModelSpecRow[]).map(mapModelSpec));
    },
    async listModelSpecParams() {
      const { data, error } = await client
        .from('os_lab_model_spec_params')
        .select('*')
        .order('name');
      if (error) return readAbsence('listLabModelSpecParams', error);
      return okRows(((data ?? []) as ModelParamRow[]).map(mapModelParam));
    },
    async listModelResults() {
      const { data, error } = await client
        .from('os_lab_model_results')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabModelResults', error);
      return okRows(((data ?? []) as ModelResultRow[]).map(mapModelResult));
    },
    async approveModelSpec(id, rationale) {
      const { data, error } = await client
        .from('os_lab_model_specs')
        .update({ status: 'approved', rationale })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('approveModelSpec', error.message);
      return mapModelSpec(data as ModelSpecRow);
    },
    async demoteModelSpec(id) {
      const { data, error } = await client
        .from('os_lab_model_specs')
        .update({ status: 'draft' })
        .eq('id', id)
        .select()
        .single();
      if (error) fail('demoteModelSpec', error.message);
      return mapModelSpec(data as ModelSpecRow);
    },
    async registerExternalModelResult(input) {
      const { data, error } = await client
        .from('os_lab_model_results')
        .insert({
          spec_id: input.specId,
          evaluator_version: 'external',
          result_value: input.value,
          result_unit: input.unit,
          external: true,
          external_note: input.note,
        })
        .select()
        .single();
      if (error) fail('registerExternalModelResult', error.message);
      return mapModelResult(data as ModelResultRow);
    },

    async staleSweep() {
      const { data, error } = await client.rpc('os_lab_stale_sweep');
      if (error) fail('staleSweep', error.message);
      return typeof data === 'number' ? data : 0;
    },

    async latestSweep() {
      const { data, error } = await client
        .from('os_lab_sweep_log')
        .select('ran_at, rows_demoted')
        .order('ran_at', { ascending: false })
        .limit(1);
      if (error) return readAbsence('latestSweep', error);
      return okRows(
        ((data ?? []) as Array<{ ran_at: string; rows_demoted: number }>).map((row) => ({
          ranAt: row.ran_at,
          rowsDemoted: row.rows_demoted,
        })),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Mock implementation — the same shared gate logic over in-memory rows, so a
// bare clone (and the jsdom acceptance test) exercises real refusals, not a
// permissive double. Seeded with one small worked example: a verified
// datapoint (7.3), an approved claim standing on it, and a draft briefing —
// exactly enough for the blocking-number acceptance path to be walkable.
// ---------------------------------------------------------------------------

const EV_NOW = () => new Date().toISOString();

export class MockLabEvidenceRepository implements LabEvidenceRepository {
  private projects: LabProject[] = [
    {
      id: 'ev-project',
      name: 'Contoh riset',
      researchQuestion: 'Worked example — replace with a real project.',
      status: 'active',
      wipSlot: 1,
      workflowId: null,
    },
  ];
  /** The same five routes migration 085 seeds, stable ids for tests. */
  private workflows: LabWorkflow[] = [
    {
      id: 'wf-canonical',
      name: 'Riset penuh',
      stageCodes: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'],
      isCanonical: true,
    },
    { id: 'wf-cek-angka', name: 'Cek angka cepat', stageCodes: ['S3', 'S4', 'S5'], isCanonical: false },
    { id: 'wf-sapuan-literatur', name: 'Sapuan literatur', stageCodes: ['S2', 'S6'], isCanonical: false },
    { id: 'wf-model-ulang', name: 'Model ulang', stageCodes: ['S7', 'S8'], isCanonical: false },
    { id: 'wf-pendasaran', name: 'Pendasaran referensi', stageCodes: ['S6'], isCanonical: false },
  ];
  private sources: LabSourceDocument[] = [
    {
      id: 'ev-source',
      title: 'Statistical Yearbook (contoh)',
      publisher: 'BPS',
      publicationDate: '2026-01-15',
      docType: 'government_report',
      url: 'https://example.invalid/yearbook',
      localSnapshotPath: 'snapshots/yearbook-2026.pdf',
      snapshotHash: 'mock',
      retrievedAt: EV_NOW(),
      lastRecheckedAt: null,
      contentChangedAt: null,
    },
  ];
  /** The mock's allowlist mirror — same 11 tier-1 institutions as 081. */
  private publisherTiers = new Map<string, 1 | 2>([
    ['bps', 1], ['bank indonesia', 1], ['ojk', 1], ['kemenperin', 1],
    ['kemenkeu', 1], ['kemenhub', 1], ['bkpm', 1], ['world bank', 1],
    ['adb', 1], ['iea', 1], ['imf', 1],
  ]);
  private candidates: LabCandidateSource[] = [];
  private datapoints: LabDatapoint[] = [
    {
      id: 'ev-dp-73',
      value: 7.3,
      unit: '%',
      year: 2025,
      geography: 'ID',
      definitionScope: 'cold-storage utilisation rate, national aggregate, BPS basis',
      sourceDocumentId: 'ev-source',
      locator: 'tab 2.1',
      retrievedAt: EV_NOW(),
      status: 'V',
      verificationNote: 'checked against printed table 2.1',
      verifiedAt: EV_NOW(),
      volatilityClass: 'volatile',
      extractionMethod: 'manual',
      internalCheckPassed: null,
    },
    {
      id: 'ev-dp-ind',
      value: 55,
      unit: 'units',
      year: 2025,
      geography: 'ID',
      definitionScope: 'licensed facility count, regulated class, ministry register',
      sourceDocumentId: 'ev-source',
      locator: 'p.7',
      retrievedAt: EV_NOW(),
      status: 'IND',
      verificationNote: '',
      verifiedAt: null,
      volatilityClass: 'volatile',
      extractionMethod: 'agent_from_full_pdf',
      internalCheckPassed: null,
    },
  ];
  private conflicts: LabDatapointConflict[] = [];
  private references: LabReference[] = [];
  private commitments: LabCommitmentSource[] = [];
  private claims: LabClaim[] = [
    {
      id: 'ev-claim-approved',
      projectId: 'ev-project',
      statement: 'Utilisation sits materially below capacity.',
      layer: 'B',
      commitmentSourceId: null,
      evidenceDirection: 'supports',
      status: 'approved',
      approvedByHumanAt: EV_NOW(),
      createdByRunId: null,
      inferenceStep: 'the matched utilisation figure sits well below the capacity figure on the same basis',
      datapointIds: ['ev-dp-73'],
      referenceIds: [],
    },
    {
      id: 'ev-claim-draft',
      projectId: 'ev-project',
      statement: 'The register understates informal capacity.',
      layer: 'C',
      commitmentSourceId: null,
      evidenceDirection: 'untested',
      status: 'draft',
      approvedByHumanAt: null,
      createdByRunId: null,
      inferenceStep: '',
      datapointIds: ['ev-dp-ind'],
      referenceIds: [],
    },
  ];
  private contradictions: LabClaimContradiction[] = [];
  private outputs: LabOutput[] = [
    {
      id: 'ev-output',
      projectId: 'ev-project',
      outputType: 'briefing',
      content: '',
      status: 'draft',
      stale: false,
      generatedByRunId: null,
      claimIds: ['ev-claim-approved'],
      subQuestionIds: [],
    },
  ];
  private questions: LabQuestion[] = [];
  private subQuestions: LabSubQuestion[] = [];
  private requirements: LabEvidenceRequirement[] = [];
  private modelSpecs: LabModelSpec[] = [];
  private modelParams: LabModelSpecParam[] = [];
  private modelResults: LabModelResult[] = [];
  private counter = 0;

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  async listProjects(): Promise<ReadResult<LabProject>> {
    return okRows(this.projects.map((row) => ({ ...row })));
  }
  async createProject(input: { name: string; researchQuestion: string }): Promise<LabProject> {
    const project: LabProject = {
      id: this.nextId('ev-project'),
      name: input.name,
      researchQuestion: input.researchQuestion,
      status: 'active',
      wipSlot: null,
      workflowId: null,
    };
    this.projects.push(project);
    return { ...project };
  }
  async listWorkflows(): Promise<ReadResult<LabWorkflow>> {
    return okRows(this.workflows.map((row) => ({ ...row, stageCodes: [...row.stageCodes] })));
  }
  async setProjectWorkflow(projectId: string, workflowId: string | null): Promise<LabProject> {
    const project = this.projects.find((row) => row.id === projectId);
    if (!project) throw new LabGateError(`setProjectWorkflow: project ${projectId} tidak ditemukan.`);
    if (workflowId !== null && !this.workflows.some((row) => row.id === workflowId)) {
      throw new LabGateError(`setProjectWorkflow: workflow ${workflowId} tidak ditemukan.`);
    }
    project.workflowId = workflowId;
    return { ...project };
  }

  async listSourceDocuments(): Promise<ReadResult<LabSourceDocument>> {
    return okRows(this.sources.map((row) => ({ ...row })));
  }
  async createSourceDocument(input: LabSourceDocumentWrite): Promise<LabSourceDocument> {
    if (!input.localSnapshotPath.trim()) {
      throw new LabGateError('a source document requires its local snapshot — the URL is a courtesy, the snapshot is the citation.');
    }
    const source: LabSourceDocument = {
      id: this.nextId('ev-source'),
      title: input.title,
      publisher: input.publisher,
      publicationDate: input.publicationDate,
      docType: input.docType,
      url: input.url,
      localSnapshotPath: input.localSnapshotPath,
      snapshotHash: input.snapshotHash,
      retrievedAt: EV_NOW(),
      lastRecheckedAt: null,
      contentChangedAt: null,
    };
    this.sources.push(source);
    return { ...source };
  }

  async listReferences(): Promise<ReadResult<LabReference>> {
    return okRows(this.references.map((row) => ({ ...row })));
  }
  async createReference(input: LabReferenceWrite): Promise<LabReference> {
    const reference: LabReference = {
      id: this.nextId('ev-ref'),
      title: input.title,
      authors: input.authors,
      container: input.container,
      publicationYear: input.publicationYear,
      doi: input.doi,
      url: input.url,
      verificationLevel: 'abstract_only',
      fullTextPath: '',
    };
    this.references.push(reference);
    return { ...reference };
  }
  async promoteReference(id: string, fullTextPath: string): Promise<LabReference> {
    const reference = this.references.find((row) => row.id === id);
    if (!reference) throw new Error(`promoteReference: no reference ${id}`);
    if (!fullTextPath.trim()) {
      throw new LabGateError('full_text_read without a full_text_path is an abstract wearing a costume — put the text on disk first.');
    }
    reference.verificationLevel = 'full_text_read';
    reference.fullTextPath = fullTextPath;
    return { ...reference };
  }

  async listCommitmentSources(): Promise<ReadResult<LabCommitmentSource>> {
    return okRows(this.commitments.map((row) => ({ ...row })));
  }
  async createCommitmentSource(input: LabCommitmentSourceWrite): Promise<LabCommitmentSource> {
    const commitment: LabCommitmentSource = { id: this.nextId('ev-commit'), ...input };
    this.commitments.push(commitment);
    return { ...commitment };
  }

  async listDatapoints(): Promise<ReadResult<LabDatapoint>> {
    return okRows(this.datapoints.map((row) => ({ ...row })));
  }
  async createDatapoint(input: LabDatapointWrite): Promise<LabDatapoint> {
    const guarded = guardDatapointWrite(input);
    const datapoint: LabDatapoint = {
      id: this.nextId('ev-dp'),
      value: guarded.value,
      unit: guarded.unit,
      year: guarded.year,
      geography: guarded.geography,
      definitionScope: guarded.definitionScope,
      sourceDocumentId: guarded.sourceDocumentId,
      locator: guarded.locator,
      retrievedAt: EV_NOW(),
      status: guarded.status ?? 'IND',
      verificationNote: '',
      verifiedAt: null,
      volatilityClass: guarded.volatilityClass,
      extractionMethod: guarded.extractionMethod,
      internalCheckPassed: null,
    };
    this.datapoints.push(datapoint);
    return { ...datapoint };
  }
  async verifyDatapoint(id: string, note: string): Promise<LabDatapoint> {
    const datapoint = this.datapoints.find((row) => row.id === id);
    if (!datapoint) throw new Error(`verifyDatapoint: no datapoint ${id}`);
    const blocked = verifyBlockedReason(datapoint, note);
    if (blocked) throw new LabGateError(blocked);
    datapoint.status = 'V';
    datapoint.verificationNote = note;
    datapoint.verifiedAt = EV_NOW();
    return { ...datapoint };
  }

  async listConflicts(): Promise<ReadResult<LabDatapointConflict>> {
    return okRows(this.conflicts.map((row) => ({ ...row })));
  }
  async createConflict(input: {
    datapointAId: string;
    datapointBId: string;
    conflictType: LabConflictType;
  }): Promise<LabDatapointConflict> {
    const conflict: LabDatapointConflict = {
      id: this.nextId('ev-conflict'),
      datapointAId: input.datapointAId,
      datapointBId: input.datapointBId,
      conflictType: input.conflictType,
      resolutionStatus: 'unresolved',
      resolutionNote: '',
    };
    this.conflicts.push(conflict);
    return { ...conflict };
  }
  async resolveConflict(
    id: string,
    resolution: Exclude<LabConflictResolution, 'unresolved'>,
    note: string,
  ): Promise<LabDatapointConflict> {
    const conflict = this.conflicts.find((row) => row.id === id);
    if (!conflict) throw new Error(`resolveConflict: no conflict ${id}`);
    if (!note.trim()) {
      throw new LabGateError('a resolution without a note is a coin flip — say why.');
    }
    conflict.resolutionStatus = resolution;
    conflict.resolutionNote = note;
    return { ...conflict };
  }

  async listClaims(): Promise<ReadResult<LabClaim>> {
    return okRows(this.claims.map((row) => ({ ...row, datapointIds: [...row.datapointIds], referenceIds: [...row.referenceIds] })));
  }
  async createClaim(input: LabClaimWrite): Promise<LabClaim> {
    if (input.layer === 'A' && !input.commitmentSourceId) {
      throw new LabGateError('G-LAYER: a layer A claim requires its commitment source.');
    }
    const claim: LabClaim = {
      id: this.nextId('ev-claim'),
      projectId: input.projectId,
      statement: input.statement,
      layer: input.layer,
      commitmentSourceId: input.commitmentSourceId,
      evidenceDirection: input.evidenceDirection,
      status: 'draft',
      approvedByHumanAt: null,
      createdByRunId: input.createdByRunId ?? null,
      inferenceStep: input.inferenceStep ?? '',
      datapointIds: [],
      referenceIds: [],
    };
    this.claims.push(claim);
    return { ...claim };
  }
  async linkClaimDatapoint(claimId: string, datapointId: string): Promise<void> {
    const claim = this.claims.find((row) => row.id === claimId);
    if (!claim) throw new Error(`linkClaimDatapoint: no claim ${claimId}`);
    if (claim.status === 'approved') {
      const datapoint = this.datapoints.find((row) => row.id === datapointId);
      if (!datapoint || datapoint.status !== 'V') {
        throw new LabGateError(`G-CLAIM: claim ${claimId} is approved — datapoint ${datapointId} must be verified before it can join the claim's evidence.`);
      }
    }
    if (!claim.datapointIds.includes(datapointId)) claim.datapointIds.push(datapointId);
  }
  async linkClaimReference(claimId: string, referenceId: string): Promise<void> {
    const claim = this.claims.find((row) => row.id === claimId);
    if (!claim) throw new Error(`linkClaimReference: no claim ${claimId}`);
    if (claim.status === 'approved') {
      const reference = this.references.find((row) => row.id === referenceId);
      if (!reference || reference.verificationLevel !== 'full_text_read') {
        throw new LabGateError(`G-CLAIM: claim ${claimId} is approved — reference ${referenceId} is abstract_only and cannot join its evidence.`);
      }
    }
    if (!claim.referenceIds.includes(referenceId)) claim.referenceIds.push(referenceId);
  }
  async unlinkClaimDatapoint(claimId: string, datapointId: string): Promise<void> {
    const claim = this.claims.find((row) => row.id === claimId);
    if (!claim) return;
    if (claim.status === 'approved') {
      throw new LabGateError(`G-CLAIM: claim ${claimId} is approved — demote it before removing the evidence its approval rests on.`);
    }
    claim.datapointIds = claim.datapointIds.filter((id) => id !== datapointId);
  }
  async unlinkClaimReference(claimId: string, referenceId: string): Promise<void> {
    const claim = this.claims.find((row) => row.id === claimId);
    if (!claim) return;
    if (claim.status === 'approved') {
      throw new LabGateError(`G-CLAIM: claim ${claimId} is approved — demote it before removing the evidence its approval rests on.`);
    }
    claim.referenceIds = claim.referenceIds.filter((id) => id !== referenceId);
  }
  async approveClaim(id: string): Promise<LabClaim> {
    const claim = this.claims.find((row) => row.id === id);
    if (!claim) throw new Error(`approveClaim: no claim ${id}`);
    const blockers = claimApprovalBlockers({
      claim,
      datapoints: this.datapoints,
      references: this.references,
      conflicts: this.conflicts,
      contradictions: this.contradictions,
    });
    if (blockers.length > 0) throw new LabGateError(blockers[0]);
    claim.status = 'approved';
    claim.approvedByHumanAt = EV_NOW();
    return { ...claim };
  }
  async demoteClaim(id: string, to: 'draft' | 'reviewed'): Promise<LabClaim> {
    const claim = this.claims.find((row) => row.id === id);
    if (!claim) throw new Error(`demoteClaim: no claim ${id}`);
    claim.status = to;
    claim.approvedByHumanAt = null;
    return { ...claim };
  }

  async listContradictions(): Promise<ReadResult<LabClaimContradiction>> {
    return okRows(this.contradictions.map((row) => ({ ...row })));
  }
  async createContradiction(input: {
    claimAId: string;
    claimBId: string;
    severity: LabContradictionSeverity;
  }): Promise<LabClaimContradiction> {
    const contradiction: LabClaimContradiction = {
      id: this.nextId('ev-contradiction'),
      claimAId: input.claimAId,
      claimBId: input.claimBId,
      severity: input.severity,
      status: 'open',
      resolutionNote: '',
    };
    this.contradictions.push(contradiction);
    return { ...contradiction };
  }
  async resolveContradiction(id: string, note: string): Promise<LabClaimContradiction> {
    const contradiction = this.contradictions.find((row) => row.id === id);
    if (!contradiction) throw new Error(`resolveContradiction: no contradiction ${id}`);
    if (!note.trim()) {
      throw new LabGateError('a contradiction cannot resolve without a note saying how.');
    }
    contradiction.status = 'resolved';
    contradiction.resolutionNote = note;
    return { ...contradiction };
  }

  async listOutputs(): Promise<ReadResult<LabOutput>> {
    return okRows(this.outputs.map((row) => ({ ...row, claimIds: [...row.claimIds] })));
  }
  async createOutput(input: { projectId: string; outputType: LabOutputType }): Promise<LabOutput> {
    const output: LabOutput = {
      id: this.nextId('ev-output'),
      projectId: input.projectId,
      outputType: input.outputType,
      content: '',
      status: 'draft',
      stale: false,
      generatedByRunId: null,
      claimIds: [],
      subQuestionIds: [],
    };
    this.outputs.push(output);
    return { ...output };
  }
  async saveOutputContent(
    id: string,
    content: string,
    backingDatapoints: readonly LabDatapoint[],
    simResults: ReadonlyArray<{ id: string; value: number }> = [],
  ): Promise<LabOutput> {
    const output = this.outputs.find((row) => row.id === id);
    if (!output) throw new Error(`saveOutputContent: no output ${id}`);
    const violations = guardOutputContent(content, backingDatapoints, simResults);
    if (violations.length > 0) {
      throw new LabGateError(formatNumberViolations(violations));
    }
    if (output.status === 'final') {
      throw new LabGateError(`G-OUTPUT: output ${id} is final — revert it to draft before editing.`);
    }
    output.content = content;
    return { ...output, claimIds: [...output.claimIds] };
  }
  async linkOutputClaim(outputId: string, claimId: string): Promise<void> {
    const output = this.outputs.find((row) => row.id === outputId);
    if (!output) throw new Error(`linkOutputClaim: no output ${outputId}`);
    if (output.status === 'final') {
      throw new LabGateError(`G-OUTPUT: output ${outputId} is final — revert it to draft before changing what it cites.`);
    }
    const openBothSides = this.contradictions.find(
      (contradiction) =>
        contradiction.status === 'open' &&
        ((contradiction.claimAId === claimId && output.claimIds.includes(contradiction.claimBId)) ||
          (contradiction.claimBId === claimId && output.claimIds.includes(contradiction.claimAId))),
    );
    if (openBothSides) {
      throw new LabGateError(
        `G-LAYER: linking claim ${claimId} would make output ${outputId} cite both sides of open contradiction ${openBothSides.id} — resolve it first.`,
      );
    }
    if (!output.claimIds.includes(claimId)) output.claimIds.push(claimId);
  }
  async unlinkOutputClaim(outputId: string, claimId: string): Promise<void> {
    const output = this.outputs.find((row) => row.id === outputId);
    if (!output) return;
    if (output.status === 'final') {
      throw new LabGateError(`G-OUTPUT: output ${outputId} is final — revert it to draft before changing what it cites.`);
    }
    output.claimIds = output.claimIds.filter((id) => id !== claimId);
  }
  async finalizeOutput(id: string): Promise<LabOutput> {
    const output = this.outputs.find((row) => row.id === id);
    if (!output) throw new Error(`finalizeOutput: no output ${id}`);
    // 1.4: same re-scan as the live implementation — the current cited
    // claims' datapoints, not the set that held at save time.
    const citedClaims = this.claims.filter((claim) => output.claimIds.includes(claim.id));
    const backing = this.datapoints.filter((datapoint) =>
      citedClaims.some((claim) => claim.datapointIds.includes(datapoint.id)),
    );
    const eligibleSims = this.modelResults
      .filter((result) => result.checksPassed && result.sensitivityPassed === true && !result.staleInput)
      .filter((result) => result.resultValue !== null)
      .map((result) => ({ id: result.id, value: result.resultValue as number }));
    const violations = guardOutputContent(output.content, backing, eligibleSims);
    if (violations.length > 0) {
      throw new LabGateError(
        `G-NUMBER at finalize: ${formatNumberViolations(violations)} (a claim unlinked — or a model result gone stale — since the last save no longer backs these figures).`,
      );
    }
    const blockers = outputFinalizeBlockers({
      stale: output.stale,
      citedClaims,
      contradictions: this.contradictions,
      addressedSubQuestionIds: output.subQuestionIds,
      requirements: this.requirements,
    });
    if (blockers.length > 0) throw new LabGateError(blockers[0]);
    output.status = 'final';
    return { ...output, claimIds: [...output.claimIds] };
  }
  async revertOutputToDraft(id: string): Promise<LabOutput> {
    const output = this.outputs.find((row) => row.id === id);
    if (!output) throw new Error(`revertOutputToDraft: no output ${id}`);
    output.status = 'draft';
    return { ...output, claimIds: [...output.claimIds] };
  }
  async clearOutputStale(id: string): Promise<LabOutput> {
    const output = this.outputs.find((row) => row.id === id);
    if (!output) throw new Error(`clearOutputStale: no output ${id}`);
    output.stale = false;
    return { ...output, claimIds: [...output.claimIds] };
  }

  private tasks: LabTask[] = [];

  async listTasks(): Promise<ReadResult<LabTask>> {
    return okRows(this.tasks.map((row) => ({ ...row })));
  }
  async updateTaskStatus(id: string, status: LabTask['status'], detail?: string): Promise<LabTask> {
    const task = this.tasks.find((row) => row.id === id);
    if (!task) throw new Error(`updateTaskStatus: no task ${id}`);
    task.status = status;
    if (detail !== undefined) task.detail = detail;
    return { ...task };
  }

  async listQuestions(): Promise<ReadResult<LabQuestion>> {
    return okRows(this.questions.map((row) => ({ ...row })));
  }
  async createQuestion(input: {
    projectId: string;
    rawStatement: string;
    framedQuestion: string;
    framingSource: LabFramingSource;
  }): Promise<LabQuestion> {
    if (input.framedQuestion.trim().length < 20) {
      throw new LabGateError('G-FRAME: a framed question under 20 characters is a label, not a question.');
    }
    const question: LabQuestion = { id: this.nextId('ev-question'), ...input };
    this.questions.push(question);
    return { ...question };
  }
  async reframeQuestion(
    id: string,
    framedQuestion: string,
    framingSource: LabFramingSource,
  ): Promise<LabQuestion> {
    const question = this.questions.find((row) => row.id === id);
    if (!question) throw new Error(`reframeQuestion: no question ${id}`);
    if (framedQuestion.trim().length < 20) {
      throw new LabGateError('G-FRAME: a framed question under 20 characters is a label, not a question.');
    }
    // rawStatement is untouchable here by construction — no parameter exists.
    question.framedQuestion = framedQuestion;
    question.framingSource = framingSource;
    return { ...question };
  }
  async listSubQuestions(): Promise<ReadResult<LabSubQuestion>> {
    return okRows(this.subQuestions.map((row) => ({ ...row })));
  }
  async createSubQuestion(input: {
    questionId: string;
    statement: string;
    falsifier: string;
    position?: number;
  }): Promise<LabSubQuestion> {
    if (input.falsifier.trim().length < 20) {
      throw new LabGateError(
        'G-FRAME: a falsifier under 20 characters names no evidence — say what would show the expected answer is wrong.',
      );
    }
    const subQuestion: LabSubQuestion = {
      id: this.nextId('ev-subq'),
      questionId: input.questionId,
      statement: input.statement,
      falsifier: input.falsifier,
      position: input.position ?? 0,
    };
    this.subQuestions.push(subQuestion);
    return { ...subQuestion };
  }
  async listEvidenceRequirements(): Promise<ReadResult<LabEvidenceRequirement>> {
    return okRows(this.requirements.map((row) => ({ ...row })));
  }
  async createEvidenceRequirement(input: {
    subQuestionId: string;
    description: string;
    kind: LabRequirementKind;
  }): Promise<LabEvidenceRequirement> {
    const requirement: LabEvidenceRequirement = {
      id: this.nextId('ev-req'),
      subQuestionId: input.subQuestionId,
      description: input.description,
      kind: input.kind,
      satisfiedByDatapointId: null,
      satisfiedByReferenceId: null,
      satisfiedByModelResultId: null,
      satisfiedAt: null,
    };
    this.requirements.push(requirement);
    return { ...requirement };
  }
  async satisfyRequirement(
    id: string,
    by: { datapointId?: string; referenceId?: string; modelResultId?: string },
  ): Promise<LabEvidenceRequirement> {
    const requirement = this.requirements.find((row) => row.id === id);
    if (!requirement) throw new Error(`satisfyRequirement: no requirement ${id}`);
    if (by.datapointId) {
      if (requirement.kind !== 'datapoint') {
        throw new LabGateError(`G-FALSIFY: requirement ${id} is reference-kind — a datapoint cannot satisfy it.`);
      }
      const datapoint = this.datapoints.find((row) => row.id === by.datapointId);
      if (!datapoint || datapoint.status !== 'V') {
        throw new LabGateError(
          `G-FALSIFY: requirement ${id} cannot be satisfied by datapoint ${by.datapointId} — it is not source-matched. Only V evidence satisfies a requirement.`,
        );
      }
      requirement.satisfiedByDatapointId = by.datapointId;
      requirement.satisfiedByReferenceId = null;
    } else if (by.referenceId) {
      if (requirement.kind !== 'reference') {
        throw new LabGateError(`G-FALSIFY: requirement ${id} is datapoint-kind — a reference cannot satisfy it.`);
      }
      const reference = this.references.find((row) => row.id === by.referenceId);
      if (!reference || reference.verificationLevel !== 'full_text_read') {
        throw new LabGateError(
          `G-FALSIFY: requirement ${id} cannot be satisfied by reference ${by.referenceId} — an abstract locates a paper, it cannot satisfy an evidence requirement.`,
        );
      }
      requirement.satisfiedByReferenceId = by.referenceId;
      requirement.satisfiedByDatapointId = null;
    } else if (by.modelResultId) {
      if (requirement.kind !== 'model_result') {
        throw new LabGateError(`G-FALSIFY: requirement ${id} is not model_result-kind.`);
      }
      const result = this.modelResults.find((row) => row.id === by.modelResultId);
      if (!result || !result.checksPassed || result.sensitivityPassed !== true || result.staleInput) {
        throw new LabGateError(
          `G-FALSIFY: requirement ${id} cannot be satisfied by model result ${by.modelResultId} — it must exist, pass every check, pass sensitivity, and stand on fresh inputs.`,
        );
      }
      requirement.satisfiedByModelResultId = by.modelResultId;
      requirement.satisfiedByDatapointId = null;
      requirement.satisfiedByReferenceId = null;
    } else {
      requirement.satisfiedByDatapointId = null;
      requirement.satisfiedByReferenceId = null;
      requirement.satisfiedByModelResultId = null;
      requirement.satisfiedAt = null;
      return { ...requirement };
    }
    requirement.satisfiedAt = EV_NOW();
    return { ...requirement };
  }
  async linkOutputSubQuestion(outputId: string, subQuestionId: string): Promise<void> {
    const output = this.outputs.find((row) => row.id === outputId);
    if (!output) throw new Error(`linkOutputSubQuestion: no output ${outputId}`);
    if (output.status === 'final') {
      throw new LabGateError(
        `G-OUTPUT: output ${outputId} is final — revert it to draft before changing which sub-questions it addresses.`,
      );
    }
    if (!output.subQuestionIds.includes(subQuestionId)) output.subQuestionIds.push(subQuestionId);
  }
  async unlinkOutputSubQuestion(outputId: string, subQuestionId: string): Promise<void> {
    const output = this.outputs.find((row) => row.id === outputId);
    if (!output) return;
    if (output.status === 'final') {
      throw new LabGateError(
        `G-OUTPUT: output ${outputId} is final — revert it to draft before changing which sub-questions it addresses.`,
      );
    }
    output.subQuestionIds = output.subQuestionIds.filter((id) => id !== subQuestionId);
  }

  async listCandidateSources(): Promise<ReadResult<LabCandidateSource>> {
    return okRows(this.candidates.map((row) => ({ ...row })));
  }
  async createCandidateSource(input: {
    projectId: string | null;
    title: string;
    publisher: string;
    url: string;
    claimedDate: string | null;
  }): Promise<LabCandidateSource> {
    const candidate: LabCandidateSource = {
      id: this.nextId('ev-candidate'),
      projectId: input.projectId,
      title: input.title,
      publisher: input.publisher,
      url: input.url,
      claimedDate: input.claimedDate,
      // The allowlist decides, mirroring the trigger — never the caller.
      tier: this.publisherTiers.get(input.publisher.toLowerCase()) ?? 3,
      status: 'candidate',
      promotedSourceDocumentId: null,
      createdByRunId: null,
    };
    this.candidates.push(candidate);
    return { ...candidate };
  }
  async promoteCandidate(id: string, sourceDocumentId: string): Promise<LabCandidateSource> {
    const candidate = this.candidates.find((row) => row.id === id);
    if (!candidate) throw new Error(`promoteCandidate: no candidate ${id}`);
    const source = this.sources.find((row) => row.id === sourceDocumentId);
    if (!source || !source.localSnapshotPath) {
      throw new LabGateError(
        `G-SCOUT: candidate ${id} cannot be promoted without its source document — ingest the document (with its mandatory snapshot) first, then point the candidate at it.`,
      );
    }
    candidate.status = 'promoted';
    candidate.promotedSourceDocumentId = sourceDocumentId;
    return { ...candidate };
  }
  async dismissCandidate(id: string): Promise<LabCandidateSource> {
    const candidate = this.candidates.find((row) => row.id === id);
    if (!candidate) throw new Error(`dismissCandidate: no candidate ${id}`);
    candidate.status = 'dismissed';
    return { ...candidate };
  }

  async listModelSpecs(): Promise<ReadResult<LabModelSpec>> {
    return okRows(this.modelSpecs.map((row) => ({ ...row })));
  }
  async listModelSpecParams(): Promise<ReadResult<LabModelSpecParam>> {
    return okRows(this.modelParams.map((row) => ({ ...row })));
  }
  async listModelResults(): Promise<ReadResult<LabModelResult>> {
    return okRows(this.modelResults.map((row) => ({ ...row })));
  }
  async approveModelSpec(id: string, rationale: string): Promise<LabModelSpec> {
    const spec = this.modelSpecs.find((row) => row.id === id);
    if (!spec) throw new Error(`approveModelSpec: no spec ${id}`);
    if (rationale.trim().length < 20) {
      throw new LabGateError(
        `G-MODEL: spec ${id} cannot be approved without a rationale (min 20 chars) — why this structure answers the question, in the owner's words.`,
      );
    }
    spec.status = 'approved';
    spec.rationale = rationale;
    spec.approvedByHumanAt = EV_NOW();
    return { ...spec };
  }
  async demoteModelSpec(id: string): Promise<LabModelSpec> {
    const spec = this.modelSpecs.find((row) => row.id === id);
    if (!spec) throw new Error(`demoteModelSpec: no spec ${id}`);
    spec.status = 'draft';
    spec.approvedByHumanAt = null;
    return { ...spec };
  }
  async registerExternalModelResult(input: {
    specId: string;
    value: number;
    unit: string;
    note: string;
  }): Promise<LabModelResult> {
    if (input.note.trim().length < 20) {
      throw new LabGateError(
        'G-MODEL: an external result needs a note (min 20 chars) saying where it was computed and how to reproduce it.',
      );
    }
    const result: LabModelResult = {
      id: this.nextId('ev-result'),
      specId: input.specId,
      evaluatorVersion: 'external',
      seed: null,
      resultValue: input.value,
      resultUnit: input.unit,
      resultSummary: {},
      checks: [],
      checksPassed: false,
      sensitivityPassed: null,
      inputDatapointIds: [],
      staleInput: false,
      external: true,
      externalNote: input.note,
      createdAt: EV_NOW(),
    };
    this.modelResults.push(result);
    return { ...result };
  }

  async staleSweep(): Promise<number> {
    const now = Date.now();
    let reverted = 0;
    for (const datapoint of this.datapoints) {
      if (datapoint.status !== 'V' || !datapoint.verifiedAt) continue;
      const ageDays = (now - new Date(datapoint.verifiedAt).getTime()) / 86_400_000;
      const limit =
        datapoint.volatilityClass === 'volatile' ? 180 : datapoint.volatilityClass === 'slow' ? 365 : Infinity;
      if (ageDays <= limit) continue;
      datapoint.status = 'IND';
      datapoint.verifiedAt = null;
      reverted += 1;
      for (const claim of this.claims) {
        if (claim.status === 'approved' && claim.datapointIds.includes(datapoint.id)) {
          claim.status = 'reviewed';
          claim.approvedByHumanAt = null;
          for (const output of this.outputs) {
            if (output.claimIds.includes(claim.id)) output.stale = true;
          }
        }
      }
    }
    // The heartbeat, exactly as 079's function writes it: a zero is
    // information, and its absence is a detectable condition.
    this.sweepLog.push({ ranAt: EV_NOW(), rowsDemoted: reverted });
    return reverted;
  }

  /** Seeded fresh so the worked example finalizes; staleSweep appends. */
  private sweepLog: LabSweepBeat[] = [{ ranAt: EV_NOW(), rowsDemoted: 0 }];

  async latestSweep(): Promise<ReadResult<LabSweepBeat>> {
    const newest = [...this.sweepLog].sort((a, b) => b.ranAt.localeCompare(a.ranAt))[0];
    return okRows(newest ? [{ ...newest }] : []);
  }
}
