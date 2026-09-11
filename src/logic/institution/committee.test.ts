// Phase 5: the committee, the debate, the proposals and the evaluation
// set. The assertions that matter are the ones about what does NOT happen:
// no live prompt changes, no disagreement evaporates, no agent grades
// anyone.

import { describe, expect, it } from 'vitest';
import { promoteWithEvaluations, runBrief, runEvaluations, meanScore } from './runner';
import {
  fence,
  leadAccepts,
  makeHarness,
  programIntake,
  review,
  specialistWork,
  submission,
  type ScriptedCall,
} from './runnerFixtures';
import { rowsOf } from '../../data/readResult';

const QUESTION = 'How has Indonesian poultry processing capacity changed since 2019?';

const FINDING = {
  claim: 'Capacity grew steadily from 2019.',
  finding: 'the series has a definitional break in 2021 and the sentence reads across it',
  severity: 'material',
  suggestedFix: 'state the break and give the two segments separately',
};

const PROPOSAL = {
  agentSlug: 'scope-analyst',
  rationale: 'it read across a definitional break, twice in this brief, and its instructions never mention breaks',
  change: 'When a series changes definition mid-window, say so at the break year and never describe growth across it as one trend.',
};

const SELF_PROPOSAL = {
  agentSlug: 'editorial-committee',
  rationale: 'the accepted rebuttal showed the finding rested on a misreading of the submission, not on the work',
  change: 'Before making a finding against a figure, quote the submission line it comes from, so a misreading is visible as a misquote.',
};

/** A full-class run that reaches the committee, is contested, and is weighed. */
const committeeScript = (weighOutcome: 'accepted' | 'rejected') => (call: ScriptedCall): string => {
  const { prompt, agentSlug } = call;
  if (prompt.includes('You are the Program Office of a research institution')) {
    return programIntake({ weightClass: 'full', routing: ['framing-office'] });
  }
  if (prompt.includes('Accept this assignment, or return it')) {
    return agentSlug === 'framing-lead'
      ? leadAccepts(['scope-analyst'], { 'scope-analyst': 'draw the boundary' })
      : leadAccepts(['numeric-auditor'], { 'numeric-auditor': 'check the arithmetic' });
  }
  if (prompt.includes('YOUR ASSIGNMENT FROM THE LEAD')) return specialistWork(`${agentSlug} produced its part`);
  if (prompt.includes('reviewing a sibling')) return review('accept', 'supported');
  if (prompt.includes('reviewing your department')) return review('accept', 'accepted');
  if (prompt.includes('Write the submission')) return submission();
  // The weighing prompt also opens with "You are the Editorial Committee",
  // so it is matched FIRST here. (A model reads the whole prompt; a
  // fixture matching on a prefix does not, and getting this wrong made
  // every rebuttal read as unweighed.)
  if (prompt.includes('These parties have contested your findings')) {
    const ids = [...prompt.matchAll(/\(([0-9a-z-]+)\)/g)].map((match) => match[1]);
    return fence({
      weighings: ids.map((id) => ({
        id,
        outcome: weighOutcome,
        weighing: weighOutcome === 'accepted'
          ? 'the uncertainties line does state the break'
          : 'the produced line is what the next department reads',
      })),
      proposals: weighOutcome === 'accepted' ? [SELF_PROPOSAL] : [],
    });
  }
  if (prompt.includes('You are the Editorial Committee')) {
    return fence({
      verdict: 'rework',
      summary: 'one claim reads across a definitional break',
      findings: [FINDING],
      proposals: [PROPOSAL],
    });
  }
  if (prompt.includes('has made findings against your work')) {
    return fence({ contest: true, rebuttal: 'The submission states the break in its uncertainties line; the finding reads only the produced line.' });
  }
  return review('escalate', 'unexpected prompt');
};

async function runFullClass(weighOutcome: 'accepted' | 'rejected' = 'accepted') {
  const harness = makeHarness({ script: committeeScript(weighOutcome) });
  const brief = await harness.repo.createBrief({ question: QUESTION });
  const reports = await runBrief(harness.ports, brief.id, { maxSteps: 60 });
  return { harness, brief, reports };
}

describe('the committee reviews, and nothing it says changes anything by itself', () => {
  it('reviews after every department has submitted, with per-claim findings', async () => {
    const { harness, brief } = await runFullClass();
    const committee = rowsOf(await harness.repo.listReviews(brief.id)).filter((entry) => entry.kind === 'committee');
    expect(committee).toHaveLength(1);
    expect(committee[0].findings[0].claim).toBe(FINDING.claim);
    expect(committee[0].verdict).toBe('rework');
  });

  it('records its proposals as proposals — no live prompt changes', async () => {
    const { harness } = await runFullClass();
    const versions = rowsOf(await harness.repo.listVersions());
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) expect(version.status).toBe('proposed');
    const target = versions.find((version) => version.agentId === 'a-scope');
    expect(target?.rationale).toContain('definitional break');
    expect(target?.systemPrompt).toContain('You draw the scope boundary.'); // the old text is still there
    expect(target?.systemPrompt).toContain('never describe growth across it as one trend');
    // ...and the agent itself is untouched.
    const agents = await harness.ports.listAgents();
    expect(agents.find((agent) => agent.slug === 'scope-analyst')?.systemPrompt).toBe('You draw the scope boundary.');
  });

  it('lets every reviewed party contest, and weighs each with a reason recorded', async () => {
    const { harness, brief } = await runFullClass('accepted');
    const debates = rowsOf(await harness.repo.listDebates(brief.id));
    // Both specialists whose work was submitted were reviewed, so both may
    // contest; the committee weighs each one rather than the first.
    expect(debates.length).toBeGreaterThanOrEqual(1);
    for (const debate of debates) {
      expect(debate.outcome).toBe('accepted');
      expect(debate.weighing).toContain('uncertainties line');
    }
  });

  it('accepts a rebuttal and can propose against itself for it (B-2)', async () => {
    const { harness } = await runFullClass('accepted');
    const versions = rowsOf(await harness.repo.listVersions());
    const self = versions.find((version) => version.agentId === 'a-committee');
    expect(self).toBeDefined();
    expect(self?.status).toBe('proposed');
    expect(self?.proposedByAgentId).toBe('a-committee');
  });

  it('sends a standing disagreement to the director rather than looping (B-5)', async () => {
    const { harness, brief, reports } = await runFullClass('rejected');
    expect(reports[reports.length - 1].action).toBe('to_director');
    expect((await harness.repo.getBrief(brief.id))?.status).toBe('director');
    const debates = rowsOf(await harness.repo.listDebates(brief.id));
    expect(debates.every((debate) => debate.outcome !== null)).toBe(true);
  });

  it('records the debate in the event log the floor reads', async () => {
    const { harness, brief } = await runFullClass();
    const kinds = rowsOf(await harness.repo.listEvents(brief.id)).map((event) => event.kind);
    expect(kinds).toContain('review.committee');
    expect(kinds).toContain('debate.filed');
    expect(kinds).toContain('debate.weighed');
  });
});

describe('the held-fixed evaluation set (B-9)', () => {
  const evalHarness = () => {
    const harness = makeHarness({ script: () => 'CAGR is (end/start)^(1/years) - 1 and it misleads across a structural break.' });
    harness.repo.evaluations.push(
      { id: 'e1', slug: 'eval-method-cagr', departmentSlug: 'methodology-desk', task: 'Explain CAGR.', expectedAnswer: '...', weight: 1, isActive: true },
      { id: 'e2', slug: 'eval-bounded-review', departmentSlug: 'framing-office', task: 'Restate the question.', expectedAnswer: '...', weight: 1, isActive: true },
      { id: 'e3', slug: 'eval-retired', departmentSlug: null, task: 'Old.', expectedAnswer: '...', weight: 1, isActive: false },
    );
    return harness;
  };

  it('runs only the active evaluations and records an answer for each', async () => {
    const harness = evalHarness();
    const agent = (await harness.ports.listAgents())[1];
    const outcomes = await runEvaluations(harness.ports, agent, 'baseline', null);
    expect(outcomes.map((outcome) => outcome.evaluationSlug)).toEqual(['eval-method-cagr', 'eval-bounded-review']);
    expect(rowsOf(await harness.repo.listEvaluationRuns(agent.id))).toHaveLength(2);
  });

  it('never computes a score in the client — it asks the database and takes the number back', async () => {
    const harness = evalHarness();
    const agent = (await harness.ports.listAgents())[1];
    const outcomes = await runEvaluations(harness.ports, agent, 'baseline', null);
    for (const outcome of outcomes) expect(outcome.score).toBe(1);
    expect(meanScore(outcomes)).toBe(1);
  });

  it('leaves a refused run unscored rather than averaging it in as a zero', async () => {
    const harness = makeHarness({ script: () => ({ refusal: 'No API key is configured.' }) });
    harness.repo.evaluations.push({ id: 'e1', slug: 'eval-method-cagr', departmentSlug: null, task: 'Explain CAGR.', expectedAnswer: '...', weight: 1, isActive: true });
    const agent = (await harness.ports.listAgents())[1];
    const outcomes = await runEvaluations(harness.ports, agent, 'before', null);
    expect(outcomes[0].score).toBeNull();
    expect(meanScore(outcomes)).toBeNull();
  });

  it('scores before the promotion and again after it, and says which way it moved', async () => {
    const harness = evalHarness();
    const agent = (await harness.ports.listAgents())[1];
    const version = await harness.repo.proposeVersion({
      agentId: agent.id,
      systemPrompt: `${agent.systemPrompt}\n\nAlways state a definitional break.`,
      proposedBy: 'editorial-committee',
      rationale: 'it read across a break twice in one brief',
      diff: '+ Always state a definitional break.',
    });
    const result = await promoteWithEvaluations(harness.ports, version.id, agent);
    expect(result.promoted).toBe(true);
    expect(result.before).toBe(1);
    expect(result.after).toBe(1);
    expect(result.note).toContain('did not move');

    const stored = rowsOf(await harness.repo.listVersions(agent.id)).find((row) => row.id === version.id);
    expect(stored?.status).toBe('active');
    expect(stored?.evalScoreBefore).toBe(1);
    expect(stored?.evalScoreAfter).toBe(1);

    // The before-phase runs were recorded against the OLD prompt: they
    // exist before the promotion, which is the only thing that makes a
    // before-and-after mean anything.
    const runs = rowsOf(await harness.repo.listEvaluationRuns(agent.id));
    expect(runs.filter((run) => run.phase === 'before')).toHaveLength(2);
    expect(runs.filter((run) => run.phase === 'after')).toHaveLength(2);
  });

  it('refuses to promote a version twice', async () => {
    const harness = evalHarness();
    const agent = (await harness.ports.listAgents())[1];
    const version = await harness.repo.proposeVersion({
      agentId: agent.id, systemPrompt: 'new prompt', proposedBy: 'committee',
      rationale: 'a rationale long enough', diff: '+new',
    });
    await harness.repo.promoteVersion(version.id);
    await expect(harness.repo.promoteVersion(version.id)).rejects.toThrow(/not proposed/);
  });

  it('stores a rejection reason and leaves the agent unchanged', async () => {
    const harness = evalHarness();
    const agent = (await harness.ports.listAgents())[1];
    const version = await harness.repo.proposeVersion({
      agentId: agent.id, systemPrompt: 'new prompt', proposedBy: 'committee',
      rationale: 'a rationale long enough', diff: '+new',
    });
    await harness.repo.rejectVersion(version.id, 'the finding behind this was withdrawn');
    const stored = rowsOf(await harness.repo.listVersions(agent.id)).find((row) => row.id === version.id);
    expect(stored?.status).toBe('rejected');
    expect(stored?.rejectedReason).toContain('withdrawn');
    const agents = await harness.ports.listAgents();
    expect(agents.find((entry) => entry.id === agent.id)?.systemPrompt).toBe(agent.systemPrompt);
  });

  it('refuses a proposal with no rationale or no diff', async () => {
    const harness = evalHarness();
    await expect(harness.repo.proposeVersion({
      agentId: 'a-scope', systemPrompt: 'x', proposedBy: 'committee', rationale: 'short', diff: '+x',
    })).rejects.toThrow(/B-1/);
  });
});
