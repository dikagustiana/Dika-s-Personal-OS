/**
 * FSRE BUILDING v2 — THE NAMES THE LIVE CONTRACT CARRIES BEFORE THE ROUTER
 * DOES: THE PROVISIONAL STAGE LIST AND THE ROSTER.
 *
 * Both are DATA, not code vocabulary, which is why they live in the data
 * layer: the building's view and core never write a stage id, stage name or
 * skill name as a literal (src/views/lab/fsre/fsreRules.test.ts, rule 2), and
 * read these lists instead.
 *
 * STAGES_PROVISIONAL is brief v2's provisional list (§2: "name the constant
 * STAGES_PROVISIONAL"), identical in ids and names to the provisional
 * stages.json kept as a fixture in src/logic/lab/fsre/__fixtures__/provisional.
 * The router's real state machine replaces it when the live contract is
 * wired (milestone M3); until then only the synthetic mode reads it.
 *
 * ROSTER_V2 is the roster table of brief v2 §3 (docs/lab/fsre-contract-v2.md):
 * which role and department each skill works in. The mock builds its agents
 * from it, and the replay seats its per-skill agents on the v2 desks with it
 * (departmentLayout.ts); a skill the roster does not name keeps the floor the
 * stage data gives it.
 */
import type { AgentRole, DepartmentId } from './contract';

export interface ProvisionalStage {
  id: string;
  name: string;
  order: number;
}

/** Provisional stage names; the router's real state machine replaces them. */
export const STAGES_PROVISIONAL: readonly ProvisionalStage[] = [
  { id: 'manifest', name: 'Manifest', order: 1 },
  { id: 'universe', name: 'Universe', order: 2 },
  { id: 'sourcing', name: 'Sourcing', order: 3 },
  { id: 'intake', name: 'Intake', order: 4 },
  { id: 'gate-1', name: 'Gate 1', order: 5 },
  { id: 'normalise', name: 'Normalise', order: 6 },
  { id: 'decomposition', name: 'Decomposition', order: 7 },
  { id: 'benchmark', name: 'Benchmark', order: 8 },
  { id: 'model', name: 'Model', order: 9 },
  { id: 'gate-2', name: 'Gate 2', order: 10 },
  { id: 'holdout', name: 'Holdout', order: 11 },
  { id: 'gate-3', name: 'Gate 3', order: 12 },
  { id: 'sign-off', name: 'Sign-off', order: 13 },
];

export const STAGES_TOTAL = STAGES_PROVISIONAL.length;

export interface RosterEntry {
  role: AgentRole;
  departmentId: DepartmentId | null;
  title: string;
  skills: readonly string[];
}

/**
 * Brief v2 §3, one entry per seat kind. Staff entries describe every staff
 * desk of that department (one per company in active engagements, minimum 2).
 * The review department's two checkers are standing staff with titles of
 * their own; the roster gives them the review lead's skill, as the mock does.
 */
export const ROSTER_V2: readonly RosterEntry[] = [
  { role: 'lead', departmentId: 'data', title: 'Data lead', skills: ['idx-universe', 'data-sourcing'] },
  { role: 'staff', departmentId: 'data', title: 'Data staff', skills: ['fs-intake', 'fs-normalize'] },
  { role: 'router', departmentId: null, title: 'Router', skills: ['fs-reverse-engineering'] },
  { role: 'methodology', departmentId: null, title: 'Methodology', skills: ['guruh'] },
  { role: 'lead', departmentId: 'modelling', title: 'Modelling lead', skills: ['peer-benchmark'] },
  { role: 'staff', departmentId: 'modelling', title: 'Modelling staff', skills: ['fs-driver-decomposition', 'financial-modeling'] },
  { role: 'lead', departmentId: 'review', title: 'Review lead', skills: ['review-manager'] },
  { role: 'staff', departmentId: 'review', title: 'Tie-out checker', skills: ['review-manager'] },
  { role: 'staff', departmentId: 'review', title: 'Source-trace checker', skills: ['review-manager'] },
  { role: 'owner', departmentId: null, title: 'Owner', skills: [] },
];

/** The agent role the owner (a human) holds. Written once, here, because it is also a skill name in the provisional stage data. */
export const OWNER_ROLE: AgentRole = 'owner';
