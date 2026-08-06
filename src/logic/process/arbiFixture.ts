/**
 * The ARBI B2C process seed as typed fixtures — the SAME source that
 * generated migration 20260806000053 (arbiProcessSeed.json is a byte-for-byte
 * copy of the companion seed file; the migration was emitted from it). The
 * tests over these fixtures are therefore tests over what the migration
 * inserts: counts (6/3/7/12/23/112/37), phase tiling over slots 1..23, the
 * FORWARD/REVERSE walks (21 steps 8 handoffs · 8 steps 4 handoffs), B12
 * unused, zero stacked cells, and the bridge.
 *
 * Ids are synthesized from natural keys, PREFIXED with the entity (a step's
 * id is `ARBI:<label>`) so that combined SAMB+ARBI fixture sets never
 * collide — the database generates uuids at insert time and nothing in the
 * logic layer depends on id shape, but 19 labels exist in both entities and
 * a bare-label id would merge them.
 *
 * NO FIGURES ANYWHERE IN THIS FILE OR IN THE JSON — the seed carries process
 * structure and data-needs text only.
 */
import type {
  ProcessGate,
  ProcessGateType,
  ProcessLane,
  ProcessNeed,
  ProcessNeedKind,
  ProcessNeedStatus,
  ProcessPhase,
  ProcessStep,
  ProcessStepItem,
  ProcessTrack,
  ProcessTrackDef,
} from '../../data/types';
import seed from './arbiProcessSeed.json';

interface ArbiSeedStep {
  label: string;
  slot: number;
  lane_key: string;
  co?: string;
  track: string;
  name: string;
  risk?: string;
  control?: string;
  note?: string;
  gate_id?: string | null;
  docs?: string[];
  coa?: { code: string; label: string }[];
  drivers?: string[];
  needs?: {
    item: string;
    kind: string;
    src?: string;
    owner?: string;
    status: string;
  }[];
}

const steps = seed.steps as ArbiSeedStep[];

/** The fixture id convention: entity-prefixed so SAMB+ARBI sets can mix. */
export function arbiStepId(label: string): string {
  return `ARBI:${label}`;
}

export function arbiTracks(): ProcessTrackDef[] {
  return seed.tracks.map((track) => ({
    entityCode: 'ARBI',
    code: track.code,
    label: track.label,
    ordinal: track.ordinal,
    isShared: track.is_shared,
  }));
}

export function arbiLanes(): ProcessLane[] {
  return seed.lanes.map((lane) => {
    const mapped: ProcessLane = {
      entityCode: 'ARBI',
      key: lane.key,
      label: lane.label,
      ordinal: lane.ordinal,
      isExternal: lane.is_external,
    };
    if (lane.description) mapped.description = lane.description;
    return mapped;
  });
}

export function arbiPhases(): ProcessPhase[] {
  return seed.phases.map((phase, index) => ({
    id: `arbi-phase-${index + 1}`,
    entityCode: 'ARBI',
    name: phase.name,
    slotFrom: phase.slot_from,
    slotTo: phase.slot_to,
  }));
}

export function arbiGates(): ProcessGate[] {
  return seed.gates.map((gate) => {
    const mapped: ProcessGate = {
      id: gate.id,
      entityCode: 'ARBI',
      type: gate.type as ProcessGateType,
      title: gate.title,
    };
    if (gate.sub) mapped.sub = gate.sub;
    if (gate.owner) mapped.owner = gate.owner;
    if (gate.unblock) mapped.unblock = gate.unblock;
    return mapped;
  });
}

export function arbiSteps(): ProcessStep[] {
  return steps.map((step) => {
    const mapped: ProcessStep = {
      id: arbiStepId(step.label),
      entityCode: 'ARBI',
      label: step.label,
      slot: step.slot,
      laneKey: step.lane_key,
      track: step.track as ProcessTrack,
      name: step.name,
      docs: step.docs ?? [],
      coa: step.coa ?? [],
      drivers: step.drivers ?? [],
    };
    if (step.co) mapped.co = step.co;
    if (step.risk) mapped.risk = step.risk;
    if (step.control) mapped.control = step.control;
    if (step.note) mapped.note = step.note;
    if (step.gate_id) mapped.gateId = step.gate_id;
    return mapped;
  });
}

export function arbiNeeds(): ProcessNeed[] {
  const rows: ProcessNeed[] = [];
  for (const step of steps) {
    for (const [index, need] of (step.needs ?? []).entries()) {
      const mapped: ProcessNeed = {
        id: `${arbiStepId(step.label)}-need-${index + 1}`,
        stepId: arbiStepId(step.label),
        item: need.item,
        kind: need.kind as ProcessNeedKind,
        status: need.status as ProcessNeedStatus,
      };
      if (need.src) mapped.src = need.src;
      if (need.owner) mapped.owner = need.owner;
      rows.push(mapped);
    }
  }
  return rows;
}

/**
 * The ARBI step → Finish line bridge, straight from the seed's step_items[].
 * item_id values are LIVE uuids read on 6 August — several are the same rows
 * SAMB's bridge feeds (Storing cost, Distribution cost, COGS — Logistic
 * provider…), which is the point: the cells differ by entity, and the
 * processModel parity test asserts migration 53 carries exactly these pairs.
 */
export function arbiStepItems(): ProcessStepItem[] {
  return seed.step_items.map((edge) => ({
    stepId: arbiStepId(edge.step_label),
    itemId: edge.item_id,
  }));
}

/** Raw (label, itemId) pairs for the migration-parity test. */
export function arbiBridgePairs(): Array<{ stepLabel: string; itemId: string }> {
  return seed.step_items.map((edge) => ({
    stepLabel: edge.step_label,
    itemId: edge.item_id,
  }));
}
