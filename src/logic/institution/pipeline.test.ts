// The pipeline decider. Every state the institution can be in is a value
// here, so the rules that matter — Verification is never skipped, a third
// disagreement escalates rather than looping, an empty desk blocks rather
// than being worked around — are assertions, not hopes.

import { describe, expect, it } from 'vitest';
import {
  nextAction,
  summarise,
  type AssignmentRow,
  type BriefRow,
  type DebateRow,
  type PipelineState,
  type ReviewRow,
  type SubmissionRow,
} from '../../../supabase/functions/_shared/institution/pipeline';
import type { DepartmentConfig, SeatConfig } from '../../../supabase/functions/_shared/institution/department';

const seat = (agentSlug: string, role: 'lead' | 'specialist', position: number, over: Partial<SeatConfig> = {}): SeatConfig => ({
  agentSlug,
  role,
  position,
  seatPurpose: '',
  agentId: `id-${agentSlug}`,
  dataClass: 'public',
  capabilities: [agentSlug.replace(/-/g, ' ')],
  ...over,
});

const department = (slug: string, order: number, lead: string, specialists: string[], over: Partial<DepartmentConfig> = {}): DepartmentConfig => ({
  id: `d-${slug}`,
  slug,
  name: slug,
  kind: 'department',
  pipelineOrder: order,
  leadAgentSlug: lead,
  purpose: '',
  accountableFor: '',
  seats: [seat(lead, 'lead', 0), ...specialists.map((s, i) => seat(s, 'specialist', i + 1))],
  ...over,
});

const DEPARTMENTS: DepartmentConfig[] = [
  { ...department('program-office', 0, 'evidence-coordinator', []), kind: 'program_office' },
  department('framing-office', 1, 'framing-lead', ['scope-analyst', 'assumption-auditor']),
  department('verification', 7, 'verification-lead', ['numeric-auditor', 'provenance-checker']),
  { ...department('committee', 9, 'editorial-committee', []), kind: 'committee' },
];

const brief = (over: Partial<BriefRow> = {}): BriefRow => ({
  id: 'b1',
  question: 'How has Indonesian poultry processing capacity changed since 2019?',
  brief: { restated: 'How has capacity changed since 2019?', answerWouldBe: 'a capacity series with its source' },
  weightClass: 'standard',
  dataClass: 'public',
  routing: ['framing-office', 'verification'],
  status: 'running',
  currentDepartmentSlug: null,
  stepsTaken: 3,
  costEstimateUsd: 0.5,
  costActualUsd: 0.1,
  ...over,
});

const assignment = (over: Partial<AssignmentRow> & Pick<AssignmentRow, 'id' | 'agentSlug' | 'kind' | 'status'>): AssignmentRow => ({
  briefId: 'b1',
  departmentId: null,
  departmentSlug: null,
  parentAssignmentId: null,
  outputCorpusId: null,
  output: '',
  reworkCount: 0,
  round: 1,
  refusalReason: null,
  ...over,
});

const state = (over: Partial<PipelineState> = {}): PipelineState => ({
  brief: brief(),
  departments: DEPARTMENTS,
  assignments: [],
  reviews: [],
  submissions: [],
  debates: [],
  maxSteps: 200,
  ...over,
});

const DONE_INTAKE = assignment({ id: 'a-intake', agentSlug: 'evidence-coordinator', kind: 'program_intake', status: 'done', departmentSlug: 'program-office' });

describe('intake comes first', () => {
  it('asks the program office to write the brief before anything routes', () => {
    const action = nextAction(state({ assignments: [] }));
    expect(action.kind).toBe('program_intake');
    if (action.kind === 'program_intake') expect(action.agentSlug).toBe('evidence-coordinator');
  });

  it('blocks rather than routing a brief with no routing', () => {
    const action = nextAction(state({ assignments: [DONE_INTAKE], brief: brief({ routing: [] }) }));
    expect(action.kind).toBe('blocked');
  });

  it('stops at the step ceiling instead of spending on a loop nobody is watching', () => {
    const action = nextAction(state({ brief: brief({ stepsTaken: 200 }), maxSteps: 200 }));
    expect(action.kind).toBe('blocked');
    if (action.kind === 'blocked') expect(action.why).toContain('ceiling');
  });
});

describe('a department works in contract order', () => {
  const withIntake = (extra: AssignmentRow[] = [], over: Partial<PipelineState> = {}) =>
    state({ assignments: [DONE_INTAKE, ...extra], ...over });

  it('asks the lead to take the assignment in first', () => {
    const action = nextAction(withIntake());
    expect(action).toMatchObject({ kind: 'lead_intake', departmentSlug: 'framing-office', agentSlug: 'framing-lead' });
  });

  it('stops when the lead returned the assignment, and repeats the reason', () => {
    const action = nextAction(withIntake([
      assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'refused', departmentSlug: 'framing-office', refusalReason: 'the question has no answerable shape' }),
    ]));
    expect(action.kind).toBe('blocked');
    if (action.kind === 'blocked') expect(action.why).toContain('no answerable shape');
  });

  it('sends work to a specialist once the lead has accepted', () => {
    const action = nextAction(withIntake([
      assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'done', departmentSlug: 'framing-office' }),
    ]));
    expect(action).toMatchObject({ kind: 'specialist_work', agentSlug: 'scope-analyst' });
  });

  it('authors a missing capability before any work starts', () => {
    const action = nextAction(withIntake([
      assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'done', departmentSlug: 'framing-office' }),
      assignment({ id: 'a2', agentSlug: 'discourse-analyst', kind: 'agent_authoring', status: 'assigned', departmentSlug: 'framing-office' }),
    ]));
    expect(action).toMatchObject({ kind: 'agent_authoring', capability: 'discourse-analyst', authorSlug: 'framing-lead' });
  });

  it('peer reviews an output with a sibling who did not write it', () => {
    const action = nextAction(withIntake([
      assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'done', departmentSlug: 'framing-office' }),
      assignment({ id: 'a2', agentSlug: 'scope-analyst', kind: 'specialist_work', status: 'peer_review', departmentSlug: 'framing-office', outputCorpusId: 'c1' }),
    ]));
    expect(action).toMatchObject({ kind: 'peer_review', reviewerSlug: 'assumption-auditor', subjectAssignmentId: 'a2' });
    if (action.kind === 'peer_review') expect(action.reviewerSlug).not.toBe('scope-analyst');
  });

  it('sends work back to its author when the peer asks for rework', () => {
    const action = nextAction(withIntake(
      [
        assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'done', departmentSlug: 'framing-office' }),
        assignment({ id: 'a2', agentSlug: 'scope-analyst', kind: 'specialist_work', status: 'peer_review', departmentSlug: 'framing-office', outputCorpusId: 'c1' }),
      ],
      { reviews: [{ id: 'r1', briefId: 'b1', kind: 'peer', reviewerAgentSlug: 'assumption-auditor', subjectAssignmentId: 'a2', verdict: 'rework', round: 1 }] },
    ));
    expect(action).toMatchObject({ kind: 'specialist_work', agentSlug: 'scope-analyst' });
  });

  it('hands the decision to the lead after two peer rounds rather than looping', () => {
    const action = nextAction(withIntake(
      [
        assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'done', departmentSlug: 'framing-office' }),
        assignment({ id: 'a2', agentSlug: 'scope-analyst', kind: 'specialist_work', status: 'peer_review', departmentSlug: 'framing-office', outputCorpusId: 'c1', round: 2 }),
      ],
      {
        reviews: [
          { id: 'r1', briefId: 'b1', kind: 'peer', reviewerAgentSlug: 'assumption-auditor', subjectAssignmentId: 'a2', verdict: 'rework', round: 1 },
          { id: 'r2', briefId: 'b1', kind: 'peer', reviewerAgentSlug: 'assumption-auditor', subjectAssignmentId: 'a2', verdict: 'rework', round: 2 },
        ],
      },
    ));
    expect(action).toMatchObject({ kind: 'lead_review', subjectAssignmentId: 'a2' });
  });

  it('asks the lead to look again after each rework — one review per round of work', () => {
    // Counted, not looked up: finding "the lead review for this assignment"
    // returns the first one forever, so a department whose lead asked for
    // rework once would ask again on every pass and never reach its limit.
    const reworked = (reworkCount: number, leadReviews: number) => nextAction(withIntake(
      [
        assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'done', departmentSlug: 'framing-office' }),
        assignment({ id: 'a2', agentSlug: 'scope-analyst', kind: 'specialist_work', status: 'peer_review', departmentSlug: 'framing-office', outputCorpusId: 'c1', reworkCount }),
      ],
      {
        reviews: [
          { id: 'r1', briefId: 'b1', kind: 'peer', reviewerAgentSlug: 'assumption-auditor', subjectAssignmentId: 'a2', verdict: 'accept', round: 1 },
          ...Array.from({ length: leadReviews }, (_, index) => ({
            id: `rl${index}`, briefId: 'b1', kind: 'lead' as const, reviewerAgentSlug: 'framing-lead',
            subjectAssignmentId: 'a2', verdict: 'rework' as const, round: 1,
          })),
        ],
      },
    ));
    expect(reworked(1, 1)).toMatchObject({ kind: 'lead_review', subjectAssignmentId: 'a2' });
    expect(reworked(2, 2)).toMatchObject({ kind: 'lead_review', subjectAssignmentId: 'a2' });
    // Reviews spent and still unaccepted: arbitration, never a fourth round.
    expect(reworked(2, 3)).toMatchObject({ kind: 'arbitration', agentSlug: 'evidence-coordinator', about: 'a2' });
  });

  it('escalates an assignment the runner marked escalated', () => {
    const action = nextAction(withIntake([
      assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'done', departmentSlug: 'framing-office' }),
      assignment({ id: 'a2', agentSlug: 'scope-analyst', kind: 'specialist_work', status: 'escalated', departmentSlug: 'framing-office' }),
    ]));
    expect(action).toMatchObject({ kind: 'arbitration', agentSlug: 'evidence-coordinator', about: 'a2' });
  });

  it('submits onward to the next department in the routing', () => {
    const action = nextAction(withIntake(
      [
        assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'done', departmentSlug: 'framing-office' }),
        assignment({ id: 'a2', agentSlug: 'scope-analyst', kind: 'specialist_work', status: 'accepted', departmentSlug: 'framing-office', outputCorpusId: 'c1' }),
      ],
      {
        reviews: [
          { id: 'r1', briefId: 'b1', kind: 'peer', reviewerAgentSlug: 'assumption-auditor', subjectAssignmentId: 'a2', verdict: 'accept', round: 1 },
          { id: 'r2', briefId: 'b1', kind: 'lead', reviewerAgentSlug: 'framing-lead', subjectAssignmentId: 'a2', verdict: 'accept', round: 1 },
        ],
      },
    ));
    expect(action).toMatchObject({ kind: 'lead_submit', departmentSlug: 'framing-office', toDepartmentSlug: 'verification', toCommittee: false });
  });

  it('blocks on an empty lead desk rather than working around it', () => {
    const unstaffed = DEPARTMENTS.map((d) => (d.slug === 'framing-office'
      ? { ...d, seats: [{ ...d.seats[0], agentId: null, dataClass: null }, ...d.seats.slice(1)] }
      : d));
    const action = nextAction(state({ assignments: [DONE_INTAKE], departments: unstaffed }));
    expect(action.kind).toBe('blocked');
    if (action.kind === 'blocked') expect(action.why).toContain('empty desk');
  });

  it('blocks when no staffed specialist may work an internal brief', () => {
    const action = nextAction(state({
      brief: brief({ dataClass: 'internal' }),
      assignments: [
        DONE_INTAKE,
        assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_intake', status: 'done', departmentSlug: 'framing-office' }),
      ],
    }));
    expect(action.kind).toBe('blocked');
    if (action.kind === 'blocked') expect(action.why).toContain('internal brief');
  });
});

describe('Verification is never skipped', () => {
  const framingDone: SubmissionRow = { id: 's1', briefId: 'b1', fromDepartmentSlug: 'framing-office', toDepartmentSlug: 'verification', toCommittee: false, returnCount: 0, accepted: true };

  it('moves to Verification once the first department has submitted', () => {
    const action = nextAction(state({ assignments: [DONE_INTAKE], submissions: [framingDone] }));
    expect(action).toMatchObject({ kind: 'lead_intake', departmentSlug: 'verification' });
  });

  it('goes to the committee only after Verification has submitted', () => {
    const verificationDone: SubmissionRow = { id: 's2', briefId: 'b1', fromDepartmentSlug: 'verification', toDepartmentSlug: null, toCommittee: true, returnCount: 0, accepted: true };
    const action = nextAction(state({ assignments: [DONE_INTAKE], submissions: [framingDone, verificationDone] }));
    expect(action).toMatchObject({ kind: 'committee_review', agentSlug: 'editorial-committee' });
  });
});

describe('the committee, the debate and the director', () => {
  const allSubmitted: SubmissionRow[] = [
    { id: 's1', briefId: 'b1', fromDepartmentSlug: 'framing-office', toDepartmentSlug: 'verification', toCommittee: false, returnCount: 0, accepted: true },
    { id: 's2', briefId: 'b1', fromDepartmentSlug: 'verification', toDepartmentSlug: null, toCommittee: true, returnCount: 0, accepted: true },
  ];
  const committeeReview: ReviewRow = { id: 'r-c', briefId: 'b1', kind: 'committee', reviewerAgentSlug: 'editorial-committee', subjectAssignmentId: null, verdict: 'rework', round: 1 };

  it('skips the committee entirely at brief class (B-10)', () => {
    const action = nextAction(state({ brief: brief({ weightClass: 'brief' }), assignments: [DONE_INTAKE], submissions: allSubmitted }));
    expect(action.kind).toBe('to_director');
  });

  it('weighs an unanswered rebuttal before anything else', () => {
    const debate: DebateRow = { id: 'd1', briefId: 'b1', reviewId: 'r-c', rebuttingAgentSlug: 'framing-lead', round: 1, outcome: null };
    const action = nextAction(state({
      brief: brief({ weightClass: 'full' }),
      assignments: [DONE_INTAKE],
      submissions: allSubmitted,
      reviews: [committeeReview],
      debates: [debate],
    }));
    expect(action).toMatchObject({ kind: 'committee_reweigh', round: 1 });
  });

  it('escalates to the director when the debate ends still disagreeing', () => {
    const debates: DebateRow[] = [
      { id: 'd1', briefId: 'b1', reviewId: 'r-c', rebuttingAgentSlug: 'framing-lead', round: 1, outcome: 'rejected' },
      { id: 'd2', briefId: 'b1', reviewId: 'r-c', rebuttingAgentSlug: 'framing-lead', round: 2, outcome: 'rejected' },
    ];
    const action = nextAction(state({
      brief: brief({ weightClass: 'full' }),
      assignments: [DONE_INTAKE],
      submissions: allSubmitted,
      reviews: [committeeReview],
      debates,
    }));
    expect(action.kind).toBe('to_director');
    if (action.kind === 'to_director') expect(action.why).toContain('2-round limit');
  });

  it('reaches the director when everything is settled', () => {
    const action = nextAction(state({
      assignments: [DONE_INTAKE],
      submissions: allSubmitted,
      reviews: [{ ...committeeReview, verdict: 'accept' }],
    }));
    expect(action.kind).toBe('to_director');
  });

  it('stops once the director has decided', () => {
    for (const status of ['approved', 'rejected', 'published'] as const) {
      expect(nextAction(state({ brief: brief({ status }) })).kind).toBe('done');
    }
  });
});

describe('summarise', () => {
  it('counts what the director\'s room and the floor both need', () => {
    const summary = summarise(state({
      assignments: [
        DONE_INTAKE,
        assignment({ id: 'a2', agentSlug: 'scope-analyst', kind: 'specialist_work', status: 'accepted', departmentSlug: 'framing-office', outputCorpusId: 'c1' }),
        assignment({ id: 'a3', agentSlug: 'assumption-auditor', kind: 'specialist_work', status: 'escalated', departmentSlug: 'framing-office' }),
      ],
      reviews: [
        { id: 'r1', briefId: 'b1', kind: 'peer', reviewerAgentSlug: 'assumption-auditor', subjectAssignmentId: 'a2', verdict: 'accept', round: 1 },
        { id: 'r2', briefId: 'b1', kind: 'lead', reviewerAgentSlug: 'framing-lead', subjectAssignmentId: 'a2', verdict: 'accept', round: 1 },
      ],
    }));
    expect(summary).toMatchObject({ outputs: 1, peerReviews: 1, leadReviews: 1, escalations: 1 });
    expect(summary.departmentsVisited).toEqual(['program-office', 'framing-office']);
  });
});
