/**
 * SAMB operational process — pure derivations for the swimlane.
 *
 * THE ARROWS ARE DERIVED, NEVER STORED. An edge list in the seed would go
 * stale the first time a step moved; instead the flow is recomputed from two
 * path walks (TRADE and LP), so convergence (two arrows into put-away),
 * divergence (POD forking per track) and the handoff count all fall out of
 * the data. Within one walk two steps can never share a slot — the seed
 * guarantees it, and duplicateChainSlots() is the tripwire: when it reports
 * anything the seed is broken and the view must refuse to draw arrows rather
 * than guess an order.
 */
import type {
  ProcessGate,
  ProcessNeed,
  ProcessPhase,
  ProcessStep,
} from '../data/types';

/** The jalur filter. ALL shows both walks; KEDUANYA steps belong to both. */
export type TrackFilter = 'ALL' | 'TRADE' | 'LP';

export const TRACK_FILTERS: TrackFilter[] = ['ALL', 'TRADE', 'LP'];

export function stepVisible(step: ProcessStep, filter: TrackFilter): boolean {
  return filter === 'ALL' || step.track === 'KEDUANYA' || step.track === filter;
}

export function visibleSteps(steps: ProcessStep[], filter: TrackFilter): ProcessStep[] {
  return steps.filter((step) => stepVisible(step, filter));
}

export function maxSlot(steps: ProcessStep[]): number {
  return steps.reduce((highest, step) => Math.max(highest, step.slot), 0);
}

/** One walk: every step on the track (or shared), ascending by slot. */
export function chainFor(steps: ProcessStep[], track: 'TRADE' | 'LP'): ProcessStep[] {
  return steps
    .filter((step) => step.track === track || step.track === 'KEDUANYA')
    .sort((a, b) => a.slot - b.slot);
}

/**
 * Slots that appear twice INSIDE one walk. Always empty for a healthy seed;
 * non-empty means the chain order is ambiguous and arrows must not be drawn.
 */
export function duplicateChainSlots(
  steps: ProcessStep[],
): Array<{ track: 'TRADE' | 'LP'; slot: number }> {
  const problems: Array<{ track: 'TRADE' | 'LP'; slot: number }> = [];
  for (const track of ['TRADE', 'LP'] as const) {
    const seen = new Set<number>();
    for (const step of chainFor(steps, track)) {
      if (seen.has(step.slot)) problems.push({ track, slot: step.slot });
      seen.add(step.slot);
    }
  }
  return problems;
}

export interface ProcessEdge {
  from: ProcessStep;
  to: ProcessStep;
  /** True when the edge crosses lanes — a handoff, drawn heavy + labelled. */
  cross: boolean;
}

/**
 * Consecutive pairs of each active walk, deduped by (from.label, to.label) —
 * the shared spine (e.g. DO → picking) appears in both walks but is one
 * arrow. Identity is the label because the label IS the step's identity.
 */
export function deriveEdges(steps: ProcessStep[], filter: TrackFilter): ProcessEdge[] {
  const edges = new Map<string, ProcessEdge>();
  for (const track of ['TRADE', 'LP'] as const) {
    if (filter !== 'ALL' && filter !== track) continue;
    const chain = chainFor(steps, track);
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
 * label so 6a stands above 6b regardless of read order.
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
 * Phases must tile slot 1..highestSlot exactly once — no gap, no overlap.
 * Not enforceable in the table (each row only knows its own range), so this
 * is the check, asserted over the seed in tests and used by the view to
 * refuse a broken ribbon.
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
 * Gates no step references. G03, G07 and G09 land here BY DESIGN — they keep
 * the numbering aligned with the blocker register outside the app.
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
 * one track must not quote the global totals.
 */
export function processStats(
  steps: ProcessStep[],
  needs: ProcessNeed[],
  filter: TrackFilter,
): ProcessStats {
  const shown = visibleSteps(steps, filter);
  const visibleIds = new Set(shown.map((step) => step.id));
  const scoped = needs.filter((need) => visibleIds.has(need.stepId));
  return {
    visible: shown.length,
    total: steps.length,
    handoffCount: handoffs(deriveEdges(steps, filter)).length,
    needCount: scoped.length,
    needBelum: scoped.filter((need) => need.status === 'BELUM').length,
  };
}
