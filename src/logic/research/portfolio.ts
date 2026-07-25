/**
 * Cross-project views over the research portfolio, plus the fact library.
 *
 * Two things are only visible above the level of a single project, which is why
 * they live here rather than in pipeline.ts: work that several projects are
 * waiting on at once, and the same figure carrying different values in two
 * projects. The second is the one that would appear in two papers at once.
 */
import type {
  FactLibraryEntry,
  ResearchItem,
  ResearchProject,
} from '../../data/types';

/** Items are matched across projects on a normalised name, never on id. */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

export interface SharedPendingItem {
  /** The name as first encountered, for display. */
  name: string;
  unit: string;
  /** Critical in ANY project makes the shared row critical. */
  crit: boolean;
  /** Project titles waiting on it. */
  projects: string[];
}

/**
 * Indeterminate items wanted by more than one project — verify once, use many
 * times. Single-project items are included too (the console lists them), with
 * the multi-project ones sorted first.
 */
export function sharedPending(projects: ResearchProject[]): SharedPendingItem[] {
  const byName = new Map<string, SharedPendingItem>();
  for (const research of projects) {
    for (const item of research.items) {
      if (item.status !== 'IND') continue;
      const key = normaliseName(item.name);
      const existing = byName.get(key);
      if (existing) {
        existing.crit = existing.crit || item.crit;
        existing.projects.push(research.project.title);
      } else {
        byName.set(key, {
          name: item.name,
          unit: item.unit,
          crit: item.crit,
          projects: [research.project.title],
        });
      }
    }
  }
  return [...byName.values()].sort(
    (a, b) =>
      Number(b.crit) - Number(a.crit) || b.projects.length - a.projects.length,
  );
}

export interface ConflictingValue {
  value: string;
  projectTitle: string;
  source: string;
  asof: string;
}

export interface ValueConflict {
  name: string;
  values: ConflictingValue[];
}

/**
 * The same item name carrying different non-empty values in different projects.
 *
 * Only non-empty values count: an unfilled item is not a disagreement, it is
 * just unfilled. Two projects agreeing is not a conflict either, so a name is
 * reported only when the set of distinct values exceeds one.
 */
export function valueConflicts(projects: ResearchProject[]): ValueConflict[] {
  const byName = new Map<string, ConflictingValue[]>();
  const displayName = new Map<string, string>();
  for (const research of projects) {
    for (const item of research.items) {
      const value = item.value.trim();
      if (!value) continue;
      const key = normaliseName(item.name);
      if (!displayName.has(key)) displayName.set(key, item.name);
      const list = byName.get(key) ?? [];
      list.push({
        value,
        projectTitle: research.project.title,
        source: item.source,
        asof: item.asof,
      });
      byName.set(key, list);
    }
  }
  const conflicts: ValueConflict[] = [];
  for (const [key, values] of byName) {
    if (values.length < 2) continue;
    if (new Set(values.map((entry) => entry.value)).size < 2) continue;
    conflicts.push({ name: displayName.get(key) ?? key, values });
  }
  return conflicts;
}

/**
 * Attached to every item pulled out of the library, and NOT optional.
 *
 * The same figure can be correct in one project and wrong in another because
 * the definition differs — different coverage, different base year, different
 * scope. The note is what stops a reused number being treated as verified for
 * a use it was never verified for.
 */
export const LIBRARY_PULL_NOTE =
  'Ditarik dari pustaka lintas riset — definisinya harus dicek ulang agar cocok untuk pemakaian di riset ini.';

/**
 * A register item built from a library fact. Arrives `V` because it was verified
 * where it came from, but carries the definition-check note so that status is
 * never mistaken for verified-for-this-use.
 */
export function itemFromLibrary(
  fact: FactLibraryEntry,
  projectId: string,
  order: number,
): Omit<ResearchItem, 'id'> {
  return {
    projectId,
    name: fact.name,
    unit: fact.unit,
    type: 'parameter',
    crit: false,
    status: 'V',
    value: fact.value,
    source: fact.source,
    asof: fact.asof,
    note: fact.fromProject
      ? `${LIBRARY_PULL_NOTE} (asal: ${fact.fromProject})`
      : LIBRARY_PULL_NOTE,
    order,
  };
}

/** A library entry built from a verified register item. */
export function libraryEntryFromItem(
  item: ResearchItem,
  projectTitle: string,
): Omit<FactLibraryEntry, 'id'> {
  return {
    name: item.name,
    unit: item.unit,
    value: item.value,
    source: item.source,
    asof: item.asof,
    fromProject: projectTitle,
  };
}

/**
 * Every verified item across every project that is not already in the library,
 * de-duplicated by normalised name — the console's "sweep" action.
 *
 * Name-duplicates are skipped rather than merged: two projects may hold the
 * same name with different definitions, and picking one silently is exactly the
 * failure valueConflicts exists to surface.
 */
export function librarySweepCandidates(
  projects: ResearchProject[],
  library: FactLibraryEntry[],
): Array<Omit<FactLibraryEntry, 'id'>> {
  const seen = new Set(library.map((fact) => normaliseName(fact.name)));
  const candidates: Array<Omit<FactLibraryEntry, 'id'>> = [];
  for (const research of projects) {
    for (const item of research.items) {
      if (item.status !== 'V') continue;
      const key = normaliseName(item.name);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(libraryEntryFromItem(item, research.project.title));
    }
  }
  return candidates;
}
