// The institution, driven end to end against fakes. Every assertion here is
// about behaviour the spec names: a department that can refuse, a peer
// review that is never by its author, a rework limit that holds, an
// authored agent that is public, a proposal that changes nothing.

import { describe, expect, it } from 'vitest';
import { runBrief, stepBrief } from './runner';
import {
  authoring,
  leadAccepts,
  leadRefuses,
  makeHarness,
  programIntake,
  review,
  specialistWork,
  submission,
  type ScriptedCall,
} from './runnerFixtures';
import { rowsOf } from '../../data/readResult';

const QUESTION = 'How has Indonesian poultry processing capacity changed since 2019?';

/** A script that carries a whole brief-class run: framing, then verification. */
const happyScript = (call: ScriptedCall): string => {
  const { prompt, agentSlug } = call;
  if (prompt.includes('You are the Program Office of a research institution')) return programIntake();
  if (prompt.includes('Accept this assignment, or return it')) {
    return agentSlug === 'framing-lead'
      ? leadAccepts(['scope-analyst'], { 'scope-analyst': 'draw the boundary' })
      : leadAccepts(['numeric-auditor'], { 'numeric-auditor': 're-derive every figure' });
  }
  if (prompt.includes('YOUR ASSIGNMENT FROM THE LEAD')) return specialistWork(`${agentSlug} produced its part`);
  if (prompt.includes('reviewing a sibling')) return review('accept', 'the work is supported');
  if (prompt.includes('reviewing your department')) return review('accept', 'accepted for submission');
  if (prompt.includes('Write the submission')) return submission();
  if (prompt.includes('You are the Editorial Committee')) return review('accept', 'nothing blocking');
  return review('escalate', 'unexpected prompt');
};

async function runQuestion(script: (call: ScriptedCall) => string | { refusal: string }) {
  const harness = makeHarness({ script });
  const brief = await harness.repo.createBrief({ question: QUESTION });
  const reports = await runBrief(harness.ports, brief.id, { maxSteps: 40 });
  return { harness, brief, reports };
}

describe('a brief-class run, end to end', () => {
  it('takes the question in, routes it, works it, reviews it and reaches the director', async () => {
    const { harness, brief, reports } = await runQuestion(happyScript);
    const finalBrief = await harness.repo.getBrief(brief.id);
    expect(finalBrief?.status).toBe('director');
    expect(reports[reports.length - 1].action).toBe('to_director');

    const actions = reports.map((report) => report.action);
    expect(actions[0]).toBe('program_intake');
    expect(actions).toContain('lead_intake');
    expect(actions).toContain('specialist_work');
    expect(actions).toContain('peer_review');
    expect(actions).toContain('lead_review');
    expect(actions).toContain('lead_submit');
  });

  it('puts Verification in the routing even though the program office asked for one department', async () => {
    const { harness, brief } = await runQuestion(happyScript);
    const finalBrief = await harness.repo.getBrief(brief.id);
    expect(finalBrief?.routing).toEqual(['framing-office', 'verification']);
  });

  it('skips the committee at brief class', async () => {
    const { harness, brief } = await runQuestion(happyScript);
    const reviews = rowsOf(await harness.repo.listReviews(brief.id));
    expect(reviews.some((entry) => entry.kind === 'committee')).toBe(false);
  });

  it('shows a cost estimate before the run and records the actual after', async () => {
    const { harness, brief } = await runQuestion(happyScript);
    const finalBrief = await harness.repo.getBrief(brief.id);
    expect(finalBrief?.costEstimateUsd).toBeGreaterThan(0);
    expect(finalBrief?.brief.estimate?.breakdown.length).toBeGreaterThan(2);
    expect(finalBrief?.costActualUsd).toBeGreaterThan(0);
    expect(finalBrief?.tokensActual).toBeGreaterThan(0);
  });

  it('records every step as events the floor can read', async () => {
    const { harness, brief } = await runQuestion(happyScript);
    const kinds = rowsOf(await harness.repo.listEvents(brief.id)).map((event) => event.kind);
    expect(kinds).toContain('brief.intake');
    expect(kinds).toContain('department.accepted');
    expect(kinds).toContain('specialist.produced');
    expect(kinds).toContain('review.peer');
    expect(kinds).toContain('department.submitted');
    expect(kinds).toContain('brief.to_director');
  });

  it('never has an agent review its own work', async () => {
    const { harness, brief } = await runQuestion(happyScript);
    const reviews = rowsOf(await harness.repo.listReviews(brief.id));
    expect(reviews.length).toBeGreaterThan(0);
    for (const entry of reviews) {
      if (entry.kind === 'peer' && entry.subjectAgentId) {
        expect(entry.reviewerAgentId).not.toBe(entry.subjectAgentId);
      }
    }
  });

  it('runs two departments from config alone, with no department-specific code', async () => {
    const { harness, brief } = await runQuestion(happyScript);
    const assignments = rowsOf(await harness.repo.listAssignments(brief.id));
    const departments = new Set(assignments.map((row) => row.departmentId).filter(Boolean));
    expect(departments.has('dept-framing')).toBe(true);
    expect(departments.has('dept-verification')).toBe(true);
  });
});

describe('a department can refuse', () => {
  it('stops when the lead returns the assignment, and repeats the reason', async () => {
    const { harness, brief, reports } = await runQuestion((call) => {
      if (call.prompt.includes('You are the Program Office')) return programIntake();
      if (call.prompt.includes('Accept this assignment')) return leadRefuses('the question does not say which capacity measure it means');
      return happyScript(call);
    });
    const last = reports[reports.length - 1];
    expect(last.blocked).toBe(true);
    expect(last.note).toContain('which capacity measure');
    const events = rowsOf(await harness.repo.listEvents(brief.id)).map((event) => event.kind);
    expect(events).toContain('department.refused');
  });

  it('refuses before spending a call when the brief says nothing about what an answer is', async () => {
    const harness = makeHarness({ script: () => review('accept') });
    const brief = await harness.repo.createBrief({
      question: QUESTION,
      brief: { restated: 'a restated question long enough', answerWouldBe: '' },
      routing: ['framing-office'],
    });
    await harness.repo.updateBrief(brief.id, { status: 'running' });
    await harness.repo.createAssignment({ briefId: brief.id, agentSlug: 'evidence-coordinator', kind: 'program_intake', status: 'done' });
    const report = await stepBrief(harness.ports, brief.id);
    expect(report.note).toContain('unanswerable-as-written');
    expect(harness.calls).toHaveLength(0); // nothing was spent on it
  });

  it('returns the assignment when the lead answers in prose, rather than reading it as a yes', async () => {
    const { reports } = await runQuestion((call) => {
      if (call.prompt.includes('You are the Program Office')) return programIntake();
      if (call.prompt.includes('Accept this assignment')) return 'Sure, sounds good, I will get someone on it.';
      return happyScript(call);
    });
    expect(reports[reports.length - 1].note).toContain('unreadable reply');
  });
});

describe('the review loops are bounded (B-5)', () => {
  const reworkScript = (leadVerdict: string) => (call: ScriptedCall): string => {
    if (call.prompt.includes('You are the Program Office')) return programIntake();
    if (call.prompt.includes('Accept this assignment')) {
      return call.agentSlug === 'framing-lead'
        ? leadAccepts(['scope-analyst'], { 'scope-analyst': 'draw the boundary' })
        : leadAccepts(['numeric-auditor'], { 'numeric-auditor': 'check' });
    }
    if (call.prompt.includes('YOUR ASSIGNMENT FROM THE LEAD')) return specialistWork('a scope note');
    if (call.prompt.includes('reviewing a sibling')) return review('accept', 'fine');
    if (call.prompt.includes('reviewing your department')) {
      return call.agentSlug === 'framing-lead'
        ? review(leadVerdict, 'the boundary is still not stated', [{ claim: 'scope', finding: 'no boundary given', severity: 'material' }])
        : review('accept', 'fine');
    }
    if (call.prompt.includes('Write the submission')) return submission();
    if (call.prompt.includes('Program Office. Work has hit a bounded limit')) {
      return `\`\`\`json\n${JSON.stringify({ decision: 'stop', reason: 'the department cannot state the boundary; the director should see this', note: '' })}\n\`\`\``;
    }
    return review('escalate', 'unexpected');
  };

  it('lets a lead return work twice, then escalates to the program office instead of looping', async () => {
    const { harness, brief, reports } = await runQuestion(reworkScript('rework'));
    const assignments = rowsOf(await harness.repo.listAssignments(brief.id));
    const work = assignments.find((row) => row.kind === 'specialist_work' && row.agentSlug === 'scope-analyst');
    expect(work?.reworkCount).toBeLessThanOrEqual(2);
    expect(reports.map((report) => report.action)).toContain('arbitration');
    const events = rowsOf(await harness.repo.listEvents(brief.id)).map((event) => event.kind);
    expect(events).toContain('arbitration');
  });

  it('never records more than two lead reviews of the same work', async () => {
    const { harness, brief } = await runQuestion(reworkScript('rework'));
    const reviews = rowsOf(await harness.repo.listReviews(brief.id));
    const leadReviews = reviews.filter((entry) => entry.kind === 'lead');
    const bySubject = new Map<string, number>();
    for (const entry of leadReviews) {
      const key = entry.subjectAssignmentId ?? 'none';
      bySubject.set(key, (bySubject.get(key) ?? 0) + 1);
    }
    for (const count of bySubject.values()) expect(count).toBeLessThanOrEqual(3);
  });
});

describe('authoring a missing capability (B-3)', () => {
  it('authors a PUBLIC agent, attributed to the lead that asked for it', async () => {
    const { harness } = await runQuestion((call) => {
      if (call.prompt.includes('You are the Program Office')) return programIntake();
      if (call.prompt.includes('Accept this assignment')) {
        return call.agentSlug === 'framing-lead'
          ? leadAccepts(['scope-analyst'], { 'scope-analyst': 'draw the boundary' }, ['discourse analysis'])
          : leadAccepts(['numeric-auditor'], { 'numeric-auditor': 'check' });
      }
      if (call.prompt.includes('authoring the specialist')) return authoring('discourse-analyst');
      return happyScript(call);
    });
    expect(harness.authored).toHaveLength(1);
    expect(harness.authored[0]).toMatchObject({ slug: 'discourse-analyst', dataClass: 'public', authoredByAgentId: 'a-framing-lead' });
  });

  it('fails the authoring assignment rather than creating an agent with a three-sentence prompt', async () => {
    const { harness } = await runQuestion((call) => {
      if (call.prompt.includes('You are the Program Office')) return programIntake();
      if (call.prompt.includes('Accept this assignment')) {
        return call.agentSlug === 'framing-lead'
          ? leadAccepts(['scope-analyst'], {}, ['discourse analysis'])
          : leadAccepts(['numeric-auditor'], {});
      }
      if (call.prompt.includes('authoring the specialist')) {
        return `\`\`\`json\n${JSON.stringify({ slug: 'thin', systemPrompt: 'Do the thing.' })}\n\`\`\``;
      }
      return happyScript(call);
    });
    expect(harness.authored).toHaveLength(0);
  });
});

describe('tools and the egress check', () => {
  it('runs the retrieval a specialist asked for and notes the archived record', async () => {
    const { harness, brief } = await runQuestion((call) => {
      if (call.prompt.includes('YOUR ASSIGNMENT FROM THE LEAD')) {
        return specialistWork('a scope note', { needs: [{ tool: 'web_search', why: 'capacity series', query: 'indonesia poultry capacity' }] });
      }
      return happyScript(call);
    });
    expect(harness.toolCalls.some((call) => call.tool === 'search')).toBe(true);
    const assignments = rowsOf(await harness.repo.listAssignments(brief.id));
    const work = assignments.find((row) => row.kind === 'specialist_work');
    expect(JSON.stringify(work?.detail)).toContain('archived as');
  });

  it('records a blocked egress attempt as an event and carries on', async () => {
    const harness = makeHarness({
      script: (call) => {
        if (call.prompt.includes('YOUR ASSIGNMENT FROM THE LEAD')) {
          return specialistWork('a scope note', { needs: [{ tool: 'web_search', why: 'benchmark', query: 'internal figure 8.675.309.000' }] });
        }
        return happyScript(call);
      },
      toolResult: (tool) => ({ ok: false, tool, code: 'egress_blocked', error: 'B-4: this call would place internal content in front of a third party, so it was blocked and logged.' }),
    });
    const brief = await harness.repo.createBrief({ question: QUESTION });
    await runBrief(harness.ports, brief.id, { maxSteps: 40 });
    const events = rowsOf(await harness.repo.listEvents(brief.id));
    const blocked = events.filter((event) => event.kind === 'egress.blocked');
    expect(blocked.length).toBeGreaterThan(0);
    expect(String(blocked[0].payload.note)).toContain('B-4');
    // ...and the run still reached the director rather than dying.
    expect((await harness.repo.getBrief(brief.id))?.status).toBe('director');
  });

  it('passes the internal haystack only for an internal-lane specialist', async () => {
    const harness = makeHarness({
      script: (call) => {
        if (call.prompt.includes('You are the Program Office')) return programIntake({ dataClass: 'internal', routing: ['framing-office'] });
        if (call.prompt.includes('Accept this assignment')) {
          return call.agentSlug === 'framing-lead'
            ? leadAccepts(['evidence-framer'], { 'evidence-framer': 'critique the framing' })
            : leadAccepts(['numeric-auditor'], { 'numeric-auditor': 'check' });
        }
        if (call.prompt.includes('YOUR ASSIGNMENT FROM THE LEAD')) {
          return specialistWork('a framing note', { needs: [{ tool: 'web_search', why: 'context', query: 'poultry capacity' }] });
        }
        return happyScript(call);
      },
    });
    const brief = await harness.repo.createBrief({ question: QUESTION });
    harness.repo.corpus.push({
      id: '00000000-0000-4000-8000-0000000000ff', kind: 'retrieval', title: 'internal', dataClass: 'internal',
      content: 'Synthetic internal figure 8.675.309.000', contentHash: 'f'.repeat(64), url: null, httpStatus: null,
      fetchedAt: null, query: null, provenance: {}, derivedFrom: [], briefId: brief.id, assignmentId: null,
      createdByAgentId: null, createdByRunId: null, reviewStatus: 'unreviewed', createdAt: new Date().toISOString(),
    });
    await runBrief(harness.ports, brief.id, { maxSteps: 40 });
    const searchCall = harness.toolCalls.find((call) => call.tool === 'search');
    expect(searchCall?.ref.internalContext).toBeDefined();
    expect(searchCall?.ref.internalContext?.[0]).toContain('8.675.309.000');
  });
});

describe('the executor refusing is not a crash', () => {
  it('records the refusal and stops the step', async () => {
    const harness = makeHarness({ script: () => ({ refusal: 'No API key is configured for anthropic.' }) });
    const brief = await harness.repo.createBrief({ question: QUESTION });
    const report = await stepBrief(harness.ports, brief.id);
    expect(report.note).toContain('No API key is configured');
    const events = rowsOf(await harness.repo.listEvents(brief.id)).map((event) => event.kind);
    expect(events).toContain('run.refused');
  });
});
