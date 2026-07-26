import { useCallback, useEffect, useState } from 'react';
import type {
  FactLibraryEntry,
  Project,
  ResearchProject,
  ResearchSettings,
} from '../../../data/types';
import { RESEARCH_DEFAULTS } from '../../../data/types';
import { PROJECT_IDS } from '../../../data/seed';
import { gatesFor } from '../../../logic/research/templates';
import { useAppStore } from '../../../store/appStore';

export interface ResearchData {
  /** The Research umbrella project; settings hang off this row. */
  parent: Project | null;
  settings: ResearchSettings;
  projects: ResearchProject[];
  library: FactLibraryEntry[];
}

const EMPTY: ResearchData = {
  parent: null,
  settings: RESEARCH_DEFAULTS,
  projects: [],
  library: [],
};

/**
 * Loads the whole research portfolio: the umbrella project's settings, every
 * child with its meta/register/claims/cycles/log, and the cross-project fact
 * library.
 *
 * Loads per child rather than in five wide queries. The portfolio is a handful
 * of projects governed by a WIP limit of two — the wide version would be more
 * code to save requests nobody is waiting on, and every consumer here needs the
 * per-project shape anyway.
 */
export function useResearch() {
  const repository = useAppStore((state) => state.repository);
  const [data, setData] = useState<ResearchData>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const all = await repository.listProjects('growth');
    const parent = all.find((project) => project.id === PROJECT_IDS.research) ?? null;
    const children = all.filter((project) => project.parentId === PROJECT_IDS.research);

    const projects = await Promise.all(
      children.map(async (project) => {
        const [meta, items, claims, cycles, log] = await Promise.all([
          repository.research.getMeta(project.id),
          repository.research.listItems(project.id),
          repository.research.listClaims(project.id),
          repository.research.listCycles(project.id),
          repository.research.listLog(project.id),
        ]);
        return {
          project,
          // A child with no meta row is still a research project — it renders
          // against the default template rather than vanishing from the map.
          meta: meta ?? {
            projectId: project.id,
            template: 'min',
            question: '',
            output: '',
            audience: '',
            gates: gatesFor('min'),
          },
          items,
          claims,
          cycles,
          log,
        } satisfies ResearchProject;
      }),
    );

    const library = await repository.research.listLibrary();

    setData({
      parent,
      settings: {
        wipLimit: parent?.wipLimit ?? RESEARCH_DEFAULTS.wipLimit,
        staleMonths: parent?.staleMonths ?? RESEARCH_DEFAULTS.staleMonths,
      },
      projects: projects.sort(
        (a, b) => (a.project.priority ?? 99) - (b.project.priority ?? 99),
      ),
      library,
    });
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...data, loaded, reload: load };
}
