/**
 * Arrow geometry for the swimlane, kept pure so the anti-overlap rule and
 * the box-edge landing rule are TESTABLE — the failure mode here is silent
 * (arrows vanish or capsules cover each other, nothing throws), so the only
 * guard that works is an assertion over the computed geometry.
 *
 * Coordinates are relative to the grid element; the caller measures boxes
 * with offsetLeft/offsetTop AGAINST THE GRID (the cells must stay
 * position-less for that — see the view) and passes rects in.
 */

/**
 * §6.1 grid constants — deliberately constants, not design tokens: they are
 * measurement geometry, shared verbatim by the view's grid template and the
 * geometry tests.
 */
export const LABEL_W = 168;
export const BOX_W = 204;
export const GAP_W = 54;

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An edge by step label — decoupled from ProcessStep so tests can synthesize. */
export interface WireEdge {
  fromLabel: string;
  toLabel: string;
  cross: boolean;
}

export interface Capsule {
  x: number;
  y: number;
}

export interface Wire {
  key: string;
  d: string;
  cross: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  capsule?: Capsule;
}

/**
 * Anchor near the TOP of the box, not the middle: in tempel mode a box can
 * be several hundred pixels tall and a centre anchor would drag every arrow
 * across the content of neighbouring boxes.
 */
function anchorY(rect: BoxRect): number {
  return rect.y + Math.min(rect.h / 2, 26);
}

/** Spread formula for multiple arrows on one side of one box. */
function fanOffset(index: number, count: number, h: number): number {
  if (count <= 1) return 0;
  return (index - (count - 1) / 2) * Math.min(7, (h - 14) / count);
}

/** Capsules collide when BOTH axes are within range; separation must clear one. */
const CAPSULE_X_CLEARANCE = 22;
const CAPSULE_Y_CLEARANCE = 18;
const CAPSULE_MAX_SHIFTS = 8;

export function capsulesCollide(a: Capsule, b: Capsule): boolean {
  return (
    Math.abs(a.x - b.x) <= CAPSULE_X_CLEARANCE && Math.abs(a.y - b.y) <= CAPSULE_Y_CLEARANCE
  );
}

/**
 * Build every wire. Edges whose rects are missing are skipped (a filtered-out
 * box has no rect). HANDOFF capsules are anti-stacked: while a new capsule
 * sits within 22px horizontally AND 18px vertically of a placed one, its
 * elbow shifts +22px right, at most eight times — two handoffs in the seed
 * would otherwise cover each other exactly.
 */
export function computeWires(edges: WireEdge[], rects: ReadonlyMap<string, BoxRect>): Wire[] {
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  const drawable = edges.filter(
    (edge) => rects.has(edge.fromLabel) && rects.has(edge.toLabel),
  );
  for (const edge of drawable) {
    outCount.set(edge.fromLabel, (outCount.get(edge.fromLabel) ?? 0) + 1);
    inCount.set(edge.toLabel, (inCount.get(edge.toLabel) ?? 0) + 1);
  }

  // Deterministic fan order: arrows leave/enter sorted by the counterpart's
  // vertical position, so a divergence fans downward without crossing at the
  // box edge.
  const outIndex = new Map<string, number>();
  const inIndex = new Map<string, number>();
  const byCounterpartY = (labelOf: (edge: WireEdge) => string) => (a: WireEdge, b: WireEdge) =>
    anchorY(rects.get(labelOf(a)) as BoxRect) - anchorY(rects.get(labelOf(b)) as BoxRect);
  for (const [label, count] of outCount) {
    if (count < 2) continue;
    drawable
      .filter((edge) => edge.fromLabel === label)
      .sort(byCounterpartY((edge) => edge.toLabel))
      .forEach((edge, index) => outIndex.set(`${edge.fromLabel}>${edge.toLabel}`, index));
  }
  for (const [label, count] of inCount) {
    if (count < 2) continue;
    drawable
      .filter((edge) => edge.toLabel === label)
      .sort(byCounterpartY((edge) => edge.fromLabel))
      .forEach((edge, index) => inIndex.set(`${edge.fromLabel}>${edge.toLabel}`, index));
  }

  const placed: Capsule[] = [];
  const wires: Wire[] = [];
  for (const edge of drawable) {
    const key = `${edge.fromLabel}>${edge.toLabel}`;
    const from = rects.get(edge.fromLabel) as BoxRect;
    const to = rects.get(edge.toLabel) as BoxRect;
    const x1 = from.x + from.w;
    const y1 =
      anchorY(from) +
      fanOffset(outIndex.get(key) ?? 0, outCount.get(edge.fromLabel) ?? 1, from.h);
    const x2 = to.x;
    const y2 =
      anchorY(to) + fanOffset(inIndex.get(key) ?? 0, inCount.get(edge.toLabel) ?? 1, to.h);

    let d: string;
    let capsule: Capsule | undefined;
    if (Math.abs(y1 - y2) < 2) {
      d = `M${x1},${y1} L${x2},${y2}`;
      if (edge.cross) capsule = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    } else {
      let gx = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      if (edge.cross) {
        let shifts = 0;
        while (
          placed.some((existing) => capsulesCollide(existing, { x: gx, y: midY })) &&
          shifts < CAPSULE_MAX_SHIFTS
        ) {
          gx += CAPSULE_X_CLEARANCE;
          shifts += 1;
        }
        capsule = { x: gx, y: midY };
      }
      // Radius ~10, clamped so a short vertical run or a narrow gutter can
      // never make the curve overshoot its own segment.
      const sign = Math.sign(y2 - y1);
      const radius = Math.min(10, Math.abs(y2 - y1) / 2, Math.abs(gx - x1), Math.abs(x2 - gx));
      d =
        `M${x1},${y1} L${gx - radius},${y1} Q${gx},${y1} ${gx},${y1 + sign * radius} ` +
        `L${gx},${y2 - sign * radius} Q${gx},${y2} ${gx + radius},${y2} L${x2},${y2}`;
    }
    if (capsule) placed.push(capsule);
    const wire: Wire = { key, d, cross: edge.cross, x1, y1, x2, y2 };
    if (capsule) wire.capsule = capsule;
    wires.push(wire);
  }
  return wires;
}
