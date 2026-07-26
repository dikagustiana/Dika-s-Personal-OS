import type {
  FinishLineItem,
  FinishLineLink,
  FinishLineStatus,
  Milestone,
  Project,
} from '../data/types';

/**
 * Derivations for the Finish line view — the pack, rendered.
 *
 * The mental model is GateMap, not a register: rows and columns, one state per
 * cell, refusing to become a progress bar. Every row of the pack — block,
 * section, line — is a FinishLineItem; this module builds the tree, resolves
 * each line's links down to MILESTONE precision, and derives the counts the
 * header tiles show. Nothing here is stored, and nothing here holds a value:
 * the figures live in the workbook, the app holds structure and trust.
 *
 * BROKEN LINKS ARE A FIRST-CLASS STATE. milestone ids are plain strings into
 * a jsonb array, so nothing in the database can guarantee they still resolve.
 * A link whose milestone is gone is returned as `broken` — named and visible —
 * never filtered out. Silently dropping it produces the two worst outcomes
 * available: a gap that looks unowned when it is not, or one that looks owned
 * after the milestone that would have closed it was deleted.
 */

// ---------------------------------------------------------------------------
// Resolved links
// ---------------------------------------------------------------------------

export interface ResolvedLink {
  link: FinishLineLink;
  project: Project;
  /** The milestone, when the link is milestone-level and the id still resolves. */
  milestone?: Milestone;
  /**
   * Milestone-level link whose id no longer exists in the project's current
   * milestone array — the milestone was deleted or the project rewritten.
   * Rendered as a broken link, never dropped.
   */
  broken: boolean;
}

/**
 * Blocked milestones that were never escalated to anyone.
 *
 * `done` milestones are excluded: a blocker that was overcome without ever
 * being escalated is history, not a live silence. Absent `escalateTo` means
 * 'none', matching how the field is read everywhere else.
 */
export function silentBlockers(project: Project): Milestone[] {
  return project.milestones.filter(
    (milestone) =>
      !milestone.done &&
      milestone.status === 'blocked' &&
      (milestone.escalateTo ?? 'none') === 'none',
  );
}

/**
 * Resolves an item's links against the live project list.
 *
 * A link whose PROJECT is gone is dropped — the database cascades project
 * deletion through the join table, so such a link can only be a stale cache
 * and will disappear on the next read. A link whose MILESTONE is gone is the
 * case nothing can cascade, and it comes back `broken: true`.
 */
export function resolveLinks(item: FinishLineItem, projects: Project[]): ResolvedLink[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const resolved: ResolvedLink[] = [];
  for (const link of item.links) {
    const project = byId.get(link.projectId);
    if (!project) continue;
    if (!link.milestoneId) {
      resolved.push({ link, project, broken: false });
      continue;
    }
    const milestone = project.milestones.find((candidate) => candidate.id === link.milestoneId);
    resolved.push(
      milestone ? { link, project, milestone, broken: false } : { link, project, broken: true },
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// The line annotation — what the expanded panel shows
// ---------------------------------------------------------------------------

export interface PackLine {
  item: FinishLineItem;
  links: ResolvedLink[];
  /** No work is linked at all. On an untrusted line, the loudest state. */
  unowned: boolean;
  /** A proxy is standing in; everything downstream is provisional. */
  provisional: boolean;
  /** Milestone-level links whose milestone no longer exists. */
  brokenLinks: number;
  /**
   * Blocked, unescalated milestones across the linked work. Milestone-level
   * links count only their own milestone — a line linked to one milestone of
   * a 50-milestone parent is not stuck on the other 49.
   */
  silentBlockers: number;
}

export function buildPackLine(item: FinishLineItem, projects: Project[]): PackLine {
  const links = resolveLinks(item, projects);
  // DISTINCT milestones, not link count: a line holding both a project-level
  // link and a milestone-level link into the same project must not count that
  // milestone's silence twice. Milestone-level links contribute only their own
  // milestone — a line linked to one milestone of a 50-milestone parent is not
  // stuck on the other 49 — while a project-level link contributes them all.
  const silent = new Set<string>();
  for (const resolved of links) {
    if (resolved.broken) continue;
    if (resolved.milestone) {
      const m = resolved.milestone;
      if (!m.done && m.status === 'blocked' && (m.escalateTo ?? 'none') === 'none') {
        silent.add(`${resolved.project.id}:${m.id}`);
      }
    } else {
      for (const m of silentBlockers(resolved.project)) {
        silent.add(`${resolved.project.id}:${m.id}`);
      }
    }
  }
  return {
    item,
    links,
    unowned: links.length === 0,
    provisional: Boolean(item.interim),
    brokenLinks: links.filter((resolved) => resolved.broken).length,
    silentBlockers: silent.size,
  };
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export interface PackNode {
  item: FinishLineItem;
  children: PackNode[];
  /** Present on lines (kind === 'line'); structural rows carry none. */
  line?: PackLine;
  /** Lines in this subtree that are not trusted. */
  needsWork: number;
  /** Trusted lines in this subtree. */
  trusted: number;
  /** All lines in this subtree. */
  totalLines: number;
  /**
   * Broken links in this subtree. Rolled up so a block of nominally trusted
   * lines cannot hide a dangling link behind its collapsed header — the
   * broken link is a first-class state at every level, not just on the line.
   */
  brokenLinks: number;
  /**
   * Blocks arrive expanded when they contain a non-trusted line OR a broken
   * link — the document opens to where the work is.
   */
  defaultOpen: boolean;
}

const byDocumentOrder = (a: FinishLineItem, b: FinishLineItem) =>
  a.order - b.order || a.item.localeCompare(b.item);

/**
 * Builds the pack tree in document order.
 *
 * STATUS ON STRUCTURAL ROWS IS IGNORED. Blocks and sections are structure;
 * whether a block "needs work" is derived from the lines inside it, exactly
 * the way project progress is derived from milestones. A block seeded with
 * the schema's default status must not paint the whole pack red.
 *
 * An item whose parent id does not resolve becomes a root rather than
 * disappearing — same posture as the broken milestone link: structure the
 * owner entered must stay visible even when its wiring is wrong.
 */
export function buildPack(items: FinishLineItem[], projects: Project[]): PackNode[] {
  const ids = new Set(items.map((item) => item.id));
  const childrenOf = new Map<string, FinishLineItem[]>();
  const roots: FinishLineItem[] = [];
  for (const item of items) {
    if (item.parentId && ids.has(item.parentId)) {
      const siblings = childrenOf.get(item.parentId);
      if (siblings) siblings.push(item);
      else childrenOf.set(item.parentId, [item]);
    } else {
      roots.push(item);
    }
  }

  const build = (item: FinishLineItem): PackNode => {
    const children = (childrenOf.get(item.id) ?? []).sort(byDocumentOrder).map(build);
    const line = item.kind === 'line' ? buildPackLine(item, projects) : undefined;
    const own = item.kind === 'line' ? 1 : 0;
    const ownTrusted = item.kind === 'line' && item.status === 'trusted' ? 1 : 0;
    const totalLines = own + children.reduce((sum, child) => sum + child.totalLines, 0);
    const trusted = ownTrusted + children.reduce((sum, child) => sum + child.trusted, 0);
    const needsWork = totalLines - trusted;
    const brokenLinks =
      (line?.brokenLinks ?? 0) + children.reduce((sum, child) => sum + child.brokenLinks, 0);
    return {
      item,
      children,
      line,
      needsWork,
      trusted,
      totalLines,
      brokenLinks,
      defaultOpen: needsWork > 0 || brokenLinks > 0,
    };
  };

  return roots.sort(byDocumentOrder).map(build);
}

/** Depth-first line walk, for anything that needs every line once. */
export function packLines(nodes: PackNode[]): PackNode[] {
  return nodes.flatMap((node) => [
    ...(node.item.kind === 'line' ? [node] : []),
    ...packLines(node.children),
  ]);
}

/** Root ids on the path to an item — what has to be expanded to reach it. */
export function ancestorPath(items: FinishLineItem[], itemId: string): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path: string[] = [];
  let current = byId.get(itemId);
  const guard = new Set<string>();
  while (current?.parentId && byId.has(current.parentId) && !guard.has(current.parentId)) {
    guard.add(current.parentId);
    path.unshift(current.parentId);
    current = byId.get(current.parentId);
  }
  return path;
}

// ---------------------------------------------------------------------------
// Header tiles
// ---------------------------------------------------------------------------

export interface PackSummary {
  /** Lines that are not trusted. */
  needsWork: number;
  blocked: number;
  /** Untrusted lines with no work linked. */
  unowned: number;
  /** Untrusted lines resting on a proxy. */
  provisional: number;
  /** Untrusted lines whose linked work is stuck with nobody told. */
  silent: number;
  /** The only progress number this view can honestly offer. */
  trusted: number;
  totalLines: number;
}

export function summarizePack(nodes: PackNode[]): PackSummary {
  const lines = packLines(nodes);
  const open = lines.filter((node) => node.item.status !== 'trusted');
  return {
    needsWork: open.length,
    blocked: open.filter((node) => node.item.status === 'blocked').length,
    unowned: open.filter((node) => node.line?.unowned).length,
    provisional: open.filter((node) => node.line?.provisional).length,
    silent: open.filter((node) => (node.line?.silentBlockers ?? 0) > 0).length,
    trusted: lines.length - open.length,
    totalLines: lines.length,
  };
}

// ---------------------------------------------------------------------------
// The reverse direction — project back to the pack
// ---------------------------------------------------------------------------

export interface TrustLine {
  item: FinishLineItem;
  /** Ancestor labels, root first — the Function → Nature → Account path. */
  path: string[];
  status: FinishLineStatus;
  /** How many of THIS project's milestones are linked to the line — RESOLVED
   *  ones only. A dangling id is counted under `brokenLinks` instead: telling
   *  the owner "2 milestones here" when one was deleted is the looks-owned
   *  failure the broken-link state exists to prevent. */
  milestonesLinked: number;
  /** Milestone links from this project whose milestone no longer exists. */
  brokenLinks: number;
  /** A project-level link (no milestone) also exists. */
  projectLevel: boolean;
}

/**
 * The pack lines this project's work would make trustworthy — the answer to
 * "why does this project matter". Returns [] when nothing is linked, and the
 * card renders NOTHING in that case: no empty state, no prompt. Most projects
 * have no links at first, and 21 cards each carrying an empty invitation is
 * noise.
 */
export function linesForProject(items: FinishLineItem[], project: Project): TrustLine[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const milestoneIds = new Set(project.milestones.map((milestone) => milestone.id));
  const result: TrustLine[] = [];
  for (const item of items) {
    if (item.kind !== 'line') continue;
    const mine = item.links.filter((link) => link.projectId === project.id);
    if (mine.length === 0) continue;
    const path: string[] = [];
    let cursor = item.parentId ? byId.get(item.parentId) : undefined;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      path.unshift(cursor.item);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    const milestoneLevel = mine.filter((link) => link.milestoneId);
    result.push({
      item,
      path,
      status: item.status,
      milestonesLinked: milestoneLevel.filter((link) => milestoneIds.has(link.milestoneId!))
        .length,
      brokenLinks: milestoneLevel.filter((link) => !milestoneIds.has(link.milestoneId!)).length,
      projectLevel: mine.some((link) => !link.milestoneId),
    });
  }
  // Untrusted first — the reason to look — then document order.
  return result.sort((a, b) => {
    const openA = a.status !== 'trusted' ? 0 : 1;
    const openB = b.status !== 'trusted' ? 0 : 1;
    return openA - openB || a.item.order - b.item.order;
  });
}

/**
 * The milestone ids of one project that any pack line links to — the marker
 * set for the milestone list. On a 50-milestone parent, these are the ones
 * that actually move the deliverable.
 */
export function linkedMilestoneIds(items: FinishLineItem[], projectId: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    for (const link of item.links) {
      if (link.projectId === projectId && link.milestoneId) ids.add(link.milestoneId);
    }
  }
  return ids;
}
