// @vitest-environment jsdom
//
// The two Lab screen behaviours the brief names as done-or-not-done:
//
//  §1 The registry surfaces the four known phantom dependencies ON FIRST
//     LOAD, against the same seed shape production carries. If these four
//     stop appearing, the parser is wrong — that is the brief's own test.
//
//  §2 The run screen's provider selector is DISABLED for an internal agent,
//     with the reason in always-visible text. The selector is only layer 3
//     of the boundary, but it is the layer a person sees, and a selector
//     that offers DeepSeek for internal data teaches the owner the boundary
//     is negotiable.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockRepository } from '../../data/mockRepository';
import { useAppStore } from '../../store/appStore';
import { LabRegistry } from './LabRegistry';
import { LabRun } from './LabRun';

afterEach(() => {
  cleanup();
  useAppStore.setState({
    repository: mockRepository,
    area: 'lab',
    labView: 'registry',
    labRunFocus: null,
    labLogFocus: null,
  });
});

describe('§1 the registry integrity banner', () => {
  it('surfaces exactly the four ground-truth phantoms on first load', async () => {
    render(<LabRegistry />);
    await screen.findByText(/phantom dependenc/i);
    const banner = screen.getByText(/Referenced by prompts or chains/i);
    for (const slug of [
      'financial-modeling',
      'verify-financial-model',
      'consolidation-reporting',
      'deck-narrative-drafter',
    ]) {
      expect(banner.textContent).toContain(slug);
    }
    // And none of the agents that DO exist read as phantoms.
    expect(banner.textContent).not.toContain('senior-finance-analyst');
  });

  it('badges the referencing card, not just the summary', async () => {
    render(<LabRegistry />);
    await screen.findByText('Senior Finance Analyst');
    const badges = screen.getAllByText(/phantoms?$/i);
    expect(badges.length).toBeGreaterThan(0);
  });
});

describe('§2 the run screen provider selector', () => {
  it('locks an internal agent to Anthropic and says why, visibly', async () => {
    render(<LabRun />);
    const agentSelect = (await screen.findByLabelText('Agent')) as HTMLSelectElement;
    fireEvent.change(agentSelect, { target: { value: 'senior-finance-analyst' } });

    const providerSelect = screen.getByLabelText(/Provider/) as HTMLSelectElement;
    await waitFor(() => expect(providerSelect.disabled).toBe(true));
    // The reason is a sentence on the page — not a hover-only tooltip,
    // which does not exist on touch.
    expect(
      screen.getAllByText(/Internal data — Anthropic only/i).length,
    ).toBeGreaterThan(0);
  });

  it('leaves the selector open for a public agent', async () => {
    render(<LabRun />);
    const agentSelect = (await screen.findByLabelText('Agent')) as HTMLSelectElement;
    fireEvent.change(agentSelect, { target: { value: 'ceo-briefing-deck' } });
    const providerSelect = screen.getByLabelText(/Provider/) as HTMLSelectElement;
    await waitFor(() => expect(providerSelect.disabled).toBe(false));
  });
});
