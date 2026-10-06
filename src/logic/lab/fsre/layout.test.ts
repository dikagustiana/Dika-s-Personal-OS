import { describe, expect, it } from 'vitest';
import { FLOOR_UNITS } from './geometry';
import {
  FALLBACK_DESK_KEY,
  FLOOR_IDS,
  deskKeyForGate,
  deskKeyForSkill,
  deskKeyForStage,
  isGateStage,
  planFloors,
  resolveDesk,
  slotCentres,
} from './layout';
import { provisionalRun, realRun, tenCompanyRun } from './__fixtures__/fsreFixtures';

describe('floors take their skills from the stage data', () => {
  it('places the provisional stage list by the rule, not by a second list', () => {
    const run = provisionalRun();
    const plan = planFloors(run.stages, run.skills);
    expect(plan.skillsOnFloor).toEqual({
      b1: ['idx-universe', 'data-sourcing', 'fs-intake'],
      // The router runs the first and the holdout segment; guruh runs no stage.
      f1: ['fs-reverse-engineering', 'guruh'],
      f2: ['fs-normalize', 'fs-driver-decomposition', 'peer-benchmark', 'financial-modeling'],
      f3: ['review-manager'],
      f4: ['owner'],
    });
    expect(plan.gateStageIds).toEqual(['gate-1', 'gate-2', 'gate-3']);
    expect(plan.partnerSkills).toEqual(['owner']);
  });

  it("places the router's stage ids with invented skill names the same way", () => {
    const run = tenCompanyRun();
    const plan = planFloors(run.stages, run.skills);
    expect(plan.gateStageIds).toEqual(['gate1', 'gate2', 'gate3']);
    expect(plan.skillsOnFloor).toEqual({
      b1: ['sourcer', 'intaker'],
      f1: ['router', 'learner'],
      f2: ['normaliser', 'decomposer', 'benchmarker', 'calibrator'],
      f3: ['reviewer'],
      f4: ['partner'],
    });
  });

  it('puts every skill on exactly one floor, and nothing that is in neither file', () => {
    const run = provisionalRun();
    const plan = planFloors(run.stages, run.skills);
    const placed = FLOOR_IDS.flatMap((id) => plan.skillsOnFloor[id]).sort();
    const named = [...new Set([...run.stages.flatMap((s) => s.skills), ...run.skills.map((s) => s.name)])].sort();
    expect(placed).toEqual(named);
  });

  it('knows a gate by its id in both generations of stage list', () => {
    expect(['gate-1', 'gate1', 'GATE_2', 'gate-3'].every((id) => isGateStage({ id }))).toBe(true);
    expect(['gatekeeper', 'intake', 'delegate-1'].some((id) => isGateStage({ id }))).toBe(false);
  });

  it('moves a skill when the stage data moves it', () => {
    const run = provisionalRun();
    const moved = run.stages.map((stage) => (stage.id === 'normalise' ? { ...stage, order: 4.5 } : stage));
    expect(planFloors(moved, run.skills).floorOfSkill['fs-normalize']).toBe('b1');
  });
});

describe('the real export (brief 04) places by its seats and its stages', () => {
  const run = realRun();
  const plan = planFloors(run.stages, run.skills);

  it('seats the owner in the partner room and the router in the lobby', () => {
    expect(plan.partnerSkills).toEqual(['partner']);
    expect(plan.floorOfSkill.partner).toBe('f4');
    expect(plan.floorOfSkill['fs-reverse-engineering']).toBe('f1');
    // An agent: the owner sits at the partner desk.
    expect(plan.desks[deskKeyForSkill('partner')].agentSpot).not.toBeNull();
  });

  it('places everyone else by the stage rule', () => {
    expect(plan.gateStageIds).toEqual(['gate1', 'gate2', 'gate3']);
    expect(plan.skillsOnFloor).toEqual({
      b1: ['idx-universe', 'fs-intake'],
      // data-sourcing works in two segments (doc_plan, decomposed); guruh runs no stage.
      f1: ['data-sourcing', 'fs-reverse-engineering', 'guruh'],
      f2: ['fs-normalize', 'fs-driver-decomposition', 'peer-benchmark', 'financial-modeling'],
      f3: ['review-manager'],
      f4: ['partner'],
    });
  });
});

describe('desks are generated and never collide', () => {
  const run = tenCompanyRun();
  const plan = planFloors(run.stages, run.skills);

  it('gives each placed skill a desk on its floor, and each gate a room on the review floor', () => {
    for (const id of FLOOR_IDS) {
      for (const skill of plan.skillsOnFloor[id]) expect(plan.desks[deskKeyForSkill(skill)].floorId).toBe(id);
    }
    for (const stageId of plan.gateStageIds) expect(plan.desks[deskKeyForGate(stageId)]).toMatchObject({ floorId: 'f3', kind: 'gate' });
  });

  it('keeps every desk and room inside the floor, without overlaps', () => {
    for (const id of FLOOR_IDS) {
      const boxes = plan.desksOnFloor[id]
        .map((key) => plan.desks[key])
        .filter((desk) => desk.kind !== 'partner')
        .map((desk) => desk.room ?? desk.surface);
      for (const box of boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(FLOOR_UNITS.width);
        expect(box.y + box.d).toBeLessThanOrEqual(FLOOR_UNITS.depth);
      }
      const sorted = [...boxes].filter((b) => b.y === boxes[0].y).sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].w);
    }
  });

  it('seats an agent only where the skill is in skills.json', () => {
    expect(plan.desks[deskKeyForSkill('sourcer')].agentSpot).not.toBeNull();
    expect(plan.desks[deskKeyForSkill('partner')].agentSpot).toBeNull();
  });

  it('sends a gate stage to its room and a desk-less skill to the lobby bench', () => {
    expect(deskKeyForStage(plan, 'gate2', 'reviewer')).toBe(deskKeyForGate('gate2'));
    expect(deskKeyForStage(plan, 'intake', null)).toBe(deskKeyForSkill('intaker'));
    expect(resolveDesk(plan, deskKeyForSkill('nobody')).key).toBe(FALLBACK_DESK_KEY);
  });

  it('spreads slots evenly', () => {
    expect(slotCentres(0, 30, 3)).toEqual([5, 15, 25]);
    expect(slotCentres(0, 30, 0)).toEqual([]);
  });
});

describe('seats named in the skill data', () => {
  // The router's state machine ends with `closed`, run by the router: without seats, the last-stage
  // rule would put the router at the partner desk and the owner on the modelling floor.
  const stages = [
    { id: 'selected', name: 'Selected', order: 1, skills: ['idx-universe'] },
    { id: 'gate1', name: 'Gate 1', order: 2, skills: ['review-manager'] },
    { id: 'partner_reviewed', name: 'Partner review', order: 3, skills: ['partner'] },
    { id: 'closed', name: 'Closed', order: 4, skills: ['fs-reverse-engineering'] },
  ];
  const roles = (seats: Record<string, 'partner' | 'lobby'>) =>
    ['idx-universe', 'review-manager', 'partner', 'fs-reverse-engineering'].map((name) => ({
      name, role: `${name} role`, ...(seats[name] ? { seat: seats[name] } : {}),
    }));

  it('puts a skill where its entry says, and keeps the partner room for the seated skill', () => {
    const plan = planFloors(stages, roles({ partner: 'partner', 'fs-reverse-engineering': 'lobby' }));
    expect(plan.partnerSkills).toEqual(['partner']);
    expect(plan.desks[deskKeyForSkill('partner')].floorId).toBe('f4');
    expect(plan.desks[deskKeyForSkill('fs-reverse-engineering')].floorId).toBe('f1');
  });

  it('without seats, the last stage still takes the partner room (the provisional list)', () => {
    const plan = planFloors(stages, roles({}));
    expect(plan.partnerSkills).toEqual(['fs-reverse-engineering']);
  });
});
