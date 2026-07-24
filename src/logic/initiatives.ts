import { PROJECT_IDS } from '../data/seed';
import type { Project } from '../data/types';

// The six GROWTH initiatives, in nav / deadline-strip / Gantt order. The ids
// are the fixed UUIDs shared by the seed and the live database migrations.
export const GROWTH_INITIATIVES = [
  { key: 'ielts', label: 'IELTS', projectId: PROJECT_IDS.ielts },
  { key: 'uni', label: 'Uni Applications', projectId: PROJECT_IDS.uni },
  { key: 'chevening', label: 'Chevening', projectId: PROJECT_IDS.scholarship },
  { key: 'lpdp', label: 'LPDP', projectId: PROJECT_IDS.lpdp },
  { key: 'research', label: 'Research', projectId: PROJECT_IDS.research },
  { key: 'website', label: 'Website', projectId: PROJECT_IDS.website },
] as const;

export type InitiativeKey = (typeof GROWTH_INITIATIVES)[number]['key'];

/** Projects in initiative order; missing ones are skipped. */
export function initiativeProjects(projects: Project[]): Project[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return GROWTH_INITIATIVES.map((initiative) => byId.get(initiative.projectId)).filter(
    (project): project is Project => project !== undefined,
  );
}

export function initiativeProject(
  projects: Project[],
  key: InitiativeKey,
): Project | undefined {
  const entry = GROWTH_INITIATIVES.find((initiative) => initiative.key === key);
  return entry ? projects.find((project) => project.id === entry.projectId) : undefined;
}
