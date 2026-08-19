// @vitest-environment jsdom
//
// Gate 5's acceptance items, executable:
//
//  §1 Thirteen ordinal segments render, derived by query — no tracking
//     table exists to read (MockRepository holds only the epistemic rows).
//  §2 A blocked stage names its blocker AND the record id on the surface.
//  §3 The WIP figure shows as a METER against the known cap — and no
//     work-completion progress exists anywhere (no progressbar, no ETA).
//  §4 Penolakan renders from refusals PERSISTED on run rows, so a fresh
//     mount (the reload analog — nothing but repository rows feeds it)
//     still shows them. The live column was proven by SQL probe; this
//     proves the surface reads the rows, not the response body.
//  §5 A chain advances station to station via the live store, and a
//     mid-run failure keeps the view loudly non-idle with the server text.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MockRepository, mockRepository } from '../../../data/mockRepository';
import { okRows } from '../../../data/readResult';
import type { LabProject } from '../../../data/labEvidenceTypes';
import { useAppStore } from '../../../store/appStore';
import { useLabLiveStore } from '../../../store/labLiveStore';
import { freshInstallRepository } from '../__fixtures__/freshInstallRepository';
import { LabFlow } from './LabFlow';

async function mountFlow(repository = new MockRepository()) {
  useAppStore.setState({ repository, area: 'lab', labView: 'flow' });
  render(<LabFlow />);
  await waitFor(() => screen.getByRole('group', { name: /13 tahap berurutan/ }));
  return repository;
}

afterEach(() => {
  cleanup();
  useLabLiveStore.setState({ live: null, lastOutcome: null, generation: 0 });
  useAppStore.setState({ repository: mockRepository, area: 'work', labView: 'registry' });
});

describe('§1 position is counted, never estimated', () => {
  it('renders 13 track segments and the floorplan, front line at the verification queue', async () => {
    await mountFlow();
    const track = screen.getByRole('group', { name: /13 tahap berurutan/ });
    expect(track.querySelectorAll('button')).toHaveLength(13);
    // The worked example: sources + datapoints exist, one IND waits — the
    // front line is the owner's queue at S5, exactly the screen's point.
    expect(screen.getAllByText(/S5 Verifikasi/).length).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: /Denah lantai pipeline/ })).toBeTruthy();
  });

  it('tokens stand only where agents actually ran — no idle-agent crowd', async () => {
    await mountFlow();
    const floor = screen.getByRole('group', { name: /Denah lantai pipeline/ });
    // Mock runs: extractor and drafter ran; scout/literature/locator never
    // did. Their stations carry no token cubes.
    expect(floor.querySelector('g[aria-label^="S4"] title')?.textContent).toBe('evidence-extractor');
    expect(floor.querySelector('g[aria-label^="S3"] title')).toBeNull();
    expect(floor.querySelector('g[aria-label^="S2"] title')).toBeNull();
  });
});

describe('§2 a blocked stage names its blocker and the record', () => {
  it('an open DIRECT contradiction bars S10 with the contradiction and claim ids on screen', async () => {
    const repository = new MockRepository();
    const contradiction = await repository.labEvidence.createContradiction({
      claimAId: 'ev-claim-approved',
      claimBId: 'ev-claim-draft',
      severity: 'direct',
    });
    await mountFlow(repository);
    fireEvent.click(screen.getByRole('button', { name: /^S10 Approve: blocked/ }));
    const detail = await screen.findByText(/stasiun manusia · blocked/);
    expect(detail).toBeTruthy();
    expect(screen.getAllByText(new RegExp(contradiction.id)).length).toBeGreaterThan(0);
    expect(screen.getByText(/record: ev-claim-draft/)).toBeTruthy();
  });
});

describe('§3 the WIP figure is a meter; work-completion progress does not exist', () => {
  it('shows IND against the KNOWN cap and renders no progressbar or ETA anywhere', async () => {
    await mountFlow();
    const meter = screen.getByRole('meter', { name: /Antrean IND/ });
    expect(meter.getAttribute('aria-valuenow')).toBe('1');
    expect(meter.getAttribute('aria-valuemax')).toBe('25');
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
    expect(screen.queryByText(/ETA|estimasi selesai|selesai dalam/i)).toBeNull();
  });
});

describe('§4 Penolakan reads the persisted run rows', () => {
  it('a fresh mount shows the echo-check and G-NUMBER refusals, quiet, with their count', async () => {
    await mountFlow();
    fireEvent.click(screen.getByRole('tab', { name: /Penolakan \(2\)/ }));
    expect(await screen.findByText(/echo check: this number does not appear/)).toBeTruthy();
    expect(screen.getByText(/G-NUMBER: no datapoint stands behind it/)).toBeTruthy();
    // Quiet monospace, not an error tone: the line is not styled destructive.
    const line = screen.getByText(/echo check: this number does not appear/);
    expect(line.className).not.toContain('destructive');
  });
});

describe('§5 a chain advances station to station, and a failure never leaves the view idle', () => {
  it('the banner and log follow each step, then surface the mid-run failure verbatim', async () => {
    await mountFlow();

    act(() => {
      useLabLiveStore.getState().start({
        agentSlug: 'evidence-locator',
        action: 'run',
        chainId: 'chain-1',
        stepIndex: 0,
        stepCount: 2,
      });
    });
    expect((await screen.findAllByText(/langkah 1 dari 2/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/evidence-locator/).length).toBeGreaterThan(0);

    // Step 1 completes; step 2 dispatches — the marker moves to the next
    // station (S3 → S4; the station mapping itself is pinned in
    // labFlowState.test.ts).
    act(() => {
      useLabLiveStore.getState().end({ agentSlug: 'evidence-locator', action: 'run', ok: true, chainId: 'chain-1', stepIndex: 0 });
      useLabLiveStore.getState().start({
        agentSlug: 'evidence-extractor',
        action: 'run',
        chainId: 'chain-1',
        stepIndex: 1,
        stepCount: 2,
      });
    });
    expect((await screen.findAllByText(/langkah 2 dari 2/)).length).toBeGreaterThan(0);

    // The same chain, failing mid-run: the row's error text stays on
    // screen — a failed run must never leave the view looking idle.
    act(() => {
      useLabLiveStore.getState().end({
        agentSlug: 'evidence-extractor',
        action: 'run',
        ok: false,
        error: 'Model call failed (429).',
        chainId: 'chain-1',
        stepIndex: 1,
      });
    });
    expect(await screen.findByText(/evidence-extractor gagal di langkah 2/)).toBeTruthy();
    expect(screen.getByText('Model call failed (429).')).toBeTruthy();
  });
});

describe('§6 empty is an answer — a fresh install renders, it never hangs at Checking', () => {
  // The live failure this reproduces (2026-08-19, os.dikagustiana.com):
  // os_lab_projects held ZERO rows, every read returned ok, and the Flow
  // tab sat at `Checking…` forever. readResult.ts's doctrine names the
  // conflation: `Checking` means A READ HAS NOT RETURNED. Here every read
  // HAD returned — the database was simply empty, and emptiness is a fact
  // to render in words, never a spinner.

  it('zero projects, every Lab table empty: the screen says what that MEANS, and Checking is gone', async () => {
    useAppStore.setState({ repository: freshInstallRepository(), area: 'lab', labView: 'flow' });
    render(<LabFlow />);
    // The meaning of this emptiness, in words — not a spinner, not an error.
    expect(await screen.findByText(/Belum ada proyek riset/)).toBeTruthy();
    expect(screen.queryByText('Checking…')).toBeNull();
    expect(screen.queryByText('Could not check')).toBeNull();
  });

  it('one project, every other table empty: 13 stages render and the sweep line reads "belum pernah tercatat" — not an error, not 0 jam', async () => {
    const repository = freshInstallRepository();
    repository.labEvidence.listProjects = async () =>
      okRows<LabProject>([
        { id: 'p-fresh', name: 'Proyek pertama', researchQuestion: '', status: 'active', wipSlot: null },
      ]);
    useAppStore.setState({ repository, area: 'lab', labView: 'flow' });
    render(<LabFlow />);
    const track = await screen.findByRole('group', { name: /13 tahap berurutan/ });
    expect(track.querySelectorAll('button')).toHaveLength(13);
    // An empty sweep log means the sweep has never run — say that, and
    // never dress the absence up as an age of zero hours. (The line shows
    // on more than one surface — rail and console read the same state.)
    expect(screen.getAllByText(/belum pernah tercatat/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0 jam/)).toBeNull();
    expect(screen.queryByText('Could not check')).toBeNull();
    expect(screen.queryByText('Checking…')).toBeNull();
  });

  it('a rejected core read renders Could not check WITH the error text — never Checking, never zeros', async () => {
    const repository = new MockRepository();
    repository.labEvidence.listDatapoints = async () => ({
      ok: false,
      reason: 'failed',
      detail: 'listDatapoints: 42501 — izin ditolak (RLS atau grant), bukan data kosong',
    });
    useAppStore.setState({ repository, area: 'lab', labView: 'flow' });
    render(<LabFlow />);
    expect(await screen.findByText('Could not check')).toBeTruthy();
    expect(screen.getByText(/42501 — izin ditolak/)).toBeTruthy();
    expect(screen.queryByText('Checking…')).toBeNull();
    expect(screen.queryByRole('group', { name: /13 tahap berurutan/ })).toBeNull();
  });

  it('a core read that THROWS lands as Could not check too — a rejected promise must never hang the screen silent', async () => {
    const repository = new MockRepository();
    repository.labEvidence.listClaims = async () => {
      throw new Error('fetch failed: network unreachable');
    };
    useAppStore.setState({ repository, area: 'lab', labView: 'flow' });
    render(<LabFlow />);
    expect(await screen.findByText('Could not check')).toBeTruthy();
    expect(screen.getByText(/listClaims: fetch failed: network unreachable/)).toBeTruthy();
    expect(screen.queryByText('Checking…')).toBeNull();
  });
});
