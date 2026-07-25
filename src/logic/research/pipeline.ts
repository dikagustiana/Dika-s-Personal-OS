/**
 * Research pipeline mechanics — gates, stage locking, review-loop due dates.
 *
 * ===========================================================================
 * A DELIBERATE EXCEPTION TO A STANDING RULE. READ BEFORE SOFTENING ANYTHING.
 * ===========================================================================
 * Personal OS has a rule, decided twice and holding everywhere else: nothing
 * blocks. No enforced dependencies, every pointer informational, every warning
 * advisory. This module is an explicit, permanent exception, and it must stay
 * hard:
 *
 *   1. A stage is LOCKED until the previous stage's gate fully passes. Locked,
 *      not warned.
 *   2. A `rework` verdict invalidates every gate from a chosen stage downward.
 *      It clears them and reports the count; it does not ask per gate.
 *   3. Stage 00's gate cannot pass while any critical item is still IND.
 *
 * These are hard because they are methodological preconditions, not scheduling
 * dependencies. Running a Monte Carlo on unverified parameters does not make a
 * project late — it makes the findings wrong. A gate that can be waved past is
 * not a gate, and this subsystem's only purpose is to be the thing that cannot
 * be waved past at 1am.
 *
 * If you are here to make this consistent with the rest of the app: don't. The
 * inconsistency is the feature. Ported from the owner's research console.
 * ===========================================================================
 */
import type {
  ResearchCycle,
  ResearchItem,
  ResearchProject,
  ResearchSettings,
} from '../../data/types';
import { LOOPS, LOOP_KEYS, type LoopKey } from './loops';
import { templateOf, type ResearchStage } from './templates';

/** Milliseconds in an average month — the console's own divisor, kept. */
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

/** The method-review loop falls due after this many months regardless. */
const METHOD_REVIEW_MONTHS = 3;

/**
 * A stage's gate passes only when it has criteria AND every one is checked.
 * The length test matters: an empty array would otherwise pass vacuously via
 * `every`, which would silently unlock a whole pipeline.
 */
export function gatePass(project: ResearchProject, index: number): boolean {
  const gate = project.meta.gates[index] ?? [];
  return gate.length > 0 && gate.every(Boolean);
}

/** Critical register items still indeterminate — the stage-00 blocker. */
export function critIND(project: ResearchProject): ResearchItem[] {
  return project.items.filter((item) => item.crit && item.status === 'IND');
}

/** The first stage whose gate has not passed; the last stage when all have. */
export function curStage(project: ResearchProject): number {
  const count = templateOf(project.meta.template).stages.length;
  for (let i = 0; i < count; i += 1) {
    if (!gatePass(project, i)) return i;
  }
  return count - 1;
}

export type StageState = 'blocked' | 'passed' | 'open' | 'locked';

export interface StageStatus {
  state: StageState;
  /** Display text, as the console words it. */
  txt: string;
}

/**
 * Stage 00 reports `blocked` while a critical item is IND — rule 3 above.
 * Every later stage reports `locked` until its predecessor's gate passes,
 * naming the stage it is waiting on.
 */
export function stageStatus(project: ResearchProject, index: number): StageStatus {
  const stages = templateOf(project.meta.template).stages;
  if (index === 0) {
    if (critIND(project).length > 0 && !gatePass(project, 0)) {
      return { state: 'blocked', txt: 'blocker terbuka' };
    }
    return gatePass(project, 0)
      ? { state: 'passed', txt: 'gate lulus' }
      : { state: 'open', txt: 'gate terbuka' };
  }
  if (!gatePass(project, index - 1)) {
    return { state: 'locked', txt: `terkunci · stage ${stages[index - 1].n}` };
  }
  return gatePass(project, index)
    ? { state: 'passed', txt: 'gate lulus' }
    : { state: 'open', txt: 'gate terbuka' };
}

/**
 * Whether a gate criterion may be ticked at all. This is where rules 1 and 3
 * are ENFORCED rather than merely displayed — the UI reads it, and so does the
 * mutation path, so a locked gate cannot be set by any route.
 */
export function canTickGate(project: ResearchProject, index: number): boolean {
  if (index > 0 && !gatePass(project, index - 1)) return false;
  // Stage 00 stays untickable while a critical item is unverified.
  if (index === 0 && critIND(project).length > 0) return false;
  return true;
}

/**
 * Months since an ISO-ish date. Unparseable or absent reads as infinitely old,
 * so a missing `asof` surfaces as stale rather than silently passing.
 */
export function monthsSince(date: string | undefined, now: Date = new Date()): number {
  if (!date) return Infinity;
  const then = Date.parse(date);
  if (Number.isNaN(then)) return Infinity;
  return (now.getTime() - then) / MS_PER_MONTH;
}

/** Verified items whose reference period has aged past the staleness bound. */
export function staleItems(
  project: ResearchProject,
  settings: ResearchSettings,
  now: Date = new Date(),
): ResearchItem[] {
  return project.items.filter(
    (item) => item.status === 'V' && monthsSince(item.asof, now) > settings.staleMonths,
  );
}

/**
 * What the citation loop is responsible for: every source-bearing register item
 * plus every layer-(b) claim. Used as a snapshot count to detect new work.
 */
export function citeCount(project: ResearchProject): number {
  const sourceTypes = ['paper', 'dokumen', 'baseline'];
  return (
    project.items.filter((item) => sourceTypes.includes(item.type)).length +
    project.claims.filter((claim) => claim.layer === 'b').length
  );
}

/** Cycles for one loop, oldest first. */
export function cyclesOf(project: ResearchProject, loop: LoopKey): ResearchCycle[] {
  return project.cycles
    .filter((cycle) => cycle.loop === loop)
    .slice()
    .sort((a, b) => a.n - b.n);
}

export function lastCycle(project: ResearchProject, loop: LoopKey): ResearchCycle | null {
  return cyclesOf(project, loop).at(-1) ?? null;
}

export interface LoopDue {
  due: boolean;
  /** True only when the loop has never been run. */
  never?: boolean;
  /** The reason, in the console's own words — shown verbatim in the UI. */
  why: string;
}

/**
 * Whether a review loop is due, and why. Five independent triggers: never run,
 * last verdict was rework, stale verified items (data), new items since the
 * last cycle (data), new sources or (b) claims since the last cycle (cite), and
 * more than three months elapsed (method).
 *
 * Deliberately recomputed every time rather than stored: a stored due-flag
 * starts lying within a week of the counts moving.
 */
export function loopDue(
  project: ResearchProject,
  loop: LoopKey,
  settings: ResearchSettings,
  now: Date = new Date(),
): LoopDue {
  const last = lastCycle(project, loop);
  if (!last) return { due: true, never: true, why: 'belum pernah dijalankan' };
  if (last.verdict === 'rework') {
    return {
      due: true,
      why: 'siklus terakhir memutuskan rework — jalankan ulang setelah perbaikan',
    };
  }
  if (loop === 'data') {
    const stale = staleItems(project, settings, now).length;
    if (stale > 0) {
      return {
        due: true,
        why: `${stale} item V melewati batas kebasian ${settings.staleMonths} bulan`,
      };
    }
    if (project.items.length > last.itemCount) {
      return {
        due: true,
        why: `${project.items.length - last.itemCount} item baru sejak siklus terakhir`,
      };
    }
  }
  if (loop === 'cite') {
    const current = citeCount(project);
    if (current > last.citeCount) {
      return {
        due: true,
        why: `${current - last.citeCount} sumber atau klaim (b) baru sejak siklus terakhir`,
      };
    }
  }
  if (loop === 'method') {
    if (monthsSince(last.date, now) > METHOD_REVIEW_MONTHS) {
      return { due: true, why: `lebih dari ${METHOD_REVIEW_MONTHS} bulan sejak siklus terakhir` };
    }
  }
  return { due: false, why: `bersih per ${last.date}` };
}

export function dueLoops(
  project: ResearchProject,
  settings: ResearchSettings,
  now: Date = new Date(),
): LoopKey[] {
  return LOOP_KEYS.filter((loop) => loopDue(project, loop, settings, now).due);
}

/**
 * Clears every gate from `from` downward and returns how many were actually
 * cleared — rule 2. Returns a NEW matrix; the caller persists it, so a failed
 * write cannot leave a half-invalidated project.
 */
export function invalidateFrom(
  gates: boolean[][],
  from: number,
): { gates: boolean[][]; invalidated: number } {
  let invalidated = 0;
  const next = gates.map((gate, index) => {
    if (index < from) return gate.slice();
    return gate.map((checked) => {
      if (checked) invalidated += 1;
      return false;
    });
  });
  return { gates: next, invalidated };
}

export interface NextAction {
  stage: ResearchStage;
  text: string;
}

/** The single next thing to do: the first unchecked criterion of the current stage. */
export function nextAction(project: ResearchProject): NextAction {
  const index = curStage(project);
  const stage = templateOf(project.meta.template).stages[index];
  const gate = project.meta.gates[index] ?? [];
  const firstOpen = gate.findIndex((checked) => !checked);
  if (firstOpen < 0) {
    return { stage, text: 'Semua gate lulus — riset ini siap ditandai done.' };
  }
  return { stage, text: stage.g[firstOpen] };
}

/**
 * Which active project to park when over the WIP limit: an open blocker first,
 * then lowest priority. Returns null rather than a dash so the caller owns the
 * empty presentation.
 */
export function parkCandidate(projects: ResearchProject[]): ResearchProject | null {
  const active = projects.filter((item) => item.project.status === 'active');
  if (active.length === 0) return null;
  return active.slice().sort((a, b) => {
    const blockedDelta = (critIND(b).length ? 1 : 0) - (critIND(a).length ? 1 : 0);
    if (blockedDelta !== 0) return blockedDelta;
    return (b.project.priority ?? 0) - (a.project.priority ?? 0);
  })[0];
}

/** Loop metadata by key, for views that render all three in order. */
export function loopMeta(loop: LoopKey) {
  return LOOPS[loop];
}
