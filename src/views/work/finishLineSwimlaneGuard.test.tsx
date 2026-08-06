// @vitest-environment jsdom
/**
 * §6.6 / §10.9 IN THE DOM — the two things no pure logic test can reach.
 *
 * THE SILENT FAILURE. If measurement fails, nothing throws. computeWires gets
 * an empty rect map, returns no wires, and the swimlane renders 30 boxes with
 * no arrows — a diagram that looks deliberate and is wrong. Every other test
 * in this feature feeds computeWires rects that already exist, so none of
 * them can see this. Only rendering the real component against a real (if
 * stubbed) layout can, which is why this file carries the DOM dependency the
 * rest of the suite does not.
 *
 * jsdom performs no layout: offsetLeft/offsetWidth/scrollWidth are 0 for
 * everything unless stubbed. That default IS the failure case, so the guard
 * is exercised by rendering plainly; the healthy case is the one that needs
 * a stub. Both directions are asserted — a banner that is always on would
 * pass a one-sided test and warn on every healthy render.
 *
 * Fixtures are the same seedFixture the logic tests use, so what renders here
 * is what migration 20260806000051 inserts.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows, readFailure, type ReadResult } from '../../data/readResult';
import type { FinishLineItem } from '../../data/types';
import {
  fixtureGates,
  fixtureLanes,
  fixtureNeeds,
  fixturePhases,
  fixtureStepItems,
  fixtureSteps,
} from '../../logic/process/seedFixture';
import { useAppStore } from '../../store/appStore';
import { FinishLineSwimlane } from './FinishLineSwimlane';

const WARNING = 'Alur tidak dapat digambar — pengukuran kanvas gagal, panah tidak ditampilkan.';
const EMPTY = 'Kanvas belum bisa digambar — migration proses belum diterapkan.';

/** The seven reads FinishLineSwimlane issues, all healthy. */
function seededRepository(): Repository {
  return {
    listProcessLanes: async () => okRows(fixtureLanes()),
    listProcessPhases: async () => okRows(fixturePhases()),
    listProcessSteps: async () => okRows(fixtureSteps()),
    listProcessGates: async () => okRows(fixtureGates()),
    listProcessNeeds: async () => okRows(fixtureNeeds()),
    listProcessStepItems: async () => okRows(fixtureStepItems()),
    listFinishLineItems: async () => okRows<FinishLineItem>([]),
  } as unknown as Repository;
}

/** The live state on 6 August: none of the six relations exist. */
function missingRelationRepository(): Repository {
  const gone = <T,>(fn: string): ReadResult<T> => readFailure(fn, { code: '42P01' });
  return {
    listProcessLanes: async () => gone('listProcessLanes'),
    listProcessPhases: async () => gone('listProcessPhases'),
    listProcessSteps: async () => gone('listProcessSteps'),
    listProcessGates: async () => gone('listProcessGates'),
    listProcessNeeds: async () => gone('listProcessNeeds'),
    listProcessStepItems: async () => gone('listProcessStepItems'),
    listFinishLineItems: async () => okRows<FinishLineItem>([]),
  } as unknown as Repository;
}

/**
 * Give the grid and its boxes a plausible layout. Without this jsdom reports
 * zero for everything, which is exactly the failure the guard is for.
 */
function stubLayout(options: { allAtZero?: boolean } = {}) {
  const columnOf = new Map<string, number>();
  const define = (prop: string, get: (el: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get() {
      return get(this as HTMLElement);
    } });

  define('scrollWidth', () => 4000);
  define('scrollHeight', () => 1200);
  define('offsetWidth', (el) => (el.dataset.stepLabel ? 168 : 4000));
  define('offsetHeight', (el) => (el.dataset.stepLabel ? 96 : 1200));
  define('offsetTop', (el) => {
    if (!el.dataset.stepLabel) return 0;
    return 46 + (columnOf.get(el.dataset.stepLabel) ?? 0) * 7;
  });
  define('offsetLeft', (el) => {
    const label = el.dataset.stepLabel;
    if (!label) return 0;
    if (options.allAtZero) return 0;
    if (!columnOf.has(label)) columnOf.set(label, columnOf.size);
    return 120 + (columnOf.get(label) ?? 0) * 196;
  });
}

function clearLayoutStub() {
  for (const prop of [
    'scrollWidth',
    'scrollHeight',
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
  // jsdom ships neither of these, and the component measures through both.
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
  clearLayoutStub();
  vi.unstubAllGlobals();
  useAppStore.setState({ prosesTrack: 'ALL', prosesFocus: null });
});

function renderSwimlane(repository: Repository) {
  useAppStore.setState({ repository, prosesTrack: 'ALL', prosesFocus: null });
  return render(
    <FinishLineSwimlane onClearItemFilter={noop} onOpenMatrix={noop} />,
  );
}

describe('§6.6 the silent-failure guard actually fires', () => {
  it('surfaces the warning row when measurement comes back zero', async () => {
    const { container } = renderSwimlane(seededRepository());

    // The boxes render — that is the whole danger. Without the warning this
    // is a complete-looking swimlane that has quietly lost every arrow.
    await waitFor(() => {
      expect(container.querySelectorAll('[data-step-label]').length).toBe(30);
    });
    await waitFor(() => {
      expect(screen.getByText(WARNING)).toBeDefined();
    });
    expect(container.querySelectorAll('svg path[marker-end]')).toHaveLength(0);
  });

  it('fires on the other trip too: a grid with width but every box at offsetLeft 0', async () => {
    stubLayout({ allAtZero: true });
    const { container } = renderSwimlane(seededRepository());

    await waitFor(() => {
      expect(container.querySelectorAll('[data-step-label]').length).toBe(30);
    });
    await waitFor(() => {
      expect(screen.getByText(WARNING)).toBeDefined();
    });
  });

  it('stays silent and draws arrows once measurement succeeds', async () => {
    stubLayout();
    const { container } = renderSwimlane(seededRepository());

    await waitFor(() => {
      expect(container.querySelectorAll('[data-step-label]').length).toBe(30);
    });
    await waitFor(() => {
      expect(container.querySelectorAll('svg path[marker-end]').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});

describe('§10.9 the pre-migration state renders as an empty state, not a failure', () => {
  it('shows the empty state — no warning row, no console noise — when all six are missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(noop);
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    try {
      renderSwimlane(missingRelationRepository());

      await waitFor(() => {
        expect(screen.getByText(EMPTY)).toBeDefined();
      });
      // The canvas is not drawn at all, so the measurement warning would be
      // a second, contradictory message about the same absence.
      expect(screen.queryByText(WARNING)).toBeNull();
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });
});
