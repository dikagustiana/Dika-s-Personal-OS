import { useCallback, useEffect, useState } from 'react';
import type {
  FactLibraryEntry,
  Project,
  ResearchProject,
  ResearchSettings,
} from '../../../data/types';
import { RESEARCH_DEFAULTS } from '../../../data/types';
import { PROJECT_IDS } from '../../../data/seed';
import {
  NO_ROUTING,
  routingTable,
  type ModelRoute,
  type ModelRoutingTable,
} from '../../../logic/research/modelRouting';
import { gatesFor } from '../../../logic/research/templates';
import { useAppStore } from '../../../store/appStore';

export interface ResearchData {
  /** The Research umbrella project; settings hang off this row. */
  parent: Project | null;
  settings: ResearchSettings;
  projects: ResearchProject[];
  library: FactLibraryEntry[];
  /** Task → model, resolved. Empty is the normal state: everything on default. */
  routing: ModelRoutingTable;
  /** The rows as stored, for the summary and the unrecognised-task warning. */
  routingRows: ModelRoute[];
  /**
   * True when the routing read FAILED, which is not the same as no routing.
   * Both leave every task on the default, so without this flag a failed read
   * would render as a working "nothing routed" state — the empty-on-failure
   * defect this project keeps re-learning.
   */
  routingFailed: boolean;
}

const EMPTY: ResearchData = {
  parent: null,
  settings: RESEARCH_DEFAULTS,
  projects: [],
  library: [],
  routing: NO_ROUTING,
  routingRows: [],
  routingFailed: false,
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

    // Routing is read separately and its failure is contained: a routing table
    // that cannot be read must leave every card working on the default, not take
    // the whole Research area down with it. The API is an accelerant.
    let routingRows: ModelRoute[] = [];
    let routingFailed = false;
    try {
      routingRows = await repository.research.listModelRouting();
    } catch {
      routingFailed = true;
    }

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
      routing: routingFailed ? NO_ROUTING : routingTable(routingRows),
      routingRows,
      routingFailed,
    });
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...data, loaded, reload: load };
}
