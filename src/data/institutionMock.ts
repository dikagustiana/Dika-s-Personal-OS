/**
 * The institution, in memory.
 *
 * The boot default so a bare clone runs: `PassphraseGate` swaps in the
 * Supabase implementation after verification, exactly as it does for the
 * rest of the app. It is also what the stepper's tests run against, so the
 * pipeline is exercised end to end with no network and no database.
 *
 * It enforces the two rules a mock could otherwise quietly drop, because a
 * mock that is more permissive than production teaches the wrong thing:
 *   * a version row is born 'proposed'; promoting one is a separate call;
 *   * the corpus is not writable here either — records arrive through the
 *     tool layer, which in tests is a fake that returns records.
 */
import { okRows, type ReadResult } from './readResult';
import type {
  AssignmentPatch,
  AssignmentWrite,
  BriefWrite,
  DebateWrite,
  EvaluationRunWrite,
  EventWrite,
  InstitutionRepository,
  ReviewWrite,
  SubmissionWrite,
  VersionProposal,
} from './institutionRepository';
import type {
  InstAgentVersion,
  InstAssignment,
  InstBrief,
  InstCorpusRecord,
  InstDebate,
  InstDepartment,
  InstEgressBlock,
  InstEvaluation,
  InstEvaluationRun,
  InstEvent,
  InstReview,
  InstSeat,
  InstSubmission,
} from './institutionTypes';

let counter = 0;
const id = (prefix: string) => `${prefix}-${(counter += 1)}`;
const now = () => new Date().toISOString();

export const MOCK_DEPARTMENTS: InstDepartment[] = [
  { id: 'dept-program', slug: 'program-office', name: 'Program Office', kind: 'program_office', pipelineOrder: 0, leadAgentSlug: 'evidence-coordinator', purpose: 'Runs the pipeline.', accountableFor: 'A written brief, routing, arbitration and budget.', isActive: true },
  { id: 'dept-framing', slug: 'framing-office', name: 'Framing Office', kind: 'department', pipelineOrder: 1, leadAgentSlug: 'framing-lead', purpose: 'Owns the question.', accountableFor: 'A brief that can actually be answered.', isActive: true },
  { id: 'dept-verification', slug: 'verification', name: 'Verification', kind: 'department', pipelineOrder: 7, leadAgentSlug: 'verification-lead', purpose: 'Owns whether it holds.', accountableFor: 'Arithmetic, standards, G-NUMBER and provenance.', isActive: true },
  { id: 'dept-committee', slug: 'committee', name: 'Editorial Committee', kind: 'committee', pipelineOrder: 9, leadAgentSlug: 'editorial-committee', purpose: 'An editorial board.', accountableFor: 'A verdict, findings and proposals.', isActive: true },
];

export const MOCK_SEATS: InstSeat[] = [
  { id: 'seat-1', departmentId: 'dept-program', agentSlug: 'evidence-coordinator', role: 'lead', seatPurpose: 'Intake, routing, arbitration.', position: 0 },
  { id: 'seat-2', departmentId: 'dept-framing', agentSlug: 'framing-lead', role: 'lead', seatPurpose: 'Accepts or returns the question.', position: 0 },
  { id: 'seat-3', departmentId: 'dept-framing', agentSlug: 'evidence-framer', role: 'specialist', seatPurpose: 'Critiques the framing.', position: 1 },
  { id: 'seat-4', departmentId: 'dept-framing', agentSlug: 'scope-analyst', role: 'specialist', seatPurpose: 'Draws the scope boundary.', position: 2 },
  { id: 'seat-5', departmentId: 'dept-verification', agentSlug: 'verification-lead', role: 'lead', seatPurpose: 'The last line before the director.', position: 0 },
  { id: 'seat-6', departmentId: 'dept-verification', agentSlug: 'numeric-auditor', role: 'specialist', seatPurpose: 'Re-derives every figure.', position: 1 },
  { id: 'seat-7', departmentId: 'dept-verification', agentSlug: 'provenance-checker', role: 'specialist', seatPurpose: 'Every claim resolves or fails.', position: 2 },
  { id: 'seat-8', departmentId: 'dept-committee', agentSlug: 'editorial-committee', role: 'lead', seatPurpose: 'The board.', position: 0 },
];

export class MockInstitutionRepository implements InstitutionRepository {
  departments: InstDepartment[] = MOCK_DEPARTMENTS.map((row) => ({ ...row }));
  seats: InstSeat[] = MOCK_SEATS.map((row) => ({ ...row }));
  briefs: InstBrief[] = [];
  assignments: InstAssignment[] = [];
  reviews: InstReview[] = [];
  submissions: InstSubmission[] = [];
  debates: InstDebate[] = [];
  corpus: InstCorpusRecord[] = [];
  versions: InstAgentVersion[] = [];
  evaluations: InstEvaluation[] = [];
  evaluationRuns: InstEvaluationRun[] = [];
  egressBlocks: InstEgressBlock[] = [];
  events: InstEvent[] = [];

  async listDepartments(): Promise<ReadResult<InstDepartment>> {
    return okRows(this.departments.map((row) => ({ ...row })));
  }

  async listSeats(): Promise<ReadResult<InstSeat>> {
    return okRows(this.seats.map((row) => ({ ...row })));
  }

  async listBriefs(): Promise<ReadResult<InstBrief>> {
    return okRows(this.briefs.map((row) => ({ ...row })));
  }

  async getBrief(briefId: string): Promise<InstBrief | null> {
    const found = this.briefs.find((row) => row.id === briefId);
    return found ? { ...found } : null;
  }

  async createBrief(input: BriefWrite): Promise<InstBrief> {
    const brief: InstBrief = {
      id: id('brief'),
      question: input.question,
      brief: input.brief ?? {},
      weightClass: input.weightClass ?? 'standard',
      classOverriddenByDirector: false,
      dataClass: input.dataClass ?? 'public',
      routing: input.routing ?? [],
      status: 'intake',
      currentDepartmentSlug: null,
      costEstimateUsd: input.costEstimateUsd ?? null,
      tokensEstimate: input.tokensEstimate ?? null,
      costActualUsd: 0,
      tokensActual: 0,
      stepsTaken: 0,
      finalOutputCorpusId: null,
      directorDecision: null,
      directorReason: null,
      decidedAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.briefs.push(brief);
    return { ...brief };
  }

  async updateBrief(briefId: string, patch: Partial<InstBrief>): Promise<InstBrief> {
    const index = this.briefs.findIndex((row) => row.id === briefId);
    if (index === -1) throw new Error(`updateBrief: no brief ${briefId}`);
    this.briefs[index] = { ...this.briefs[index], ...patch, updatedAt: now() };
    return { ...this.briefs[index] };
  }

  async listAssignments(briefId: string): Promise<ReadResult<InstAssignment>> {
    return okRows(this.assignments.filter((row) => row.briefId === briefId).map((row) => ({ ...row })));
  }

  async createAssignment(input: AssignmentWrite): Promise<InstAssignment> {
    const assignment: InstAssignment = {
      id: id('assignment'),
      briefId: input.briefId,
      departmentId: input.departmentId ?? null,
      agentId: input.agentId ?? null,
      agentSlug: input.agentSlug,
      kind: input.kind,
      status: input.status ?? 'assigned',
      parentAssignmentId: input.parentAssignmentId ?? null,
      input: input.input ?? '',
      output: '',
      outputCorpusId: null,
      runId: null,
      reworkCount: 0,
      round: 1,
      refusalReason: null,
      detail: input.detail ?? {},
      startedAt: null,
      finishedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.assignments.push(assignment);
    return { ...assignment };
  }

  async updateAssignment(assignmentId: string, patch: AssignmentPatch): Promise<InstAssignment> {
    const index = this.assignments.findIndex((row) => row.id === assignmentId);
    if (index === -1) throw new Error(`updateAssignment: no assignment ${assignmentId}`);
    if (patch.reworkCount !== undefined && patch.reworkCount > 2) {
      throw new Error('rework_count must be between 0 and 2'); // the CHECK, mirrored
    }
    if (patch.round !== undefined && (patch.round < 1 || patch.round > 2)) {
      throw new Error('round must be between 1 and 2');
    }
    this.assignments[index] = { ...this.assignments[index], ...patch, updatedAt: now() };
    return { ...this.assignments[index] };
  }

  async listReviews(briefId: string): Promise<ReadResult<InstReview>> {
    return okRows(this.reviews.filter((row) => row.briefId === briefId).map((row) => ({ ...row })));
  }

  async createReview(input: ReviewWrite): Promise<InstReview> {
    // The guard that matters, mirrored: a review is never by its author.
    const subject = input.subjectAssignmentId
      ? this.assignments.find((row) => row.id === input.subjectAssignmentId)
      : null;
    const authorId = subject?.agentId ?? input.subjectAgentId ?? null;
    if (authorId && authorId === input.reviewerAgentId) {
      throw new Error('1-A: a review is never by its own author');
    }
    const review: InstReview = {
      id: id('review'),
      briefId: input.briefId,
      kind: input.kind,
      reviewerAgentId: input.reviewerAgentId,
      subjectAssignmentId: input.subjectAssignmentId ?? null,
      subjectSubmissionId: input.subjectSubmissionId ?? null,
      subjectAgentId: input.subjectAgentId ?? subject?.agentId ?? null,
      findings: input.findings,
      verdict: input.verdict,
      summary: input.summary,
      round: input.round ?? 1,
      runId: input.runId ?? null,
      createdAt: now(),
    };
    this.reviews.push(review);
    return { ...review };
  }

  async listSubmissions(briefId: string): Promise<ReadResult<InstSubmission>> {
    return okRows(this.submissions.filter((row) => row.briefId === briefId).map((row) => ({ ...row })));
  }

  async createSubmission(input: SubmissionWrite): Promise<InstSubmission> {
    if (input.toDepartmentId && input.toDepartmentId === input.fromDepartmentId) {
      throw new Error('1-A: a submission goes to the next department or the committee');
    }
    const submission: InstSubmission = {
      id: id('submission'),
      briefId: input.briefId,
      fromDepartmentId: input.fromDepartmentId,
      toDepartmentId: input.toDepartmentId ?? null,
      toCommittee: input.toCommittee ?? false,
      produced: input.produced,
      restsOn: input.restsOn,
      uncertainties: input.uncertainties,
      exclusions: input.exclusions,
      returnCount: input.returnCount ?? 0,
      accepted: input.accepted ?? true,
      createdAt: now(),
    };
    this.submissions.push(submission);
    return { ...submission };
  }

  async updateSubmission(submissionId: string, patch: { accepted?: boolean; returnCount?: number }): Promise<InstSubmission> {
    const index = this.submissions.findIndex((row) => row.id === submissionId);
    if (index === -1) throw new Error(`updateSubmission: no submission ${submissionId}`);
    if (patch.returnCount !== undefined && patch.returnCount > 2) {
      throw new Error('return_count must be between 0 and 2');
    }
    this.submissions[index] = { ...this.submissions[index], ...patch };
    return { ...this.submissions[index] };
  }

  async listDebates(briefId: string): Promise<ReadResult<InstDebate>> {
    return okRows(this.debates.filter((row) => row.briefId === briefId).map((row) => ({ ...row })));
  }

  async createDebate(input: DebateWrite): Promise<InstDebate> {
    if ((input.round ?? 1) > 2) throw new Error('round must be between 1 and 2');
    const debate: InstDebate = {
      id: id('debate'),
      briefId: input.briefId,
      reviewId: input.reviewId,
      rebuttingAgentId: input.rebuttingAgentId,
      rebuttal: input.rebuttal,
      weighing: null,
      outcome: null,
      round: input.round ?? 1,
      createdAt: now(),
    };
    this.debates.push(debate);
    return { ...debate };
  }

  async weighDebate(debateId: string, weighing: string, outcome: 'accepted' | 'rejected' | 'partially_accepted'): Promise<InstDebate> {
    const index = this.debates.findIndex((row) => row.id === debateId);
    if (index === -1) throw new Error(`weighDebate: no debate ${debateId}`);
    this.debates[index] = { ...this.debates[index], weighing, outcome };
    return { ...this.debates[index] };
  }

  async listCorpus(filter?: { briefId?: string; kind?: string; limit?: number }): Promise<ReadResult<InstCorpusRecord>> {
    let rows = this.corpus;
    if (filter?.briefId) rows = rows.filter((row) => row.briefId === filter.briefId);
    if (filter?.kind) rows = rows.filter((row) => row.kind === filter.kind);
    return okRows(rows.slice(0, filter?.limit ?? 200).map((row) => ({ ...row })));
  }

  async getCorpusRecord(recordId: string): Promise<InstCorpusRecord | null> {
    const found = this.corpus.find((row) => row.id === recordId);
    return found ? { ...found } : null;
  }

  async listVersions(agentId?: string): Promise<ReadResult<InstAgentVersion>> {
    const rows = agentId ? this.versions.filter((row) => row.agentId === agentId) : this.versions;
    return okRows(rows.map((row) => ({ ...row })));
  }

  async proposeVersion(input: VersionProposal): Promise<InstAgentVersion> {
    if (input.rationale.trim().length < 10 || input.diff.length === 0) {
      throw new Error('B-1: a proposal carries a rationale and a diff, or it is not a proposal');
    }
    const version: InstAgentVersion = {
      id: id('version'),
      agentId: input.agentId,
      version: null,
      systemPrompt: input.systemPrompt,
      status: 'proposed',
      proposedBy: input.proposedBy,
      proposedByAgentId: input.proposedByAgentId ?? null,
      rationale: input.rationale,
      diff: input.diff,
      triggeredByReviewId: input.triggeredByReviewId ?? null,
      evalScoreBefore: null,
      evalScoreAfter: null,
      approvedBy: null,
      approvedAt: null,
      rejectedReason: null,
      createdAt: now(),
    };
    this.versions.push(version);
    return { ...version };
  }

  async promoteVersion(versionId: string): Promise<void> {
    const index = this.versions.findIndex((row) => row.id === versionId);
    if (index === -1) throw new Error(`promoteVersion: no version ${versionId}`);
    if (this.versions[index].status !== 'proposed') {
      throw new Error(`promoteVersion: version ${versionId} is ${this.versions[index].status}, not proposed`);
    }
    for (const version of this.versions) {
      if (version.agentId === this.versions[index].agentId && version.status === 'active') version.status = 'retired';
    }
    this.versions[index] = {
      ...this.versions[index],
      status: 'active',
      version: (this.versions[index].version ?? 1) + 1,
      approvedBy: 'director',
      approvedAt: now(),
    };
  }

  async rejectVersion(versionId: string, reason: string): Promise<void> {
    const index = this.versions.findIndex((row) => row.id === versionId);
    if (index === -1) throw new Error(`rejectVersion: no version ${versionId}`);
    if (reason.trim().length < 5) throw new Error('a rejection carries a reason');
    this.versions[index] = { ...this.versions[index], status: 'rejected', rejectedReason: reason, approvedBy: 'director', approvedAt: now() };
  }

  async listEvaluations(): Promise<ReadResult<InstEvaluation>> {
    return okRows(this.evaluations.map((row) => ({ ...row })));
  }

  async listEvaluationRuns(agentId?: string): Promise<ReadResult<InstEvaluationRun>> {
    const rows = agentId ? this.evaluationRuns.filter((row) => row.agentId === agentId) : this.evaluationRuns;
    return okRows(rows.map((row) => ({ ...row })));
  }

  async recordEvaluationRun(input: EvaluationRunWrite): Promise<InstEvaluationRun> {
    const run: InstEvaluationRun = {
      id: id('eval-run'),
      evaluationId: input.evaluationId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId ?? null,
      phase: input.phase,
      answer: input.answer,
      // No score: B-9 says the scorer writes it, and the mock has no rubric.
      score: null,
      runId: input.runId ?? null,
      createdAt: now(),
    };
    this.evaluationRuns.push(run);
    return { ...run };
  }

  async listEgressBlocks(briefId?: string): Promise<ReadResult<InstEgressBlock>> {
    const rows = briefId ? this.egressBlocks.filter((row) => row.briefId === briefId) : this.egressBlocks;
    return okRows(rows.map((row) => ({ ...row })));
  }

  async listEvents(briefId: string, since?: number): Promise<ReadResult<InstEvent>> {
    const rows = this.events.filter((row) => row.briefId === briefId && (since === undefined || row.id > since));
    return okRows(rows.map((row) => ({ ...row })));
  }

  async recordEvent(input: EventWrite): Promise<void> {
    this.events.push({
      id: this.events.length + 1,
      briefId: input.briefId ?? null,
      kind: input.kind,
      agentSlug: input.agentSlug ?? null,
      departmentSlug: input.departmentSlug ?? null,
      payload: input.payload ?? {},
      createdAt: now(),
    });
  }

  async decideBrief(briefId: string, decision: 'approved' | 'rejected' | 'published', reason: string | null): Promise<void> {
    const index = this.briefs.findIndex((row) => row.id === briefId);
    if (index === -1) throw new Error(`decideBrief: no brief ${briefId}`);
    const brief = this.briefs[index];
    if (!['director', 'approved'].includes(brief.status)) {
      throw new Error(`1-E: brief ${briefId} is ${brief.status} — it has not reached the director's room`);
    }
    if (decision === 'rejected' && (reason ?? '').trim().length < 5) {
      throw new Error('1-E: a rejection carries a reason');
    }
    if (decision === 'published' && brief.status !== 'approved') throw new Error('1-E: approve before publishing');
    this.briefs[index] = {
      ...brief,
      status: decision,
      directorDecision: decision,
      directorReason: reason,
      decidedAt: now(),
    };
  }
}
