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
 *
 * GAP_W was 54 when the handoff badge was a 54px-wide text capsule that had
 * to fit inside a gutter. The badge is now an 11px diamond (the word moved to
 * the legend and the hover title), so the gutter no longer carries text and
 * narrows to 40 — which takes ~280px off the full canvas width and brings
 * neighbouring steps close enough to read as a chain.
 */
export const LABEL_W = 168;
export const BOX_W = 204;
export const GAP_W = 40;

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
  /**
   * The x of this wire's vertical run — its CORRIDOR. Absent on a level wire,
   * which is a single horizontal segment. Exposed because the crossing count
   * is computed from it, and a routing change that does not move the numbers
   * is a routing change that did nothing.
   */
  mid?: number;
}

export interface WireSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  horizontal: boolean;
}

/**
 * The wire as axis-aligned segments. The rounded corners are ignored: at a
 * radius of ≤10 they cannot change which pairs of wires meet, only where by a
 * few pixels, and treating the elbow as square keeps the count exact rather
 * than approximate.
 */
export function wireSegments(wire: Wire): WireSegment[] {
  if (wire.mid === undefined) {
    return [{ x1: wire.x1, y1: wire.y1, x2: wire.x2, y2: wire.y2, horizontal: true }];
  }
  return [
    { x1: wire.x1, y1: wire.y1, x2: wire.mid, y2: wire.y1, horizontal: true },
    { x1: wire.mid, y1: wire.y1, x2: wire.mid, y2: wire.y2, horizontal: false },
    { x1: wire.mid, y1: wire.y2, x2: wire.x2, y2: wire.y2, horizontal: true },
  ];
}

const EPS = 0.5;
const span = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);
/** Strictly inside, so a shared endpoint at a box edge is not a crossing. */
const within = (value: number, a: number, b: number): boolean => {
  const [lo, hi] = span(a, b);
  return value > lo + EPS && value < hi - EPS;
};
const overlaps = (a1: number, a2: number, b1: number, b2: number): boolean => {
  const [aLo, aHi] = span(a1, a2);
  const [bLo, bHi] = span(b1, b2);
  return aLo < bHi - EPS && bLo < aHi - EPS;
};

function segmentsMeet(a: WireSegment, b: WireSegment): boolean {
  if (a.horizontal && !b.horizontal) {
    return within(b.x1, a.x1, a.x2) && within(a.y1, b.y1, b.y2);
  }
  if (!a.horizontal && b.horizontal) return segmentsMeet(b, a);
  // Parallel: only collinear runs count, and those are the worst case — two
  // arrows drawn along the same pixels are not "crossing", they are one line
  // pretending to be one line.
  if (a.horizontal) {
    return Math.abs(a.y1 - b.y1) <= EPS && overlaps(a.x1, a.x2, b.x1, b.x2);
  }
  return Math.abs(a.x1 - b.x1) <= EPS && overlaps(a.y1, a.y2, b.y1, b.y2);
}

/**
 * How many times the drawn wires meet each other. This is the number §7.3
 * asks to move, and it is counted rather than eyeballed: a pair contributes
 * once per pair of segments that intersect or run collinear, so a bundle
 * sharing one corridor scores heavily — which is exactly the complaint.
 */
export function countWireCrossings(wires: Wire[]): number {
  const segments = wires.map(wireSegments);
  let total = 0;
  for (let a = 0; a < wires.length; a += 1) {
    for (let b = a + 1; b < wires.length; b += 1) {
      for (const segA of segments[a]) {
        for (const segB of segments[b]) {
          if (segmentsMeet(segA, segB)) total += 1;
        }
      }
    }
  }
  return total;
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

/**
 * Capsules collide when BOTH axes are within range; separation must clear one.
 *
 * The clearances predate the marker shrinking from a 54×16 capsule to an
 * 11px diamond and are KEPT at the old values on purpose: 22/18 around an
 * 11px glyph guarantees daylight between any two markers, not merely
 * non-overlap. Do not lower them to "fit more in" — the whole point of the
 * anti-stack is that two handoffs near each other stay two events.
 */
const CAPSULE_X_CLEARANCE = 22;
const CAPSULE_Y_CLEARANCE = 18;
const CAPSULE_MAX_SHIFTS = 8;

export function capsulesCollide(a: Capsule, b: Capsule): boolean {
  return (
    Math.abs(a.x - b.x) <= CAPSULE_X_CLEARANCE && Math.abs(a.y - b.y) <= CAPSULE_Y_CLEARANCE
  );
}

/**
 * Steps that CLEAR the clearances rather than land on them — 20 > 18 and
 * 24 > 22, because capsulesCollide treats exact-clearance as still stacked.
 */
const CAPSULE_SLIDE_Y = 20;
const CAPSULE_SLIDE_X = 24;
/** Keeps a slid capsule on the straight part, clear of the ~10px corner. */
const CAPSULE_RUN_PAD = 12;

/**
 * A HANDOFF marker sits where its wire crosses between lanes. When two of
 * them land on top of each other one has to move, and it MOVES ALONG ITS OWN
 * WIRE: down or up the vertical run for an elbow, left or right for a level
 * wire.
 *
 * This replaces a shift that moved the wire's corridor instead. That had the
 * marker deciding where the arrow went — the tail wagging the dog — and on a
 * 40px gutter its eight 22px steps could add 176px, carrying the corridor
 * past the target box and folding the arrow back over itself. Sliding keeps
 * the marker on its line, leaves routing alone, and has room to work: a
 * handoff crosses lanes by definition, so its vertical run is at least one
 * lane tall (~227px in compact).
 *
 * Candidates alternate outward from the midpoint so a marker stays as near
 * the crossing as it can, and every one is clamped inside the run — a marker
 * off the end of its own wire is worse than one slightly off-centre.
 */
function placeCapsule(
  along: 'x' | 'y',
  midX: number,
  midY: number,
  from: number,
  to: number,
  placed: readonly Capsule[],
): Capsule {
  const step = along === 'y' ? CAPSULE_SLIDE_Y : CAPSULE_SLIDE_X;
  const lo = Math.min(from, to) + CAPSULE_RUN_PAD;
  const hi = Math.max(from, to) - CAPSULE_RUN_PAD;
  const base = along === 'y' ? midY : midX;
  const at = (value: number): Capsule =>
    along === 'y' ? { x: midX, y: value } : { x: value, y: midY };
  for (let shift = 0; shift <= CAPSULE_MAX_SHIFTS; shift += 1) {
    for (const direction of shift === 0 ? [1] : [1, -1]) {
      const value = base + direction * shift * step;
      if (lo <= hi && (value < lo || value > hi)) continue;
      const candidate = at(value);
      if (!placed.some((existing) => capsulesCollide(existing, candidate))) return candidate;
    }
  }
  return at(base);
}

// --- per-edge corridors (§7.1) ----------------------------------------------
//
// THE DEFECT. Every elbow used to turn at (x1 + x2) / 2 — the middle of the
// gutter. Two edges spanning the same gutter therefore ran their verticals
// along IDENTICAL pixels. Measured on the SAMB seed, four pairs did exactly
// that: 15a>16 and 15b>16 shared 344px of line, 4>6a and 5>6b shared 227px,
// 18a>19 and 18b>20 shared 120px, and 19>23 and 20>21 were superimposed over
// their whole 107px run in opposite directions. That is not a crossing to be
// marked, it is two arrows pretending to be one, and no crossing marker can
// help a reader follow either of them.
//
// THE FIX. Each edge crossing a gutter gets its own x inside it. Ordering is
// what makes this worth doing rather than merely different:
//
//   Corridors are assigned by DESCENDING TARGET y, left to right — the edge
//   landing lowest turns first.
//
// Why that way round: an edge's exit run travels from its own corridor
// rightward to its target, so it passes every corridor to its right. Give the
// lowest-landing edge the leftmost corridor and its long exit passes under
// the others' verticals rather than through them. Two edges then cross only
// when their source order and target order genuinely disagree — an inversion
// no routing can remove — and never merely because they shared a gutter.
//
// The step is capped by the gutter itself, so a busy gutter packs tighter
// rather than spilling into the boxes on either side.

const CORRIDOR_STEP = 14;
/** Keeps a corridor clear of both box edges, so the elbow radius survives. */
const CORRIDOR_MARGIN = 8;

/** The x range a corridor may occupy: inside the span, off both box walls. */
function corridorBand(x1: number, x2: number): [number, number] {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  const margin = Math.min(CORRIDOR_MARGIN, (hi - lo) / 2);
  return [lo + margin, hi - margin];
}

/**
 * Where a corridor wants to sit before its bundle spreads it: the middle of
 * the span, which for the adjacent-column edges that make up almost all of
 * both chains is the middle of the gutter.
 *
 * COLUMN-SKIPPING EDGES WERE TRIED BOTH OTHER WAYS AND THE MIDDLE WON. A few
 * edges skip columns (SAMB's 1>5 spans 284px; ARBI reaches six columns), and
 * their midpoint lands inside an intervening box column rather than a gutter.
 * Turning them in the gutter just before the target, or just after the source,
 * both looked more principled and both measured worse on the seed — SAMB's
 * `Semua` count went 3 → 4 either way, and ARBI's 1 → 3 turning early, because
 * each variant only trades which long run does the cutting. Leaving them at
 * the midpoint is the measured answer, not the unexamined default. If this is
 * revisited, move the number, not the aesthetics.
 */
function corridorCentre(x1: number, x2: number): number {
  return (x1 + x2) / 2;
}

interface CorridorInput {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  level: boolean;
}

/**
 * Lowest target first. Source y breaks a tie, and the key breaks that, so the
 * assignment is a pure function of geometry — the same seed lays out the same
 * way on every render, which matters because these coordinates come from DOM
 * measurement and are recomputed on every resize.
 */
function byDescendingTarget(a: CorridorInput, b: CorridorInput): number {
  if (b.y2 !== a.y2) return b.y2 - a.y2;
  if (b.y1 !== a.y1) return b.y1 - a.y1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * One corridor x per elbow wire. Level wires get none — they are a single
 * horizontal segment and never occupy a gutter.
 */
function assignCorridors(anchors: readonly CorridorInput[]): Map<string, number> {
  const groups = new Map<number, CorridorInput[]>();
  for (const anchor of anchors) {
    if (anchor.level) continue;
    // Grouped by the corridor they WOULD have shared, so edges of different
    // column spans that happen to collide are separated too — not only the
    // same-gutter case.
    const centre = Math.round(corridorCentre(anchor.x1, anchor.x2));
    groups.set(centre, [...(groups.get(centre) ?? []), anchor]);
  }

  const corridor = new Map<string, number>();
  for (const [centre, group] of groups) {
    const ordered = [...group].sort(byDescendingTarget);
    const narrowest = Math.min(
      ...group.map((anchor) => {
        const [lo, hi] = corridorBand(anchor.x1, anchor.x2);
        return hi - lo;
      }),
    );
    const step =
      ordered.length > 1 ? Math.min(CORRIDOR_STEP, narrowest / (ordered.length - 1)) : 0;
    ordered.forEach((anchor, index) => {
      const ideal = centre + (index - (ordered.length - 1) / 2) * step;
      const [lo, hi] = corridorBand(anchor.x1, anchor.x2);
      corridor.set(anchor.key, Math.min(hi, Math.max(lo, ideal)));
    });
  }
  return corridor;
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

  // --- pass 1: anchors ------------------------------------------------------
  const anchors = drawable.map((edge) => {
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
    return { edge, key, x1, y1, x2, y2, level: Math.abs(y1 - y2) < 2 };
  });

  const corridor = assignCorridors(anchors);

  // --- pass 2: paths --------------------------------------------------------
  const placed: Capsule[] = [];
  const wires: Wire[] = [];
  for (const anchor of anchors) {
    const { edge, key, x1, y1, x2, y2 } = anchor;
    let d: string;
    let capsule: Capsule | undefined;
    let mid: number | undefined;
    if (anchor.level) {
      d = `M${x1},${y1} L${x2},${y2}`;
      if (edge.cross) {
        capsule = placeCapsule('x', (x1 + x2) / 2, (y1 + y2) / 2, x1, x2, placed);
      }
    } else {
      const gx = corridor.get(key) as number;
      if (edge.cross) {
        // Corridors already separate most markers, because each one rides its
        // own. This handles what corridors cannot: two handoffs at the same x
        // AND the same height.
        capsule = placeCapsule('y', gx, (y1 + y2) / 2, y1, y2, placed);
      }
      mid = gx;
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
    if (mid !== undefined) wire.mid = mid;
    if (capsule) wire.capsule = capsule;
    wires.push(wire);
  }
  return wires;
}
