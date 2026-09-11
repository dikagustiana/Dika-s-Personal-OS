/**
 * The institution's data seam.
 *
 * A separate interface hanging off Repository, like research, lab and
 * labEvidence, for the same reason: one bounded subsystem, and the main seam
 * stays readable.
 *
 * THREE INVARIANTS LIVE HERE, NOT IN THE UI:
 *
 *  1. THE CORPUS IS READ-ONLY FROM THE CLIENT. There is no createRecord —
 *     not unimplemented, ABSENT. Records are written by the institution-tools
 *     Edge Function under the service role, because that is where the
 *     synthesize gate runs (B-8, G-NUMBER); a client that could insert a
 *     record could publish a draft that never passed it. Migration
 *     20260910000104 revokes the grant as well as withholding the policy.
 *     The same applies to egress blocks and to the evaluation set.
 *
 *  2. A LIVE PROMPT IS NEVER WRITTEN HERE. proposeVersion inserts a row with
 *     status 'proposed'; promoting one is os_inst_version_promote(), a
 *     key-gated function, and the trigger refuses every other path (B-1).
 *
 *  3. EVERY READ IS A ReadResult. The institution migrations land before this
 *     ships and a fresh environment replays in order; "the table is not there
 *     yet" must never render as "no departments" — this project's most
 *     repeated defect (see readResult.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { okRows, readAbsence, type ReadResult } from './readResult';
import type {
  InstAgentVersion,
  InstAssignment,
  InstBrief,
  InstBriefBody,
  InstCorpusRecord,
  InstDebate,
  InstDepartment,
  InstEgressBlock,
  InstEvaluation,
  InstEvaluationRun,
  InstEvent,
  InstReview,
  InstReviewFinding,
  InstSeat,
  InstSubmission,
  AssignmentKind,
  AssignmentStatus,
  DataClass,
  WeightClass,
} from './institutionTypes';

// --- writes the stepper makes ----------------------------------------------

export interface BriefWrite {
  question: string;
  brief?: InstBriefBody;
  weightClass?: WeightClass;
  dataClass?: DataClass;
  routing?: string[];
  costEstimateUsd?: number | null;
  tokensEstimate?: number | null;
}

export interface AssignmentWrite {
  briefId: string;
  departmentId?: string | null;
  agentId?: string | null;
  agentSlug: string;
  kind: AssignmentKind;
  status?: AssignmentStatus;
  parentAssignmentId?: string | null;
  input?: string;
  detail?: Record<string, unknown>;
}

export interface AssignmentPatch {
  status?: AssignmentStatus;
  output?: string;
  outputCorpusId?: string | null;
  runId?: string | null;
  reworkCount?: number;
  round?: number;
  refusalReason?: string | null;
  detail?: Record<string, unknown>;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface ReviewWrite {
  briefId: string;
  kind: 'peer' | 'lead' | 'committee';
  reviewerAgentId: string;
  subjectAssignmentId?: string | null;
  subjectSubmissionId?: string | null;
  subjectAgentId?: string | null;
  findings: InstReviewFinding[];
  verdict: 'accept' | 'rework' | 'reject' | 'escalate';
  summary: string;
  round?: number;
  runId?: string | null;
}

export interface SubmissionWrite {
  briefId: string;
  fromDepartmentId: string;
  toDepartmentId?: string | null;
  toCommittee?: boolean;
  produced: string;
  restsOn: string[];
  uncertainties: string;
  exclusions: string;
  returnCount?: number;
  accepted?: boolean;
}

export interface DebateWrite {
  briefId: string;
  reviewId: string;
  rebuttingAgentId: string;
  rebuttal: string;
  round?: number;
}

export interface VersionProposal {
  agentId: string;
  systemPrompt: string;
  proposedBy: string;
  proposedByAgentId?: string | null;
  rationale: string;
  diff: string;
  triggeredByReviewId?: string | null;
}

export interface EvaluationRunWrite {
  evaluationId: string;
  agentId: string;
  agentVersionId?: string | null;
  phase: 'before' | 'after' | 'baseline';
  answer: string;
  runId?: string | null;
}

export interface EventWrite {
  briefId?: string | null;
  kind: string;
  agentSlug?: string | null;
  departmentSlug?: string | null;
  payload?: Record<string, unknown>;
}

export interface InstitutionRepository {
  // --- structure
  listDepartments(): Promise<ReadResult<InstDepartment>>;
  listSeats(): Promise<ReadResult<InstSeat>>;

  // --- briefs and their work
  listBriefs(limit?: number): Promise<ReadResult<InstBrief>>;
  getBrief(id: string): Promise<InstBrief | null>;
  createBrief(input: BriefWrite): Promise<InstBrief>;
  updateBrief(id: string, patch: Partial<InstBrief>): Promise<InstBrief>;

  listAssignments(briefId: string): Promise<ReadResult<InstAssignment>>;
  createAssignment(input: AssignmentWrite): Promise<InstAssignment>;
  updateAssignment(id: string, patch: AssignmentPatch): Promise<InstAssignment>;

  listReviews(briefId: string): Promise<ReadResult<InstReview>>;
  createReview(input: ReviewWrite): Promise<InstReview>;

  listSubmissions(briefId: string): Promise<ReadResult<InstSubmission>>;
  createSubmission(input: SubmissionWrite): Promise<InstSubmission>;
  updateSubmission(id: string, patch: { accepted?: boolean; returnCount?: number }): Promise<InstSubmission>;

  listDebates(briefId: string): Promise<ReadResult<InstDebate>>;
  createDebate(input: DebateWrite): Promise<InstDebate>;
  weighDebate(id: string, weighing: string, outcome: 'accepted' | 'rejected' | 'partially_accepted'): Promise<InstDebate>;

  // --- the corpus: read only, by design (see the header)
  listCorpus(filter?: { briefId?: string; kind?: string; limit?: number }): Promise<ReadResult<InstCorpusRecord>>;
  getCorpusRecord(id: string): Promise<InstCorpusRecord | null>;

  // --- versions (B-1): propose here, promote through the function
  listVersions(agentId?: string): Promise<ReadResult<InstAgentVersion>>;
  proposeVersion(input: VersionProposal): Promise<InstAgentVersion>;
  promoteVersion(id: string): Promise<void>;
  rejectVersion(id: string, reason: string): Promise<void>;

  // --- evaluations (B-9): the set is the director's, runs are recorded here
  listEvaluations(): Promise<ReadResult<InstEvaluation>>;
  listEvaluationRuns(agentId?: string): Promise<ReadResult<InstEvaluationRun>>;
  recordEvaluationRun(input: EvaluationRunWrite): Promise<InstEvaluationRun>;
  /**
   * Scores one recorded answer against a rubric the caller never sees, and
   * returns the number it wrote. Key-gated in the database
   * (os_inst_eval_score_owner); an agent calling it is refused.
   */
  scoreEvaluationRun(runId: string): Promise<number | null>;
  /** Attaches a before/after score to a proposal (B-9). Key-gated. */
  setVersionEvalScore(versionId: string, phase: 'before' | 'after', score: number): Promise<void>;

  // --- the record
  listEgressBlocks(briefId?: string): Promise<ReadResult<InstEgressBlock>>;
  listEvents(briefId: string, since?: number): Promise<ReadResult<InstEvent>>;
  recordEvent(input: EventWrite): Promise<void>;

  /** The director's decision on a brief (1-E). Key-gated in the database. */
  decideBrief(id: string, decision: 'approved' | 'rejected' | 'published', reason: string | null): Promise<void>;

  /**
   * An agent authored inside the institution (B-3), and its seat.
   *
   * ALWAYS PUBLIC, and not as a default a caller may override: the field is
   * hardcoded here, `authored_by_agent_id` is always set, and the
   * os_lab_agents_lane_at_birth trigger refuses an internal agent carrying
   * that column whoever holds the key. Promotion to the internal lane is
   * the director's action.
   */
  authorAgent(input: AuthorAgentInput): Promise<AuthoredAgent>;
}

export interface AuthorAgentInput {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  authoredByAgentId: string;
  authoringPurpose: string;
  departmentId: string;
  seatPurpose: string;
  /** Non-null when filling an existing empty desk; null creates a seat. */
  seatSlug: string | null;
  seatRole: 'lead' | 'specialist';
}

export interface AuthoredAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  dataClass: DataClass;
  version: number;
}

// --- row mapping ------------------------------------------------------------

interface DepartmentRow {
  id: string; slug: string; name: string; kind: InstDepartment['kind'];
  pipeline_order: number; lead_agent_slug: string; purpose: string;
  accountable_for: string; is_active: boolean;
}
const toDepartment = (row: DepartmentRow): InstDepartment => ({
  id: row.id, slug: row.slug, name: row.name, kind: row.kind,
  pipelineOrder: row.pipeline_order, leadAgentSlug: row.lead_agent_slug,
  purpose: row.purpose, accountableFor: row.accountable_for, isActive: row.is_active,
});

interface SeatRow {
  id: string; department_id: string; agent_slug: string;
  role: 'lead' | 'specialist'; seat_purpose: string; position: number;
}
const toSeat = (row: SeatRow): InstSeat => ({
  id: row.id, departmentId: row.department_id, agentSlug: row.agent_slug,
  role: row.role, seatPurpose: row.seat_purpose, position: row.position,
});

interface BriefRow {
  id: string; question: string; brief: InstBriefBody; weight_class: WeightClass;
  class_overridden_by_director: boolean; data_class: DataClass; routing: string[];
  status: InstBrief['status']; current_department_slug: string | null;
  cost_estimate_usd: number | string | null; tokens_estimate: number | null;
  cost_actual_usd: number | string; tokens_actual: number; steps_taken: number;
  final_output_corpus_id: string | null;
  director_decision: InstBrief['directorDecision']; director_reason: string | null;
  decided_at: string | null; started_at: string | null; finished_at: string | null;
  created_at: string; updated_at: string;
}
const numeric = (value: number | string | null): number | null =>
  value === null ? null : typeof value === 'number' ? value : Number(value);

const toBrief = (row: BriefRow): InstBrief => ({
  id: row.id, question: row.question, brief: row.brief ?? {}, weightClass: row.weight_class,
  classOverriddenByDirector: row.class_overridden_by_director, dataClass: row.data_class,
  routing: row.routing ?? [], status: row.status, currentDepartmentSlug: row.current_department_slug,
  costEstimateUsd: numeric(row.cost_estimate_usd), tokensEstimate: row.tokens_estimate,
  costActualUsd: numeric(row.cost_actual_usd) ?? 0, tokensActual: row.tokens_actual,
  stepsTaken: row.steps_taken, finalOutputCorpusId: row.final_output_corpus_id,
  directorDecision: row.director_decision, directorReason: row.director_reason,
  decidedAt: row.decided_at, startedAt: row.started_at, finishedAt: row.finished_at,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

interface AssignmentRow {
  id: string; brief_id: string; department_id: string | null; agent_id: string | null;
  agent_slug: string; kind: AssignmentKind; status: AssignmentStatus;
  parent_assignment_id: string | null; input: string; output: string;
  output_corpus_id: string | null; run_id: string | null; rework_count: number;
  round: number; refusal_reason: string | null; detail: Record<string, unknown>;
  started_at: string | null; finished_at: string | null; created_at: string; updated_at: string;
}
const toAssignment = (row: AssignmentRow): InstAssignment => ({
  id: row.id, briefId: row.brief_id, departmentId: row.department_id, agentId: row.agent_id,
  agentSlug: row.agent_slug, kind: row.kind, status: row.status,
  parentAssignmentId: row.parent_assignment_id, input: row.input, output: row.output,
  outputCorpusId: row.output_corpus_id, runId: row.run_id, reworkCount: row.rework_count,
  round: row.round, refusalReason: row.refusal_reason, detail: row.detail ?? {},
  startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at, updatedAt: row.updated_at,
});

interface ReviewRow {
  id: string; brief_id: string; kind: 'peer' | 'lead' | 'committee'; reviewer_agent_id: string;
  subject_assignment_id: string | null; subject_submission_id: string | null;
  subject_agent_id: string | null; findings: InstReviewFinding[];
  verdict: InstReview['verdict']; summary: string; round: number;
  run_id: string | null; created_at: string;
}
const toReview = (row: ReviewRow): InstReview => ({
  id: row.id, briefId: row.brief_id, kind: row.kind, reviewerAgentId: row.reviewer_agent_id,
  subjectAssignmentId: row.subject_assignment_id, subjectSubmissionId: row.subject_submission_id,
  subjectAgentId: row.subject_agent_id, findings: row.findings ?? [], verdict: row.verdict,
  summary: row.summary, round: row.round, runId: row.run_id, createdAt: row.created_at,
});

interface SubmissionRow {
  id: string; brief_id: string; from_department_id: string; to_department_id: string | null;
  to_committee: boolean; produced: string; rests_on: string[]; uncertainties: string;
  exclusions: string; return_count: number; accepted: boolean; created_at: string;
}
const toSubmission = (row: SubmissionRow): InstSubmission => ({
  id: row.id, briefId: row.brief_id, fromDepartmentId: row.from_department_id,
  toDepartmentId: row.to_department_id, toCommittee: row.to_committee, produced: row.produced,
  restsOn: row.rests_on ?? [], uncertainties: row.uncertainties, exclusions: row.exclusions,
  returnCount: row.return_count, accepted: row.accepted, createdAt: row.created_at,
});

interface DebateRow {
  id: string; brief_id: string; review_id: string; rebutting_agent_id: string;
  rebuttal: string; weighing: string | null; outcome: InstDebate['outcome'];
  round: number; created_at: string;
}
const toDebate = (row: DebateRow): InstDebate => ({
  id: row.id, briefId: row.brief_id, reviewId: row.review_id, rebuttingAgentId: row.rebutting_agent_id,
  rebuttal: row.rebuttal, weighing: row.weighing, outcome: row.outcome, round: row.round,
  createdAt: row.created_at,
});

interface CorpusRow {
  id: string; kind: InstCorpusRecord['kind']; title: string; data_class: DataClass;
  content: string; content_hash: string; url: string | null; http_status: number | null;
  fetched_at: string | null; query: string | null; provenance: Record<string, unknown>;
  derived_from: string[]; brief_id: string | null; assignment_id: string | null;
  created_by_agent_id: string | null; created_by_run_id: string | null;
  review_status: InstCorpusRecord['reviewStatus']; created_at: string;
}
const toCorpus = (row: CorpusRow): InstCorpusRecord => ({
  id: row.id, kind: row.kind, title: row.title, dataClass: row.data_class, content: row.content,
  contentHash: row.content_hash, url: row.url, httpStatus: row.http_status, fetchedAt: row.fetched_at,
  query: row.query, provenance: row.provenance ?? {}, derivedFrom: row.derived_from ?? [],
  briefId: row.brief_id, assignmentId: row.assignment_id, createdByAgentId: row.created_by_agent_id,
  createdByRunId: row.created_by_run_id, reviewStatus: row.review_status, createdAt: row.created_at,
});

interface VersionRow {
  id: string; agent_id: string; version: number | null; system_prompt: string;
  status: InstAgentVersion['status']; proposed_by: string; proposed_by_agent_id: string | null;
  rationale: string; diff: string; triggered_by_review_id: string | null;
  eval_score_before: number | string | null; eval_score_after: number | string | null;
  approved_by: string | null; approved_at: string | null; rejected_reason: string | null;
  created_at: string;
}
const toVersion = (row: VersionRow): InstAgentVersion => ({
  id: row.id, agentId: row.agent_id, version: row.version, systemPrompt: row.system_prompt,
  status: row.status, proposedBy: row.proposed_by, proposedByAgentId: row.proposed_by_agent_id,
  rationale: row.rationale, diff: row.diff, triggeredByReviewId: row.triggered_by_review_id,
  evalScoreBefore: numeric(row.eval_score_before), evalScoreAfter: numeric(row.eval_score_after),
  approvedBy: row.approved_by, approvedAt: row.approved_at, rejectedReason: row.rejected_reason,
  createdAt: row.created_at,
});

interface EvaluationRow {
  id: string; slug: string; department_slug: string | null; task: string;
  expected_answer: string; weight: number | string; is_active: boolean;
}
const toEvaluation = (row: EvaluationRow): InstEvaluation => ({
  id: row.id, slug: row.slug, departmentSlug: row.department_slug, task: row.task,
  expectedAnswer: row.expected_answer, weight: numeric(row.weight) ?? 1, isActive: row.is_active,
});

interface EvaluationRunRow {
  id: string; evaluation_id: string; agent_id: string; agent_version_id: string | null;
  phase: 'before' | 'after' | 'baseline'; answer: string; score: number | string | null;
  run_id: string | null; created_at: string;
}
const toEvaluationRun = (row: EvaluationRunRow): InstEvaluationRun => ({
  id: row.id, evaluationId: row.evaluation_id, agentId: row.agent_id,
  agentVersionId: row.agent_version_id, phase: row.phase, answer: row.answer,
  score: numeric(row.score), runId: row.run_id, createdAt: row.created_at,
});

interface EgressRow {
  id: string; brief_id: string | null; assignment_id: string | null; agent_id: string | null;
  run_id: string | null; tool: string; matched_excerpt: string; query_hash: string; created_at: string;
}
const toEgress = (row: EgressRow): InstEgressBlock => ({
  id: row.id, briefId: row.brief_id, assignmentId: row.assignment_id, agentId: row.agent_id,
  runId: row.run_id, tool: row.tool, matchedExcerpt: row.matched_excerpt,
  queryHash: row.query_hash, createdAt: row.created_at,
});

interface EventRow {
  id: number; brief_id: string | null; kind: string; agent_slug: string | null;
  department_slug: string | null; payload: Record<string, unknown>; created_at: string;
}
const toEvent = (row: EventRow): InstEvent => ({
  id: row.id, briefId: row.brief_id, kind: row.kind, agentSlug: row.agent_slug,
  departmentSlug: row.department_slug, payload: row.payload ?? {}, createdAt: row.created_at,
});

// --- the Supabase implementation --------------------------------------------

export function createSupabaseInstitutionRepository(client: SupabaseClient): InstitutionRepository {
  const fail = (label: string, message: string): never => {
    throw new Error(`${label} failed: ${message}`);
  };

  return {
    async listDepartments() {
      const { data, error } = await client.from('os_inst_departments').select('*').order('pipeline_order');
      if (error) return readAbsence('institution departments', error);
      return okRows((data as DepartmentRow[]).map(toDepartment));
    },

    async listSeats() {
      const { data, error } = await client.from('os_inst_department_members').select('*').order('position');
      if (error) return readAbsence('institution seats', error);
      return okRows((data as SeatRow[]).map(toSeat));
    },

    async listBriefs(limit = 50) {
      const { data, error } = await client.from('os_inst_briefs').select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) return readAbsence('institution briefs', error);
      return okRows((data as BriefRow[]).map(toBrief));
    },

    async getBrief(id) {
      const { data, error } = await client.from('os_inst_briefs').select('*').eq('id', id).maybeSingle();
      if (error) fail('getBrief', error.message);
      return data ? toBrief(data as BriefRow) : null;
    },

    async createBrief(input) {
      const { data, error } = await client
        .from('os_inst_briefs')
        .insert({
          question: input.question,
          brief: input.brief ?? {},
          weight_class: input.weightClass ?? 'standard',
          data_class: input.dataClass ?? 'public',
          routing: input.routing ?? [],
          cost_estimate_usd: input.costEstimateUsd ?? null,
          tokens_estimate: input.tokensEstimate ?? null,
        })
        .select('*')
        .single();
      if (error) fail('createBrief', error.message);
      return toBrief(data as BriefRow);
    },

    async updateBrief(id, patch) {
      const row: Record<string, unknown> = {};
      if ('brief' in patch) row.brief = patch.brief;
      if ('weightClass' in patch) row.weight_class = patch.weightClass;
      if ('classOverriddenByDirector' in patch) row.class_overridden_by_director = patch.classOverriddenByDirector;
      if ('dataClass' in patch) row.data_class = patch.dataClass;
      if ('routing' in patch) row.routing = patch.routing;
      if ('status' in patch) row.status = patch.status;
      if ('currentDepartmentSlug' in patch) row.current_department_slug = patch.currentDepartmentSlug;
      if ('costEstimateUsd' in patch) row.cost_estimate_usd = patch.costEstimateUsd;
      if ('tokensEstimate' in patch) row.tokens_estimate = patch.tokensEstimate;
      if ('costActualUsd' in patch) row.cost_actual_usd = patch.costActualUsd;
      if ('tokensActual' in patch) row.tokens_actual = patch.tokensActual;
      if ('stepsTaken' in patch) row.steps_taken = patch.stepsTaken;
      if ('finalOutputCorpusId' in patch) row.final_output_corpus_id = patch.finalOutputCorpusId;
      if ('startedAt' in patch) row.started_at = patch.startedAt;
      if ('finishedAt' in patch) row.finished_at = patch.finishedAt;
      const { data, error } = await client.from('os_inst_briefs').update(row).eq('id', id).select('*').single();
      if (error) fail('updateBrief', error.message);
      return toBrief(data as BriefRow);
    },

    async listAssignments(briefId) {
      const { data, error } = await client.from('os_inst_assignments').select('*').eq('brief_id', briefId).order('created_at');
      if (error) return readAbsence('institution assignments', error);
      return okRows((data as AssignmentRow[]).map(toAssignment));
    },

    async createAssignment(input) {
      const { data, error } = await client
        .from('os_inst_assignments')
        .insert({
          brief_id: input.briefId,
          department_id: input.departmentId ?? null,
          agent_id: input.agentId ?? null,
          agent_slug: input.agentSlug,
          kind: input.kind,
          status: input.status ?? 'assigned',
          parent_assignment_id: input.parentAssignmentId ?? null,
          input: input.input ?? '',
          detail: input.detail ?? {},
        })
        .select('*')
        .single();
      if (error) fail('createAssignment', error.message);
      return toAssignment(data as AssignmentRow);
    },

    async updateAssignment(id, patch) {
      const row: Record<string, unknown> = {};
      if ('status' in patch) row.status = patch.status;
      if ('output' in patch) row.output = patch.output;
      if ('outputCorpusId' in patch) row.output_corpus_id = patch.outputCorpusId;
      if ('runId' in patch) row.run_id = patch.runId;
      if ('reworkCount' in patch) row.rework_count = patch.reworkCount;
      if ('round' in patch) row.round = patch.round;
      if ('refusalReason' in patch) row.refusal_reason = patch.refusalReason;
      if ('detail' in patch) row.detail = patch.detail;
      if ('startedAt' in patch) row.started_at = patch.startedAt;
      if ('finishedAt' in patch) row.finished_at = patch.finishedAt;
      const { data, error } = await client.from('os_inst_assignments').update(row).eq('id', id).select('*').single();
      if (error) fail('updateAssignment', error.message);
      return toAssignment(data as AssignmentRow);
    },

    async listReviews(briefId) {
      const { data, error } = await client.from('os_inst_reviews').select('*').eq('brief_id', briefId).order('created_at');
      if (error) return readAbsence('institution reviews', error);
      return okRows((data as ReviewRow[]).map(toReview));
    },

    async createReview(input) {
      const { data, error } = await client
        .from('os_inst_reviews')
        .insert({
          brief_id: input.briefId,
          kind: input.kind,
          reviewer_agent_id: input.reviewerAgentId,
          subject_assignment_id: input.subjectAssignmentId ?? null,
          subject_submission_id: input.subjectSubmissionId ?? null,
          subject_agent_id: input.subjectAgentId ?? null,
          findings: input.findings,
          verdict: input.verdict,
          summary: input.summary,
          round: input.round ?? 1,
          run_id: input.runId ?? null,
        })
        .select('*')
        .single();
      if (error) fail('createReview', error.message);
      return toReview(data as ReviewRow);
    },

    async listSubmissions(briefId) {
      const { data, error } = await client.from('os_inst_submissions').select('*').eq('brief_id', briefId).order('created_at');
      if (error) return readAbsence('institution submissions', error);
      return okRows((data as SubmissionRow[]).map(toSubmission));
    },

    async createSubmission(input) {
      const { data, error } = await client
        .from('os_inst_submissions')
        .insert({
          brief_id: input.briefId,
          from_department_id: input.fromDepartmentId,
          to_department_id: input.toDepartmentId ?? null,
          to_committee: input.toCommittee ?? false,
          produced: input.produced,
          rests_on: input.restsOn,
          uncertainties: input.uncertainties,
          exclusions: input.exclusions,
          return_count: input.returnCount ?? 0,
          accepted: input.accepted ?? true,
        })
        .select('*')
        .single();
      if (error) fail('createSubmission', error.message);
      return toSubmission(data as SubmissionRow);
    },

    async updateSubmission(id, patch) {
      const row: Record<string, unknown> = {};
      if ('accepted' in patch) row.accepted = patch.accepted;
      if ('returnCount' in patch) row.return_count = patch.returnCount;
      const { data, error } = await client.from('os_inst_submissions').update(row).eq('id', id).select('*').single();
      if (error) fail('updateSubmission', error.message);
      return toSubmission(data as SubmissionRow);
    },

    async listDebates(briefId) {
      const { data, error } = await client.from('os_inst_debates').select('*').eq('brief_id', briefId).order('created_at');
      if (error) return readAbsence('institution debates', error);
      return okRows((data as DebateRow[]).map(toDebate));
    },

    async createDebate(input) {
      const { data, error } = await client
        .from('os_inst_debates')
        .insert({
          brief_id: input.briefId,
          review_id: input.reviewId,
          rebutting_agent_id: input.rebuttingAgentId,
          rebuttal: input.rebuttal,
          round: input.round ?? 1,
        })
        .select('*')
        .single();
      if (error) fail('createDebate', error.message);
      return toDebate(data as DebateRow);
    },

    async weighDebate(id, weighing, outcome) {
      const { data, error } = await client
        .from('os_inst_debates')
        .update({ weighing, outcome })
        .eq('id', id)
        .select('*')
        .single();
      if (error) fail('weighDebate', error.message);
      return toDebate(data as DebateRow);
    },

    async listCorpus(filter) {
      let query = client.from('os_inst_corpus').select('*').order('created_at', { ascending: false });
      if (filter?.briefId) query = query.eq('brief_id', filter.briefId);
      if (filter?.kind) query = query.eq('kind', filter.kind);
      query = query.limit(filter?.limit ?? 200);
      const { data, error } = await query;
      if (error) return readAbsence('institution corpus', error);
      return okRows((data as CorpusRow[]).map(toCorpus));
    },

    async getCorpusRecord(id) {
      const { data, error } = await client.from('os_inst_corpus').select('*').eq('id', id).maybeSingle();
      if (error) fail('getCorpusRecord', error.message);
      return data ? toCorpus(data as CorpusRow) : null;
    },

    async listVersions(agentId) {
      let query = client.from('os_inst_agent_versions').select('*').order('created_at', { ascending: false });
      if (agentId) query = query.eq('agent_id', agentId);
      const { data, error } = await query;
      if (error) return readAbsence('institution agent versions', error);
      return okRows((data as VersionRow[]).map(toVersion));
    },

    async proposeVersion(input) {
      const { data, error } = await client
        .from('os_inst_agent_versions')
        .insert({
          agent_id: input.agentId,
          system_prompt: input.systemPrompt,
          status: 'proposed',
          proposed_by: input.proposedBy,
          proposed_by_agent_id: input.proposedByAgentId ?? null,
          rationale: input.rationale,
          diff: input.diff,
          triggered_by_review_id: input.triggeredByReviewId ?? null,
        })
        .select('*')
        .single();
      if (error) fail('proposeVersion', error.message);
      return toVersion(data as VersionRow);
    },

    async promoteVersion(id) {
      const { error } = await client.rpc('os_inst_version_promote', { p_version_id: id });
      if (error) fail('promoteVersion', error.message);
    },

    async rejectVersion(id, reason) {
      const { error } = await client.rpc('os_inst_version_reject', { p_version_id: id, p_reason: reason });
      if (error) fail('rejectVersion', error.message);
    },

    async listEvaluations() {
      const { data, error } = await client.from('os_inst_evaluations').select('*').order('slug');
      if (error) return readAbsence('institution evaluations', error);
      return okRows((data as EvaluationRow[]).map(toEvaluation));
    },

    async listEvaluationRuns(agentId) {
      let query = client.from('os_inst_evaluation_runs').select('*').order('created_at', { ascending: false });
      if (agentId) query = query.eq('agent_id', agentId);
      const { data, error } = await query;
      if (error) return readAbsence('institution evaluation runs', error);
      return okRows((data as EvaluationRunRow[]).map(toEvaluationRun));
    },

    async recordEvaluationRun(input) {
      const { data, error } = await client
        .from('os_inst_evaluation_runs')
        .insert({
          evaluation_id: input.evaluationId,
          agent_id: input.agentId,
          agent_version_id: input.agentVersionId ?? null,
          phase: input.phase,
          answer: input.answer,
          run_id: input.runId ?? null,
        })
        .select('*')
        .single();
      if (error) fail('recordEvaluationRun', error.message);
      return toEvaluationRun(data as EvaluationRunRow);
    },

    async scoreEvaluationRun(runId) {
      const { data, error } = await client.rpc('os_inst_eval_score_owner', { p_run_id: runId });
      if (error) fail('scoreEvaluationRun', error.message);
      return typeof data === 'number' ? data : data === null ? null : Number(data);
    },

    async setVersionEvalScore(versionId, phase, score) {
      const { error } = await client.rpc('os_inst_version_set_eval_owner', {
        p_version_id: versionId,
        p_phase: phase,
        p_score: score,
      });
      if (error) fail('setVersionEvalScore', error.message);
    },

    async listEgressBlocks(briefId) {
      let query = client.from('os_inst_egress_blocks').select('*').order('created_at', { ascending: false }).limit(200);
      if (briefId) query = query.eq('brief_id', briefId);
      const { data, error } = await query;
      if (error) return readAbsence('institution egress blocks', error);
      return okRows((data as EgressRow[]).map(toEgress));
    },

    async listEvents(briefId, since) {
      let query = client.from('os_inst_events').select('*').eq('brief_id', briefId).order('id');
      if (since !== undefined) query = query.gt('id', since);
      const { data, error } = await query;
      if (error) return readAbsence('institution events', error);
      return okRows((data as EventRow[]).map(toEvent));
    },

    async recordEvent(input) {
      const { error } = await client.from('os_inst_events').insert({
        brief_id: input.briefId ?? null,
        kind: input.kind,
        agent_slug: input.agentSlug ?? null,
        department_slug: input.departmentSlug ?? null,
        payload: input.payload ?? {},
      });
      // An event is a record of what happened, not a precondition for it: a
      // failed event write must never turn a completed step into an error.
      // Swallowed deliberately, and named so nobody "fixes" it into a throw.
      void error;
    },

    async decideBrief(id, decision, reason) {
      const { error } = await client.rpc('os_inst_brief_decide', {
        p_brief_id: id,
        p_decision: decision,
        p_reason: reason,
      });
      if (error) fail('decideBrief', error.message);
    },

    async authorAgent(input) {
      // The Anthropic provider is not chosen here: a public agent may run
      // on any provider, and the boundary trigger decides what an internal
      // one may use. Leaving default_provider_id null keeps that decision
      // where it belongs.
      const { data, error } = await client
        .from('os_lab_agents')
        .insert({
          slug: input.slug,
          name: input.name,
          description: input.description,
          system_prompt: input.systemPrompt,
          data_class: 'public',
          authored_by_agent_id: input.authoredByAgentId,
          authoring_purpose: input.authoringPurpose,
        })
        .select('id, slug, name, description, system_prompt, data_class, version')
        .single();
      if (error) fail('authorAgent', error.message);
      const row = data as {
        id: string; slug: string; name: string; description: string;
        system_prompt: string; data_class: DataClass; version: number;
      };
      if (!input.seatSlug) {
        const { error: seatError } = await client.from('os_inst_department_members').insert({
          department_id: input.departmentId,
          agent_slug: input.slug,
          role: input.seatRole,
          seat_purpose: input.seatPurpose,
          position: 90,
        });
        // The agent exists either way; an unseated agent is visible in the
        // registry and nameable, which is better than losing the prompt
        // that was just written. Surfaced, not swallowed silently.
        if (seatError) {
          throw new Error(`authorAgent: ${input.slug} was created but could not be seated: ${seatError.message}`);
        }
      }
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        systemPrompt: row.system_prompt,
        dataClass: row.data_class,
        version: row.version,
      };
    },
  };
}
