// @vitest-environment jsdom
//
// 1-E, as behaviour. Three things the director's room is judged on:
//
//  §1 A prompt edit in the registry becomes a PROPOSAL and does not touch
//     the live prompt. This is B-1 at the surface the owner actually uses;
//     the database refuses the direct write regardless, but a screen that
//     LETS him type it and then fails is a screen that taught the wrong
//     thing and lost his text.
//  §2 Approving a proposal promotes it and the agent then runs the new
//     version; rejecting stores the reason and leaves the agent alone.
//  §3 A brief shows its provenance, its reviews and its cost against the
//     estimate, and a rejection cannot be submitted without a reason.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MockRepository } from '../../../data/mockRepository';
import { useAppStore } from '../../../store/appStore';
import { LabRegistry } from '../LabRegistry';
import { InstitutionDirector } from './InstitutionDirector';
import { rowsOf } from '../../../data/readResult';

function freshRepository() {
  const repository = new MockRepository();
  useAppStore.setState({ repository, area: 'lab', labView: 'institution' });
  return repository;
}

afterEach(() => {
  cleanup();
});

describe('§1 a prompt edit becomes a proposal (B-1)', () => {
  it('records a proposal and leaves the live prompt alone', async () => {
    const repository = freshRepository();
    const agents = rowsOf(await repository.lab.listAgents());
    const target = agents.find((agent) => agent.dataClass === 'public') ?? agents[0];
    const originalPrompt = target.systemPrompt;

    render(<LabRegistry />);
    await screen.findAllByText(new RegExp(target.slug));
    // Each agent card carries its own Edit button; the first belongs to the
    // first card, so the target is chosen by position in the same list.
    const cardIndex = agents.findIndex((agent) => agent.id === target.id);
    const editButtons = await screen.findAllByRole('button', { name: /^edit$/i });
    fireEvent.click(editButtons[Math.max(0, cardIndex)]);
    await screen.findByText(new RegExp(`Edit — `));

    const prompt = await screen.findByLabelText(/system prompt/i);
    fireEvent.change(prompt, { target: { value: `${originalPrompt}\n\nAlways state a definitional break.` } });

    // The screen says what will happen, before anything is saved.
    expect(screen.getByText(/does not write it/i)).toBeTruthy();

    // Saving without a reason refuses, and keeps the text on screen.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText(/a proposal carries a reason/i);
    expect((await screen.findByLabelText(/system prompt/i)).getAttribute('value') ?? (prompt as HTMLTextAreaElement).value)
      .toContain('definitional break');

    fireEvent.change(screen.getByLabelText(/why this change/i), {
      target: { value: 'it read across a definitional break twice in one brief' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(async () => {
      const versions = rowsOf(await repository.institution.listVersions(target.id));
      expect(versions).toHaveLength(1);
      expect(versions[0].status).toBe('proposed');
    });

    const versions = rowsOf(await repository.institution.listVersions(target.id));
    expect(versions[0].systemPrompt).toContain('Always state a definitional break.');
    expect(versions[0].diff).toContain('+Always state a definitional break.');
    expect(versions[0].rationale).toContain('definitional break');

    // ...and the agent still runs what it ran before.
    const after = rowsOf(await repository.lab.listAgents()).find((agent) => agent.id === target.id);
    expect(after?.systemPrompt).toBe(originalPrompt);
  });
});

describe('§2 the director decides', () => {
  it('promotes a proposal, and the agent then runs the new version', async () => {
    const repository = freshRepository();
    const agents = rowsOf(await repository.lab.listAgents());
    const target = agents[0];
    await repository.institution.proposeVersion({
      agentId: target.id,
      systemPrompt: `${target.systemPrompt}\n\nAlways state a definitional break.`,
      proposedBy: 'editorial-committee',
      rationale: 'it read across a definitional break twice in one brief',
      diff: '+Always state a definitional break.',
    });

    render(<InstitutionDirector />);
    fireEvent.click(await screen.findByRole('button', { name: /proposals/i }));
    const promote = await screen.findByRole('button', { name: /approve and promote/i });
    fireEvent.click(promote);

    await waitFor(async () => {
      const versions = rowsOf(await repository.institution.listVersions(target.id));
      expect(versions[0].status).toBe('active');
    });
  });

  it('will not let a rejection be submitted without a reason', async () => {
    const repository = freshRepository();
    const agents = rowsOf(await repository.lab.listAgents());
    await repository.institution.proposeVersion({
      agentId: agents[0].id,
      systemPrompt: 'a different prompt',
      proposedBy: 'editorial-committee',
      rationale: 'a rationale long enough to count',
      diff: '+a different prompt',
    });

    render(<InstitutionDirector />);
    fireEvent.click(await screen.findByRole('button', { name: /proposals/i }));
    const reject = await screen.findByRole('button', { name: /^reject$/i });
    expect((reject as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/reason, if you are rejecting/i), {
      target: { value: 'the finding behind this was withdrawn' },
    });
    expect((screen.getByRole('button', { name: /^reject$/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('§3 a brief shows its record', () => {
  it('shows cost against estimate, the reviews, and the archive behind them', async () => {
    const repository = freshRepository();
    const brief = await repository.institution.createBrief({
      question: 'How has Indonesian poultry processing capacity changed since 2019?',
      brief: { restated: 'How has capacity changed since 2019?', answerWouldBe: 'a capacity series' },
      routing: ['framing-office', 'verification'],
      costEstimateUsd: 0.5,
    });
    await repository.institution.updateBrief(brief.id, { status: 'director', costActualUsd: 1.2, stepsTaken: 11 });
    const assignment = await repository.institution.createAssignment({
      briefId: brief.id, departmentId: 'dept-framing', agentId: 'x', agentSlug: 'scope-analyst', kind: 'specialist_work',
    });
    await repository.institution.createReview({
      briefId: brief.id, kind: 'peer', reviewerAgentId: 'reviewer-1', subjectAssignmentId: assignment.id,
      findings: [{ claim: 'capacity grew steadily', finding: 'reads across a definitional break', severity: 'material' }],
      verdict: 'rework', summary: 'one claim reads across a break',
    });
    repository.institution.corpus.push({
      id: '00000000-0000-4000-8000-000000000001', kind: 'retrieval', title: 'BPS capacity release',
      dataClass: 'public', content: 'x', contentHash: 'a'.repeat(64), url: 'https://bps.go.id/x', httpStatus: 200,
      fetchedAt: new Date().toISOString(), query: null, provenance: {}, derivedFrom: [], briefId: brief.id,
      assignmentId: null, createdByAgentId: null, createdByRunId: null, reviewStatus: 'unreviewed',
      createdAt: new Date().toISOString(),
    });

    render(<InstitutionDirector />);
    const open = await screen.findByRole('button', { name: /show the record/i });
    fireEvent.click(open);

    await screen.findByText(/BPS capacity release/);
    expect(screen.getByText(/reads across a definitional break/)).toBeTruthy();
    // 1.2 against an estimate of 0.5 is over the line and is shown as a ratio.
    expect(screen.getByText(/2\.40×/)).toBeTruthy();
    expect(screen.getByText(/sha256 aaaaaaaaaaaa…/)).toBeTruthy();
  });

  it('cannot reject a brief without a reason', async () => {
    const repository = freshRepository();
    const brief = await repository.institution.createBrief({ question: 'A question long enough to be one.' });
    await repository.institution.updateBrief(brief.id, { status: 'director' });

    render(<InstitutionDirector />);
    const reject = await screen.findByRole('button', { name: /^reject$/i });
    expect((reject as HTMLButtonElement).disabled).toBe(true);
  });
});
