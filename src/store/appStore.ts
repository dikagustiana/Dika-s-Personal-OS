import { create } from 'zustand';
import { mockRepository } from '../data/mockRepository';
import type { Repository } from '../data/repository';
import type { TrackFilter } from '../logic/process';
import { finishLineRouteFromLocation } from '../views/work/finishLineRoute';

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
  workView: WorkView;
  growthView: GrowthView;
  projectFocus: ProjectFocus | null;
  finishLineFocus: FinishLineFocus | null;
  prosesFocus: ProsesFocus | null;
  /**
   * The jalur filter (Semua / Trade / LP), SHARED between the swimlane and
   * the register — §7 requires the two views to agree on which track is in
   * view. In the store for that reason only; not persisted, like every other
   * piece of view state.
   */
  prosesTrack: TrackFilter;
  setRepository: (repository: Repository) => void;
  setViewer: (viewer: Viewer) => void;
  setWorkspace: (workspace: Workspace) => void;
  setWorkView: (view: WorkView) => void;
  setGrowthView: (view: GrowthView) => void;
  setProjectFocus: (focus: ProjectFocus | null) => void;
  setFinishLineFocus: (focus: FinishLineFocus | null) => void;
  setProsesFocus: (focus: ProsesFocus | null) => void;
  setProsesTrack: (track: TrackFilter) => void;
}

export const useAppStore = create<AppState>((set) => ({
  repository: mockRepository,
  viewer: { kind: 'owner' },
  workspace: 'work',
  // The Finish line is the one view with an address (see finishLineRoute).
  // Reading it HERE rather than in an effect is what makes a bookmarked tab
  // render as itself on the first frame instead of flashing the dashboard.
  workView: finishLineRouteFromLocation() ? 'finish-line' : 'dashboard',
  growthView: 'dashboard',
  projectFocus: null,
  finishLineFocus: null,
  prosesFocus: null,
  prosesTrack: 'ALL',
  setRepository: (repository) => set({ repository }),
  setViewer: (viewer) => set({ viewer }),
  setWorkspace: (workspace) => set({ workspace }),
  setWorkView: (workView) => set({ workView }),
  setGrowthView: (growthView) => set({ growthView }),
  setProjectFocus: (projectFocus) => set({ projectFocus }),
  setFinishLineFocus: (finishLineFocus) => set({ finishLineFocus }),
  setProsesFocus: (prosesFocus) => set({ prosesFocus }),
  setProsesTrack: (prosesTrack) => set({ prosesTrack }),
}));
