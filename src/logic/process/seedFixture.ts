/**
 * The SAMB process seed as typed fixtures — the SAME source that generated
 * migration 20260806000051 (sambProcessSeed.json is a byte-for-byte copy of
 * the curated seed; the migration was emitted from it). The tests over these
 * fixtures are therefore tests over what the migration inserts: counts
 * (6/7/15/30/118), phase tiling, gate references, chain integrity and the
 * handoff counts the swimlane must reproduce.
 *
 * Ids are synthesized from natural keys (a step's id is its label) because
 * the database generates uuids at insert time; nothing in the logic layer
 * depends on id shape.
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
  ProcessTrack,
} from '../../data/types';
import seed from './sambProcessSeed.json';

interface SeedStep {
  label: string;
  slot: number;
  fn: string;
  co?: string;
  track: string;
  name: string;
  risk?: string;
  control?: string;
  note?: string;
  gap?: string;
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

const steps = seed.steps as SeedStep[];

export function fixtureLanes(): ProcessLane[] {
  return seed.lanes.map((lane) => {
    const mapped: ProcessLane = {
      key: lane.key,
      label: lane.label,
      ordinal: lane.ordinal,
      isExternal: lane.is_external,
    };
    const description = (seed.lane_desc as Record<string, string>)[lane.key];
    if (description) mapped.description = description;
    return mapped;
  });
}

export function fixturePhases(): ProcessPhase[] {
  return seed.phases.map((phase, index) => ({
    id: `phase-${index + 1}`,
    name: phase.name,
    slotFrom: phase.a,
    slotTo: phase.b,
  }));
}

export function fixtureGates(): ProcessGate[] {
  return seed.gates.map((gate) => {
    const mapped: ProcessGate = {
      id: gate.id,
      type: gate.type as ProcessGateType,
      title: gate.title,
    };
    if (gate.sub) mapped.sub = gate.sub;
    if (gate.owner) mapped.owner = gate.owner;
    if (gate.unblock) mapped.unblock = gate.unblock;
    return mapped;
  });
}

export function fixtureSteps(): ProcessStep[] {
  return steps.map((step) => {
    const mapped: ProcessStep = {
      id: step.label,
      label: step.label,
      slot: step.slot,
      laneKey: step.fn,
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
    // Empty string means no gate — the same '' → NULL rule the seed
    // migration applies.
    if (step.gap) mapped.gateId = step.gap;
    return mapped;
  });
}

export function fixtureNeeds(): ProcessNeed[] {
  const rows: ProcessNeed[] = [];
  for (const step of steps) {
    for (const [index, need] of (step.needs ?? []).entries()) {
      const mapped: ProcessNeed = {
        id: `${step.label}-need-${index + 1}`,
        stepId: step.label,
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
