// B-10. The estimate is arithmetic the director can check, and Verification
// is in every class.

import { describe, expect, it } from 'vitest';
import {
  ALWAYS_ROUTED,
  checkOverrun,
  estimate,
  SHAPES,
  suggestClass,
  withMandatoryStops,
  type CallEstimate,
} from '../../../supabase/functions/_shared/institution/weight';
import {
  nextAction,
  type AssignmentRow,
  type BriefRow,
  type PipelineState,
  type ReviewRow,
  type SubmissionRow,
} from '../../../supabase/functions/_shared/institution/pipeline';
import type { DepartmentConfig } from '../../../supabase/functions/_shared/institution/department';

const measured: CallEstimate = { tokensPerCall: 4_000, measured: true, costPerMillionTokensUsd: 3 };
const fallback: CallEstimate = { tokensPerCall: 4_000, measured: false, costPerMillionTokensUsd: 3 };

// ---------------------------------------------------------------------------
// A clean run, walked
// ---------------------------------------------------------------------------

/**
 * Seven departments, every seat staffed, three specialists each — the shape
 * a `full` run sees when nothing has to be authored. Phantom seats are
 * deliberately absent: authoring is real work but it is not priced by
 * estimate() (the institution cannot know in advance which desks a brief
 * will find empty), so including one here would compare two different things.
 */
function cleanRunDepartments(): DepartmentConfig[] {
  const slugs = ['framing-office', 'methodology-desk', 'evidence-acquisition', 'quantitative-analysis', 'domain-synthesis', 'verification', 'editorial'];
  const departments: DepartmentConfig[] = [
    {
      id: 'po', slug: 'program-office', name: 'Program Office', kind: 'program_office', pipelineOrder: 0,
      leadAgentSlug: 'po-lead', purpose: 'runs the pipeline', accountableFor: 'routing and budget',
      seats: [{ agentSlug: 'po-lead', agentId: 'a-po', role: 'lead', position: 0, seatPurpose: 'lead', dataClass: 'public', capabilities: [] }],
    },
  ];
  slugs.forEach((slug, index) => {
    departments.push({
      id: slug, slug, name: slug, kind: 'department', pipelineOrder: index + 1,
      leadAgentSlug: `${slug}-lead`, purpose: 'owns something', accountableFor: 'something',
      seats: [
        { agentSlug: `${slug}-lead`, agentId: `a-${slug}-lead`, role: 'lead', position: 0, seatPurpose: 'lead', dataClass: 'public', capabilities: [] },
        ...[1, 2, 3].map((n) => ({
          agentSlug: `${slug}-s${n}`, agentId: `a-${slug}-s${n}`, role: 'specialist' as const,
          position: n, seatPurpose: `specialist ${n}`, dataClass: 'public' as const, capabilities: [],
        })),
      ],
    });
  });
  departments.push({
    id: 'cm', slug: 'committee', name: 'Editorial Committee', kind: 'committee', pipelineOrder: 99,
    leadAgentSlug: 'committee-agent', purpose: 'reviews', accountableFor: 'a verdict',
    seats: [{ agentSlug: 'committee-agent', agentId: 'a-cm', role: 'lead', position: 0, seatPurpose: 'board', dataClass: 'internal', capabilities: [] }],
  });
  return departments;
}

/**
 * Step nextAction() to completion, completing each action exactly as
 * runner.ts does — including the two transitions that are easy to get wrong
 * and that this walk exists to pin down: a lead intake writes one `assigned`
 * specialist row per chosen specialist (runner.ts), and a peer ACCEPT leaves
 * the work at `peer_review` for the lead rather than accepting it
 * (applyPeerReview).
 */
function walkCleanRun(departments: DepartmentConfig[], routing: string[]) {
  const brief: BriefRow = {
    id: 'b1', question: 'a decision-grade question', brief: {}, weightClass: 'full', dataClass: 'public',
    routing: withMandatoryStops(routing, 'full'), status: 'intake', currentDepartmentSlug: null,
    stepsTaken: 0, costEstimateUsd: 0, costActualUsd: 0,
  };
  const assignments: AssignmentRow[] = [];
  const reviews: ReviewRow[] = [];
  const submissions: SubmissionRow[] = [];
  const byKind: Record<string, number> = {};
  let n = 0;
  const id = (prefix: string) => `${prefix}-${(n += 1)}`;
  const state = (): PipelineState => ({ brief, departments, assignments, reviews, submissions, debates: [], maxSteps: 400 });

  for (let step = 0; step < 400; step += 1) {
    const action = nextAction(state());
    if (action.kind === 'to_director' || action.kind === 'done') break;
    if (action.kind === 'blocked') throw new Error(`the clean run blocked: ${action.why}`);
    byKind[action.kind] = (byKind[action.kind] ?? 0) + 1;

    if (action.kind === 'program_intake') {
      assignments.push(row(id('a'), brief.id, 'program-office', action.agentSlug, 'program_intake', 'done'));
      brief.status = 'running';
    } else if (action.kind === 'lead_intake') {
      const intake = row(id('a'), brief.id, action.departmentSlug, action.agentSlug, 'lead_intake', 'done');
      assignments.push(intake);
      const department = departments.find((candidate) => candidate.slug === action.departmentSlug)!;
      for (const seat of department.seats.filter((s) => s.role === 'specialist').slice(0, SHAPES.full.specialistsPerDepartment)) {
        const work = row(id('a'), brief.id, department.slug, seat.agentSlug, 'specialist_work', 'assigned');
        work.parentAssignmentId = intake.id;
        assignments.push(work);
      }
    } else if (action.kind === 'specialist_work') {
      const open = assignments.find(
        (a) => a.kind === 'specialist_work' && a.agentSlug === action.agentSlug &&
          a.departmentSlug === action.departmentSlug && (a.status === 'assigned' || a.status === 'working'),
      )!;
      open.status = 'peer_review';
      open.output = 'work';
    } else if (action.kind === 'peer_review') {
      reviews.push({
        id: id('r'), briefId: brief.id, kind: 'peer', reviewerAgentSlug: action.reviewerSlug,
        subjectAssignmentId: action.subjectAssignmentId, verdict: 'accept', round: action.round,
      });
    } else if (action.kind === 'lead_review') {
      reviews.push({
        id: id('r'), briefId: brief.id, kind: 'lead', reviewerAgentSlug: action.agentSlug,
        subjectAssignmentId: action.subjectAssignmentId, verdict: 'accept', round: 1,
      });
      assignments.find((a) => a.id === action.subjectAssignmentId)!.status = 'accepted';
    } else if (action.kind === 'lead_submit') {
      assignments.push(row(id('a'), brief.id, action.departmentSlug, action.agentSlug, 'lead_submit', 'submitted'));
      submissions.push({
        id: id('s'), briefId: brief.id, fromDepartmentSlug: action.departmentSlug,
        toDepartmentSlug: action.toDepartmentSlug, toCommittee: action.toCommittee, returnCount: 0, accepted: true,
      });
      if (action.toCommittee) brief.status = 'committee';
    } else if (action.kind === 'committee_review') {
      assignments.push(row(id('a'), brief.id, 'committee', action.agentSlug, 'committee_review', 'done'));
      reviews.push({ id: id('r'), briefId: brief.id, kind: 'committee', reviewerAgentSlug: action.agentSlug, subjectAssignmentId: null, verdict: 'accept', round: 1 });
    } else {
      throw new Error(`the clean run should not reach ${action.kind}: ${action.why}`);
    }
  }
  return { byKind, total: Object.values(byKind).reduce((a, b) => a + b, 0) };
}

function row(
  id: string, briefId: string, departmentSlug: string, agentSlug: string,
  kind: AssignmentRow['kind'], status: AssignmentRow['status'],
): AssignmentRow {
  return {
    id, briefId, departmentId: departmentSlug, departmentSlug, agentSlug, kind, status,
    parentAssignmentId: null, outputCorpusId: null, output: '', reworkCount: 0, round: 1, refusalReason: null,
  };
}

describe('class shapes', () => {
  it('gives brief no committee and full everything', () => {
    expect(SHAPES.brief.committeeReview).toBe(false);
    expect(SHAPES.standard.committeeReview).toBe(true);
    expect(SHAPES.standard.proposals).toBe(false);
    expect(SHAPES.full.debate && SHAPES.full.proposals && SHAPES.full.evals).toBe(true);
  });

  it('keeps peer review in every class, including brief', () => {
    for (const shape of Object.values(SHAPES)) expect(shape.peerReviewPerOutput).toBe(true);
  });
});

describe('routing', () => {
  it('puts Verification in every routing at every class', () => {
    for (const weightClass of ['brief', 'standard', 'full'] as const) {
      expect(withMandatoryStops(['framing-office'], weightClass)).toContain(ALWAYS_ROUTED);
    }
  });

  it('puts Verification last, after the work and before Editorial', () => {
    expect(withMandatoryStops(['framing-office', 'editorial', 'quantitative-analysis'], 'standard'))
      .toEqual(['framing-office', 'quantitative-analysis', 'verification', 'editorial']);
  });

  it('drops Editorial from a brief-class run but never Verification', () => {
    expect(withMandatoryStops(['framing-office', 'editorial'], 'brief')).toEqual(['framing-office', 'verification']);
  });

  it('does not duplicate Verification when the caller already asked for it', () => {
    const routing = withMandatoryStops(['verification', 'framing-office'], 'standard');
    expect(routing.filter((slug) => slug === ALWAYS_ROUTED)).toHaveLength(1);
  });
});

describe('estimate', () => {
  it('costs a brief-class run at a fraction of a full one', () => {
    const routing = ['framing-office', 'verification'];
    const small = estimate('brief', routing, measured);
    const large = estimate('full', ['framing-office', 'methodology-desk', 'evidence-acquisition', 'data-engineering', 'quantitative-analysis', 'domain-synthesis', 'verification', 'editorial'], measured);
    expect(small.calls).toBeLessThan(large.calls / 3);
    expect(small.costUsd).toBeLessThan(large.costUsd);
  });

  it('prices tokens at the provider rate, to the millionth of a dollar', () => {
    const result = estimate('brief', ['framing-office', 'verification'], measured);
    expect(result.tokens).toBe(result.calls * 4_000);
    expect(result.costUsd).toBeCloseTo((result.tokens / 1e6) * 3, 6);
  });

  it('caps the departments it counts at the class maximum', () => {
    const result = estimate('brief', ['a', 'b', 'c', 'd'], measured);
    expect(result.departments).toEqual(['a', 'b']);
  });

  it('carries whether the per-call figure was measured, so the UI can say so', () => {
    expect(estimate('standard', ['a'], measured).measured).toBe(true);
    expect(estimate('standard', ['a'], fallback).measured).toBe(false);
  });

  /**
   * THE TEST THAT WAS MISSING.
   *
   * An estimate is only worth writing down if it counts the same calls the
   * stepper will make. This walks nextAction() over a clean run — no
   * refusal, no rework, no debate — completing each action the way the
   * runner does, and compares the dispatched calls with what estimate()
   * priced. It caught two real errors: intake priced at two calls when the
   * stepper makes one, and lead review priced per department when the
   * machine reviews per output.
   *
   * The three conditional stages (debate, proposals, evaluations) are
   * priced but not dispatched on a clean run, so they are excluded here and
   * asserted separately: the estimate deliberately prices the class's
   * ceiling, and being over on those is the safe direction.
   */
  it('prices the same calls the stepper actually dispatches on a clean run', () => {
    const departments = cleanRunDepartments();
    const routing = departments.filter((d) => d.kind === 'department').map((d) => d.slug);
    const priced = estimate('full', routing, measured);
    const CONDITIONAL = new Set(['debate (2 rounds, both sides)', 'upgrade proposals', 'evaluations before and after']);
    const pricedUnconditional = priced.breakdown
      .filter((line) => !CONDITIONAL.has(line.stage))
      .reduce((total, line) => total + line.calls, 0);

    const dispatched = walkCleanRun(departments, routing);
    expect(dispatched.total).toBe(pricedUnconditional);

    // And per stage, so a drift says which line moved.
    const priceOf = (stage: string) => priced.breakdown.find((line) => line.stage === stage)?.calls ?? 0;
    expect(priceOf('program office intake and routing')).toBe(dispatched.byKind.program_intake ?? 0);
    expect(priceOf('lead intake')).toBe(dispatched.byKind.lead_intake ?? 0);
    expect(priceOf('specialist work')).toBe(dispatched.byKind.specialist_work ?? 0);
    expect(priceOf('peer review')).toBe(dispatched.byKind.peer_review ?? 0);
    expect(priceOf('lead review')).toBe(dispatched.byKind.lead_review ?? 0);
    expect(priceOf('submission onward')).toBe(dispatched.byKind.lead_submit ?? 0);
    expect(priceOf('committee review')).toBe(dispatched.byKind.committee_review ?? 0);
  });

  it('breaks the count into stages a reader can check', () => {
    const result = estimate('full', ['a', 'b'], measured);
    const stages = result.breakdown.map((line) => line.stage);
    expect(stages).toContain('peer review');
    expect(stages).toContain('committee review');
    expect(stages).toContain('evaluations before and after');
    expect(result.breakdown.reduce((total, line) => total + line.calls, 0)).toBe(result.calls);
  });
});

describe('suggestClass', () => {
  it('suggests brief for a lookup', () => {
    expect(suggestClass('What is the current PSAK number for consolidation?', 1).weightClass).toBe('brief');
  });

  it('suggests full for a decision-grade question', () => {
    expect(suggestClass('Build the market entry strategy for CNG in Priangan Timur', 3).weightClass).toBe('full');
  });

  it('suggests standard for an ordinary research question', () => {
    expect(suggestClass('How has Indonesian poultry processing capacity changed since 2019?', 3).weightClass).toBe('standard');
  });

  it('gives a reason with every suggestion', () => {
    for (const question of ['What is X?', 'Build the business plan', 'How has Y changed?']) {
      expect(suggestClass(question, 2).reason.length).toBeGreaterThan(20);
    }
  });
});

describe('checkOverrun', () => {
  it('does not cry overrun at a slightly wrong estimate', () => {
    expect(checkOverrun(1, 1.4).overrun).toBe(false);
  });

  it('surfaces a real overrun with the ratio', () => {
    const verdict = checkOverrun(1, 2.2);
    expect(verdict.overrun).toBe(true);
    expect(verdict.message).toContain('2.20x');
  });

  it('says plainly when nothing was estimated', () => {
    expect(checkOverrun(0, 5).message).toContain('no estimate');
  });
});
