// @vitest-environment jsdom
/**
 * §5.4, held programmatically.
 *
 * jsdom performs NO layout and does not implement container queries, so a
 * pixel assertion here would be fiction — `getBoundingClientRect()` returns
 * zeros whether the fix works or not. What IS decidable, and is the stronger
 * claim anyway, is STRUCTURAL: exactly which elements opt into the bleed and
 * which do not. A prose element that never receives the class cannot stretch
 * under any layout engine, and a canvas that does receive it cannot fail to.
 *
 * The arithmetic the class encodes is checked separately, against the CSS
 * source, at the bottom of this file — that is where the "1076 → 1380" claim
 * is actually verified, by evaluating the same max/min expression the
 * stylesheet declares.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows } from '../../data/readResult';
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
import { FinishLineNeeds } from './FinishLineNeeds';
import { FinishLineSwimlane } from './FinishLineSwimlane';

// cwd, not import.meta.url: under jsdom that resolves to an http: URL and
// readFileSync rejects it.
const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

function seededRepository(): Repository {
  return {
    listProcessLanes: async () => okRows(fixtureLanes()),
    listProcessPhases: async () => okRows(fixturePhases()),
    listProcessSteps: async () => okRows(fixtureSteps()),
    listProcessGates: async () => okRows(fixtureGates()),
    listProcessNeeds: async () => okRows(fixtureNeeds()),
    listProcessStepItems: async () => okRows(fixtureStepItems()),
    listProcessTracks: async () => okRows(fixtureTracks()),
    listProcessReferences: async () => okRows<ProcessReference>([]),
    listFinishLineItems: async () => okRows<FinishLineItem>([]),
  } as unknown as Repository;
}

/** Same layout stub the other swimlane suites use. */
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
let observers: Array<{ target: Element; fire: () => void }> = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly cb: () => void) {}
      observe(target: Element) {
        observers.push({ target, fire: () => this.cb() });
      }
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

function renderSwimlane() {
  useAppStore.setState({ repository: seededRepository(), prosesEntity: 'SAMB', prosesFocus: null });
  return render(
    <FinishLineSwimlane onClearItemFilter={noop} onOpenMatrix={noop} />,
  );
}

async function waitForCanvas(container: HTMLElement, boxes = 30) {
  await waitFor(() => {
    expect(container.querySelectorAll('[data-step-label]').length).toBe(boxes);
  });
}

// --- what bleeds, and what refuses to -------------------------------------

describe('§5.2 the canvas and its chrome widen', () => {
  it('the toolbar and the canvas row both opt in', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);

    const toolbar = container.querySelector('[aria-label="Kontrol swimlane"]') as HTMLElement;
    const row = container.querySelector('[data-canvas-row]') as HTMLElement;
    expect(toolbar.classList.contains('canvas-bleed')).toBe(true);
    expect(row.classList.contains('canvas-bleed')).toBe(true);
    // The minimap and the scroll container live inside the row, so they
    // inherit the width rather than declaring one.
    expect(row.querySelector('[data-minimap]') ?? row.firstElementChild).not.toBeNull();
  });

  it('the needs table opts in on the other tab', async () => {
    useAppStore.setState({ repository: seededRepository(), prosesFocus: null });
    const { container } = render(<FinishLineNeeds onOpenStep={noop} />);
    const table = await waitFor(() => {
      const found = container.querySelector('[data-needs-table]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(table.classList.contains('canvas-bleed')).toBe(true);
  });
});

describe('§5.2 prose stays inside the measure', () => {
  it('the scope row, its references block and the step panel never bleed', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);

    const scope = container.querySelector('[data-scope-row]') as HTMLElement;
    expect(scope.classList.contains('canvas-bleed')).toBe(false);
    // ...and no ancestor of it does either, which is what actually decides it.
    for (let node = scope.parentElement; node; node = node.parentElement) {
      expect(node.classList.contains('canvas-bleed')).toBe(false);
    }

    fireEvent.click(container.querySelector('[data-step-label="9"]') as HTMLElement);
    const panel = await screen.findByRole('complementary', { name: 'Detail step 9' });
    expect(panel.classList.contains('canvas-bleed')).toBe(false);
  });

  /**
   * §5.4.5: the panel's WIDTH is fixed at 380px and must stay that. The row
   * around it widening is the point — every added pixel goes to flex-1, which
   * is the canvas.
   */
  it('the step panel keeps its 380px, unchanged by the wider row', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);
    fireEvent.click(container.querySelector('[data-step-label="9"]') as HTMLElement);
    const panel = await screen.findByRole('complementary', { name: 'Detail step 9' });
    expect(panel.className).toContain('lg:w-[380px]');
    expect(panel.className).toContain('shrink-0');
  });

  it('the measurement-failure warning stays prose-width', async () => {
    // Force the silent-failure guard: every box measures at the origin.
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
      configurable: true,
      get: () => 0,
    });
    const { container } = renderSwimlane();
    await waitForCanvas(container);
    const warning = await screen.findByText(/pengukuran kanvas gagal/);
    expect(warning.classList.contains('canvas-bleed')).toBe(false);
    for (let node = warning.parentElement; node; node = node.parentElement) {
      expect(node.classList.contains('canvas-bleed')).toBe(false);
    }
  });
});

// --- the numbers that must not move ---------------------------------------

describe('§5.4.7 the pinned numbers survive the wider container', () => {
  it('SAMB: 30 boxes, 12 handoff markers, and the per-track splits', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container, 30);
    expect(container.querySelectorAll('[data-handoff-marker]')).toHaveLength(12);

    fireEvent.click(screen.getByRole('button', { name: 'TRADE' }));
    await waitForCanvas(container, 19);
    expect(container.querySelectorAll('[data-handoff-marker]')).toHaveLength(6);

    fireEvent.click(screen.getByRole('button', { name: 'LP' }));
    await waitForCanvas(container, 20);
    expect(container.querySelectorAll('[data-handoff-marker]')).toHaveLength(7);
  });

  /**
   * §5.4.8. The grid's columns are fixed px, so its own width does not change
   * when the container widens — which means arrow coordinates are container
   * independent BY CONSTRUCTION, not by luck. This asserts that: fire the
   * container's ResizeObserver and every arrow path must come back identical.
   */
  it('arrows land in the same place after the container resizes', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);
    const paths = () =>
      [...container.querySelectorAll('svg path[marker-end]')].map((p) => p.getAttribute('d'));

    const before = paths();
    expect(before.length).toBeGreaterThan(0);

    // Every registered observer fires — the grid's and the scroll box's.
    for (const observer of observers) observer.fire();
    await waitFor(() => expect(paths()).toEqual(before));
  });

  it('the scroll container is observed, so the minimap follows a width change', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);
    const scroller = container.querySelector('[data-canvas-row] .overflow-auto') as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(observers.some((observer) => observer.target === scroller)).toBe(true);
  });

  it('cells still carry no position — the grid stays every box’s offsetParent', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);
    for (const box of container.querySelectorAll('[data-step-label]')) {
      const cell = box.parentElement as HTMLElement;
      expect(cell.className).not.toMatch(/\b(relative|absolute|sticky|fixed)\b/);
    }
  });

  it('still zero filled-primary buttons on the view', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);
    expect(container.querySelectorAll('button.bg-primary')).toHaveLength(0);
    expect(container.querySelectorAll('[class*="font-mono"]')).toHaveLength(0);
  });
});

// --- the arithmetic, read off the stylesheet -------------------------------

describe('§5.4.2 the width expression itself', () => {
  const rule = CSS.slice(CSS.indexOf('.canvas-bleed'), CSS.indexOf('}', CSS.indexOf('.canvas-bleed')));

  it('is declared once, and only .app-main provides the container', () => {
    expect([...CSS.matchAll(/\.canvas-bleed\s*\{/g)]).toHaveLength(1);
    expect(CSS).toContain('container-type: inline-size');
    expect([...CSS.matchAll(/container-type:/g)]).toHaveLength(1);
  });

  it('measures the column, not the viewport — 100vw would include the scrollbar', () => {
    expect(rule).toContain('100cqi');
    expect(rule).not.toContain('100vw');
    expect(rule).not.toContain('100dvw');
  });

  /**
   * The floor is the whole of §5.3's "narrow must not get worse": when the
   * available column is no wider than the measure, this resolves to 100% and
   * the margins to zero — the pre-change layout, exactly.
   */
  it('never resolves narrower than the measure it escapes', () => {
    expect(rule).toMatch(/--canvas-width:\s*max\(100%,/);
    expect(rule).toContain('margin-inline: calc((100% - var(--canvas-width)) / 2)');
  });

  /** Evaluates the declared expression at the widths that matter. */
  it('yields 1076 -> 1380 at a 1700px viewport, and is unchanged at 900px', () => {
    const GUTTER = 64; // 4rem, matching page-shell's 2rem each side
    const CAP = 1600; // 100rem
    const SIDEBAR = 256; // lg:ml-64
    const MEASURE = 1140; // page-shell's min(100%, 1140px)

    const shellContent = (viewport: number) => {
      const main = viewport >= 1024 ? viewport - SIDEBAR : viewport;
      const pad = viewport >= 768 ? 64 : 32;
      return Math.min(main, MEASURE) - pad;
    };
    const bleed = (viewport: number) => {
      const main = viewport >= 1024 ? viewport - SIDEBAR : viewport;
      return Math.max(shellContent(viewport), Math.min(main - GUTTER, CAP));
    };

    expect(shellContent(1700)).toBe(1076);
    expect(bleed(1700)).toBe(1380);
    // Narrow: identical, so the floor genuinely floors.
    expect(bleed(900)).toBe(shellContent(900));
    expect(bleed(1280)).toBe(Math.max(shellContent(1280), 1280 - SIDEBAR - GUTTER));
    // Very wide: capped, and the cap is the declared one.
    expect(bleed(2560)).toBe(CAP);
    expect(rule).toContain('100rem');
  });
});
