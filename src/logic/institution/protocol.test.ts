// The protocol fails closed. These are the cases that decide whether a
// model's shrug can become an acceptance.

import { describe, expect, it } from 'vitest';
import {
  extractJson,
  parseArbitration,
  parseAuthoring,
  parseLeadIntake,
  parseProgramIntake,
  parseRebuttal,
  parseReview,
  parseSpecialistWork,
  parseSubmission,
  parseWeighing,
  renderAuthoring,
  renderCommitteeReview,
  renderLeadIntake,
  renderPeerReview,
  renderProgramIntake,
  type BriefContext,
} from '../../../supabase/functions/_shared/institution/protocol';
import type { DepartmentConfig, SeatConfig } from '../../../supabase/functions/_shared/institution/department';

const seat = (agentSlug: string, role: 'lead' | 'specialist', position: number): SeatConfig => ({
  agentSlug, role, position, seatPurpose: `${agentSlug} seat`, agentId: `id-${agentSlug}`,
  dataClass: 'public', capabilities: [agentSlug],
});

const framing: DepartmentConfig = {
  id: 'd1', slug: 'framing-office', name: 'Framing Office', kind: 'department', pipelineOrder: 1,
  leadAgentSlug: 'framing-lead', purpose: 'Owns the question.', accountableFor: 'an answerable brief',
  seats: [seat('framing-lead', 'lead', 0), seat('scope-analyst', 'specialist', 1), seat('assumption-auditor', 'specialist', 2)],
};

const brief: BriefContext = {
  question: 'Is our Q3 margin good?',
  restated: 'How did SAMB Q3 gross margin compare with budget?',
  answerWouldBe: 'a comparison with the margin definition stated',
  outOfScope: 'FY22',
  assumptions: ['the pack definition of gross margin holds'],
  weightClass: 'standard',
  dataClass: 'internal',
};

const fence = (value: unknown) => `Some prose first.\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

describe('extractJson', () => {
  it('reads a fenced block', () => {
    expect(extractJson(fence({ a: 1 }))).toEqual({ a: 1 });
  });

  it('reads bare JSON when there is no fence', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('takes the last block when a model shows its working', () => {
    expect(extractJson('```json\n{"a":1}\n```\nthen\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it('returns null for prose, rather than guessing', () => {
    expect(extractJson('I accept the assignment.')).toBeNull();
    expect(extractJson('```json\n{not json}\n```')).toBeNull();
  });
});

describe('prompts say what the rules are', () => {
  it('tells an internal-lane agent about the egress check', () => {
    expect(renderLeadIntake(framing, brief, null, framing.seats)).toContain('B-4');
  });

  it('puts Verification and the class definitions in the program office prompt', () => {
    const prompt = renderProgramIntake('question', [framing]);
    expect(prompt).toContain('Verification is in every routing');
    expect(prompt).toContain('brief:');
  });

  it('tells a peer reviewer it is not the author', () => {
    expect(renderPeerReview(framing, 'assumption-auditor', 'scope-analyst', 'work', brief))
      .toContain('You did not write this');
  });

  it('tells the committee it may propose against itself, and that nothing changes by itself', () => {
    const prompt = renderCommitteeReview(brief, 'submissions', 'history');
    expect(prompt).toContain('or to yourself');
    expect(prompt).toContain('until the director approves');
  });

  it('tells a lead that an agent it authors is public', () => {
    expect(renderAuthoring(framing, 'discourse analysis', brief)).toContain('PUBLIC-lane agent');
  });
});

describe('parseProgramIntake', () => {
  it('reads a complete intake', () => {
    const reply = parseProgramIntake(fence({
      restated: 'How did SAMB Q3 gross margin compare with budget?',
      answerWouldBe: 'a comparison',
      outOfScope: 'FY22',
      assumptions: ['definition holds'],
      weightClass: 'full',
      classReason: 'decision-grade',
      dataClass: 'internal',
      routing: ['framing-office', 'verification', 'not-a-department'],
    }), ['framing-office', 'verification']);
    expect('error' in reply).toBe(false);
    if (!('error' in reply)) {
      expect(reply.weightClass).toBe('full');
      expect(reply.dataClass).toBe('internal');
      expect(reply.routing).toEqual(['framing-office', 'verification']);
    }
  });

  it('refuses an intake with no restatement', () => {
    expect(parseProgramIntake(fence({ restated: 'eh' }), [])).toHaveProperty('error');
    expect(parseProgramIntake('no json at all', [])).toHaveProperty('error');
  });

  it('falls back to standard for an unknown class rather than inventing one', () => {
    const reply = parseProgramIntake(fence({ restated: 'a restated question here', weightClass: 'enormous' }), []);
    if (!('error' in reply)) expect(reply.weightClass).toBe('standard');
  });
});

describe('parseLeadIntake fails closed', () => {
  const bench = ['scope-analyst', 'assumption-auditor'];

  it('reads an acceptance with instructions', () => {
    const reply = parseLeadIntake(fence({
      accept: true, reason: 'answerable', assignTo: ['scope-analyst', 'someone-else'],
      authorNeeded: [], instructions: { 'scope-analyst': 'draw the boundary', 'ghost': 'x' },
    }), bench);
    expect(reply.accept).toBe(true);
    expect(reply.assignTo).toEqual(['scope-analyst']);
    expect(Object.keys(reply.instructions)).toEqual(['scope-analyst']);
  });

  it('returns the assignment when the reply cannot be read', () => {
    const reply = parseLeadIntake('I accept, looks fine to me.', bench);
    expect(reply.accept).toBe(false);
    expect(reply.reason).toContain('unreadable reply');
  });

  it('treats a missing accept flag as a refusal', () => {
    expect(parseLeadIntake(fence({ reason: 'hmm' }), bench).accept).toBe(false);
  });
});

describe('parseReview fails closed', () => {
  it('reads a verdict and its findings', () => {
    const reply = parseReview(fence({
      verdict: 'rework', summary: 'two figures unattributed',
      findings: [{ claim: '3.85m tonnes', finding: 'no citation', severity: 'blocking', suggestedFix: 'cite the release' }],
    }));
    expect(reply.verdict).toBe('rework');
    expect(reply.findings[0].severity).toBe('blocking');
  });

  it('escalates an unreadable review rather than accepting it', () => {
    const reply = parseReview('Looks good to me!');
    expect(reply.verdict).toBe('escalate');
    expect(reply.summary).toContain('not answer in the required form');
  });

  it('escalates an unknown verdict', () => {
    expect(parseReview(fence({ verdict: 'looks-fine', summary: 'x' })).verdict).toBe('escalate');
  });

  it('will not let an accept stand beside a blocking finding', () => {
    const reply = parseReview(fence({
      verdict: 'accept', summary: 'fine',
      findings: [{ claim: 'x', finding: 'unattributed', severity: 'blocking' }],
    }));
    expect(reply.verdict).toBe('rework');
  });

  it('drops a proposal with no substance', () => {
    const reply = parseReview(fence({
      verdict: 'accept', summary: 'fine',
      proposals: [
        { agentSlug: 'scope-analyst', rationale: 'too short', change: 'do better' },
        { agentSlug: 'scope-analyst', rationale: 'it repeatedly widened scope', change: 'Add a rule: never widen the scope boundary to make the question more interesting; return it instead.' },
      ],
    }));
    expect(reply.proposals).toHaveLength(1);
  });
});

describe('parseSpecialistWork', () => {
  it('keeps the prose and reads the record fields', () => {
    const reply = parseSpecialistWork(`The boundary is 2019-2024.\n\n${fence({ produced: 'a scope note', restsOn: ['c1'], uncertain: 'nothing material', didNotDo: 'no pricing', needs: [{ tool: 'web_search', why: 'capacity series', query: 'indonesia poultry capacity' }] })}`);
    expect(reply.prose).toContain('The boundary is 2019-2024.');
    expect(reply.prose).not.toContain('```');
    expect(reply.restsOn).toEqual(['c1']);
    expect(reply.needs).toHaveLength(1);
  });

  it('survives a reply with no JSON at all, keeping the prose', () => {
    const reply = parseSpecialistWork('Just some prose, no block.');
    expect(reply.produced).toContain('Just some prose');
    expect(reply.restsOn).toEqual([]);
    expect(reply.uncertain).toBe('not stated');
  });
});

describe('parseSubmission', () => {
  it('reads the four parts of the record', () => {
    const reply = parseSubmission(fence({ produced: 'p', restsOn: ['c1'], uncertainties: 'u', exclusions: 'e' }));
    expect(reply).toEqual({ produced: 'p', restsOn: ['c1'], uncertainties: 'u', exclusions: 'e' });
  });

  it('returns empty fields for an unreadable reply, which checkSubmission then refuses', () => {
    expect(parseSubmission('nope')).toEqual({ produced: '', restsOn: [], uncertainties: '', exclusions: '' });
  });
});

describe('debate', () => {
  it('reads a contested finding', () => {
    const reply = parseRebuttal(fence({ contest: true, rebuttal: 'The finding reads the 2019 column as 2020, which the archived table contradicts.' }));
    expect(reply.contest).toBe(true);
  });

  it('does not treat a one-word protest as a rebuttal', () => {
    expect(parseRebuttal(fence({ contest: true, rebuttal: 'wrong' })).contest).toBe(false);
  });

  it('records an unweighed rebuttal as unresolved rather than dropping it', () => {
    const reply = parseWeighing(fence({ weighings: [{ id: 'd1', outcome: 'accepted', weighing: 'fair' }] }), ['d1', 'd2']);
    expect(reply.weighings).toHaveLength(2);
    const second = reply.weighings.find((entry) => entry.id === 'd2');
    expect(second?.outcome).toBe('rejected');
    expect(second?.weighing).toContain('did not weigh');
  });

  it('defaults an unknown outcome to rejected, so the disagreement survives', () => {
    const reply = parseWeighing(fence({ weighings: [{ id: 'd1', outcome: 'mostly ok', weighing: 'x' }] }), ['d1']);
    expect(reply.weighings[0].outcome).toBe('rejected');
  });
});

describe('parseAuthoring', () => {
  it('reads a complete agent', () => {
    const reply = parseAuthoring(fence({
      slug: 'Discourse Analyst!', name: 'Discourse Analyst', description: 'reads framing',
      systemPrompt: 'x'.repeat(250), purpose: 'the department needs it',
    }));
    expect('error' in reply).toBe(false);
    if (!('error' in reply)) expect(reply.slug).toBe('discourse-analyst');
  });

  it('refuses a three-sentence prompt', () => {
    const reply = parseAuthoring(fence({ slug: 'thin', systemPrompt: 'Do the thing.' }));
    expect(reply).toHaveProperty('error');
    if ('error' in reply) expect(reply.error).toContain('not three sentences');
  });

  it('refuses an authoring reply with no slug', () => {
    expect(parseAuthoring('nope')).toHaveProperty('error');
  });
});

describe('parseArbitration fails closed', () => {
  it('reads a decision', () => {
    expect(parseArbitration(fence({ decision: 'drop', reason: 'the contested table is not load-bearing', note: 'n' })).decision).toBe('drop');
  });

  it('stops when the reply cannot be read, rather than waving work onward', () => {
    const reply = parseArbitration('just continue');
    expect(reply.decision).toBe('stop');
    expect(reply.reason).toContain('required form');
  });
});
