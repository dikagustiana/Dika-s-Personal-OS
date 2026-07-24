import { create } from 'zustand';
import { mockRepository } from '../data/mockRepository';
import type { Repository } from '../data/repository';

export type Workspace = 'work' | 'growth';
export type WorkView = 'today' | 'timebox' | 'week';
export type GrowthView = 'projects' | 'analytics';

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
  growthView: 'projects',
  setRepository: (repository) => set({ repository }),
  setWorkspace: (workspace) => set({ workspace }),
  setWorkView: (workView) => set({ workView }),
  setGrowthView: (growthView) => set({ growthView }),
}));
