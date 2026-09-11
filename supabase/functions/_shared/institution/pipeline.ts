// =============================================================================
// THE PIPELINE — what the institution does next, decided from rows alone
// =============================================================================
//
// One pure function: given a brief, its assignments, reviews, submissions
// and debates as they stand in the database, return the NEXT ACTION. The
// runner performs that action, writes the rows it produces, and calls this
// again. Nothing here fetches, spends or waits.
//
// Why a decider rather than a loop: every state the institution can be in is
// then a value a test can construct, so "a third disagreement escalates
// rather than looping" is an assertion about a function, not a hope about a
// long-running process. It is also what lets a run survive the director
// closing the tab — the rows are the state, so the next step is recomputed,
// never remembered.
//
// The order of the checks below IS the institution's order of precedence:
// an escalation outranks work in flight; Verification is never skipped; the
// committee comes after every department; the director decides last.

import {
  applyPeerReview,
  leadSeat,
  MAX_DEBATE_ROUNDS,
  MAX_REWORKS,
  nextStop,
  peerReviewerFor,
  staffedSpecialists,
  type DepartmentConfig,
} from './department.ts';
import { SHAPES, type WeightClass } from './weight.ts';
import type { DataClass } from './types.ts';

export type AssignmentKind =
  | 'program_intake'
  | 'lead_intake'
  | 'specialist_work'
  | 'peer_review'
  | 'lead_review'
  | 'lead_submit'
  | 'agent_authoring'
  | 'committee_review'
  | 'debate'
  | 'arbitration'
  | 'evaluation';

export type AssignmentStatus =
  | 'assigned' | 'working' | 'peer_review' | 'rework' | 'accepted' | 'returned'
  | 'refused' | 'submitted' | 'done' | 'failed' | 'escalated';

export interface BriefRow {
  id: string;
  question: string;
  brief: { restated?: string; answerWouldBe?: string; outOfScope?: string; assumptions?: string[] };
  weightClass: WeightClass;
  dataClass: DataClass;
  routing: string[];
  status: 'intake' | 'running' | 'committee' | 'debate' | 'director' | 'approved' | 'rejected' | 'published' | 'failed' | 'paused';
  currentDepartmentSlug: string | null;
  stepsTaken: number;
  costEstimateUsd: number | null;
  costActualUsd: number;
}

export interface AssignmentRow {
  id: string;
  briefId: string;
  departmentId: string | null;
  departmentSlug: string | null;
  agentSlug: string;
  kind: AssignmentKind;
  status: AssignmentStatus;
  parentAssignmentId: string | null;
  outputCorpusId: string | null;
  output: string;
  reworkCount: number;
  round: number;
  refusalReason: string | null;
}

export interface ReviewRow {
  id: string;
  briefId: string;
  kind: 'peer' | 'lead' | 'committee';
  reviewerAgentSlug: string;
  subjectAssignmentId: string | null;
  verdict: 'accept' | 'rework' | 'reject' | 'escalate';
  round: number;
}

export interface SubmissionRow {
  id: string;
  briefId: string;
  fromDepartmentSlug: string;
  toDepartmentSlug: string | null;
  toCommittee: boolean;
  returnCount: number;
  accepted: boolean;
}

export interface DebateRow {
  id: string;
  briefId: string;
  reviewId: string;
  rebuttingAgentSlug: string;
  round: number;
  outcome: string | null;
}

export interface PipelineState {
  brief: BriefRow;
  departments: readonly DepartmentConfig[];
  assignments: readonly AssignmentRow[];
  reviews: readonly ReviewRow[];
  submissions: readonly SubmissionRow[];
  debates: readonly DebateRow[];
  /** The hard step ceiling. A run that hits it stops and tells the director. */
  maxSteps: number;
}

export type Action =
  | { kind: 'program_intake'; agentSlug: string; why: string }
  | { kind: 'lead_intake'; departmentSlug: string; agentSlug: string; why: string }
  | { kind: 'specialist_work'; departmentSlug: string; agentSlug: string; parentAssignmentId: string | null; why: string }
  | { kind: 'agent_authoring'; departmentSlug: string; authorSlug: string; capability: string; why: string }
  | { kind: 'peer_review'; departmentSlug: string; reviewerSlug: string; subjectAssignmentId: string; round: number; why: string }
  | { kind: 'lead_review'; departmentSlug: string; agentSlug: string; subjectAssignmentId: string; why: string }
  | { kind: 'lead_submit'; departmentSlug: string; agentSlug: string; toDepartmentSlug: string | null; toCommittee: boolean; why: string }
  | { kind: 'committee_review'; agentSlug: string; why: string }
  | { kind: 'debate'; agentSlug: string; reviewId: string; round: number; why: string }
  | { kind: 'committee_reweigh'; agentSlug: string; round: number; why: string }
  | { kind: 'arbitration'; agentSlug: string; about: string; why: string }
  | { kind: 'to_director'; why: string }
  | { kind: 'blocked'; why: string }
  | { kind: 'done'; why: string };

const PROGRAM_OFFICE = 'program-office';
const COMMITTEE = 'committee';

const byId = (state: PipelineState, id: string) => state.assignments.find((a) => a.id === id) ?? null;
const departmentBySlug = (state: PipelineState, slug: string) =>
  state.departments.find((department) => department.slug === slug) ?? null;

const programOfficeLead = (state: PipelineState): string | null =>
  departmentBySlug(state, PROGRAM_OFFICE)?.leadAgentSlug ?? null;

const committeeSlug = (state: PipelineState): string | null =>
  departmentBySlug(state, COMMITTEE)?.leadAgentSlug ?? null;

/** The next thing the institution should do, or why it cannot. */
export function nextAction(state: PipelineState): Action {
  const { brief } = state;

  if (brief.status === 'paused') return { kind: 'blocked', why: 'the brief is paused' };
  if (['approved', 'rejected', 'published'].includes(brief.status)) {
    return { kind: 'done', why: `the director has ${brief.status} this brief` };
  }
  if (brief.status === 'failed') return { kind: 'blocked', why: 'the brief failed; the director decides whether to restart it' };
  if (brief.stepsTaken >= state.maxSteps) {
    return { kind: 'blocked', why: `this run has taken ${brief.stepsTaken} steps, its ceiling. Stopping and telling the director beats spending further on a loop nobody is watching.` };
  }

  // 1. Intake. Nothing routes until the program office has written the brief.
  const intake = state.assignments.find((assignment) => assignment.kind === 'program_intake');
  if (!intake || intake.status !== 'done') {
    const lead = programOfficeLead(state);
    if (!lead) return { kind: 'blocked', why: 'there is no program office lead; the institution cannot take in work' };
    return { kind: 'program_intake', agentSlug: lead, why: 'the request is not yet a written brief with a weight class and an estimate' };
  }
  if (brief.routing.length === 0) {
    return { kind: 'blocked', why: 'the brief has no routing; the program office must decide which departments it needs' };
  }

  // 2. An escalation outranks everything still in flight.
  const escalated = state.assignments.find((assignment) => assignment.status === 'escalated');
  if (escalated) {
    const arbiter = programOfficeLead(state);
    if (!arbiter) return { kind: 'blocked', why: 'work has escalated and there is no program office to arbitrate' };
    const alreadyArbitrated = state.assignments.some(
      (assignment) => assignment.kind === 'arbitration' && assignment.parentAssignmentId === escalated.id && assignment.status === 'done',
    );
    if (!alreadyArbitrated) {
      return {
        kind: 'arbitration',
        agentSlug: arbiter,
        about: escalated.id,
        why: `${escalated.agentSlug}'s work hit a B-5 limit and does not loop again; the program office decides`,
      };
    }
  }

  // 3. Walk the routing in order. The first department with unfinished
  //    business is where the institution is.
  for (const departmentSlug of brief.routing) {
    const config = departmentBySlug(state, departmentSlug);
    if (!config) return { kind: 'blocked', why: `the brief routes through ${departmentSlug}, which is not a department` };
    const action = departmentAction(state, config);
    if (action) return action;
  }

  // 4. Every department has submitted. The committee reviews, unless the
  //    class says otherwise (B-10: brief has no committee).
  const shape = SHAPES[brief.weightClass];
  const committee = committeeSlug(state);
  if (shape.committeeReview && committee) {
    const committeeReview = state.reviews.find((review) => review.kind === 'committee');
    if (!committeeReview) {
      return { kind: 'committee_review', agentSlug: committee, why: 'every department has submitted; the editorial board reviews before the director sees it' };
    }
    // 5. Debate, bounded (B-5): the reviewed party may contest, the
    //    committee weighs, and a third disagreement escalates.
    if (shape.debate) {
      const open = state.debates.filter((debate) => debate.outcome === null);
      if (open.length > 0) {
        const round = Math.max(...open.map((debate) => debate.round));
        return { kind: 'committee_reweigh', agentSlug: committee, round, why: `${open.length} rebuttal(s) filed in round ${round} and not yet weighed` };
      }
      const weighed = state.debates.filter((debate) => debate.outcome !== null);
      const rounds = weighed.length === 0 ? 0 : Math.max(...weighed.map((debate) => debate.round));
      const unresolved = weighed.some((debate) => debate.outcome === 'rejected');
      if (unresolved && rounds >= MAX_DEBATE_ROUNDS) {
        return { kind: 'to_director', why: `the debate reached its ${MAX_DEBATE_ROUNDS}-round limit with the disagreement standing; both positions go to the director (B-5)` };
      }
    }
  }

  return { kind: 'to_director', why: 'the work is complete, reviewed, and waiting on the only decision the institution does not make' };
}

/** Unfinished business inside one department, in contract order (1-A). */
function departmentAction(state: PipelineState, config: DepartmentConfig): Action | null {
  const mine = state.assignments.filter((assignment) => assignment.departmentSlug === config.slug);
  const lead = leadSeat(config);
  const shape = SHAPES[state.brief.weightClass];

  // Already submitted onward: nothing left here.
  const submitted = state.submissions.find((submission) => submission.fromDepartmentSlug === config.slug && submission.accepted);
  if (submitted) return null;

  // a. the lead takes the assignment in, or returns it
  const leadIntake = mine.find((assignment) => assignment.kind === 'lead_intake');
  if (!leadIntake) {
    if (!lead || lead.agentId === null) {
      return { kind: 'blocked', why: `${config.name}'s lead seat is an empty desk; the program office authors the lead before work is routed here` };
    }
    return { kind: 'lead_intake', departmentSlug: config.slug, agentSlug: lead.agentSlug, why: `${config.name} has not accepted or returned this assignment` };
  }
  if (leadIntake.status === 'refused') {
    return { kind: 'blocked', why: `${config.name} returned the assignment unanswerable-as-written: ${leadIntake.refusalReason ?? 'no reason recorded'}` };
  }
  if (leadIntake.status !== 'done') {
    return { kind: 'lead_intake', departmentSlug: config.slug, agentSlug: leadIntake.agentSlug, why: 'the lead has not finished intake' };
  }

  // b. a capability the department lacks is authored before work starts
  const authoring = mine.filter((assignment) => assignment.kind === 'agent_authoring');
  const pending = authoring.find((assignment) => assignment.status !== 'done' && assignment.status !== 'failed');
  if (pending) {
    return {
      kind: 'agent_authoring',
      departmentSlug: config.slug,
      authorSlug: lead?.agentSlug ?? config.leadAgentSlug,
      capability: pending.agentSlug,
      why: `${config.name} needs ${pending.agentSlug} and has no seat for it`,
    };
  }

  // c. specialist work
  const work = mine.filter((assignment) => assignment.kind === 'specialist_work');
  if (work.length === 0) {
    const bench = staffedSpecialists(config)
      .filter((seat) => state.brief.dataClass === 'public' || seat.dataClass === 'internal')
      .slice(0, shape.specialistsPerDepartment);
    if (bench.length === 0) {
      return { kind: 'blocked', why: `${config.name} has no staffed specialist able to work a ${state.brief.dataClass} brief` };
    }
    return {
      kind: 'specialist_work',
      departmentSlug: config.slug,
      agentSlug: bench[0].agentSlug,
      parentAssignmentId: leadIntake.id,
      why: `${config.name} accepted the assignment; ${bench[0].agentSlug} works it first`,
    };
  }
  const reworking = work.find((assignment) => assignment.status === 'rework');
  if (reworking) {
    return {
      kind: 'specialist_work',
      departmentSlug: config.slug,
      agentSlug: reworking.agentSlug,
      parentAssignmentId: reworking.id,
      why: `${reworking.agentSlug} has work to redo (rework ${reworking.reworkCount} of 2)`,
    };
  }
  const working = work.find((assignment) => assignment.status === 'assigned' || assignment.status === 'working');
  if (working) {
    return {
      kind: 'specialist_work',
      departmentSlug: config.slug,
      agentSlug: working.agentSlug,
      parentAssignmentId: working.parentAssignmentId,
      why: `${working.agentSlug} has not produced yet`,
    };
  }

  // d. peer review — a sibling, never the author (1-A)
  for (const output of work.filter((assignment) => assignment.status === 'peer_review' || assignment.status === 'accepted')) {
    if (output.status !== 'peer_review') continue;
    const peerReviews = state.reviews.filter((review) => review.kind === 'peer' && review.subjectAssignmentId === output.id);
    const latest = peerReviews[peerReviews.length - 1];
    if (!latest) {
      const choice = peerReviewerFor(config, output.agentSlug);
      if (!choice.reviewer) return { kind: 'blocked', why: choice.reason };
      return {
        kind: 'peer_review',
        departmentSlug: config.slug,
        reviewerSlug: choice.reviewer,
        subjectAssignmentId: output.id,
        round: 1,
        why: `${output.agentSlug}'s output has not been peer reviewed (${choice.reason})`,
      };
    }
    if (latest.verdict === 'rework') {
      const outcome = applyPeerReview({ agentSlug: output.agentSlug, status: output.status, reworkCount: output.reworkCount, round: latest.round }, 'rework');
      if (!outcome.escalated) {
        return {
          kind: 'specialist_work',
          departmentSlug: config.slug,
          agentSlug: output.agentSlug,
          parentAssignmentId: output.id,
          why: outcome.note,
        };
      }
      // Peer review has run out of rounds: the lead decides, per B-5.
    }
  }

  // e. lead review of what peer review cleared.
  //
  // A lead review is DUE when the work has been reworked since the last one:
  // one review per round of work, counted rather than looked up. Looking it
  // up by subject alone finds the first review forever, so a department
  // whose lead asked for rework once would ask for it again on every pass
  // and never reach its B-5 limit — the loop the limit exists to stop.
  const cleared = work.filter((assignment) => assignment.status === 'peer_review');
  for (const output of cleared) {
    const leadReviews = state.reviews.filter((review) => review.kind === 'lead' && review.subjectAssignmentId === output.id);
    if (leadReviews.length <= output.reworkCount) {
      if (!lead) return { kind: 'blocked', why: `${config.name} has no lead to review its work` };
      return {
        kind: 'lead_review',
        departmentSlug: config.slug,
        agentSlug: lead.agentSlug,
        subjectAssignmentId: output.id,
        why: leadReviews.length === 0
          ? `${output.agentSlug}'s output cleared peer review and awaits the lead`
          : `${output.agentSlug} reworked the output; the lead reviews it again (rework ${output.reworkCount} of ${MAX_REWORKS})`,
      };
    }
    // Safety net. The runner sets 'escalated' when a lead review hits the
    // B-5 limit; if that write is ever lost, this work would otherwise sit
    // in peer_review forever and the department would be silently skipped.
    // An unaccepted output whose reviews are all spent goes to arbitration.
    const lastLead = leadReviews[leadReviews.length - 1];
    if (lastLead && lastLead.verdict !== 'accept') {
      const arbiter = programOfficeLead(state);
      if (!arbiter) return { kind: 'blocked', why: `${output.agentSlug}'s work is unaccepted, its reviews are spent, and there is no program office to arbitrate` };
      return {
        kind: 'arbitration',
        agentSlug: arbiter,
        about: output.id,
        why: `${output.agentSlug}'s work has had ${leadReviews.length} lead review(s) and ${output.reworkCount} rework(s) without acceptance; it does not loop again (B-5)`,
      };
    }
  }

  // f. submission onward
  const accepted = work.filter((assignment) => assignment.status === 'accepted');
  if (accepted.length > 0 && accepted.length === work.filter((assignment) => assignment.status !== 'failed').length) {
    if (!lead) return { kind: 'blocked', why: `${config.name} has no lead to submit its work` };
    const stop = nextStop(state.brief.routing, config.slug);
    return {
      kind: 'lead_submit',
      departmentSlug: config.slug,
      agentSlug: lead.agentSlug,
      toDepartmentSlug: stop.to,
      toCommittee: stop.toCommittee,
      why: stop.to ? `${config.name} accepted its work and hands it to ${stop.to}` : `${config.name} is the last stop; the submission goes to the committee`,
    };
  }

  return null;
}

/** Every assignment this brief has produced, for the director's room and the floor. */
export function summarise(state: PipelineState): {
  departmentsVisited: string[];
  outputs: number;
  peerReviews: number;
  leadReviews: number;
  committeeReviews: number;
  debates: number;
  escalations: number;
  refusals: number;
} {
  return {
    departmentsVisited: [...new Set(state.assignments.map((assignment) => assignment.departmentSlug).filter((slug): slug is string => Boolean(slug)))],
    outputs: state.assignments.filter((assignment) => assignment.outputCorpusId !== null).length,
    peerReviews: state.reviews.filter((review) => review.kind === 'peer').length,
    leadReviews: state.reviews.filter((review) => review.kind === 'lead').length,
    committeeReviews: state.reviews.filter((review) => review.kind === 'committee').length,
    debates: state.debates.length,
    escalations: state.assignments.filter((assignment) => assignment.status === 'escalated').length,
    refusals: state.assignments.filter((assignment) => assignment.status === 'refused').length,
  };
}

export { byId };
