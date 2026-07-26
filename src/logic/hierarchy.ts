import type { Project } from '../data/types';

/**
 * Parent/child project structure.
 *
 * `parent_id` is a real foreign key, but the list this runs against is always
 * a filtered slice (one domain, monthly closes excluded), so a parent can be
 * absent from the input. A project whose parent is not in the slice is
 * rendered at the top level rather than dropped — a filter must never make a
 * project invisible.
 */

export interface ProjectNode {
  project: Project;
  /** 0 for a root card, 1 for a child, and so on. */
  depth: number;
  children: ProjectNode[];
}

export interface MilestoneRollup {
  /** This project's own milestones only. */
  ownDone: number;
  ownTotal: number;
  /** Own milestones plus every descendant's. */
  done: number;
  total: number;
  /** Descendant projects folded into the rollup. */
  childCount: number;
}

function countOwn(project: Project): { done: number; total: number } {
  return {
    done: project.milestones.filter((milestone) => milestone.done).length,
    total: project.milestones.length,
  };
}

/**
 * Builds the project forest.
 *
 * Cycle-safe: a project that is its own parent, or that sits in a parent
 * loop, falls back to the top level instead of recursing forever. The
 * database forbids self-parenting and the picker forbids choosing a
 * descendant, so this is a backstop, not an expected path — but a render loop
 * would take the whole view down, and the guard is two lines.
 */
export function buildProjectTree(projects: Project[]): ProjectNode[] {
  const byId = new Map(projects.map((project) => [project.id, project]));

  const parentOf = (project: Project): Project | undefined => {
    const parentId = project.parentId;
    if (!parentId || parentId === project.id) return undefined;
    const parent = byId.get(parentId);
    if (!parent) return undefined;
    // Walk to the root; if we come back to `project`, the chain is a cycle.
    const seen = new Set<string>([project.id]);
    let cursor: Project | undefined = parent;
    while (cursor) {
      if (seen.has(cursor.id)) return undefined;
      seen.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return parent;
  };

  const childrenOf = new Map<string, Project[]>();
  const roots: Project[] = [];
  for (const project of projects) {
    const parent = parentOf(project);
    if (!parent) {
      roots.push(project);
      continue;
    }
    const siblings = childrenOf.get(parent.id);
    if (siblings) siblings.push(project);
    else childrenOf.set(parent.id, [project]);
  }

  const toNode = (project: Project, depth: number): ProjectNode => ({
    project,
    depth,
    children: (childrenOf.get(project.id) ?? []).map((child) => toNode(child, depth + 1)),
  });

  return roots.map((project) => toNode(project, 0));
}

/** Every project in the subtree, the node's own project first. */
export function flattenNode(node: ProjectNode): Project[] {
  return [node.project, ...node.children.flatMap(flattenNode)];
}

/**
 * Finds a project's node anywhere in the forest, not just among the roots — a
 * child project rendered on its own page still needs its own rollup.
 */
export function findNode(
  nodes: ProjectNode[],
  projectId: string,
): ProjectNode | undefined {
  for (const node of nodes) {
    if (node.project.id === projectId) return node;
    const found = findNode(node.children, projectId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Milestone counts for one node: its own, and its own plus every
 * descendant's. An umbrella project with no milestones of its own still
 * reports a real rollup number rather than a zero.
 */
export function rollupMilestones(node: ProjectNode): MilestoneRollup {
  const own = countOwn(node.project);
  const descendants = node.children.flatMap(flattenNode);
  const totals = descendants.reduce(
    (sum, project) => {
      const counts = countOwn(project);
      return { done: sum.done + counts.done, total: sum.total + counts.total };
    },
    { done: own.done, total: own.total },
  );
  return {
    ownDone: own.done,
    ownTotal: own.total,
    done: totals.done,
    total: totals.total,
    childCount: descendants.length,
  };
}

/**
 * Every ancestor of `projectId`, nearest parent first.
 *
 * Needed because a collapsed row renders no children at all: opening a
 * grandchild means opening the chain above it, or its card is never mounted
 * and a link pointing at it silently does nothing. Cycle-safe on the same
 * grounds as `buildProjectTree` — a loop here would hang the click handler.
 */
export function ancestorIds(projects: Project[], projectId: string): string[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const chain: string[] = [];
  const seen = new Set<string>([projectId]);
  let cursor = byId.get(projectId)?.parentId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = byId.get(cursor)?.parentId;
  }
  return chain;
}

/**
 * Projects that may legally become `candidate`'s parent: same domain, not
 * itself, and not one of its own descendants. Without the descendant check a
 * two-click cycle is trivially reachable from the picker.
 */
export function eligibleParents(projects: Project[], candidate: Project): Project[] {
  const descendants = new Set<string>();
  const collect = (id: string) => {
    for (const project of projects) {
      if (project.parentId === id && !descendants.has(project.id)) {
        descendants.add(project.id);
        collect(project.id);
      }
    }
  };
  collect(candidate.id);
  return projects.filter(
    (project) =>
      project.id !== candidate.id &&
      project.domain === candidate.domain &&
      !descendants.has(project.id),
  );
}

/** Distinct entity tags across a project list, alphabetical. */
export function entityTags(projects: Project[]): string[] {
  const tags = new Set<string>();
  for (const project of projects) {
    const tag = project.entityTag?.trim();
    if (tag) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}
