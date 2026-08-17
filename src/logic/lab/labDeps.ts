/**
 * The dependency checker: which agents reference agents that do not exist.
 *
 * An agent's prompt and trigger description cite sibling agents the way the
 * owner's SKILL.md library already writes them — a parenthesized slug,
 * "(financial-modeling)", or a backticked one, "`verify-financial-model`".
 * A cited slug with no row in the registry is a PHANTOM DEPENDENCY: the
 * prompt delegates to something that cannot run, and nothing else in the
 * system would ever say so.
 *
 * THE GRAMMAR IS DELIBERATELY STRICT: a kebab-case token of at least two
 * segments, standing ALONE inside parentheses or backticks. Prose is full of
 * hyphenated words — "cost-to-serve", "three-statement" — and a checker that
 * flags those teaches the owner to ignore it, which is worse than no checker
 * (the tool's warnings must stay meaningful, or they retire themselves).
 * Chains are not parsed at all: their steps name agents in a structured
 * field, compared directly.
 *
 * Ground truth, pinned by test: with the seeded registry, exactly
 * financial-modeling, verify-financial-model, consolidation-reporting and
 * deck-narrative-drafter are phantoms on first load.
 */
import type { LabAgent, LabChain } from '../../data/labTypes';

/** ≥2 kebab segments — one hyphenated prose word is not a slug reference. */
const SLUG_BODY = '[a-z0-9]+(?:-[a-z0-9]+)+';
const PAREN_REF = new RegExp(`\\((${SLUG_BODY})\\)`, 'g');
const TICK_REF = new RegExp(`\`(${SLUG_BODY})\``, 'g');

/** Every slug the text cites, unique and sorted. */
export function extractSlugRefs(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of [PAREN_REF, TICK_REF]) {
    for (const match of text.matchAll(pattern)) {
      found.add(match[1]);
    }
  }
  return [...found].sort();
}

export interface PhantomReport {
  /** Every phantom slug across the registry, unique, sorted. */
  all: string[];
  /** Phantoms per referencing agent id — drives the card warning badge. */
  byAgentId: Record<string, string[]>;
  /** Phantoms per chain id — a step naming a missing agent cannot run. */
  byChainId: Record<string, string[]>;
}

export function phantomReport(
  agents: readonly LabAgent[],
  chains: readonly LabChain[],
): PhantomReport {
  const known = new Set(agents.map((agent) => agent.slug));
  const all = new Set<string>();
  const byAgentId: Record<string, string[]> = {};
  const byChainId: Record<string, string[]> = {};

  for (const agent of agents) {
    const cited = extractSlugRefs(`${agent.description}\n${agent.systemPrompt}`);
    const phantoms = cited.filter((slug) => !known.has(slug));
    if (phantoms.length > 0) {
      byAgentId[agent.id] = phantoms;
      phantoms.forEach((slug) => all.add(slug));
    }
  }

  for (const chain of chains) {
    const phantoms = [
      ...new Set(chain.steps.map((step) => step.agentSlug).filter((slug) => !known.has(slug))),
    ].sort();
    if (phantoms.length > 0) {
      byChainId[chain.id] = phantoms;
      phantoms.forEach((slug) => all.add(slug));
    }
  }

  return { all: [...all].sort(), byAgentId, byChainId };
}
