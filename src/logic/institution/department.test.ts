// 1-A, proved from config alone. The two departments below are built from
// the same shape the database rows carry; nothing in department.ts knows
// either of them by name, which is the property Phase 3 has to demonstrate.

import { describe, expect, it } from 'vitest';
import {
  applyLeadReview,
  applyPeerReview,
  applyUpstreamReturn,
  authoringRequests,
  checkSubmission,
  intake,
  isPhantom,
  leadSeat,
  matchCapabilities,
  nextStop,
  peerReviewerFor,
  seatServes,
  slugify,
  specialists,
  staffedSpecialists,
  type AssignmentState,
  type DepartmentConfig,
  type SeatConfig,
} from '../../../supabase/functions/_shared/institution/department';

const seat = (over: Partial<SeatConfig> & Pick<SeatConfig, 'agentSlug' | 'role' | 'position'>): SeatConfig => ({
  seatPurpose: '',
  agentId: `id-${over.agentSlug}`,
  dataClass: 'public',
  capabilities: [over.agentSlug.replace(/-/g, ' ')],
  ...over,
});

const framing: DepartmentConfig = {
  id: 'd1',
  slug: 'framing-office',
  name: 'Framing Office',
  kind: 'department',
  pipelineOrder: 1,
  leadAgentSlug: 'framing-lead',
  purpose: 'Owns the question.',
  accountableFor: 'a brief that can actually be answered',
  seats: [
    seat({ agentSlug: 'framing-lead', role: 'lead', position: 0 }),
    seat({ agentSlug: 'evidence-framer', role: 'specialist', position: 1, dataClass: 'internal', capabilities: ['critique the framing', 'restate the question'] }),
    seat({ agentSlug: 'scope-analyst', role: 'specialist', position: 2, capabilities: ['draw the scope boundary', 'scope'] }),
    seat({ agentSlug: 'assumption-auditor', role: 'specialist', position: 3, capabilities: ['surface assumptions', 'assumptions'] }),
  ],
};

const quant: DepartmentConfig = {
  id: 'd5',
  slug: 'quantitative-analysis',
  name: 'Quantitative Analysis',
  kind: 'department',
  pipelineOrder: 5,
  leadAgentSlug: 'quant-lead',
  purpose: 'Owns the numbers.',
  accountableFor: 'analysis with uncertainty stated',
  seats: [
    seat({ agentSlug: 'quant-lead', role: 'lead', position: 0, dataClass: 'internal' }),
    seat({ agentSlug: 'math-specialist', role: 'specialist', position: 1, dataClass: 'internal', capabilities: ['forecasting', 'monte carlo', 'econometrics'] }),
    seat({ agentSlug: 'financial-modeling', role: 'specialist', position: 3, agentId: null, dataClass: null, capabilities: ['three statement model'] }),
    seat({ agentSlug: 'scenario-analyst', role: 'specialist', position: 4, dataClass: 'internal', capabilities: ['scenario', 'sensitivity'] }),
  ],
};

const ANSWER = 'a restated question with scope and assumptions';

describe('config reading', () => {
  it('finds the lead and orders the specialists by seat', () => {
    expect(leadSeat(framing)?.agentSlug).toBe('framing-lead');
    expect(specialists(framing).map((s) => s.agentSlug)).toEqual(['evidence-framer', 'scope-analyst', 'assumption-auditor']);
  });

  it('treats a seat with no agent row as a phantom, and leaves it out of the bench', () => {
    expect(isPhantom(quant.seats[2])).toBe(true);
    expect(staffedSpecialists(quant).map((s) => s.agentSlug)).toEqual(['math-specialist', 'scenario-analyst']);
  });
});

describe('intake — two departments, one code path', () => {
  it('accepts a well-formed assignment and names who will work it', () => {
    const decision = intake(framing, {
      briefQuestion: 'Is our Q3 margin good?',
      restated: 'How did SAMB Q3 gross margin compare with budget?',
      answerWouldBe: ANSWER,
      dataClass: 'public',
      upstreamSummary: null,
      requiredCapabilities: ['scope', 'assumptions'],
    });
    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      expect(decision.assignTo).toEqual(['scope-analyst', 'assumption-auditor']);
      expect(decision.authorNeeded).toEqual([]);
    }
  });

  it('runs the identical path for a different department from config alone', () => {
    const decision = intake(quant, {
      briefQuestion: 'Forecast KGR volume for 2027',
      restated: 'Forecast KGR processed poultry volume for 2027 with a range',
      answerWouldBe: 'a volume range with the basis for the range',
      dataClass: 'internal',
      upstreamSummary: 'Evidence submitted a hashed volume series.',
      requiredCapabilities: ['forecasting'],
    });
    expect(decision.accepted).toBe(true);
    if (decision.accepted) expect(decision.assignTo).toEqual(['math-specialist']);
  });

  it('returns an assignment that carries no question', () => {
    const decision = intake(framing, {
      briefQuestion: 'eh',
      restated: '',
      answerWouldBe: ANSWER,
      dataClass: 'public',
      upstreamSummary: null,
      requiredCapabilities: [],
    });
    expect(decision.accepted).toBe(false);
    if (!decision.accepted) expect(decision.code).toBe('no-question');
  });

  it('returns an assignment that never says what would count as an answer', () => {
    const decision = intake(framing, {
      briefQuestion: 'How did SAMB Q3 gross margin compare with budget?',
      restated: '',
      answerWouldBe: '',
      dataClass: 'public',
      upstreamSummary: null,
      requiredCapabilities: [],
    });
    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.code).toBe('no-answer-shape');
      expect(decision.reason).toContain('unanswerable-as-written');
    }
  });

  it('refuses an internal brief when the lead is a public-lane agent, and says it is B-3', () => {
    const decision = intake(framing, {
      briefQuestion: 'What is KGR yield against standard?',
      restated: 'What is KGR yield against standard for the period?',
      answerWouldBe: ANSWER,
      dataClass: 'internal',
      upstreamSummary: null,
      requiredCapabilities: [],
    });
    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.code).toBe('lane');
      expect(decision.reason).toContain('B-3');
    }
  });

  it('refuses when the lead seat is an empty desk', () => {
    const unstaffed: DepartmentConfig = {
      ...framing,
      seats: [{ ...framing.seats[0], agentId: null, dataClass: null }, ...framing.seats.slice(1)],
    };
    const decision = intake(unstaffed, {
      briefQuestion: 'How did SAMB Q3 gross margin compare with budget?',
      restated: '',
      answerWouldBe: ANSWER,
      dataClass: 'public',
      upstreamSummary: null,
      requiredCapabilities: [],
    });
    expect(decision.accepted).toBe(false);
    if (!decision.accepted) expect(decision.code).toBe('no-lead');
  });

  it('returns an empty submission from upstream rather than working on nothing', () => {
    const decision = intake(quant, {
      briefQuestion: 'Forecast KGR volume for 2027',
      restated: 'Forecast KGR processed poultry volume for 2027',
      answerWouldBe: 'a volume range',
      dataClass: 'internal',
      upstreamSummary: '   ',
      requiredCapabilities: [],
    });
    expect(decision.accepted).toBe(false);
    if (!decision.accepted) expect(decision.code).toBe('no-upstream');
  });

  it('names the capability it lacks instead of assigning the wrong specialist', () => {
    const decision = intake(quant, {
      briefQuestion: 'Build the three statement model for KGR',
      restated: 'Build the three statement model for KGR for 2027',
      answerWouldBe: 'a model with its assumptions',
      dataClass: 'internal',
      upstreamSummary: null,
      requiredCapabilities: ['three statement model'],
    });
    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      expect(decision.assignTo).toEqual([]);
      expect(decision.authorNeeded).toEqual(['three statement model']);
    }
  });
});

describe('delegation respects the lane', () => {
  it('never assigns a public specialist to internal work', () => {
    const match = matchCapabilities(framing, [], 'internal');
    expect(match.assignTo).toEqual(['evidence-framer']);
  });

  it('assigns the whole staffed bench when no capability is named', () => {
    expect(matchCapabilities(framing, [], 'public').assignTo).toEqual(['evidence-framer', 'scope-analyst', 'assumption-auditor']);
  });

  it('matches a seat by slug as well as by capability words', () => {
    expect(seatServes(framing.seats[2], 'scope-analyst')).toBe(true);
    expect(seatServes(framing.seats[2], 'monte carlo')).toBe(false);
  });
});

describe('authoring a missing capability (B-3)', () => {
  it('always proposes a public agent, with a stated purpose', () => {
    const requests = authoringRequests(quant, ['three statement model'], 'quant-lead');
    expect(requests).toHaveLength(1);
    expect(requests[0].dataClass).toBe('public');
    expect(requests[0].slug).toBe('three-statement-model');
    expect(requests[0].authoredByAgentSlug).toBe('quant-lead');
    expect(requests[0].purpose).toContain('Quantitative Analysis');
  });

  it('slugifies a capability into a usable agent slug', () => {
    expect(slugify('PSAK 110 consolidation!!')).toBe('psak-110-consolidation');
  });
});

describe('peer review is never by the author (1-A)', () => {
  it('picks a sibling, deterministically, by seat order after the author', () => {
    expect(peerReviewerFor(framing, 'evidence-framer').reviewer).toBe('scope-analyst');
    expect(peerReviewerFor(framing, 'assumption-auditor').reviewer).toBe('evidence-framer');
  });

  it('never returns the author, whoever it is', () => {
    for (const author of staffedSpecialists(framing).map((s) => s.agentSlug)) {
      expect(peerReviewerFor(framing, author).reviewer).not.toBe(author);
    }
  });

  it('falls to a different sibling in round 2', () => {
    expect(peerReviewerFor(framing, 'evidence-framer', ['scope-analyst']).reviewer).toBe('assumption-auditor');
  });

  it('uses the lead when there is only one staffed specialist, and says so', () => {
    const thin: DepartmentConfig = { ...framing, seats: [framing.seats[0], framing.seats[1]] };
    const choice = peerReviewerFor(thin, 'evidence-framer');
    expect(choice.reviewer).toBe('framing-lead');
    expect(choice.reason).toContain('not skipped');
  });

  it('refuses rather than letting an author review itself when it is alone', () => {
    const alone: DepartmentConfig = {
      ...framing,
      seats: [{ ...framing.seats[0], agentSlug: 'evidence-framer', role: 'lead' }],
    };
    const choice = peerReviewerFor(alone, 'evidence-framer');
    expect(choice.reviewer).toBeNull();
    expect(choice.reason).toContain('cannot peer-review');
  });

  it('skips phantom desks, which cannot review anything', () => {
    expect(peerReviewerFor(quant, 'math-specialist').reviewer).toBe('scenario-analyst');
  });
});

describe('the B-5 bounds hold', () => {
  const base: AssignmentState = { agentSlug: 'scope-analyst', status: 'working', reworkCount: 0, round: 1 };

  it('sends peer rework back once, then hands the decision to the lead', () => {
    const first = applyPeerReview(base, 'rework');
    expect(first.next.status).toBe('rework');
    expect(first.next.round).toBe(2);
    const second = applyPeerReview(first.next, 'rework');
    expect(second.escalated).toBe(true);
    expect(second.note).toContain('2-round limit');
    expect(second.next.round).toBe(2);
  });

  it('lets a lead return work twice and then escalates instead of looping', () => {
    let state = base;
    for (const expected of [1, 2]) {
      const outcome = applyLeadReview(state, 'rework');
      expect(outcome.escalated).toBe(false);
      expect(outcome.next.reworkCount).toBe(expected);
      state = outcome.next;
    }
    const third = applyLeadReview(state, 'rework');
    expect(third.escalated).toBe(true);
    expect(third.next.status).toBe('escalated');
    expect(third.next.reworkCount).toBe(2);
  });

  it('accepts and rejects without touching the counters', () => {
    expect(applyLeadReview(base, 'accept').next.status).toBe('accepted');
    expect(applyLeadReview(base, 'reject')).toMatchObject({ escalated: true, next: { status: 'failed' } });
  });

  it('allows two upstream returns per submission, then arbitration', () => {
    expect(applyUpstreamReturn(0).accepted).toBe(true);
    expect(applyUpstreamReturn(1).nextCount).toBe(2);
    const third = applyUpstreamReturn(2);
    expect(third.accepted).toBe(false);
    expect(third.note).toContain('arbitrates');
  });
});

describe('submission is a record, not a message', () => {
  it('accepts a complete submission', () => {
    expect(checkSubmission({
      produced: 'A restated brief with three scope boundaries and four assumptions.',
      restsOn: ['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'],
      uncertainties: 'Whether the margin definition matches the pack.',
      exclusions: 'Did not look at FY22; out of the window.',
    })).toEqual([]);
  });

  it('names every missing part rather than defaulting it', () => {
    const problems = checkSubmission({ produced: '', restsOn: [], uncertainties: '', exclusions: '' });
    expect(problems.map((problem) => problem.field)).toEqual(['produced', 'restsOn', 'uncertainties', 'exclusions']);
  });

  it('refuses a submission that names no corpus records (B-8)', () => {
    const problems = checkSubmission({
      produced: 'A restated brief with three scope boundaries.',
      restsOn: [],
      uncertainties: 'None worth recording.',
      exclusions: 'Did not price anything.',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('B-8');
  });
});

describe('routing', () => {
  it('sends work to the next department, then to the committee', () => {
    const routing = ['framing-office', 'quantitative-analysis', 'verification'];
    expect(nextStop(routing, 'framing-office')).toEqual({ to: 'quantitative-analysis', toCommittee: false });
    expect(nextStop(routing, 'verification')).toEqual({ to: null, toCommittee: true });
    expect(nextStop(routing, 'editorial')).toEqual({ to: null, toCommittee: false });
  });
});
