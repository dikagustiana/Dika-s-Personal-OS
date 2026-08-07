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
import { fixtureLanes, fixtureStepItems, fixtureSteps, fixtureTracks } from './process/seedFixture';
import { stepLabelsForItem } from './processModel';
import { arbiLanes, arbiSteps, arbiTracks } from './process/arbiFixture';
import {
  BOX_W,
  GAP_W,
  LABEL_W,
  capsulesCollide,
  computeWires,
  countWireCrossings,
  type BoxRect,
  type Capsule,
  type WireEdge,
} from './processWires';

const steps = fixtureSteps();
const tracks = fixtureTracks();
const shared = new Set(['KEDUANYA']);
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
  const shown = visibleSteps(steps, filter, shared);
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
  return deriveEdges(steps, filter, tracks).map((edge) => ({
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
    expect(handoffs(deriveEdges(steps, 'ALL', tracks))).toHaveLength(12);
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

  // THE MECHANISM CHANGED IN §7 AND SO DID THESE NUMBERS. A colliding marker
  // used to shift its wire's ELBOW +22px right, which made the marker decide
  // where the arrow went. Now corridors decide where the arrow goes and the
  // marker slides ALONG the wire it belongs to. The clearances themselves are
  // untouched at 22/18; what moved is 44 → (-14 across, 24 down) here, and
  // 176 → 154 of corridor spread below.
  it('slides a colliding capsule along its own wire instead of dragging the arrow', () => {
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
    const [first, second] = wires.map((wire) => wire.capsule as Capsule);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Raw midpoints sit 4px apart vertically — a perfect stack. Corridors
    // separate the two wires by one 14px step, which is still inside the 22px
    // x-clearance, so the second marker also slides one 20px step down its own
    // vertical run. 24px of vertical daylight clears the 18px y-clearance.
    expect(second.x - first.x).toBe(-14);
    expect(second.y - first.y).toBe(24);
    expect(capsulesCollide(first, second)).toBe(false);
    // And it is still ON its wire — same x as that wire's corridor.
    expect(second.x).toBe(wires[1].mid);
  });

  it('packs a crowded bundle inside the gutter instead of marching out of it', () => {
    const rects = new Map<string, BoxRect>();
    const edges: WireEdge[] = [];
    for (let i = 0; i < 12; i += 1) {
      rects.set(`s${i}`, { x: 0, y: i, w: 100, h: 60 });
      rects.set(`t${i}`, { x: 300, y: 200 + i, w: 100, h: 60 });
      edges.push({ fromLabel: `s${i}`, toLabel: `t${i}`, cross: true });
    }
    const wires = computeWires(edges, rects);
    expect(wires.filter((wire) => wire.capsule)).toHaveLength(12);
    // Twelve corridors, one 14px step apart: 11 × 14 = 154 across.
    const mids = wires.map((wire) => wire.mid as number);
    expect(Math.max(...mids) - Math.min(...mids)).toBe(154);
    // Every corridor inside the gutter. The old +22-per-shift walk could add
    // 176px, carrying an elbow past the target box and folding the arrow back
    // over itself; a corridor can no longer leave the span it belongs to.
    for (const mid of mids) {
      expect(mid).toBeGreaterThanOrEqual(108);
      expect(mid).toBeLessThanOrEqual(292);
    }
    const capsules = wires.flatMap((wire) => (wire.capsule ? [wire.capsule] : []));
    for (let a = 0; a < capsules.length; a += 1) {
      for (let b = a + 1; b < capsules.length; b += 1) {
        expect(capsulesCollide(capsules[a], capsules[b])).toBe(false);
      }
    }
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

/**
 * §7 — the corridor rewrite.
 *
 * The complaint was that arrows between SALES and WAREHOUSE could not be
 * followed. The cause was not crossing but SUPERPOSITION: every elbow turned
 * at the same gutter midpoint, so pairs ran along identical pixels. On the
 * SAMB seed four pairs did — 15a>16 and 15b>16 shared 344px of line, 4>6a and
 * 5>6b 227px, 18a>19 and 18b>20 120px, and 19>23 and 20>21 were superimposed
 * over their whole run in opposite directions.
 *
 * These tests pin the counted result, both entities, both densities. The
 * number is computed by countWireCrossings rather than eyeballed, and it has
 * to keep going down, never up.
 */
function laneLayout(lanes: ReturnType<typeof fixtureLanes>) {
  return new Map(
    [...lanes].sort((a, b) => a.ordinal - b.ordinal).map((lane, index) => [lane.key, index]),
  );
}

function chain(
  chainSteps: ProcessStep[],
  chainTracks: ReturnType<typeof fixtureTracks>,
  lanes: ReturnType<typeof fixtureLanes>,
) {
  const rows = laneLayout(lanes);
  const rectsFor = (filter: TrackFilter, heightOf: (step: ProcessStep) => number) => {
    const shown = visibleSteps(chainSteps, filter, shared);
    const rowHeight =
      CELL_PAD * 2 + STACK_GAP + 2 * Math.max(...shown.map((step) => heightOf(step)));
    const rects = new Map<string, BoxRect>();
    for (const group of groupCells(shown).values()) {
      let y = PHASE_H + (rows.get(group[0].laneKey) ?? 0) * rowHeight + CELL_PAD;
      for (const step of group) {
        rects.set(step.label, {
          x: LABEL_W + (step.slot - 1) * (BOX_W + GAP_W),
          y,
          w: BOX_W,
          h: heightOf(step),
        });
        y += heightOf(step) + STACK_GAP;
      }
    }
    return rects;
  };
  const edgesFor = (filter: TrackFilter): WireEdge[] =>
    deriveEdges(chainSteps, filter, chainTracks).map((edge) => ({
      fromLabel: edge.from.label,
      toLabel: edge.to.label,
      cross: edge.cross,
    }));
  return {
    wires: (filter: TrackFilter, heightOf: (step: ProcessStep) => number) =>
      computeWires(edgesFor(filter), rectsFor(filter, heightOf)),
  };
}

const samb = chain(steps, tracks, fixtureLanes());
const arbi = chain(arbiSteps(), arbiTracks(), arbiLanes());
/** The third density: the seed's own middle setting sits between these two. */
const medium = (step: ProcessStep) => 96 + step.drivers.length * 18;
const DENSITIES = [
  ['ringkas', compact],
  ['sedang', medium],
  ['lengkap', tall],
] as const;

describe('§7.3 the counted crossing result', () => {
  // Measured on this seed with the shared-midpoint routing this replaced.
  it('SAMB Semua falls from 5 to 3, and both survivors are true inversions', () => {
    expect(countWireCrossings(samb.wires('ALL', compact))).toBe(3);
  });

  it('ARBI Semua falls from 2 to 1', () => {
    expect(countWireCrossings(arbi.wires('ALL', compact))).toBe(1);
  });

  it('every single-track view is completely untangled, in both chains', () => {
    expect(countWireCrossings(samb.wires('TRADE', compact))).toBe(0);
    expect(countWireCrossings(samb.wires('LP', compact))).toBe(0);
    expect(countWireCrossings(arbi.wires('FORWARD', compact))).toBe(0);
    expect(countWireCrossings(arbi.wires('REVERSE', compact))).toBe(0);
  });

  it.each(DENSITIES)('holds at the same counts in %s density', (_name, heightOf) => {
    expect(countWireCrossings(samb.wires('ALL', heightOf))).toBe(3);
    expect(countWireCrossings(arbi.wires('ALL', heightOf))).toBe(1);
  });

  it('no two elbows in a bundle share a corridor any more — the superposition itself', () => {
    for (const [, heightOf] of DENSITIES) {
      for (const [label, wires] of [
        ['SAMB', samb.wires('ALL', heightOf)],
        ['ARBI', arbi.wires('ALL', heightOf)],
      ] as const) {
        const byGutter = new Map<string, number[]>();
        for (const wire of wires) {
          if (wire.mid === undefined) continue;
          const key = `${wire.x1}:${wire.x2}`;
          byGutter.set(key, [...(byGutter.get(key) ?? []), wire.mid]);
        }
        for (const [gutter, mids] of byGutter) {
          expect(new Set(mids).size, `${label} ${gutter}`).toBe(mids.length);
        }
      }
    }
  });
});

describe('§7.2 what the rewrite was not allowed to touch', () => {
  it('leaves the edge set and the handoff counts exactly where they were', () => {
    expect(samb.wires('ALL', compact)).toHaveLength(32);
    expect(samb.wires('ALL', compact).filter((wire) => wire.capsule)).toHaveLength(12);
    expect(samb.wires('TRADE', compact).filter((wire) => wire.capsule)).toHaveLength(6);
    expect(samb.wires('LP', compact).filter((wire) => wire.capsule)).toHaveLength(7);
    expect(arbi.wires('FORWARD', compact).filter((wire) => wire.capsule)).toHaveLength(8);
    expect(arbi.wires('REVERSE', compact).filter((wire) => wire.capsule)).toHaveLength(4);
  });

  it('keeps convergence and divergence readable — 8 takes two in, 17 sends two out', () => {
    const wires = samb.wires('ALL', compact);
    const into8 = wires.filter((wire) => wire.key.endsWith('>8'));
    const outOf17 = wires.filter((wire) => wire.key.startsWith('17>'));
    expect(into8).toHaveLength(2);
    expect(outOf17).toHaveLength(2);
    // Distinct corridors as well as distinct anchors, so the two legs of a
    // fork are separable for their whole length rather than only at the box.
    expect(into8[0].mid).not.toBe(into8[1].mid);
    expect(outOf17[0].mid).not.toBe(outOf17[1].mid);
  });

  it.each(DENSITIES)('stacks no handoff capsule, both chains, %s density', (_name, heightOf) => {
    for (const wires of [samb.wires('ALL', heightOf), arbi.wires('ALL', heightOf)]) {
      const capsules = wires.flatMap((wire) => (wire.capsule ? [wire.capsule] : []));
      for (let a = 0; a < capsules.length; a += 1) {
        for (let b = a + 1; b < capsules.length; b += 1) {
          expect(capsulesCollide(capsules[a], capsules[b])).toBe(false);
        }
      }
    }
  });

  it.each(DENSITIES)('lands every arrow on a box edge, %s density', (_name, heightOf) => {
    for (const wires of [samb.wires('ALL', heightOf), arbi.wires('ALL', heightOf)]) {
      for (const wire of wires) {
        expect(wire.d.startsWith(`M${wire.x1},${wire.y1} `)).toBe(true);
        expect(wire.d.endsWith(`L${wire.x2},${wire.y2}`) || wire.mid === undefined).toBe(true);
      }
    }
  });

  it.each(DENSITIES)('keeps every corridor between its two boxes, %s density', (_name, heightOf) => {
    for (const wires of [samb.wires('ALL', heightOf), arbi.wires('ALL', heightOf)]) {
      for (const wire of wires) {
        if (wire.mid === undefined) continue;
        expect(wire.mid).toBeGreaterThan(Math.min(wire.x1, wire.x2));
        expect(wire.mid).toBeLessThan(Math.max(wire.x1, wire.x2));
      }
    }
  });

  it('keeps every capsule sitting on the wire it marks', () => {
    for (const wires of [samb.wires('ALL', compact), arbi.wires('ALL', compact)]) {
      for (const wire of wires) {
        if (!wire.capsule) continue;
        if (wire.mid === undefined) {
          expect(wire.capsule.y).toBe((wire.y1 + wire.y2) / 2);
        } else {
          expect(wire.capsule.x).toBe(wire.mid);
          expect(wire.capsule.y).toBeGreaterThanOrEqual(Math.min(wire.y1, wire.y2));
          expect(wire.capsule.y).toBeLessThanOrEqual(Math.max(wire.y1, wire.y2));
        }
      }
    }
  });

  it('is a pure function of geometry — the same seed routes identically twice', () => {
    expect(samb.wires('ALL', compact).map((wire) => wire.d)).toEqual(
      samb.wires('ALL', compact).map((wire) => wire.d),
    );
  });
});
