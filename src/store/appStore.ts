import { create } from 'zustand';
import { mockRepository } from '../data/mockRepository';
import type { Repository } from '../data/repository';

// Repository selection: the store boots with the in-memory mock so a bare
// clone (no credentials) always runs. When VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY are set, PassphraseGate (mounted around <App /> in
// main.tsx) verifies the passphrase against the database and swaps in the
// Supabase repository via setRepository before any view issues a data call.

// Two fully separate worlds, each with its own complete view set. WORK
// additionally has the Escalations board-review screen; GROWTH does not.
export type Workspace = 'work' | 'growth';
export type WorkView =
  | 'today'
  | 'timebox'
  | 'week'
  | 'projects'
  | 'analytics'
  | 'escalations';
export type GrowthView = 'today' | 'timebox' | 'week' | 'projects' | 'analytics';

interface AppState {
  repository: Repository;
  workspace: Workspace;
  workView: WorkView;
  growthView: GrowthView;
  setRepository: (repository: Repository) => void;
  setWorkspace: (workspace: Workspace) => void;
  setWorkView: (view: WorkView) => void;
  setGrowthView: (view: GrowthView) => void;
}

export const useAppStore = create<AppState>((set) => ({
  repository: mockRepository,
  workspace: 'work',
  workView: 'today',
  growthView: 'today',
  setRepository: (repository) => set({ repository }),
  setWorkspace: (workspace) => set({ workspace }),
  setWorkView: (workView) => set({ workView }),
  setGrowthView: (growthView) => set({ growthView }),
}));
