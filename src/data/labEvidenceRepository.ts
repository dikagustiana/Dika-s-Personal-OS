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
  LabClaim,
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
  LabOutput,
  LabOutputType,
  LabProject,
  LabReference,
  LabSourceDocument,
  LabTask,
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
  ): Promise<LabOutput>;
  linkOutputClaim(outputId: string, claimId: string): Promise<void>;
  unlinkOutputClaim(outputId: string, claimId: string): Promise<void>;
  finalizeOutput(id: string): Promise<LabOutput>;
  revertOutputToDraft(id: string): Promise<LabOutput>;
  clearOutputStale(id: string): Promise<LabOutput>;

  /** The coordinator's delegations, newest first. */
  listTasks(): Promise<ReadResult<LabTask>>;
  updateTaskStatus(id: string, status: LabTask['status'], detail?: string): Promise<LabTask>;

  /** Applies the standing expiry policy now; returns how many V reverted. */
  staleSweep(): Promise<number>;
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
  os_lab_claim_datapoints?: Array<{ datapoint_id: string }>;
  os_lab_claim_references?: Array<{ reference_id: string }>;
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
}

function mapProject(row: ProjectRow): LabProject {
  return {
    id: row.id,
    name: row.name,
    researchQuestion: row.research_question,
    status: row.status,
    wipSlot: row.wip_slot,
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
        .select('*, os_lab_output_claims(claim_id)')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabOutputs', error);
      return okRows(((data ?? []) as OutputRow[]).map(mapOutput));
    },
    async createOutput(input) {
      const { data, error } = await client
        .from('os_lab_outputs')
        .insert({ project_id: input.projectId, output_type: input.outputType })
        .select('*, os_lab_output_claims(claim_id)')
        .single();
      if (error) fail('createOutput', error.message);
      return mapOutput(data as OutputRow);
    },
    async saveOutputContent(id, content, backingDatapoints) {
      const violations = guardOutputContent(content, backingDatapoints);
      if (violations.length > 0) {
        throw new LabGateError(formatNumberViolations(violations));
      }
      const { data, error } = await client
        .from('os_lab_outputs')
        .update({ content })
        .eq('id', id)
        .select('*, os_lab_output_claims(claim_id)')
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
      const { data, error } = await client
        .from('os_lab_outputs')
        .update({ status: 'final' })
        .eq('id', id)
        .select('*, os_lab_output_claims(claim_id)')
        .single();
      if (error) fail('finalizeOutput', error.message);
      return mapOutput(data as OutputRow);
    },
    async revertOutputToDraft(id) {
      const { data, error } = await client
        .from('os_lab_outputs')
        .update({ status: 'draft' })
        .eq('id', id)
        .select('*, os_lab_output_claims(claim_id)')
        .single();
      if (error) fail('revertOutputToDraft', error.message);
      return mapOutput(data as OutputRow);
    },
    async clearOutputStale(id) {
      const { data, error } = await client
        .from('os_lab_outputs')
        .update({ stale: false })
        .eq('id', id)
        .select('*, os_lab_output_claims(claim_id)')
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

    async staleSweep() {
      const { data, error } = await client.rpc('os_lab_stale_sweep');
      if (error) fail('staleSweep', error.message);
      return typeof data === 'number' ? data : 0;
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
    },
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
    },
  ];
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
    },
  ];
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
    };
    this.projects.push(project);
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
    };
    this.outputs.push(output);
    return { ...output };
  }
  async saveOutputContent(
    id: string,
    content: string,
    backingDatapoints: readonly LabDatapoint[],
  ): Promise<LabOutput> {
    const output = this.outputs.find((row) => row.id === id);
    if (!output) throw new Error(`saveOutputContent: no output ${id}`);
    const violations = guardOutputContent(content, backingDatapoints);
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
    const blockers = outputFinalizeBlockers({
      stale: output.stale,
      citedClaims: this.claims.filter((claim) => output.claimIds.includes(claim.id)),
      contradictions: this.contradictions,
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
    return reverted;
  }
}
