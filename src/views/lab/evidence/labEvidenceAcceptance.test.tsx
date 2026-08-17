// @vitest-environment jsdom
//
// THE BRIEF'S ACCEPTANCE TEST, verbatim: "The system passes when an attempt
// to generate a draft containing a figure with no backing datapoint is
// blocked, the blocking message names the specific offending number, and
// the only route forward is either creating a verified datapoint or
// explicitly tagging the figure as a layer C inference."
//
// Runs against the mock repository, which enforces the same shared gate
// logic as the live path; the SQL suite proves the database holds with the
// whole client bypassed. The mock's worked example: datapoint 7.3 (V,
// backing the approved cited claim) — so 7.3 passes and anything else must
// be blocked by name.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MockRepository } from '../../../data/mockRepository';
import { useAppStore } from '../../../store/appStore';
import { LabEvidence } from './LabEvidence';

function mountOutputsTab() {
  useAppStore.setState({ repository: new MockRepository(), area: 'lab', labView: 'evidence' });
  render(<LabEvidence />);
  return waitFor(() => screen.getByRole('tab', { name: 'Outputs' }));
}

afterEach(() => {
  cleanup();
  useAppStore.setState({ repository: new MockRepository(), area: 'work', labView: 'registry' });
});

describe('the acceptance test: an unbacked figure cannot leave the system', () => {
  it('blocks the save, names the offending number, and offers the two routes forward', async () => {
    const outputsTab = await mountOutputsTab();
    fireEvent.click(outputsTab);
    // The output card is a button; 'briefing' also appears as a <option>
    // in the new-output select, so target the role.
    fireEvent.click(await screen.findByRole('button', { name: /briefing/ }));

    const editor = await screen.findByLabelText(/Content/);
    fireEvent.change(editor, {
      target: { value: 'Utilisation stands at 7.3 percent. Capacity reached 9,100 units.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    // Blocked, with the SPECIFIC number named — and only that number: 7.3
    // is backed by the cited claim's verified datapoint.
    const panel = await screen.findByRole('alert');
    expect(within(panel).getByText('9,100')).toBeTruthy();
    expect(within(panel).queryByText('7.3')).toBeNull();
    // The two routes forward are stated in the panel itself.
    expect(panel.textContent).toContain('[C]');
    expect(panel.textContent).toContain('datapoint');

    // And nothing was saved: the mock's output content is untouched.
    const outputs = await useAppStore.getState().repository.labEvidence.listOutputs();
    expect(outputs.ok && outputs.rows[0].content).toBe('');
  });

  it('route forward №2: tagging the figure as a layer C inference unblocks the save', async () => {
    const outputsTab = await mountOutputsTab();
    fireEvent.click(outputsTab);
    // The output card is a button; 'briefing' also appears as a <option>
    // in the new-output select, so target the role.
    fireEvent.click(await screen.findByRole('button', { name: /briefing/ }));

    const editor = await screen.findByLabelText(/Content/);
    fireEvent.change(editor, {
      target: { value: 'Utilisation stands at 7.3 percent. Capacity reached 9,100 [C] units.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(async () => {
      const outputs = await useAppStore.getState().repository.labEvidence.listOutputs();
      expect(outputs.ok && outputs.rows[0].content).toContain('9,100 [C]');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('route forward №1: a figure backed by a cited claim′s verified datapoint saves cleanly', async () => {
    const outputsTab = await mountOutputsTab();
    fireEvent.click(outputsTab);
    // The output card is a button; 'briefing' also appears as a <option>
    // in the new-output select, so target the role.
    fireEvent.click(await screen.findByRole('button', { name: /briefing/ }));

    const editor = await screen.findByLabelText(/Content/);
    fireEvent.change(editor, {
      target: { value: 'In 2025 utilisation stood at 7.3 percent.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(async () => {
      const outputs = await useAppStore.getState().repository.labEvidence.listOutputs();
      expect(outputs.ok && outputs.rows[0].content).toContain('7.3');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
