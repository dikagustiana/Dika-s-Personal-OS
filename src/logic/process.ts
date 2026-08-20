/**
 * Operational process — pure derivations for the swimlane, per entity.
 *
 * THE ARROWS ARE DERIVED, NEVER STORED. An edge list in the seed would go
 * stale the first time a step moved; instead the flow is recomputed from one
 * path walk per BRANCH track, so convergence (two arrows into put-away),
 * divergence (POD forking per track) and the handoff count all fall out of
 * the data. Within one walk, a slot holds at most one BRANCH step and at
 * most one SHARED step: a branch+shared pair is the schema's parallel-branch
 * doctrine landing inside a walk (KGR trading, slot 6) and draws as a fan;
 * two of the SAME population on one slot is a broken seed, and
 * duplicateChainSlots() is the tripwire — when it reports anything the view
 * refuses to draw arrows rather than guess an order.
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
 * KGR IS THE RULE'S OWN PROOF, IN BOTH DIRECTIONS. Under KARKAS/OLAHAN the
 * branches covered 92% and 97% and the control was hidden — the excursion of
 * four boxes kept its information as chips. The sourcing retrack
 * (20260820000087) replaced that axis with RPA/TRADING, which partitions the
 * chain, and the same rule flips the control back on with no code change.
 *
 * At 80%, on the three chains as seeded today:
 *   SAMB  Trade 19/30 (63%) · LP 20/30 (67%)          → shown
 *   ARBI  Forward 21/23 (91%) · Reverse 8/23 (35%)    → shown
 *   KGR   RPA 38/48 (79%) · Trading 23/48 (48%)       → shown
 * KGR's RPA sits one point under the ceiling — deliberately stated, not an
 * accident: RPA ∪ shared IS the whole slaughter chain, and the button that
 * shows it is really the button that hides the ten trading boxes. The
 * decisive branch is Trading at 48%.
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
 * Slots where one walk's order is genuinely AMBIGUOUS: two BRANCH steps, or
 * two SHARED steps, on the same slot. Always empty for a healthy seed;
 * non-empty means arrows must not be drawn, because any order would be a
 * guess.
 *
 * A branch step and a SHARED step sharing a slot is deliberately NOT flagged:
 * that is the schema's own parallel-branch doctrine ("two steps MAY share a
 * slot — a parallel branch, not a duplicate") arriving inside one walk. KGR's
 * trading chain made it real — T6 (QC penerimaan) and the shared AP step both
 * sit at slot 6 — and deriveEdges draws that column as a fan: both follow the
 * previous slot, both precede the next, and no order between them is claimed.
 */
export function duplicateChainSlots(
  steps: ProcessStep[],
  tracks: ProcessTrackDef[],
): Array<{ track: string; slot: number }> {
  const shared = sharedTrackCodes(tracks);
  const problems: Array<{ track: string; slot: number }> = [];
  for (const branch of branchTracks(tracks)) {
    const seenBranch = new Set<number>();
    const seenShared = new Set<number>();
    for (const step of chainFor(steps, branch.code, shared)) {
      const seen = shared.has(step.track) ? seenShared : seenBranch;
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
 *
 * A walk is a sequence of SLOT GROUPS, not of steps: two steps legally
 * sharing a slot (a branch step beside a shared one — KGR trading's slot 6)
 * are parallel work, so every member of one group points at every member of
 * the next. A chain whose groups are all singletons — SAMB and ARBI — draws
 * exactly what it always drew.
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
    const groups: ProcessStep[][] = [];
    for (const step of chain) {
      const last = groups[groups.length - 1];
      if (last && last[0].slot === step.slot) last.push(step);
      else groups.push([step]);
    }
    for (let i = 1; i < groups.length; i += 1) {
      for (const from of groups[i - 1]) {
        for (const to of groups[i]) {
          edges.set(`${from.label}>${to.label}`, {
            from,
            to,
            cross: from.laneKey !== to.laneKey,
          });
        }
      }
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

/** Rows of the default ribbon: no track scope. The tiling invariant is theirs. */
export function defaultPhases(phases: ProcessPhase[]): ProcessPhase[] {
  return phases.filter((phase) => !phase.track);
}

/**
 * DEFAULT-RIBBON phases must tile slot 1..highestSlot exactly once — no gap,
 * no overlap — PER ENTITY: callers pass one entity's TRACK-NULL phases (see
 * defaultPhases) against that entity's highest slot. Track-scoped rows live
 * under scopedPhaseProblems, whose invariant deliberately allows gaps. Not
 * enforceable in the table (each row only knows its own range), so this is
 * the check, asserted over the seeds in tests and used by the view to refuse
 * a broken ribbon.
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

/**
 * TRACK-SCOPED ribbon rows carry a different invariant from the default
 * ribbon (20260820000086): within one track they must not overlap each
 * other, and together they must cover every slot that carries a step
 * REACHABLE on that track — the track's own steps plus the shared spine.
 * They need not tile: a gap over unreachable slots is a true statement that
 * the walk jumps, never a problem. Tracks with no scoped rows are vacuous —
 * they fall back to the default ribbon everywhere.
 */
export function scopedPhaseProblems(
  phases: ProcessPhase[],
  steps: ProcessStep[],
  tracks: ProcessTrackDef[],
): string[] {
  const problems: string[] = [];
  const shared = sharedTrackCodes(tracks);
  const byTrack = new Map<string, ProcessPhase[]>();
  for (const phase of phases) {
    if (!phase.track) continue;
    const group = byTrack.get(phase.track);
    if (group) group.push(phase);
    else byTrack.set(phase.track, [phase]);
  }
  for (const [trackCode, scoped] of [...byTrack.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...scoped].sort((a, b) => a.slotFrom - b.slotFrom);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      const next = ordered[i];
      if (next.slotFrom <= prev.slotTo) {
        problems.push(
          `${trackCode}: ${prev.name} × ${next.name} tumpang tindih di slot ${next.slotFrom}–${Math.min(prev.slotTo, next.slotTo)}`,
        );
      }
    }
    const reachable = [...new Set(
      steps
        .filter((step) => stepVisible(step, trackCode, shared))
        .map((step) => step.slot),
    )].sort((a, b) => a - b);
    const uncovered = reachable.filter(
      (slot) => !scoped.some((phase) => slot >= phase.slotFrom && slot <= phase.slotTo),
    );
    if (uncovered.length > 0) {
      problems.push(`${trackCode}: slot terjangkau tanpa fase — ${uncovered.join(', ')}`);
    }
  }
  return problems;
}

/**
 * One drawable ribbon segment. `phaseId` is the REAL phase row (the panel
 * opens it); a default-ribbon phase partially shadowed by a scoped row is
 * split into fragments that keep its id, so `key` — unique per fragment —
 * is the render key.
 */
export interface RibbonSegment {
  key: string;
  phaseId: string;
  name: string;
  slotFrom: number;
  slotTo: number;
}

/**
 * The ribbon under a filter, resolved per §6.2 of the sourcing-split brief:
 * for each slot, a phase whose track matches the active filter wins over the
 * default (track-null) ribbon; with no filter active the default wins
 * everywhere (scoped rows are for a chosen walk, not for the stacked view).
 * Adjacent slots resolving to the same phase merge back into one segment.
 */
export function ribbonSegments(
  phases: ProcessPhase[],
  filter: TrackFilter,
  highestSlot: number,
): RibbonSegment[] {
  const base = defaultPhases(phases);
  const scoped = filter === ALL_TRACKS ? [] : phases.filter((phase) => phase.track === filter);
  const at = (slot: number): ProcessPhase | undefined =>
    scoped.find((phase) => slot >= phase.slotFrom && slot <= phase.slotTo) ??
    base.find((phase) => slot >= phase.slotFrom && slot <= phase.slotTo);
  const segments: RibbonSegment[] = [];
  for (let slot = 1; slot <= highestSlot; slot += 1) {
    const phase = at(slot);
    if (!phase) continue;
    const last = segments[segments.length - 1];
    if (last && last.phaseId === phase.id && last.slotTo === slot - 1) {
      last.slotTo = slot;
    } else {
      segments.push({
        key: `${phase.id}:${slot}`,
        phaseId: phase.id,
        name: phase.name,
        slotFrom: slot,
        slotTo: slot,
      });
    }
  }
  return segments;
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
