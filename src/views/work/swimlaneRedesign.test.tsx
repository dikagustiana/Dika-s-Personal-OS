// @vitest-environment jsdom
/**
 * §4 of the redesign brief, held programmatically — not by eye.
 *
 * The invariants a canvas rework is most likely to break silently:
 *   - 30 boxes / 12 handoff markers in Semua; 19/6 in Trade; 20/7 in LP.
 *   - No two handoff markers gathered into one blot (the markers are 11px
 *     diamonds; the computeWires anti-stack keeps centres >22px apart in x
 *     or >18px in y, so adjacency here means overlap there).
 *   - The ?item highlight DIMS 26 and lights 4, and changes neither the box
 *     count nor the wire count — highlighting must never become filtering.
 *   - No density ever puts prose on the canvas: risk/control/note text
 *     renders in the panel and only in the panel.
 *   - Every matrix group on a box caps at two items, with the remainder
 *     declared as "+N di panel".
 *
 * Fixtures are the seedFixture — what migration 20260806000051 inserts — and
 * layout is stubbed the same way finishLineSwimlaneGuard.test.tsx stubs it,
 * because jsdom performs no layout of its own.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows } from '../../data/readResult';
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

const SALES_GENERAL_TRADE = '634e675f-4681-4307-b831-6cad1e7d80fa';

/** A risk string straight from the seed — the prose that must stay off-canvas. */
const STEP_9_RISK_FRAGMENT = () => {
  const step9 = fixtureSteps().find((step) => step.label === '9');
  if (!step9?.risk) throw new Error('seed drift: step 9 must carry a risk');
  return step9.risk;
};

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

/** Same stub as the guard test: give the grid a plausible measured layout. */
function stubLayout() {
  const columnOf = new Map<string, number>();
  const define = (prop: string, get: (el: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get() {
        return get(this as HTMLElement);
      },
    });
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
  useAppStore.setState({ prosesTrack: 'ALL', prosesFocus: null });
});

function renderSwimlane(props: { itemFilter?: string } = {}) {
  useAppStore.setState({ repository: seededRepository(), prosesFocus: null });
  return render(
    <FinishLineSwimlane
      itemFilter={props.itemFilter}
      onClearItemFilter={noop}
      onOpenMatrix={noop}
    />,
  );
}

async function waitForCanvas(container: HTMLElement, boxes: number) {
  await waitFor(() => {
    expect(container.querySelectorAll('[data-step-label]').length).toBe(boxes);
  });
  await waitFor(() => {
    expect(container.querySelectorAll('svg path[marker-end]').length).toBeGreaterThan(0);
  });
}

describe('§4 boxes and handoff markers per filter', () => {
  it('Semua: 30 boxes, 12 handoff markers, none gathered', async () => {
    useAppStore.setState({ prosesTrack: 'ALL' });
    const { container } = renderSwimlane();
    await waitForCanvas(container, 30);

    const markers = container.querySelectorAll('[data-handoff-marker]');
    expect(markers.length).toBe(12);

    // The centres come out of the rendered diamond paths ("M{x},{y-5.5} …"),
    // so this asserts what is actually on screen, not what computeWires
    // promised. 11px glyphs whose centres clear 22px in x or 18px in y
    // cannot visually merge.
    const centres = [...markers].map((marker) => {
      const d = marker.querySelector('path')?.getAttribute('d') ?? '';
      const match = /^M([\d.-]+),([\d.-]+)/.exec(d);
      if (!match) throw new Error(`unparseable marker path: ${d}`);
      return { x: Number(match[1]), y: Number(match[2]) + 5.5 };
    });
    for (let a = 0; a < centres.length; a += 1) {
      for (let b = a + 1; b < centres.length; b += 1) {
        const dx = Math.abs(centres[a].x - centres[b].x);
        const dy = Math.abs(centres[a].y - centres[b].y);
        expect(dx > 22 || dy > 18).toBe(true);
      }
    }
  });

  it('Trade: 19 boxes, 6 handoff markers', async () => {
    useAppStore.setState({ prosesTrack: 'TRADE' });
    const { container } = renderSwimlane();
    await waitForCanvas(container, 19);
    expect(container.querySelectorAll('[data-handoff-marker]').length).toBe(6);
  });

  it('LP: 20 boxes, 7 handoff markers', async () => {
    useAppStore.setState({ prosesTrack: 'LP' });
    const { container } = renderSwimlane();
    await waitForCanvas(container, 20);
    expect(container.querySelectorAll('[data-handoff-marker]').length).toBe(7);
  });

  it('renders 6 lane labels and 7 phase ribbon segments', async () => {
    useAppStore.setState({ prosesTrack: 'ALL' });
    const { container } = renderSwimlane();
    await waitForCanvas(container, 30);
    for (const lane of fixtureLanes()) {
      expect(screen.getByText(lane.label)).toBeDefined();
    }
    for (const phase of fixturePhases()) {
      expect(screen.getByText(phase.name)).toBeDefined();
    }
    expect(fixtureLanes()).toHaveLength(6);
    expect(fixturePhases()).toHaveLength(7);
  });
});

describe('§4 the ?item highlight dims — it never filters', () => {
  it('lights 4, dims 26, and leaves the box and wire counts untouched', async () => {
    useAppStore.setState({ prosesTrack: 'ALL' });
    const plain = renderSwimlane();
    await waitForCanvas(plain.container, 30);
    const plainWireCount = plain.container.querySelectorAll('svg path[marker-end]').length;
    const plainMarkerCount = plain.container.querySelectorAll('[data-handoff-marker]').length;
    plain.unmount();

    const { container } = renderSwimlane({ itemFilter: SALES_GENERAL_TRADE });
    await waitForCanvas(container, 30);

    const boxes = [...container.querySelectorAll<HTMLElement>('[data-step-label]')];
    const lit = boxes.filter((box) => box.dataset.dim === undefined);
    const dimmed = boxes.filter((box) => box.dataset.dim === 'true');
    expect(lit.map((box) => box.dataset.stepLabel).sort()).toEqual(['10', '18a', '19', '2']);
    expect(dimmed.length).toBe(26);

    expect(container.querySelectorAll('svg path[marker-end]').length).toBe(plainWireCount);
    expect(container.querySelectorAll('[data-handoff-marker]').length).toBe(plainMarkerCount);
  });
});

describe('prose never renders on the canvas — at any density', () => {
  it('keeps risk text out of ringkas, sedang and lengkap, and in the panel', async () => {
    useAppStore.setState({ prosesTrack: 'ALL' });
    const { container } = renderSwimlane();
    await waitForCanvas(container, 30);
    const risk = STEP_9_RISK_FRAGMENT();

    // ringkas (default)
    expect(screen.queryByText(risk)).toBeNull();

    // sedang
    fireEvent.click(screen.getByRole('button', { name: 'Sedang' }));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-step-label]').length).toBe(30);
    });
    expect(screen.queryByText(risk)).toBeNull();

    // lengkap
    fireEvent.click(screen.getByRole('button', { name: 'Lengkap' }));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-step-label]').length).toBe(30);
    });
    expect(screen.queryByText(risk)).toBeNull();

    // The prose lives in the panel: open step 9 and the same text appears.
    const box9 = container.querySelector('[data-step-label="9"]') as HTMLElement;
    fireEvent.click(box9);
    await waitFor(() => {
      expect(screen.getByText(risk)).toBeDefined();
    });
  });

  it('caps every on-box group at two items and declares the rest', async () => {
    useAppStore.setState({ prosesTrack: 'ALL' });
    const { container } = renderSwimlane();
    await waitForCanvas(container, 30);
    fireEvent.click(screen.getByRole('button', { name: 'Lengkap' }));

    // Step 9 carries 9 needs in the seed; its box shows 2 and says +7.
    const box9 = container.querySelector('[data-step-label="9"]') as HTMLElement;
    await waitFor(() => {
      expect(box9.textContent).toContain('Kebutuhan data · 9');
    });
    expect(box9.textContent).toContain('+7 di panel');

    // No box anywhere lists more than GROUP_ITEM_CAP items per group.
    for (const box of container.querySelectorAll('[data-step-label]')) {
      for (const list of box.querySelectorAll('ul')) {
        expect(list.querySelectorAll('li').length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('sedang shows the two highest-signal needs — BELUM outranks ADA', async () => {
    useAppStore.setState({ prosesTrack: 'ALL' });
    const { container } = renderSwimlane();
    await waitForCanvas(container, 30);
    fireEvent.click(screen.getByRole('button', { name: 'Sedang' }));

    // Step 7a: needs are GRN (ADA), faktor konversi (BELUM), harga beli
    // (ADA). The two shown must include the BELUM item.
    const box7a = container.querySelector('[data-step-label="7a"]') as HTMLElement;
    await waitFor(() => {
      expect(box7a.textContent).toContain('Kebutuhan data · 3');
    });
    expect(box7a.textContent).toContain('Faktor konversi PC ↔ karton per SKU');
    expect(box7a.textContent).toContain('+1 di panel');
  });
});

describe('the toolbar collapsed to one density control', () => {
  it('offers three density positions and no tempel toggle', async () => {
    useAppStore.setState({ prosesTrack: 'ALL' });
    const { container } = renderSwimlane();
    await waitForCanvas(container, 30);

    expect(screen.getByRole('button', { name: 'Ringkas' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sedang' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Lengkap' })).toBeDefined();
    expect(screen.queryByText('Tempel matriks')).toBeNull();
    expect(screen.queryByText('pas')).toBeNull();
  });

  it('shows the column popover only at lengkap, and toggling a column works', async () => {
    useAppStore.setState({ prosesTrack: 'ALL' });
    const { container } = renderSwimlane();
    await waitForCanvas(container, 30);

    expect(screen.queryByRole('button', { name: /Kolom/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lengkap' }));
    const trigger = await screen.findByRole('button', { name: /Kolom/ });
    fireEvent.click(trigger);
    // Exact name: in lengkap every box's accessible name contains the group
    // title "Dokumen & sistem", so a regex would match thirty boxes too.
    const docsToggle = await screen.findByRole('button', { name: 'Dokumen' });
    fireEvent.click(docsToggle);
    await waitFor(() => {
      const box9 = container.querySelector('[data-step-label="9"]') as HTMLElement;
      expect(box9.textContent).not.toContain('Dokumen & sistem');
    });
  });
});
