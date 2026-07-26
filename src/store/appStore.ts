import { create } from 'zustand';
import { mockRepository } from '../data/mockRepository';
import type { Repository } from '../data/repository';

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
   * than on the whole row. Absent means the row itself — a row-level link.
   */
  entityCode?: string;
}

interface AppState {
  repository: Repository;
  workspace: Workspace;
  workView: WorkView;
  growthView: GrowthView;
  projectFocus: ProjectFocus | null;
  finishLineFocus: FinishLineFocus | null;
  setRepository: (repository: Repository) => void;
  setWorkspace: (workspace: Workspace) => void;
  setWorkView: (view: WorkView) => void;
  setGrowthView: (view: GrowthView) => void;
  setProjectFocus: (focus: ProjectFocus | null) => void;
  setFinishLineFocus: (focus: FinishLineFocus | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  repository: mockRepository,
  workspace: 'work',
  workView: 'dashboard',
  growthView: 'dashboard',
  projectFocus: null,
  finishLineFocus: null,
  setRepository: (repository) => set({ repository }),
  setWorkspace: (workspace) => set({ workspace }),
  setWorkView: (workView) => set({ workView }),
  setGrowthView: (growthView) => set({ growthView }),
  setProjectFocus: (projectFocus) => set({ projectFocus }),
  setFinishLineFocus: (finishLineFocus) => set({ finishLineFocus }),
}));
