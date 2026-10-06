/**
 * The replay on the v2 department floors: who sits where, read from the
 * roster and the stage and skill data (departmentPlan.ts).
 */
import { describe, expect, it } from 'vitest';
import { ROSTER_V2 } from '../../../data/fsreTransport/provisional';
import { PROVISIONAL_DATA, REAL_DATA } from './__fixtures__/fsreFixtures';
import { parseFsreRun } from './data';
import { planDepartmentFloors } from './departmentPlan';
import { deskKeyForGate, deskKeyForSkill, planFloors, type FloorPlan } from './layout';
import { REAL_FILES, UNVR_FILE_NAMES, PROVISIONAL_FILES } from './__fixtures__/fsreFixtures';

function runOf(files: typeof REAL_FILES) {
  const parsed = parseFsreRun(files, UNVR_FILE_NAMES);
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.run;
}

const real = runOf(REAL_FILES);
const plan = planDepartmentFloors(real.stages, real.skills);
const rosterSkills = (role: string, departmentId: string | null) => ROSTER_V2.filter((e) => e.role === role && e.departmentId === departmentId).flatMap((e) => e.skills);
const deskOf = (p: FloorPlan, skill: string) => p.desks[deskKeyForSkill(skill)];
const vacantOn = (p: FloorPlan, floorId: string) => p.desksOnFloor[floorId as 'b1'].map((k) => p.desks[k]).filter((d) => d.kind === 'vacant');

describe('the real replay on the department floors', () => {
  it('gives every agent of the run a desk, keyed as the replay keys it', () => {
    for (const skill of real.skills.map((s) => s.name)) {
      expect(deskOf(plan, skill), skill).toBeTruthy();
      expect(deskOf(plan, skill).agentSpot, skill).not.toBeNull();
    }
  });

  it('seats each department lead’s skills at the head of its floor, and its staff in the row behind', () => {
    const [dataLeadSkill] = rosterSkills('lead', 'data');
    const [dataStaffSkill] = rosterSkills('staff', 'data');
    expect(deskOf(plan, dataLeadSkill).floorId).toBe('b1');
    expect(deskOf(plan, dataStaffSkill).floorId).toBe('b1');
    expect(deskOf(plan, dataLeadSkill).surface.y).toBeLessThan(deskOf(plan, dataStaffSkill).surface.y);
    const [modellingLead] = rosterSkills('lead', 'modelling');
    expect(deskOf(plan, modellingLead).floorId).toBe('f2');
    const [reviewLead] = rosterSkills('lead', 'review');
    expect(deskOf(plan, reviewLead).floorId).toBe('f3');
  });

  it('puts the data lead’s two skills side by side at one station, without overlapping', () => {
    const [a, b] = rosterSkills('lead', 'data').map((skill) => deskOf(plan, skill).surface);
    expect(a.y).toBe(b.y);
    expect(a.x + a.w).toBeLessThanOrEqual(b.x);
  });

  it('seats the router at reception and methodology in the lobby, the owner at the partner desk', () => {
    const [router] = rosterSkills('router', null);
    const [methodology] = rosterSkills('methodology', null);
    expect(deskOf(plan, router).floorId).toBe('f1');
    expect(deskOf(plan, methodology).floorId).toBe('f1');
    const partner = real.skills.find((s) => s.seat === 'partner')?.name ?? '';
    expect(deskOf(plan, partner).floorId).toBe('f4');
    expect(deskOf(plan, partner).kind).toBe('partner');
    expect(plan.partnerSkills).toEqual([partner]);
  });

  it('draws the review checkers and one spare desk on each per-company floor as vacant, by their roster titles', () => {
    const checkers = ROSTER_V2.filter((e) => e.role === 'staff' && e.departmentId === 'review').map((e) => e.title);
    expect(vacantOn(plan, 'f3').map((d) => d.title)).toEqual(checkers);
    expect(vacantOn(plan, 'b1')).toHaveLength(1);
    expect(vacantOn(plan, 'f2')).toHaveLength(1);
    for (const desk of [...vacantOn(plan, 'b1'), ...vacantOn(plan, 'f2'), ...vacantOn(plan, 'f3')]) {
      expect(desk.skill).toBeNull();
      expect(desk.agentSpot).toBeNull();
    }
  });

  it('keeps the gate rooms, the lobby bench and the stage bookkeeping of planFloors', () => {
    const base = planFloors(real.stages, real.skills);
    expect(plan.gateStageIds).toEqual(base.gateStageIds);
    expect(plan.stageOrder).toEqual(base.stageOrder);
    expect(plan.agentSkills).toEqual(base.agentSkills);
    for (const stageId of base.gateStageIds) expect(plan.desks[deskKeyForGate(stageId)]).toEqual(base.desks[deskKeyForGate(stageId)]);
  });

  it('brings the department floors’ furniture with it', () => {
    expect(plan.decorations.f1.some((d) => d.kind === 'glass')).toBe(true);
    expect(plan.decorations.b1.some((d) => d.kind === 'rack')).toBe(true);
  });
});

describe('skills the roster does not name', () => {
  it('keep the floor the stage data gives them', () => {
    const renamed = real.skills.map((s) => ({ ...s, name: `x-${s.name}` }));
    const stages = real.stages.map((st) => ({ ...st, skills: st.skills.map((x) => `x-${x}`) }));
    const fallback = planDepartmentFloors(stages, renamed);
    const base = planFloors(stages, renamed);
    for (const skill of base.agentSkills) {
      const desk = fallback.desks[deskKeyForSkill(skill)];
      expect(desk, skill).toBeTruthy();
      expect(desk.floorId, skill).toBe(base.floorOfSkill[skill]);
    }
  });
});

describe('the provisional shape (GLM’s files)', () => {
  it('seats every one of its skills too, the sign-off stage’s non-agent at the partner desk', () => {
    const provisional = runOf(PROVISIONAL_FILES);
    const p = planDepartmentFloors(provisional.stages, provisional.skills);
    for (const skill of PROVISIONAL_DATA.skills.skills.map((s) => s.name)) expect(p.desks[deskKeyForSkill(skill)], skill).toBeTruthy();
    expect(p.partnerSkills.length).toBeGreaterThan(0);
    expect(REAL_DATA.replay.company.ticker).toBeTruthy();
  });
});
