/**
 * FSRE BUILDING — FINDING A COMPANY, A SKILL OR A STAGE.
 *
 * The source searched one singleton folder, so "SYN05" in a ten-company run
 * found nothing. Here the company list is the reducer's own (every ticker an
 * event has named), filtered by ticker or name, and choosing one selects
 * its folder BY TICKER wherever it rests.
 */
import { PANEL } from './geometry';
import { deskKeyForGate, runnerOf } from './layout';
import { companyList, type CompanyState, type FsreContext, type FsreState } from './reducer';
import type { FsreSelection } from './scene';
import { SEARCH_TYPE_WORDS, type SearchResultType } from './statuses';

const normalise = (query: string) => query.trim().toLowerCase();

/** Companies whose ticker or name contains the query; all of them for an empty query. */
export function filterCompanies(state: FsreState, query: string): CompanyState[] {
  const q = normalise(query);
  const all = companyList(state);
  if (!q) return all;
  return all.filter((company) => company.ticker.toLowerCase().includes(q) || (company.name ?? '').toLowerCase().includes(q));
}

export interface SearchResult {
  type: SearchResultType;
  typeWord: string;
  id: string;
  label: string;
}

export function searchResults(ctx: FsreContext, state: FsreState, query: string, limit: number = PANEL.searchResults): SearchResult[] {
  const q = normalise(query);
  if (!q) return [];
  const results: SearchResult[] = [];
  for (const company of filterCompanies(state, q)) {
    results.push({
      type: 'company',
      typeWord: SEARCH_TYPE_WORDS.company,
      id: company.ticker,
      label: company.name ? `${company.ticker} — ${company.name}` : company.ticker,
    });
  }
  for (const skill of ctx.plan.agentSkills) {
    if (skill.toLowerCase().includes(q)) results.push({ type: 'skill', typeWord: SEARCH_TYPE_WORDS.skill, id: skill, label: skill });
  }
  for (const stageId of ctx.plan.stageOrder) {
    const stage = ctx.plan.stagesById[stageId];
    if (stage.id.toLowerCase().includes(q) || stage.name.toLowerCase().includes(q)) {
      results.push({ type: 'stage', typeWord: SEARCH_TYPE_WORDS.stage, id: stage.id, label: stage.name });
    }
  }
  return results.slice(0, limit);
}

/** Where a result takes the reader: a folder by ticker, an agent, a gate room, or the stage's runner. */
export function selectionForResult(ctx: FsreContext, result: SearchResult): FsreSelection {
  switch (result.type) {
    case 'company':
      return { kind: 'folder', ticker: result.id };
    case 'skill':
      return { kind: 'agent', skill: result.id };
    case 'stage': {
      if (ctx.plan.desks[deskKeyForGate(result.id)]) return { kind: 'gate', stageId: result.id };
      const runner = runnerOf(ctx.plan, result.id);
      return runner && ctx.plan.agentSkills.includes(runner) ? { kind: 'agent', skill: runner } : { kind: 'partner' };
    }
  }
}

/* ---------- the combobox's active option ---------- */

export const FIRST_RESULT = 0;

/** Arrow keys move the active option, stopping at either end. */
export function moveActive(index: number, direction: 'next' | 'previous', count: number): number {
  if (count <= 0) return FIRST_RESULT;
  return direction === 'next' ? Math.min(index + 1, count - 1) : Math.max(index - 1, FIRST_RESULT);
}
