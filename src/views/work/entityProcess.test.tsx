// @vitest-environment jsdom
/**
 * §6 lintas entitas, held in the DOM — the four properties a rework is most
 * likely to break silently:
 *
 *   2. Switching entity RE-MEASURES: after ARBI → SAMB no arrow may anchor
 *      at an ARBI box coordinate. The layout stub gives the two entities
 *      DISJOINT x ranges (ARBI boxes at x ≥ 50 000), so a stale wire is
 *      detectable arithmetically, not by eye.
 *   4. The jalur buttons are the entity's own: SAMB offers TRADE/LP and
 *      never FORWARD; ARBI offers FORWARD/REVERSE and never TRADE.
 *   5. The pre-52 window (tracks table absent, rows tagged SAMB by the
 *      repository fallback) renders SAMB exactly as before PLUS one visible
 *      notice line — and nothing reaches the console.
 *   7. Entity binds ACROSS the two tabs while jalur does not: LP picked on
 *      the swimlane leaves the register at Semua with all 118 rows; ARBI
 *      picked on the register carries into the swimlane.
 *
 * Fixtures are both seed fixtures — what migrations 51 and 53 insert.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows, readAbsence, type ReadResult } from '../../data/readResult';
import type { FinishLineItem, ProcessReference, ProcessTrackDef } from '../../data/types';
import {
  arbiGates,
  arbiLanes,
  arbiNeeds,
  arbiPhases,
  arbiStepItems,
  arbiSteps,
  arbiTracks,
} from '../../logic/process/arbiFixture';
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
import { FinishLineNeeds } from './FinishLineNeeds';
import { FinishLineSwimlane } from './FinishLineSwimlane';

/** ARBI boxes live at x ≥ this; SAMB boxes stay far below it. */
const ARBI_X_BASE = 50_000;

function bothEntitiesRepository(): Repository {
  return {
    listProcessLanes: async () => okRows([...fixtureLanes(), ...arbiLanes()]),
    listProcessPhases: async () => okRows([...fixturePhases(), ...arbiPhases()]),
    listProcessSteps: async () => okRows([...fixtureSteps(), ...arbiSteps()]),
    listProcessGates: async () => okRows([...fixtureGates(), ...arbiGates()]),
    listProcessNeeds: async () => okRows([...fixtureNeeds(), ...arbiNeeds()]),
    listProcessStepItems: async () => okRows([...fixtureStepItems(), ...arbiStepItems()]),
    listProcessTracks: async () => okRows([...fixtureTracks(), ...arbiTracks()]),
    listProcessForms: async () => okRows([]),
    listProcessReferences: async () => okRows<ProcessReference>([]),
    listFinishLineItems: async () => okRows<FinishLineItem>([]),
  } as unknown as Repository;
}

/**
 * §4.6's window, as the repository presents it after its own 42703 fallback:
 * every row tagged SAMB, and the tracks table absent.
 */
function pre52Repository(): Repository {
  return {
    listProcessLanes: async () => okRows(fixtureLanes()),
    listProcessPhases: async () => okRows(fixturePhases()),
    listProcessSteps: async () => okRows(fixtureSteps()),
    listProcessGates: async () => okRows(fixtureGates()),
    listProcessNeeds: async () => okRows(fixtureNeeds()),
    listProcessStepItems: async () => okRows(fixtureStepItems()),
    listProcessTracks: async () =>
      readAbsence('listProcessTracks', {
        code: 'PGRST205',
        message: "Could not find the table 'public.os_process_tracks' in the schema cache",
      }) as ReadResult<ProcessTrackDef>,
    listProcessForms: async () => okRows([]),
    listProcessReferences: async () => okRows<ProcessReference>([]),
    listFinishLineItems: async () => okRows<FinishLineItem>([]),
  } as unknown as Repository;
}

/**
 * Layout stub keyed by (entity, label): every box measures, and the two
 * entities occupy disjoint x ranges so a wire computed from stale rects is
 * arithmetically impossible to miss.
 */
function stubLayout() {
  const columnOf = new Map<string, number>();
  const originFor = (el: HTMLElement) =>
    el.dataset.entity === 'ARBI' ? ARBI_X_BASE : 120;
  const keyOf = (el: HTMLElement) => `${el.dataset.entity}:${el.dataset.stepLabel}`;
  const define = (prop: string, get: (el: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get() {
        return get(this as HTMLElement);
      },
    });
  define('scrollWidth', () => 4000);
  define('scrollHeight', () => 1200);
  define('clientWidth', () => 900);
  define('clientHeight', () => 600);
  define('offsetWidth', (el) => (el.dataset.stepLabel ? 168 : 4000));
  define('offsetHeight', (el) => (el.dataset.stepLabel ? 96 : 1200));
  define('offsetTop', (el) => {
    if (!el.dataset.stepLabel) return 0;
    const key = keyOf(el);
    if (!columnOf.has(key)) columnOf.set(key, columnOf.size);
    return 46 + (columnOf.get(key) ?? 0) * 7;
  });
  define('offsetLeft', (el) => {
    if (!el.dataset.stepLabel) return 0;
    const key = keyOf(el);
    if (!columnOf.has(key)) columnOf.set(key, columnOf.size);
    return originFor(el) + (columnOf.get(key) ?? 0) * 196;
  });
}

function clearLayoutStub() {
  for (const prop of [
    'scrollWidth',
    'scrollHeight',
    'clientWidth',
    'clientHeight',
    'offsetWidth',
    'offsetHeight',
    'offsetTop',
    'offsetLeft',
  ]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
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
  stubLayout();
});

afterEach(() => {
  cleanup();
  clearLayoutStub();
  vi.unstubAllGlobals();
  useAppStore.setState({ prosesEntity: 'SAMB', prosesFocus: null });
});

function renderSwimlane(repository: Repository) {
  useAppStore.setState({ repository, prosesFocus: null });
  return render(
    <FinishLineSwimlane onClearItemFilter={noop} onOpenMatrix={noop} />,
  );
}

function renderNeeds(repository: Repository) {
  useAppStore.setState({ repository, prosesFocus: null });
  return render(<FinishLineNeeds onOpenStep={noop} />);
}

async function waitForBoxes(container: HTMLElement, count: number) {
  await waitFor(() => {
    expect(container.querySelectorAll('[data-step-label]').length).toBe(count);
  });
}

/** Every x-anchor of every rendered wire path (`M{x},{y} …` + segments). */
function wireXs(container: HTMLElement): number[] {
  return [...container.querySelectorAll('svg path[marker-end]')].flatMap((path) => {
    const d = path.getAttribute('d') ?? '';
    return [...d.matchAll(/[ML]([\d.-]+),/g)].map((match) => Number(match[1]));
  });
}

describe('§6.2 switching entity redraws the arrows from the new boxes', () => {
  it('renders ARBI at its own coordinates, then SAMB with no arrow left in ARBI space', async () => {
    useAppStore.setState({ prosesEntity: 'ARBI' });
    const { container } = renderSwimlane(bothEntitiesRepository());
    await waitForBoxes(container, 23);
    await waitFor(() => {
      expect(container.querySelectorAll('svg path[marker-end]').length).toBeGreaterThan(0);
    });
    // Every ARBI wire anchors in ARBI space.
    const arbiXs = wireXs(container);
    expect(arbiXs.length).toBeGreaterThan(0);
    expect(arbiXs.every((x) => x >= ARBI_X_BASE)).toBe(true);
    expect(container.querySelectorAll('[data-handoff-marker]').length).toBe(12);

    // Switch to SAMB via the picker — the arrows must re-derive AND
    // re-measure: 30 boxes, and not one coordinate in ARBI space.
    fireEvent.click(screen.getByRole('button', { name: 'SAMB' }));
    await waitForBoxes(container, 30);
    await waitFor(() => {
      const xs = wireXs(container);
      expect(xs.length).toBeGreaterThan(0);
      expect(xs.every((x) => x < ARBI_X_BASE)).toBe(true);
    });
    expect(container.querySelectorAll('[data-handoff-marker]').length).toBe(12);
  });

  it('ARBI Forward: 21 boxes 8 markers · Reverse: 8 boxes 4 markers', async () => {
    useAppStore.setState({ prosesEntity: 'ARBI' });
    const { container } = renderSwimlane(bothEntitiesRepository());
    await waitForBoxes(container, 23);
    fireEvent.click(screen.getByRole('button', { name: 'FORWARD' }));
    await waitForBoxes(container, 21);
    await waitFor(() => {
      expect(container.querySelectorAll('[data-handoff-marker]').length).toBe(8);
    });
    fireEvent.click(screen.getByRole('button', { name: 'REVERSE' }));
    await waitForBoxes(container, 8);
    await waitFor(() => {
      expect(container.querySelectorAll('[data-handoff-marker]').length).toBe(4);
    });
  });
});

describe('§6.4 each entity offers its own tracks and nothing else', () => {
  it('SAMB shows Semua/TRADE/LP; ARBI shows Semua/FORWARD/REVERSE', async () => {
    const { container } = renderSwimlane(bothEntitiesRepository());
    await waitForBoxes(container, 30);
    expect(screen.getByRole('button', { name: 'TRADE' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'LP' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'FORWARD' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'REVERSE' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ARBI' }));
    await waitForBoxes(container, 23);
    expect(screen.getByRole('button', { name: 'FORWARD' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'REVERSE' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'TRADE' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'LP' })).toBeNull();
  });
});

describe('§6.7 entity binds across the tabs; jalur does not', () => {
  it('LP picked on the swimlane leaves the register at Semua with all 118 rows', async () => {
    const swimlane = renderSwimlane(bothEntitiesRepository());
    await waitForBoxes(swimlane.container, 30);
    fireEvent.click(screen.getByRole('button', { name: 'LP' }));
    await waitForBoxes(swimlane.container, 20);
    swimlane.unmount();

    const needs = renderNeeds(bothEntitiesRepository());
    await waitFor(() => {
      expect(screen.getByText('118 baris')).toBeDefined();
    });
    const semua = screen.getByRole('button', { name: 'Semua' });
    expect(semua.getAttribute('aria-pressed')).toBe('true');
    needs.unmount();
  });

  it('ARBI picked on the register carries into the swimlane', async () => {
    const needs = renderNeeds(bothEntitiesRepository());
    await waitFor(() => {
      expect(screen.getByText('118 baris')).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: 'ARBI' }));
    await waitFor(() => {
      expect(screen.getByText('112 baris')).toBeDefined();
    });
    needs.unmount();

    const swimlane = renderSwimlane(bothEntitiesRepository());
    await waitForBoxes(swimlane.container, 23);
    const arbiButton = screen.getByRole('button', { name: 'ARBI' });
    expect(arbiButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('an active jalur filter on the register SAYS how many rows it hides', async () => {
    renderNeeds(bothEntitiesRepository());
    await waitFor(() => {
      expect(screen.getByText('118 baris')).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: 'LP' }));
    // SAMB LP scope holds 82 of 118 — the other 36 must be DECLARED, not
    // silently absent from the request list.
    await waitFor(() => {
      expect(screen.getByText('82 baris')).toBeDefined();
    });
    expect(screen.getByText(/36 baris di luar jalur ini disembunyikan/)).toBeDefined();
  });
});

describe('§6.5 the pre-52 window renders SAMB plus one notice, console clean', () => {
  it('draws the 30 SAMB boxes with TRADE/LP buttons and the multi-entity notice', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(noop);
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    try {
      const { container } = renderSwimlane(pre52Repository());
      await waitForBoxes(container, 30);
      await waitFor(() => {
        expect(container.querySelectorAll('svg path[marker-end]').length).toBeGreaterThan(0);
      });
      expect(screen.getByText(/Fitur multi-entitas belum aktif/)).toBeDefined();
      expect(screen.getByRole('button', { name: 'TRADE' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'LP' })).toBeDefined();
      expect(container.querySelectorAll('[data-handoff-marker]').length).toBe(12);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it('the register renders all 118 rows with the same notice', async () => {
    renderNeeds(pre52Repository());
    await waitFor(() => {
      expect(screen.getByText('118 baris')).toBeDefined();
    });
    expect(screen.getByText(/Fitur multi-entitas belum aktif/)).toBeDefined();
  });
});

describe('an entity without a chain gets one line, never an error', () => {
  it('renders the no-chain row for a URL-forced entity and offers the picker', async () => {
    useAppStore.setState({ prosesEntity: 'ASI' });
    const { container } = renderSwimlane(bothEntitiesRepository());
    await waitFor(() => {
      // States what was observed, not why. "belum punya rantai proses" was a
      // claim about the database made from one session's slice of it.
      expect(
        screen.getByText(/Nol step terbaca untuk entitas ASI/),
      ).toBeDefined();
    });
    expect(container.querySelectorAll('[data-step-label]').length).toBe(0);
    // The picker lists the chains that exist; choosing one recovers.
    fireEvent.click(screen.getByRole('button', { name: 'ARBI' }));
    await waitForBoxes(container, 23);
  });
});
