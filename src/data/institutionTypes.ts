/**
 * The institution's rows, in the app's shape.
 *
 * Tables are snake_case in Postgres and camelCase here; the mapping happens
 * in institutionRepository.ts and nowhere else, per §7 of CLAUDE.md. The
 * rules these rows obey are not written here — they are triggers
 * (20260910000100) mirrored by the pure modules under
 * supabase/functions/_shared/institution/, which both the tool layer and
 * this client import. One copy of every rule.
 */
import type { DataClass } from '../../supabase/functions/_shared/institution/types';
import type { WeightClass } from '../../supabase/functions/_shared/institution/weight';
import type {
  AssignmentKind,
  AssignmentStatus,
} from '../../supabase/functions/_shared/institution/pipeline';

export type { AssignmentKind, AssignmentStatus, DataClass, WeightClass };

export type DepartmentKind = 'program_office' | 'department' | 'committee';

export interface InstDepartment {
  id: string;
  slug: string;
  name: string;
  kind: DepartmentKind;
  pipelineOrder: number;
  leadAgentSlug: string;
  purpose: string;
  accountableFor: string;
  isActive: boolean;
}

export interface InstSeat {
  id: string;
  departmentId: string;
  agentSlug: string;
  role: 'lead' | 'specialist';
  seatPurpose: string;
  position: number;
}

export type VersionStatus = 'proposed' | 'active' | 'retired' | 'rejected';

export interface InstAgentVersion {
  id: string;
  agentId: string;
  version: number | null;
  systemPrompt: string;
  status: VersionStatus;
  proposedBy: string;
  proposedByAgentId: string | null;
  rationale: string;
  diff: string;
  triggeredByReviewId: string | null;
  evalScoreBefore: number | null;
  evalScoreAfter: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

export type BriefStatus =
  | 'intake' | 'running' | 'committee' | 'debate' | 'director'
  | 'approved' | 'rejected' | 'published' | 'failed' | 'paused';

export interface InstBriefBody {
  restated?: string;
  answerWouldBe?: string;
  outOfScope?: string;
  assumptions?: string[];
  classReason?: string;
  estimate?: {
    calls: number;
    tokens: number;
    costUsd: number;
    measured: boolean;
    breakdown: Array<{ stage: string; calls: number }>;
  };
}

export interface InstBrief {
  id: string;
  question: string;
  brief: InstBriefBody;
  weightClass: WeightClass;
  classOverriddenByDirector: boolean;
  dataClass: DataClass;
  routing: string[];
  status: BriefStatus;
  currentDepartmentSlug: string | null;
  costEstimateUsd: number | null;
  tokensEstimate: number | null;
  costActualUsd: number;
  tokensActual: number;
  stepsTaken: number;
  finalOutputCorpusId: string | null;
  directorDecision: 'approved' | 'rejected' | 'published' | null;
  directorReason: string | null;
  decidedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CorpusKind =
  | 'retrieval' | 'dataset' | 'methodology' | 'execution' | 'assumption' | 'output' | 'submission';

export type CorpusReviewStatus =
  | 'unreviewed' | 'peer_cleared' | 'lead_cleared' | 'committee_cleared'
  | 'approved' | 'rejected' | 'superseded';

export interface InstCorpusRecord {
  id: string;
  kind: CorpusKind;
  title: string;
  dataClass: DataClass;
  content: string;
  contentHash: string;
  url: string | null;
  httpStatus: number | null;
  fetchedAt: string | null;
  query: string | null;
  provenance: Record<string, unknown>;
  derivedFrom: string[];
  briefId: string | null;
  assignmentId: string | null;
  createdByAgentId: string | null;
  createdByRunId: string | null;
  reviewStatus: CorpusReviewStatus;
  createdAt: string;
}

export interface InstAssignment {
  id: string;
  briefId: string;
  departmentId: string | null;
  agentId: string | null;
  agentSlug: string;
  kind: AssignmentKind;
  status: AssignmentStatus;
  parentAssignmentId: string | null;
  input: string;
  output: string;
  outputCorpusId: string | null;
  runId: string | null;
  reworkCount: number;
  round: number;
  refusalReason: string | null;
  detail: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstReviewFinding {
  claim: string;
  finding: string;
  severity: 'blocking' | 'material' | 'minor';
  suggestedFix?: string;
}

export interface InstReview {
  id: string;
  briefId: string;
  kind: 'peer' | 'lead' | 'committee';
  reviewerAgentId: string;
  subjectAssignmentId: string | null;
  subjectSubmissionId: string | null;
  subjectAgentId: string | null;
  findings: InstReviewFinding[];
  verdict: 'accept' | 'rework' | 'reject' | 'escalate';
  summary: string;
  round: number;
  runId: string | null;
  createdAt: string;
}

export interface InstSubmission {
  id: string;
  briefId: string;
  fromDepartmentId: string;
  toDepartmentId: string | null;
  toCommittee: boolean;
  produced: string;
  restsOn: string[];
  uncertainties: string;
  exclusions: string;
  returnCount: number;
  accepted: boolean;
  createdAt: string;
}

export interface InstDebate {
  id: string;
  briefId: string;
  reviewId: string;
  rebuttingAgentId: string;
  rebuttal: string;
  weighing: string | null;
  outcome: 'accepted' | 'rejected' | 'partially_accepted' | null;
  round: number;
  createdAt: string;
}

export interface InstEvaluation {
  id: string;
  slug: string;
  departmentSlug: string | null;
  task: string;
  expectedAnswer: string;
  weight: number;
  isActive: boolean;
}

export interface InstEvaluationRun {
  id: string;
  evaluationId: string;
  agentId: string;
  agentVersionId: string | null;
  phase: 'before' | 'after' | 'baseline';
  answer: string;
  score: number | null;
  runId: string | null;
  createdAt: string;
}

export interface InstEgressBlock {
  id: string;
  briefId: string | null;
  assignmentId: string | null;
  agentId: string | null;
  runId: string | null;
  tool: string;
  matchedExcerpt: string;
  queryHash: string;
  createdAt: string;
}

export interface InstEvent {
  id: number;
  briefId: string | null;
  kind: string;
  agentSlug: string | null;
  departmentSlug: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
