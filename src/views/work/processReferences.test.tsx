// @vitest-environment jsdom
/**
 * §B.4, held programmatically.
 *
 * The load-bearing assertion is #3: collapsed, the block must cost the page
 * NOTHING. jsdom performs no layout, so a pixel measurement here would be a
 * fiction — every offsetHeight is 0 whether the fix works or not. What IS
 * decidable, and is actually the stronger claim, is STRUCTURAL: when closed,
 * the block contributes no element to the document flow between the scope row
 * and the toolbar, and its trigger lives inside the scope row that already
 * existed. A block that adds no box cannot add height, under any layout
 * engine. The DOM is compared against the same page rendered with the
 * references read absent — i.e. against the origin/main shape.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows, readAbsence, readThrew, type ReadResult } from '../../data/readResult';
import type { FinishLineItem, ProcessReference } from '../../data/types';
import {
  fixtureGates,
  fixtureLanes,
  fixtureNeeds,
  fixturePhases,
  fixtureStepItems,
  fixtureSteps,
  fixtureTracks,
} from '../../logic/process/seedFixture';
import { useAppStore } from '../../store/appStore';
import { FinishLine } from './FinishLine';
import { FinishLineNeeds } from './FinishLineNeeds';
import { FinishLineSwimlane } from './FinishLineSwimlane';

/** The one seeded row, as migration 20260806000054 inserts it. */
const SEEDED: ProcessReference = {
  id: 'driver-tree-construction',
  title: 'Driver Tree Construction',
  url: 'https://dikagustiana.com/finance/analytics/driver-tree-construction',
  note: 'Memetakan logika value creation jadi driver terkuantifikasi yang menghubungkan KPI ke line item',
  sortOrder: 1,
};

const SECOND: ProcessReference = {
  id: 'second',
  title: 'Kedua',
  url: 'https://dikagustiana.com/kedua',
  sortOrder: 2,
};

function repositoryWith(references: () => ReadResult<ProcessReference>): Repository {
  return {
    listProcessLanes: async () => okRows(fixtureLanes()),
    listProcessPhases: async () => okRows(fixturePhases()),
    listProcessSteps: async () => okRows(fixtureSteps()),
    listProcessGates: async () => okRows(fixtureGates()),
    listProcessNeeds: async () => okRows(fixtureNeeds()),
    listProcessStepItems: async () => okRows(fixtureStepItems()),
    listProcessTracks: async () => okRows(fixtureTracks()),
    listProcessReferences: async () => references(),
    listFinishLineItems: async () => okRows<FinishLineItem>([]),
  } as unknown as Repository;
}

const noop = () => {};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    },
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAppStore.setState({ prosesEntity: 'SAMB', prosesFocus: null });
});

function renderSwimlane(repository: Repository) {
  useAppStore.setState({ repository, prosesFocus: null });
  return render(<FinishLineSwimlane onClearItemFilter={noop} onOpenMatrix={noop} />);
}

function renderNeeds(repository: Repository) {
  useAppStore.setState({ repository, prosesFocus: null });
  return render(<FinishLineNeeds onOpenStep={noop} />);
}

const seeded = () => okRows([SEEDED, SECOND]);
const absent = () =>
  readAbsence('listProcessReferences', {
    code: '42P01',
    message: 'relation "public.os_process_references" does not exist',
  }) as ReadResult<ProcessReference>;

async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.getByRole('group', { name: 'Pilih entitas' })).toBeDefined();
  });
}

describe('§B.4.3 collapsed, the block occupies no space of its own', () => {
  it('adds no element to the flow between the scope row and the toolbar', async () => {
    // Baseline: the page as it renders WITHOUT the feature (table absent) —
    // the origin/main shape.
    const base = renderSwimlane(repositoryWith(absent));
    await waitForLoaded();
    const baseRow = base.container.querySelector('[data-scope-row]') as HTMLElement;
    const baseSiblings = [...(baseRow.parentElement?.children ?? [])].length;
    base.unmount();

    // With the feature and rows present, still closed by default.
    const withRefs = renderSwimlane(repositoryWith(seeded));
    await waitForLoaded();
    const row = withRefs.container.querySelector('[data-scope-row]') as HTMLElement;
    expect([...(row.parentElement?.children ?? [])].length).toBe(baseSiblings);

    // And the trigger is INSIDE the pre-existing scope row, not beside it.
    const toggle = screen.getByRole('button', { name: /Referensi/ });
    expect(row.contains(toggle)).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // No panel in the document at all — not a zero-height one, none.
    expect(document.getElementById('process-references-panel')).toBeNull();
  });

  it('opens into a panel below the scope row and above the toolbar', async () => {
    const { container } = renderSwimlane(repositoryWith(seeded));
    await waitForLoaded();
    fireEvent.click(screen.getByRole('button', { name: /Referensi/ }));

    const panel = await waitFor(() => {
      const found = document.getElementById('process-references-panel');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const row = container.querySelector('[data-scope-row]') as HTMLElement;
    const toolbar = container.querySelector('[aria-label="Kontrol swimlane"]') as HTMLElement;
    const order = [...(row.parentElement?.children ?? [])];
    expect(order.indexOf(row)).toBeLessThan(order.indexOf(panel));
    expect(order.indexOf(panel)).toBeLessThan(order.indexOf(toolbar));
  });
});

describe('§B.4.4 / §B.4.5 absent or empty renders nothing at all', () => {
  it('shows no block and no message when the table is missing (42P01), console clean', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(noop);
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    try {
      const { container } = renderSwimlane(repositoryWith(absent));
      await waitForLoaded();
      // The rest of the page renders normally.
      await waitFor(() => {
        expect(container.querySelectorAll('[data-step-label]').length).toBe(30);
      });
      expect(screen.queryByRole('button', { name: /Referensi/ })).toBeNull();
      expect(screen.queryByText(/Referensi/)).toBeNull();
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it('shows no block when the table exists with zero rows', async () => {
    renderNeeds(repositoryWith(() => okRows<ProcessReference>([])));
    await waitForLoaded();
    expect(screen.queryByRole('button', { name: /Referensi/ })).toBeNull();
  });

  it('but a REAL failure still says so — emptiness is not a costume for failure', async () => {
    renderNeeds(
      repositoryWith(
        () => readThrew('listProcessReferences', new Error('network down')) as ReadResult<ProcessReference>,
      ),
    );
    await waitForLoaded();
    expect(screen.getByText('Referensi tidak bisa dimuat')).toBeDefined();
  });
});

describe('§B.3 the rows themselves', () => {
  it('links out safely, in sort_order, with the note under the title', async () => {
    renderSwimlane(repositoryWith(seeded));
    await waitForLoaded();
    fireEvent.click(screen.getByRole('button', { name: /Referensi/ }));

    const first = await screen.findByRole('link', { name: SEEDED.title });
    expect(first.getAttribute('href')).toBe(SEEDED.url);
    expect(first.getAttribute('target')).toBe('_blank');
    expect(first.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(SEEDED.note as string)).toBeDefined();

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([SEEDED.title, SECOND.title]);
    // A row with no note renders no empty line for it.
    const panel = document.getElementById('process-references-panel') as HTMLElement;
    expect(panel.querySelectorAll('p').length).toBe(1);
  });

  it('appears on both process tabs', async () => {
    const swimlane = renderSwimlane(repositoryWith(seeded));
    await waitForLoaded();
    expect(screen.getByRole('button', { name: /Referensi/ })).toBeDefined();
    swimlane.unmount();

    renderNeeds(repositoryWith(seeded));
    await waitForLoaded();
    expect(screen.getByRole('button', { name: /Referensi/ })).toBeDefined();
  });
});

describe('§B.4.6 the Matrix tab does not carry it', () => {
  it('renders no Referensi block on the matrix', async () => {
    useAppStore.setState({ repository: repositoryWith(seeded), prosesFocus: null });
    render(<FinishLine onOpenSwimlane={noop} />);
    // The matrix has its own reads; whatever it manages to render, the
    // references block is not part of it.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Referensi/ })).toBeNull();
    });
  });
});
