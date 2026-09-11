// =============================================================================
// 1-A — THE UNIVERSAL DEPARTMENT CONTRACT
// =============================================================================
//
// Implemented ONCE. Every department in 1-C is this state machine with a
// different config row; there is no per-department code anywhere, and
// src/logic/institution/department.test.ts instantiates two departments from
// config alone to prove it.
//
// The contract, in the order work moves:
//
//   intake       the lead accepts the assignment or returns it
//                unanswerable-as-written with a reason. A department that
//                cannot refuse bad input is a conveyor belt, not a function.
//   delegation   the lead splits the work among specialists by capability,
//                respecting data_class. A capability with no agent is a
//                gap the lead fills by AUTHORING one — always public (B-3).
//   work         specialists produce, with provenance (B-8, enforced by the
//                tool layer's synthesize gate and by the database).
//   peer review  a sibling who did not produce it, never the author.
//   lead review  accept, or return for rework — bounded (B-5).
//   submission   a record: what was produced, what it rests on, what the
//                lead is uncertain about, and what it explicitly did not do.
//
// PURE. No Deno, no fetch, no clock, no database. It decides; the caller
// performs. That is what makes every rule here testable by attempt rather
// than by reading.

import type { DataClass } from './types.ts';

// ---------------------------------------------------------------------------
// config — rows of os_inst_departments + os_inst_department_members
// ---------------------------------------------------------------------------

export interface SeatConfig {
  agentSlug: string;
  role: 'lead' | 'specialist';
  seatPurpose: string;
  position: number;
  /** Null when the seat is a name plate on an empty desk (lead or phantom, not yet authored). */
  agentId: string | null;
  dataClass: DataClass | null;
  /** Lower-cased words from the agent's description and seat purpose; the routing key. */
  capabilities: readonly string[];
}

export interface DepartmentConfig {
  id: string;
  slug: string;
  name: string;
  kind: 'program_office' | 'department' | 'committee';
  pipelineOrder: number;
  leadAgentSlug: string;
  purpose: string;
  accountableFor: string;
  seats: readonly SeatConfig[];
}

export const leadSeat = (config: DepartmentConfig): SeatConfig | null =>
  config.seats.find((seat) => seat.role === 'lead') ?? null;

export const specialists = (config: DepartmentConfig): SeatConfig[] =>
  config.seats.filter((seat) => seat.role === 'specialist').sort((a, b) => a.position - b.position);

/** A seat with no agent row: an empty desk with a name plate, per 3-C. */
export const isPhantom = (seat: SeatConfig): boolean => seat.agentId === null;

export const staffedSpecialists = (config: DepartmentConfig): SeatConfig[] =>
  specialists(config).filter((seat) => !isPhantom(seat));

// ---------------------------------------------------------------------------
// intake — accept, or return it unanswerable-as-written
// ---------------------------------------------------------------------------

export interface IntakeRequest {
  briefQuestion: string;
  /** The program office's restatement; empty when it never wrote one. */
  restated: string;
  /** What would count as an answer. A department cannot aim at an unstated target. */
  answerWouldBe: string;
  dataClass: DataClass;
  /** What the upstream department produced, if this is not the first stop. */
  upstreamSummary: string | null;
  requiredCapabilities: readonly string[];
}

export type IntakeDecision =
  | { accepted: true; assignTo: readonly string[]; authorNeeded: readonly string[] }
  | { accepted: false; reason: string; code: IntakeRefusalCode };

export type IntakeRefusalCode =
  | 'no-question'
  | 'no-answer-shape'
  | 'no-lead'
  | 'lane'
  | 'no-capability'
  | 'no-upstream';

const MIN_QUESTION = 12;

export function intake(config: DepartmentConfig, request: IntakeRequest): IntakeDecision {
  const lead = leadSeat(config);
  if (!lead) {
    return { accepted: false, code: 'no-lead', reason: `${config.name} has no lead seat; the program office must staff one before work is routed here.` };
  }
  if (lead.agentId === null) {
    return { accepted: false, code: 'no-lead', reason: `${config.name}'s lead seat (${lead.agentSlug}) is an empty desk. The program office authors the lead before this department accepts work.` };
  }
  const question = (request.restated || request.briefQuestion).trim();
  if (question.length < MIN_QUESTION) {
    return { accepted: false, code: 'no-question', reason: `The assignment carries no question this department can work: "${question}". Return it to the program office for a restatement.` };
  }
  if (request.answerWouldBe.trim().length < MIN_QUESTION) {
    return { accepted: false, code: 'no-answer-shape', reason: 'The assignment does not say what would count as an answer, so nothing here can tell finished from unfinished. Returned unanswerable-as-written.' };
  }
  if (config.pipelineOrder > 1 && request.upstreamSummary !== null && request.upstreamSummary.trim().length === 0) {
    return { accepted: false, code: 'no-upstream', reason: `${config.name} was handed an empty submission from upstream. Work cannot continue on nothing; returned.` };
  }
  // Lane: an internal brief needs an internal lead. Per B-3 an agent the
  // institution authored is public, so this refusal is the visible
  // consequence of that rule, not an accident.
  if (request.dataClass === 'internal' && lead.dataClass !== 'internal') {
    return {
      accepted: false,
      code: 'lane',
      reason: `${config.name}'s lead (${lead.agentSlug}) is a public-lane agent and this brief is internal. Internal SAMB data is processed by Anthropic-backed internal agents only; promoting an agent to the internal lane is the director's action (B-3).`,
    };
  }

  const { assignTo, missing } = matchCapabilities(config, request.requiredCapabilities, request.dataClass);
  if (assignTo.length === 0 && missing.length === 0) {
    return { accepted: false, code: 'no-capability', reason: `${config.name} has no specialist seat able to take this assignment.` };
  }
  return { accepted: true, assignTo, authorNeeded: missing };
}

// ---------------------------------------------------------------------------
// delegation — by capability, respecting the lane
// ---------------------------------------------------------------------------

export interface CapabilityMatch {
  assignTo: string[];
  missing: string[];
}

const words = (text: string): string[] =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((word) => word.length > 2);

/** A seat serves a capability when the capability's words overlap its own. */
export function seatServes(seat: SeatConfig, capability: string): boolean {
  const wanted = words(capability);
  if (wanted.length === 0) return false;
  if (seat.agentSlug === capability) return true;
  const have = new Set(seat.capabilities.flatMap(words));
  return wanted.every((word) => have.has(word)) || wanted.some((word) => word.length > 4 && have.has(word));
}

export function matchCapabilities(
  config: DepartmentConfig,
  required: readonly string[],
  dataClass: DataClass,
): CapabilityMatch {
  const assignTo: string[] = [];
  const missing: string[] = [];
  const eligible = staffedSpecialists(config).filter(
    (seat) => dataClass === 'public' || seat.dataClass === 'internal',
  );
  if (required.length === 0) {
    // No named capability: the whole staffed bench works it, which is what
    // "the department takes this" means for a small brief.
    return { assignTo: eligible.map((seat) => seat.agentSlug), missing: [] };
  }
  for (const capability of required) {
    const seat = eligible.find((candidate) => seatServes(candidate, capability));
    if (seat) {
      if (!assignTo.includes(seat.agentSlug)) assignTo.push(seat.agentSlug);
    } else {
      missing.push(capability);
    }
  }
  return { assignTo, missing };
}

/**
 * What the lead must author for a capability it lacks. ALWAYS public (B-3),
 * with a stated purpose and scope — a generated prompt does not reach SAMB
 * financial data on the strength of its generator's judgement.
 */
export interface AuthoringRequest {
  slug: string;
  departmentSlug: string;
  authoredByAgentSlug: string;
  purpose: string;
  dataClass: 'public';
}

export function authoringRequests(
  config: DepartmentConfig,
  missing: readonly string[],
  authoredBy: string,
): AuthoringRequest[] {
  return missing.map((capability) => ({
    slug: slugify(capability),
    departmentSlug: config.slug,
    authoredByAgentSlug: authoredBy,
    purpose: `${config.name} needs ${capability} and has no seat for it. Authored by ${authoredBy} to ${capability}, within ${config.name}'s accountability: ${config.accountableFor}`,
    dataClass: 'public' as const,
  }));
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// ---------------------------------------------------------------------------
// peer review — a sibling, never the author (1-A)
// ---------------------------------------------------------------------------

export interface PeerChoice {
  reviewer: string | null;
  reason: string;
}

/**
 * Pick the peer reviewer for one specialist's output. Never the author.
 * Deterministic (next staffed sibling by seat order, wrapping) so a
 * department reviews in a stable pattern rather than a random one, and
 * `already` lets round 2 fall to a different sibling than round 1.
 */
export function peerReviewerFor(
  config: DepartmentConfig,
  authorSlug: string,
  already: readonly string[] = [],
): PeerChoice {
  const bench = staffedSpecialists(config).map((seat) => seat.agentSlug);
  const siblings = bench.filter((slug) => slug !== authorSlug);
  if (siblings.length === 0) {
    const lead = leadSeat(config);
    if (lead && lead.agentId !== null && lead.agentSlug !== authorSlug) {
      return { reviewer: lead.agentSlug, reason: `${config.name} has no second staffed specialist, so its lead reviews in place of a peer. Recorded as a peer review by the lead, not skipped.` };
    }
    return { reviewer: null, reason: `${config.name} cannot peer-review this work: the author is its only staffed member. The program office must staff a second seat or route the work elsewhere.` };
  }
  const fresh = siblings.filter((slug) => !already.includes(slug));
  const pool = fresh.length > 0 ? fresh : siblings;
  const authorIndex = bench.indexOf(authorSlug);
  const ordered = authorIndex === -1
    ? pool
    : [...pool].sort((a, b) => ((bench.indexOf(a) - authorIndex + bench.length) % bench.length)
      - ((bench.indexOf(b) - authorIndex + bench.length) % bench.length));
  return { reviewer: ordered[0], reason: 'the next staffed sibling in seat order' };
}

// ---------------------------------------------------------------------------
// review outcomes and the B-5 bounds
// ---------------------------------------------------------------------------

export const MAX_PEER_ROUNDS = 2;
export const MAX_REWORKS = 2;
export const MAX_RETURNS = 2;
export const MAX_DEBATE_ROUNDS = 2;

export type Verdict = 'accept' | 'rework' | 'reject' | 'escalate';

export interface AssignmentState {
  agentSlug: string;
  status: 'assigned' | 'working' | 'peer_review' | 'rework' | 'accepted' | 'returned' | 'refused' | 'submitted' | 'done' | 'failed' | 'escalated';
  reworkCount: number;
  round: number;
}

export interface ReviewOutcome {
  next: AssignmentState;
  escalated: boolean;
  note: string;
}

/** What a peer review does to the assignment. Bounded per B-5: 2 rounds, then the lead decides. */
export function applyPeerReview(state: AssignmentState, verdict: Verdict): ReviewOutcome {
  if (verdict === 'accept') {
    return { next: { ...state, status: 'peer_review' }, escalated: false, note: 'peer cleared; the lead reviews next' };
  }
  if (state.round >= MAX_PEER_ROUNDS) {
    return {
      next: { ...state, status: 'peer_review' },
      escalated: true,
      note: `peer review reached its ${MAX_PEER_ROUNDS}-round limit without agreement; the lead decides (B-5)`,
    };
  }
  return { next: { ...state, status: 'rework', round: state.round + 1 }, escalated: false, note: `peer asked for rework, round ${state.round + 1}` };
}

/** What a lead review does. Bounded per B-5: 2 reworks, then the lead escalates to the program office. */
export function applyLeadReview(state: AssignmentState, verdict: Verdict): ReviewOutcome {
  if (verdict === 'accept') return { next: { ...state, status: 'accepted' }, escalated: false, note: 'lead accepted' };
  if (verdict === 'reject') return { next: { ...state, status: 'failed' }, escalated: true, note: 'lead rejected the work outright; the program office is told' };
  if (verdict === 'escalate') return { next: { ...state, status: 'escalated' }, escalated: true, note: 'lead escalated without deciding' };
  if (state.reworkCount >= MAX_REWORKS) {
    return {
      next: { ...state, status: 'escalated' },
      escalated: true,
      note: `the lead has returned this work ${MAX_REWORKS} times; it does not loop again — the program office arbitrates (B-5)`,
    };
  }
  return { next: { ...state, status: 'rework', reworkCount: state.reworkCount + 1 }, escalated: false, note: `returned for rework ${state.reworkCount + 1} of ${MAX_REWORKS}` };
}

/** A downstream department returning work upstream. 2 returns per submission, then the program office arbitrates. */
export function applyUpstreamReturn(returnCount: number): { accepted: boolean; nextCount: number; note: string } {
  if (returnCount >= MAX_RETURNS) {
    return { accepted: false, nextCount: returnCount, note: `this submission has already gone back ${MAX_RETURNS} times; the program office arbitrates rather than a third return (B-5)` };
  }
  return { accepted: true, nextCount: returnCount + 1, note: `returned upstream, ${returnCount + 1} of ${MAX_RETURNS}` };
}

// ---------------------------------------------------------------------------
// submission — a record, not a message
// ---------------------------------------------------------------------------

export interface SubmissionInput {
  produced: string;
  restsOn: readonly string[];
  uncertainties: string;
  exclusions: string;
}

export interface SubmissionProblem {
  field: keyof SubmissionInput;
  message: string;
}

/**
 * A submission that does not say what it rests on, what the lead is unsure
 * of and what it did not do is a message. The department contract asks for
 * a record, so the missing parts are named rather than defaulted.
 */
export function checkSubmission(input: SubmissionInput): SubmissionProblem[] {
  const problems: SubmissionProblem[] = [];
  if (input.produced.trim().length < 20) problems.push({ field: 'produced', message: 'a submission states what was produced' });
  if (input.restsOn.length === 0) problems.push({ field: 'restsOn', message: 'a submission names the corpus records it rests on — B-8 is a required field, not a feature' });
  if (input.uncertainties.trim().length < 10) {
    problems.push({ field: 'uncertainties', message: 'a submission states what the lead is uncertain about; "none" is an answer, an empty field is not' });
  }
  if (input.exclusions.trim().length < 10) {
    problems.push({ field: 'exclusions', message: 'a submission states what it explicitly did not do, so the next department does not assume it was done' });
  }
  return problems;
}

/** Who the department submits to: the next department in the routing, or the committee. */
export function nextStop(routing: readonly string[], current: string): { to: string | null; toCommittee: boolean } {
  const index = routing.indexOf(current);
  if (index === -1) return { to: null, toCommittee: false };
  const next = routing[index + 1];
  return next ? { to: next, toCommittee: false } : { to: null, toCommittee: true };
}
