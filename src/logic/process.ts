/**
 * Operational process — pure derivations for the swimlane, per entity.
 *
 * THE ARROWS ARE DERIVED, NEVER STORED. An edge list in the seed would go
 * stale the first time a step moved; instead the flow is recomputed from one
 * path walk per BRANCH track, so convergence (two arrows into put-away),
 * divergence (POD forking per track) and the handoff count all fall out of
 * the data. Within one walk two steps can never share a slot — the seed
 * guarantees it, and duplicateChainSlots() is the tripwire: when it reports
 * anything the seed is broken and the view must refuse to draw arrows rather
 * than guess an order.
 *
 * SINCE MIGRATION 52 THE TRACK VOCABULARY IS DATA (os_process_tracks), so
 * every derivation here takes the entity's ProcessTrackDef[] instead of
 * assuming TRADE/LP: SAMB walks TRADE and LP, ARBI walks FORWARD and
 * REVERSE, and the one is_shared track per entity (KEDUANYA in both) joins
 * every walk. Callers pass ONE entity's steps and ONE entity's tracks —
 * mixing entities here would dedupe edges across chains that merely share
 * label text.
 */
import type {
  ProcessGate,
  ProcessNeed,
  ProcessPhase,
  ProcessStep,
  ProcessTrackDef,
} from '../data/types';

/**
 * The jalur filter: 'ALL', or one branch track CODE of the entity in view.
 * An open string because the codes live in os_process_tracks now.
 */
export type TrackFilter = string;

export const ALL_TRACKS: TrackFilter = 'ALL';

/** Branch tracks — the filter buttons and the walk roots — by ordinal. */
export function branchTracks(tracks: ProcessTrackDef[]): ProcessTrackDef[] {
  return tracks
    .filter((track) => !track.isShared)
    .sort((a, b) => a.ordinal - b.ordinal);
}

/** The shared-track codes: steps on these belong to every walk. */
export function sharedTrackCodes(tracks: ProcessTrackDef[]): Set<string> {
  return new Set(tracks.filter((track) => track.isShared).map((track) => track.code));
}

export function stepVisible(
  step: ProcessStep,
  filter: TrackFilter,
  shared: ReadonlySet<string>,
): boolean {
  return filter === ALL_TRACKS || shared.has(step.track) || step.track === filter;
}

export function visibleSteps(
  steps: ProcessStep[],
  filter: TrackFilter,
  shared: ReadonlySet<string>,
): ProcessStep[] {
  return steps.filter((step) => stepVisible(step, filter, shared));
}

// --- is the jalur filter worth showing? -------------------------------------

/**
 * ===========================================================================
 * A FILTER THAT SHOWS ALMOST EVERYTHING IS NOT A FILTER.
 * ===========================================================================
 * KGR has three tracks, but only four of its 38 steps are anything other than
 * KEDUANYA. Pressing `Karkas` hides three boxes and `Olahan` hides one — the
 * control costs a row of chrome and a decision, and returns nothing.
 *
 * THE DATA IS RIGHT AND IS NOT WHAT GETS FIXED. KGR genuinely is one chain
 * with short excursions: one input, one line, one split-off at the carcass,
 * three further-processing steps, then back onto the same spine. That is a
 * different SHAPE from SAMB, where trade and LP run side by side end to end,
 * and from ARBI, whose forward and reverse legs enter through different doors.
 * The track chips on the boxes still have to mark those four excursion steps,
 * so the information stays; only the control goes.
 *
 * THE RULE IS DERIVED, NEVER A LIST OF ENTITIES. A fourth chain seeded
 * tomorrow decides for itself, with no code change and nothing to keep in
 * sync — the same property that makes the entity picker build itself from
 * `distinct entity_code`.
 *
 * Hide when EVERY branch covers more than the ceiling. One narrow branch is
 * enough to make the control useful, which is why ARBI keeps it: Forward
 * reaches 91% but Reverse reaches 35%, and pressing Reverse is a real answer
 * to a real question. Requiring BOTH to be narrow would have taken ARBI's
 * filter away for no reason.
 *
 * Coverage is measured with stepVisible, so it counts exactly what the canvas
 * would render — shared steps included. Any other definition would drift from
 * what the button actually does.
 *
 * At 80%, on the three chains that exist:
 *   SAMB  Trade 19/30 (63%) · LP 20/30 (67%)        → shown
 *   ARBI  Forward 21/23 (91%) · Reverse 8/23 (35%)  → shown
 *   KGR   Karkas 35/38 (92%) · Olahan 37/38 (97%)   → hidden
 * The nearest call is ARBI's Reverse at 35%, a wide margin below, and KGR's
 * Karkas at 92%, a wide margin above. Nothing sits near the line.
 */
export const TRACK_FILTER_COVERAGE_CEILING = 0.8;

export interface BranchCoverage {
  code: string;
  label: string;
  covered: number;
  total: number;
  /** Share of the entity's steps this branch would still show, 0..1. */
  ratio: number;
}

export function branchCoverage(
  steps: ProcessStep[],
  tracks: ProcessTrackDef[],
): BranchCoverage[] {
  const shared = sharedTrackCodes(tracks);
  return branchTracks(tracks).map((track) => {
    const covered = steps.filter((step) => stepVisible(step, track.code, shared)).length;
    return {
      code: track.code,
      label: track.label,
      covered,
      total: steps.length,
      // No steps means nothing to narrow; 1 reads as "covers everything", which
      // sends the caller down the hide branch rather than dividing by zero.
      ratio: steps.length === 0 ? 1 : covered / steps.length,
    };
  });
}

/**
 * True when at least one branch narrows the view enough to be worth offering.
 * Zero branch tracks is false — there is nothing to choose between.
 */
export function trackFilterDiscriminates(
  steps: ProcessStep[],
  tracks: ProcessTrackDef[],
  ceiling: number = TRACK_FILTER_COVERAGE_CEILING,
): boolean {
  const coverage = branchCoverage(steps, tracks);
  if (coverage.length === 0) return false;
  return coverage.some((branch) => branch.ratio <= ceiling);
}

export function maxSlot(steps: ProcessStep[]): number {
  return steps.reduce((highest, step) => Math.max(highest, step.slot), 0);
}

/** One walk: every step on the branch track (or shared), ascending by slot. */
export function chainFor(
  steps: ProcessStep[],
  track: string,
  shared: ReadonlySet<string>,
): ProcessStep[] {
  return steps
    .filter((step) => step.track === track || shared.has(step.track))
    .sort((a, b) => a.slot - b.slot);
}

/**
 * Slots that appear twice INSIDE one walk. Always empty for a healthy seed;
 * non-empty means the chain order is ambiguous and arrows must not be drawn.
 */
export function duplicateChainSlots(
  steps: ProcessStep[],
  tracks: ProcessTrackDef[],
): Array<{ track: string; slot: number }> {
  const shared = sharedTrackCodes(tracks);
  const problems: Array<{ track: string; slot: number }> = [];
  for (const branch of branchTracks(tracks)) {
    const seen = new Set<number>();
    for (const step of chainFor(steps, branch.code, shared)) {
      if (seen.has(step.slot)) problems.push({ track: branch.code, slot: step.slot });
      seen.add(step.slot);
    }
  }
  return problems;
}

export interface ProcessEdge {
  from: ProcessStep;
  to: ProcessStep;
  /** True when the edge crosses lanes — a handoff, drawn heavy + marked. */
  cross: boolean;
}

/**
 * Consecutive pairs of each active walk, deduped by (from.label, to.label) —
 * the shared spine (e.g. DO → picking) appears in every walk but is one
 * arrow. Identity is the label because the label IS the step's identity
 * within its entity — which is why this function must only ever see one
 * entity's steps.
 */
export function deriveEdges(
  steps: ProcessStep[],
  filter: TrackFilter,
  tracks: ProcessTrackDef[],
): ProcessEdge[] {
  const shared = sharedTrackCodes(tracks);
  const edges = new Map<string, ProcessEdge>();
  for (const branch of branchTracks(tracks)) {
    if (filter !== ALL_TRACKS && filter !== branch.code) continue;
    const chain = chainFor(steps, branch.code, shared);
    for (let i = 1; i < chain.length; i += 1) {
      const from = chain[i - 1];
      const to = chain[i];
      edges.set(`${from.label}>${to.label}`, {
        from,
        to,
        cross: from.laneKey !== to.laneKey,
      });
    }
  }
  return [...edges.values()];
}

export function handoffs(edges: ProcessEdge[]): ProcessEdge[] {
  return edges.filter((edge) => edge.cross);
}

export function cellKey(laneKey: string, slot: number): string {
  return `${laneKey}:${slot}`;
}

/**
 * Boxes grouped into cells by (lane, slot). Two steps in one cell is a
 * parallel branch rendered stacked — never a duplicate. Stack order is by
 * label so 6a stands above 6b regardless of read order. An entity with no
 * parallel branches (ARBI) simply never produces a group of two — the
 * stacking path stays live and renders nothing stacked.
 */
export function groupCells(steps: ProcessStep[]): Map<string, ProcessStep[]> {
  const cells = new Map<string, ProcessStep[]>();
  for (const step of steps) {
    const key = cellKey(step.laneKey, step.slot);
    const group = cells.get(key);
    if (group) group.push(step);
    else cells.set(key, [step]);
  }
  for (const group of cells.values()) {
    group.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }
  return cells;
}

/**
 * Phases must tile slot 1..highestSlot exactly once — no gap, no overlap —
 * PER ENTITY: callers pass one entity's phases against that entity's highest
 * slot. Not enforceable in the table (each row only knows its own range), so
 * this is the check, asserted over both seeds in tests and used by the view
 * to refuse a broken ribbon.
 */
export function phaseCoverageProblems(phases: ProcessPhase[], highestSlot: number): string[] {
  const problems: string[] = [];
  const ordered = [...phases].sort((a, b) => a.slotFrom - b.slotFrom);
  let expected = 1;
  for (const phase of ordered) {
    if (phase.slotTo < phase.slotFrom) {
      problems.push(`${phase.name}: slot_to ${phase.slotTo} < slot_from ${phase.slotFrom}`);
      continue;
    }
    if (phase.slotFrom > expected) {
      problems.push(`celah slot ${expected}–${phase.slotFrom - 1}`);
    } else if (phase.slotFrom < expected) {
      problems.push(`tumpang tindih di slot ${phase.slotFrom}–${Math.min(expected - 1, phase.slotTo)}`);
    }
    expected = Math.max(expected, phase.slotTo + 1);
  }
  if (expected <= highestSlot) problems.push(`celah slot ${expected}–${highestSlot}`);
  return problems;
}

/** Gate ids referenced by steps but absent from the gates table. */
export function unknownGateRefs(steps: ProcessStep[], gates: ProcessGate[]): string[] {
  const known = new Set(gates.map((gate) => gate.id));
  const missing = new Set<string>();
  for (const step of steps) {
    if (step.gateId && !known.has(step.gateId)) missing.add(step.gateId);
  }
  return [...missing].sort();
}

/**
 * Gates no step references. SAMB's G03/G07/G09 and ARBI's B12 land here BY
 * DESIGN — they keep the numbering aligned with the blocker registers
 * outside the app.
 */
export function unusedGates(steps: ProcessStep[], gates: ProcessGate[]): string[] {
  const used = new Set(steps.map((step) => step.gateId).filter(Boolean));
  return gates
    .map((gate) => gate.id)
    .filter((id) => !used.has(id))
    .sort();
}

export interface ProcessStats {
  visible: number;
  total: number;
  handoffCount: number;
  needCount: number;
  needBelum: number;
}

/**
 * The toolbar line. Need counts FOLLOW THE JALUR FILTER — the register for
 * one track must not quote the global totals. Needs may be passed unscoped:
 * the visible-step id set does the entity and track scoping in one pass.
 */
export function processStats(
  steps: ProcessStep[],
  needs: ProcessNeed[],
  filter: TrackFilter,
  tracks: ProcessTrackDef[],
): ProcessStats {
  const shared = sharedTrackCodes(tracks);
  const shown = visibleSteps(steps, filter, shared);
  const visibleIds = new Set(shown.map((step) => step.id));
  const scoped = needs.filter((need) => visibleIds.has(need.stepId));
  return {
    visible: shown.length,
    total: steps.length,
    handoffCount: handoffs(deriveEdges(steps, filter, tracks)).length,
    needCount: scoped.length,
    needBelum: scoped.filter((need) => need.status === 'BELUM').length,
  };
}
