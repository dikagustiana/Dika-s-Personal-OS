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
  ProcessStepItem,
  ProcessTrack,
  ProcessTrackDef,
} from '../../data/types';
import seed from './sambProcessSeed.json';

/**
 * The step → Finish line bridge, as seeded by section 6 of migration
 * 20260806000051. The uuids were read from the live os_finish_line_items on
 * 6 August; three Finish line labels are duplicated across sections, so this
 * mapping is by id and must never become a label match.
 *
 * This is the app-side copy, and processModel.test.ts parses the migration
 * and asserts the two agree — so an edit to one that misses the other fails
 * the suite rather than drifting silently.
 */
export const STEP_ITEM_MAP: Array<{
  itemId: string;
  row: string;
  section: string;
  stepLabels: string[];
}> = [
  { itemId: '634e675f-4681-4307-b831-6cad1e7d80fa', row: 'Sales — General Trade', section: 'Laba rugi', stepLabels: ['2', '10', '18a', '19'] },
  { itemId: '2b7394bf-92f4-4900-b2a6-03353dbe6d98', row: 'Sales — Logistic provider', section: 'Laba rugi', stepLabels: ['1', '20', '21'] },
  { itemId: '2e4c8392-8c03-488b-b30c-d633b5b00ea3', row: 'COGS — General Trade', section: 'Laba rugi', stepLabels: ['7a', '9'] },
  { itemId: '768beb21-1151-4a1f-924a-c1c3f5001348', row: 'COGS — Logistic provider', section: 'Laba rugi', stepLabels: ['5', '6b', '7b', '20', '21'] },
  { itemId: '10b151a5-5c45-454c-a13b-ffbc786ec645', row: 'Storing cost', section: 'Laba rugi', stepLabels: ['6a', '8', '9', '13', '14', '15a'] },
  { itemId: '7d040e4a-7bf4-425a-b171-a46245d8158c', row: 'Distribution cost', section: 'Laba rugi', stepLabels: ['15a', '16', '17'] },
  { itemId: '390d42f8-4add-4f23-b59f-1c8aed3bc5e1', row: 'Commercials and support', section: 'Laba rugi', stepLabels: ['19', '23', '24'] },
  { itemId: '8f95868d-0cdd-4590-beb0-244777dad99e', row: 'Revenue / CBM', section: 'Unit economics', stepLabels: ['3', '7a'] },
  { itemId: '1054d85e-83b7-4ae9-bdd6-1aa48bbde597', row: 'Pallet utilisation', section: 'Unit economics', stepLabels: ['8', '9', '16'] },
  { itemId: 'eeabd2b2-85af-4d86-8940-d7191203592b', row: 'Volume delivered', section: 'Volume & capacity', stepLabels: ['15a', '15b'] },
  { itemId: 'f656f8d2-73e8-4835-b7b0-2b4c7429844f', row: 'Cartons delivered', section: 'Volume & capacity', stepLabels: ['3', '7a'] },
  { itemId: '1df8ea55-0e61-4f4f-a0df-c55e5cea42a6', row: 'Delivery trips', section: 'Volume & capacity', stepLabels: ['16', '17'] },
  { itemId: 'd0199bc1-d9e9-4b24-9d6c-b3ebead0cb60', row: 'Pallet positions used', section: 'Volume & capacity', stepLabels: ['8', '9'] },
  { itemId: '873b8990-305d-426b-b43d-9effc2398957', row: 'Inventories', section: 'Working capital', stepLabels: ['7a', '9'] },
  { itemId: '39eac155-d88e-4536-a42f-f5d4c3698cea', row: 'Trade payable', section: 'Working capital', stepLabels: ['7a'] },
  { itemId: '5af36fdd-bc29-4372-9d5a-cd77afda0dfb', row: 'Trade receivable', section: 'Working capital', stepLabels: ['24', '25'] },
  { itemId: 'd5b2d207-b46d-4761-b5d4-b2eb16969c57', row: 'DSO', section: 'Working capital', stepLabels: ['24'] },
];

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

/**
 * SAMB's track vocabulary — what migration 52 seeds into os_process_tracks
 * for the rows that already exist. The parity test pins this against the
 * migration AND against LEGACY_SAMB_TRACKS, so neither can drift alone.
 */
export function fixtureTracks(): ProcessTrackDef[] {
  return [
    { entityCode: 'SAMB', code: 'TRADE', label: 'TRADE', ordinal: 1, isShared: false },
    { entityCode: 'SAMB', code: 'LP', label: 'LP', ordinal: 2, isShared: false },
    { entityCode: 'SAMB', code: 'KEDUANYA', label: 'BERSAMA', ordinal: 3, isShared: true },
  ];
}

export function fixtureLanes(): ProcessLane[] {
  return seed.lanes.map((lane) => {
    const mapped: ProcessLane = {
      entityCode: 'SAMB',
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
    entityCode: 'SAMB',
    name: phase.name,
    slotFrom: phase.a,
    slotTo: phase.b,
  }));
}

export function fixtureGates(): ProcessGate[] {
  return seed.gates.map((gate) => {
    const mapped: ProcessGate = {
      id: gate.id,
      entityCode: 'SAMB',
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
      entityCode: 'SAMB',
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

/** Bridge edges with the fixture's step-id convention (id = label). */
export function fixtureStepItems(): ProcessStepItem[] {
  return STEP_ITEM_MAP.flatMap((entry) =>
    entry.stepLabels.map((label) => ({ stepId: label, itemId: entry.itemId })),
  );
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
