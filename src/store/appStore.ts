import { create } from 'zustand';
import { mockRepository } from '../data/mockRepository';
import type { Repository } from '../data/repository';
import { DEFAULT_PROCESS_ENTITY, finishLineRouteFromLocation } from '../views/work/finishLineRoute';

// Repository selection: the store boots with the in-memory mock so a bare
// clone (no credentials) always runs. When VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY are set, PassphraseGate (mounted around <App /> in
// main.tsx) verifies the passphrase against the database and swaps in the
// Supabase repository via setRepository before any view issues a data call.

// Two fully separate worlds with asymmetric navigation. WORK is a
// finance-ops cockpit (Dashboard landing, Today with an in-page Timebox, Week,
// Projects, Monthly Close, Escalations). GROWTH is a self-development campaign
// (a combined Dashboard landing with a Gantt, then IELTS and the five
// initiative pages). Timebox and Analytics have no standalone WORK nav item —
// Timebox lives inside Today, Analytics is folded into Dashboard.
export type Workspace = 'work' | 'growth';
/**
 * What the shell shows. LAB IS DELIBERATELY NOT A Workspace: Workspace is
 * also the data Domain that Today/Week/Projects scope their reads to, and
 * Lab has no entries, timeboxes or weekly plans — making it a Domain would
 * hand every data view a third value it has no rows for. So the shell gets
 * its own axis: `area` mirrors `workspace` for the two data worlds and adds
 * 'lab'; while the lab is open, `workspace` keeps its last value and no
 * data view is mounted to read it.
 */
export type ShellArea = Workspace | 'lab';
export type WorkView =
  | 'dashboard'
  | 'today'
  | 'week'
  | 'projects'
  // ONE entry, three tabs. The SAMB swimlane and its data-needs register are
  // tabs of the Finish line, not views of their own: the matrix is the
  // target, the process is the road to it, and splitting them into sidebar
  // entries reduced that relationship to a hyperlink. See FinishLineArea.
  | 'finish-line'
  | 'monthly-close'
  | 'escalations';
export type GrowthView =
  | 'dashboard'
  | 'ielts'
  | 'uni'
  | 'chevening'
  | 'lpdp'
  | 'research'
  | 'website'
  // The forest view. It already existed and already handled parent/child
  // projects, but only WORK had a route to it.
  | 'projects';
// LAB is the agent harness: a registry with integrity checking, an executor
// screen, the run log, and a linear chain builder. Owner-only — contributors
// never see the workspace switch, and the lab tables carry no member
// policies, so this is cosmetic scoping over a database that already refuses.
export type LabView = 'registry' | 'run' | 'runs' | 'chains' | 'flow' | 'evidence';

/**
 * A one-shot handoff for cross-view navigation: "open Projects, scrolled to
 * THIS project, with its milestone list open". Set by whoever navigates
 * (the dashboard's needs-action rows), consumed and cleared by Projects on
 * arrival. Without it, a click on a needs-action row landed at the top of
 * Projects inside a collapsed list — the app knew exactly which milestone
 * was meant and threw it away.
 */
export interface ProjectFocus {
  projectId: string;
  /** Open the milestone section on arrival — the row that was clicked lives there. */
  openMilestones: boolean;
}

/**
 * The same one-shot handoff, pointed the other way: "open Finish line,
 * scrolled to THIS pack line, expanded". Set by a project card's Makes
 * trustworthy section, consumed and cleared by FinishLine on arrival.
 */
export interface FinishLineFocus {
  itemId: string;
  /**
   * Repointed at the cell. The matrix's grain is (line item x entity), so a
   * project that closes work for one entity lands on that entity's cell rather
   * than on the whole row. Absent means the row itself.
   */
  entityCode?: string;
  /**
   * Arriving from a project's PACK LINES tile: the exact cells that project's
   * milestones make trustworthy. The matrix narrows to them rather than
   * scrolling to one row, because a project generally closes cells scattered
   * across several sections and entities — a single scroll target would land
   * on one of them and silently imply it was the only one.
   */
  cellIds?: string[];
}

/**
 * One-shot handoff into the swimlane tab: "open it scrolled to THIS step,
 * with its detail panel open". Set by the register's step-label links and by
 * the Finish line cell panel's closing-conditions block; consumed and
 * cleared by the swimlane on arrival. The label is the step's human identity.
 */
export interface ProsesFocus {
  stepLabel: string;
}

/**
 * One-shot handoff into the Lab run screen: "open Run with THIS agent
 * selected". Set by a registry card's Run action (and by the chain builder's
 * step links), consumed and cleared by LabRun on arrival — the same pattern
 * as ProjectFocus, for the same reason: the app knows exactly which agent
 * was meant and must not throw that away on navigation.
 */
export interface LabRunFocus {
  agentSlug: string;
}

/**
 * One-shot handoff into the run log: "open the log scrolled to THIS run,
 * expanded". Set by the run screen's view-in-log link and by chain lineage
 * links; consumed and cleared by LabRuns on arrival.
 */
export interface LabLogFocus {
  runId: string;
}

/**
 * Who is using the app this session. `owner` is the passphrase path — the
 * default, and the only value the owner flow ever sets. `contributor` is a
 * magic-link session scoped to its entity codes; the gate sets it after
 * loading the membership rows. UI-SCOPING ONLY: every value here is
 * re-derived server-side by RLS and the cell trigger, so a tampered store
 * changes what renders, never what the database permits.
 */
export type Viewer =
  | { kind: 'owner' }
  | { kind: 'contributor'; userId: string; email?: string; entityCodes: string[] };

interface AppState {
  repository: Repository;
  viewer: Viewer;
  workspace: Workspace;
  /** The shell's axis: workspace plus 'lab'. See ShellArea. */
  area: ShellArea;
  workView: WorkView;
  growthView: GrowthView;
  labView: LabView;
  projectFocus: ProjectFocus | null;
  finishLineFocus: FinishLineFocus | null;
  prosesFocus: ProsesFocus | null;
  labRunFocus: LabRunFocus | null;
  labLogFocus: LabLogFocus | null;
  /**
   * WHICH ENTITY'S CHAIN the two process tabs show — ONE state, shared by
   * both tabs on purpose: if they could differ, someone could read the ARBI
   * swimlane beside the SAMB register without noticing and conclude the
   * wrong owners owe the wrong data. That is a truth risk with zero payoff
   * (the tabs cannot be seen at once; comparing two entities is two browser
   * tabs via ?entity=). The JALUR filter is deliberately NOT here any more:
   * it is per-tab local state — on the swimlane it decides shape, on the
   * register it silently narrows the request list, and a filter travelling
   * between those two jobs is how rows go missing without a trace. This
   * corrects the first process brief, which had the two tabs share it.
   */
  prosesEntity: string;
  setRepository: (repository: Repository) => void;
  setViewer: (viewer: Viewer) => void;
  setWorkspace: (workspace: Workspace) => void;
  setArea: (area: ShellArea) => void;
  setWorkView: (view: WorkView) => void;
  setGrowthView: (view: GrowthView) => void;
  setLabView: (view: LabView) => void;
  setProjectFocus: (focus: ProjectFocus | null) => void;
  setFinishLineFocus: (focus: FinishLineFocus | null) => void;
  setProsesFocus: (focus: ProsesFocus | null) => void;
  setLabRunFocus: (focus: LabRunFocus | null) => void;
  setLabLogFocus: (focus: LabLogFocus | null) => void;
  setProsesEntity: (entity: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  repository: mockRepository,
  viewer: { kind: 'owner' },
  workspace: 'work',
  // The Finish line is the one view with an address (see finishLineRoute).
  // Reading it HERE rather than in an effect is what makes a bookmarked tab
  // render as itself on the first frame instead of flashing the dashboard.
  workView: finishLineRouteFromLocation() ? 'finish-line' : 'dashboard',
  area: 'work',
  growthView: 'dashboard',
  labView: 'registry',
  projectFocus: null,
  finishLineFocus: null,
  prosesFocus: null,
  labRunFocus: null,
  labLogFocus: null,
  // Like workView below: read the address at boot so a bookmarked
  // ?entity=ARBI renders as ARBI on the first frame.
  prosesEntity: finishLineRouteFromLocation()?.entity ?? DEFAULT_PROCESS_ENTITY,
  setRepository: (repository) => set({ repository }),
  setViewer: (viewer) => set({ viewer }),
  // setWorkspace keeps every existing caller correct: naming a data
  // workspace also leaves the lab. setArea is the switch's entry point;
  // choosing a data world keeps `workspace` (the Domain) in lockstep, and
  // choosing 'lab' leaves it at its last value on purpose — see ShellArea.
  setWorkspace: (workspace) => set({ workspace, area: workspace }),
  setArea: (area) => set(area === 'lab' ? { area } : { area, workspace: area }),
  setWorkView: (workView) => set({ workView }),
  setGrowthView: (growthView) => set({ growthView }),
  setLabView: (labView) => set({ labView }),
  setProjectFocus: (projectFocus) => set({ projectFocus }),
  setFinishLineFocus: (finishLineFocus) => set({ finishLineFocus }),
  setProsesFocus: (prosesFocus) => set({ prosesFocus }),
  setLabRunFocus: (labRunFocus) => set({ labRunFocus }),
  setLabLogFocus: (labLogFocus) => set({ labLogFocus }),
  setProsesEntity: (prosesEntity) => set({ prosesEntity }),
}));
