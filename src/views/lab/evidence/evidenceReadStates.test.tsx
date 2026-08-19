// @vitest-environment jsdom
//
// The read-state gate on the Evidence tabs, per readResult.ts: a tab's
// collections have THREE outcomes — value, empty, failed — and a failed
// read must reach the surface as COULD NOT CHECK with the error text,
// never as an empty list. Before this gate, rowsOr() inside every tab
// dressed a refused read as zeros — the exact lie the doctrine names,
// on the screens that count problems (IND queues, conflicts, blocks).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MockRepository, mockRepository } from '../../../data/mockRepository';
import { useAppStore } from '../../../store/appStore';
import { LabEvidence } from './LabEvidence';

function mount(repository: MockRepository) {
  useAppStore.setState({ repository, area: 'lab', labView: 'evidence' });
  render(<LabEvidence />);
}

afterEach(() => {
  cleanup();
  useAppStore.setState({ repository: mockRepository, area: 'work', labView: 'registry' });
});

describe('a failed collection read reaches the tab as Could not check, with the error text', () => {
  it('a ReadFailure on datapoints darkens the default tab and shows the detail', async () => {
    const repository = new MockRepository();
    repository.labEvidence.listDatapoints = async () => ({
      ok: false,
      reason: 'failed',
      detail: 'listDatapoints: 42501 — izin ditolak (RLS atau grant), bukan data kosong',
    });
    mount(repository);
    expect(await screen.findByText('Could not check')).toBeTruthy();
    expect(screen.getByText(/42501 — izin ditolak/)).toBeTruthy();
  });

  it('a read that THROWS lands as a failure too — never an eternal Checking, never zeros', async () => {
    const repository = new MockRepository();
    repository.labEvidence.listConflicts = async () => {
      throw new Error('fetch failed: network unreachable');
    };
    mount(repository);
    expect(await screen.findByText('Could not check')).toBeTruthy();
    expect(screen.getByText(/listConflicts: fetch failed: network unreachable/)).toBeTruthy();
  });

  it('the failure darkens ONLY the tabs that read the collection', async () => {
    const repository = new MockRepository();
    repository.labEvidence.listModelResults = async () => ({
      ok: false,
      reason: 'failed',
      detail: 'listModelResults: PGRST205 — tabel tidak ada di schema cache PostgREST',
    });
    mount(repository);
    // Datapoints (the default tab) does not read modelResults: it renders
    // its rows, no gate.
    await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull());
    expect(screen.queryByText('Could not check')).toBeNull();
    // Models DOES read it: the gate stands with the detail on screen.
    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
    expect(await screen.findByText('Could not check')).toBeTruthy();
    expect(screen.getByText(/PGRST205/)).toBeTruthy();
  });
});
