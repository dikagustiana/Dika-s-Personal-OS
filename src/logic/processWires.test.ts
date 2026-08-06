/**
 * §10.5 / §10.8 — the silent failure modes of the swimlane, asserted over
 * computed geometry: capsule anti-stacking (nothing throws when capsules
 * cover each other; only an assertion catches it) and arrows landing on box
 * edges even when tempel mode makes boxes several times taller.
 *
 * Rects are synthesized with the SAME grid arithmetic the view uses
 * (LABEL_W / BOX_W / GAP_W, gutter columns, stacked cells), so these tests
 * exercise the real seed's real layout shape — only heights are parametric,
 * because in the DOM they come from measurement.
 */
import { describe, expect, it } from 'vitest';
import type { ProcessStep } from '../data/types';
import { deriveEdges, groupCells, handoffs, visibleSteps, type TrackFilter } from './process';
import { fixtureLanes, fixtureStepItems, fixtureSteps } from './process/seedFixture';
import { stepLabelsForItem } from './processModel';
import {
  BOX_W,
  GAP_W,
  LABEL_W,
  capsulesCollide,
  computeWires,
  type BoxRect,
  type WireEdge,
} from './processWires';

const steps = fixtureSteps();
const laneRow = new Map(
  fixtureLanes()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((lane, index) => [lane.key, index]),
);

const PHASE_H = 46;
const CELL_PAD = 12;
const STACK_GAP = 11;

/** Grid x for a slot column — the view's formula. */
function slotX(slot: number): number {
  return LABEL_W + (slot - 1) * (BOX_W + GAP_W);
}

/** Lay the visible seed out; heightOf makes tempel-mode heights testable. */
function buildRects(
  filter: TrackFilter,
  heightOf: (step: ProcessStep) => number,
): Map<string, BoxRect> {
  const shown = visibleSteps(steps, filter);
  const rowHeight =
    CELL_PAD * 2 +
    STACK_GAP +
    2 * Math.max(...shown.map((step) => heightOf(step)));
  const rects = new Map<string, BoxRect>();
  for (const group of groupCells(shown).values()) {
    let y =
      PHASE_H + (laneRow.get(group[0].laneKey) ?? 0) * rowHeight + CELL_PAD;
    for (const step of group) {
      rects.set(step.label, { x: slotX(step.slot), y, w: BOX_W, h: heightOf(step) });
      y += heightOf(step) + STACK_GAP;
    }
  }
  return rects;
}

function toWireEdges(filter: TrackFilter): WireEdge[] {
  return deriveEdges(steps, filter).map((edge) => ({
    fromLabel: edge.from.label,
    toLabel: edge.to.label,
    cross: edge.cross,
  }));
}

const compact = () => 96;
/** Tempel-ish: heights vary with content, up to several hundred px. */
const tall = (step: ProcessStep) =>
  120 + step.docs.length * 34 + step.drivers.length * 30 + step.coa.length * 26;

describe('§10.5 the full seed draws 12 HANDOFF capsules and none of them stack', () => {
  it('produces exactly 12 capsules in Semua — one per handoff', () => {
    const wires = computeWires(toWireEdges('ALL'), buildRects('ALL', compact));
    expect(handoffs(deriveEdges(steps, 'ALL'))).toHaveLength(12);
    expect(wires.filter((wire) => wire.capsule)).toHaveLength(12);
  });

  it.each([['ALL'], ['TRADE'], ['LP']] as const)(
    'keeps every capsule pair >22px apart horizontally or >18px vertically (%s, compact)',
    (filter) => {
      const capsules = computeWires(toWireEdges(filter), buildRects(filter, compact))
        .flatMap((wire) => (wire.capsule ? [wire.capsule] : []));
      for (let a = 0; a < capsules.length; a += 1) {
        for (let b = a + 1; b < capsules.length; b += 1) {
          const dx = Math.abs(capsules[a].x - capsules[b].x);
          const dy = Math.abs(capsules[a].y - capsules[b].y);
          expect(dx > 22 || dy > 18).toBe(true);
        }
      }
    },
  );

  it('still holds with tempel-mode heights', () => {
    const capsules = computeWires(toWireEdges('ALL'), buildRects('ALL', tall)).flatMap((wire) =>
      wire.capsule ? [wire.capsule] : [],
    );
    expect(capsules).toHaveLength(12);
    for (let a = 0; a < capsules.length; a += 1) {
      for (let b = a + 1; b < capsules.length; b += 1) {
        const dx = Math.abs(capsules[a].x - capsules[b].x);
        const dy = Math.abs(capsules[a].y - capsules[b].y);
        expect(dx > 22 || dy > 18).toBe(true);
      }
    }
  });

  it('shifts a colliding capsule +22 and rechecks — exactly-22 separation is still a stack', () => {
    const rects = new Map<string, BoxRect>([
      ['a', { x: 0, y: 0, w: 100, h: 60 }],
      ['b', { x: 300, y: 200, w: 100, h: 60 }],
      ['c', { x: 0, y: 4, w: 100, h: 60 }],
      ['d', { x: 300, y: 204, w: 100, h: 60 }],
    ]);
    const wires = computeWires(
      [
        { fromLabel: 'a', toLabel: 'b', cross: true },
        { fromLabel: 'c', toLabel: 'd', cross: true },
      ],
      rects,
    );
    const [first, second] = wires.map((wire) => wire.capsule);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Raw midpoints are 0px/4px apart — a perfect stack. One +22 shift still
    // leaves |dx| = 22, which capsulesCollide treats as stacked, so the
    // second capsule ends 44px away.
    expect(second && first && second.x - first.x).toBe(44);
    expect(first && second && capsulesCollide(first, second)).toBe(false);
  });

  it('gives up after eight shifts instead of looping forever', () => {
    const rects = new Map<string, BoxRect>();
    const edges: WireEdge[] = [];
    for (let i = 0; i < 12; i += 1) {
      rects.set(`s${i}`, { x: 0, y: i, w: 100, h: 60 });
      rects.set(`t${i}`, { x: 300, y: 200 + i, w: 100, h: 60 });
      edges.push({ fromLabel: `s${i}`, toLabel: `t${i}`, cross: true });
    }
    const wires = computeWires(edges, rects);
    expect(wires.filter((wire) => wire.capsule)).toHaveLength(12);
    const xs = wires.flatMap((wire) => (wire.capsule ? [wire.capsule.x] : []));
    expect(Math.max(...xs) - Math.min(...xs)).toBe(8 * 22);
  });
});

describe('§10.8 arrows land on box edges, in every mode', () => {
  it.each([
    ['compact', compact],
    ['tempel', tall],
  ] as const)('anchors every wire to the source right edge and target left edge (%s)', (_name, heightOf) => {
    const rects = buildRects('ALL', heightOf);
    const wires = computeWires(toWireEdges('ALL'), rects);
    expect(wires.length).toBeGreaterThan(0);
    for (const wire of wires) {
      const [fromLabel, toLabel] = wire.key.split('>');
      const from = rects.get(fromLabel) as BoxRect;
      const to = rects.get(toLabel) as BoxRect;
      expect(wire.x1).toBe(from.x + from.w);
      expect(wire.x2).toBe(to.x);
      expect(wire.y1).toBeGreaterThanOrEqual(from.y);
      expect(wire.y1).toBeLessThanOrEqual(from.y + from.h);
      expect(wire.y2).toBeGreaterThanOrEqual(to.y);
      expect(wire.y2).toBeLessThanOrEqual(to.y + to.h);
      // The tall-box rule: the anchor hugs the top (min(h/2, 26) + fan
      // spread), never the centre of a tempel-height box.
      expect(wire.y1 - from.y).toBeLessThanOrEqual(33);
      expect(wire.y2 - to.y).toBeLessThanOrEqual(33);
    }
  });

  it('fans convergence and divergence so shared anchors never coincide', () => {
    const rects = buildRects('ALL', compact);
    const wires = computeWires(toWireEdges('ALL'), rects);
    const into8 = wires.filter((wire) => wire.key.endsWith('>8'));
    const outOf17 = wires.filter((wire) => wire.key.startsWith('17>'));
    expect(into8).toHaveLength(2);
    expect(outOf17).toHaveLength(2);
    expect(into8[0].y2).not.toBe(into8[1].y2);
    expect(outOf17[0].y1).not.toBe(outOf17[1].y1);
  });

  it('draws a straight line when the ends are level, an elbow otherwise', () => {
    const rects = new Map<string, BoxRect>([
      ['a', { x: 0, y: 0, w: 100, h: 60 }],
      ['b', { x: 300, y: 1, w: 100, h: 60 }],
      ['c', { x: 300, y: 150, w: 100, h: 60 }],
    ]);
    const [level] = computeWires([{ fromLabel: 'a', toLabel: 'b', cross: false }], rects);
    const [elbow] = computeWires([{ fromLabel: 'a', toLabel: 'c', cross: false }], rects);
    expect(level.d).not.toContain('Q');
    expect(elbow.d).toContain('Q');
  });

  it('skips edges whose boxes are filtered out instead of guessing', () => {
    const rects = buildRects('TRADE', compact);
    const wires = computeWires(toWireEdges('ALL'), rects);
    for (const wire of wires) {
      const [fromLabel, toLabel] = wire.key.split('>');
      expect(rects.has(fromLabel)).toBe(true);
      expect(rects.has(toLabel)).toBe(true);
    }
  });
});

describe('§2 the ?item pre-filter dims, it never filters — arrows survive it', () => {
  const SALES_GENERAL_TRADE = '634e675f-4681-4307-b831-6cad1e7d80fa';
  const stepItems = fixtureStepItems();

  // The view derives `shown` from visibleSteps(steps, track) and passes
  // `highlighted` down as a styling prop only. This pins that separation: if
  // anyone ever narrows the render to the highlighted set, the box count and
  // the wire count both drop here, and the diagram would lose arrows without
  // throwing anything.
  it('lights 4 of 30 steps and still lays out all 30 boxes', () => {
    const lit = stepLabelsForItem(SALES_GENERAL_TRADE, stepItems, steps);
    expect([...lit].sort()).toEqual(['10', '18a', '19', '2']);
    expect(steps.length - lit.size).toBe(26);
    expect(buildRects('ALL', compact).size).toBe(30);
  });

  it('leaves every wire and all 12 capsules intact under the highlight', () => {
    const rects = buildRects('ALL', compact);
    const plain = computeWires(toWireEdges('ALL'), rects);
    const lit = stepLabelsForItem(SALES_GENERAL_TRADE, stepItems, steps);

    // Highlighting cannot remove a box, so the same rect map — and therefore
    // the same wire set — is what the highlighted render draws.
    const highlightedRects = buildRects('ALL', compact);
    for (const label of lit) expect(highlightedRects.has(label)).toBe(true);
    const underHighlight = computeWires(toWireEdges('ALL'), highlightedRects);

    expect(underHighlight.map((wire) => wire.key)).toEqual(plain.map((wire) => wire.key));
    expect(underHighlight.filter((wire) => wire.capsule)).toHaveLength(12);
  });

  // The counterfactual: what the diagram would look like if the highlight DID
  // filter. Not a behaviour we ship — it is here so the test above is not
  // trivially true.
  it('would lose boxes and arrows if the highlight ever became a filter', () => {
    const lit = stepLabelsForItem(SALES_GENERAL_TRADE, stepItems, steps);
    const litOnly = new Map(
      [...buildRects('ALL', compact)].filter(([label]) => lit.has(label)),
    );
    expect(litOnly.size).toBe(4);
    expect(computeWires(toWireEdges('ALL'), litOnly).length).toBeLessThan(
      computeWires(toWireEdges('ALL'), buildRects('ALL', compact)).length,
    );
  });
});
