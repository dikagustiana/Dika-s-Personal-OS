/**
 * THE ONE place an evidence agent's colour lives, keyed by agent slug and
 * imported by every Flow surface (floorplan tokens, rail roster, console
 * dots, banner). Defined twice they will drift, and the floorplan and the
 * log would disagree about who is who — so this module exists and nothing
 * else may restate these values.
 *
 * The set is fixed by migrations (six agents in 20260817000078, framer in
 * 080, scout in 081, modeler in 082), which is why a constant module is
 * truthful rather than a shortcut. Registry rows still enrich at render
 * time (display name, is_active); an agent the registry carries that this
 * module does not falls back to the neutral colour rather than vanishing.
 *
 * Hexes are literal on purpose: these paint SVG presentation attributes,
 * where CSS custom properties fail silently (the prototype's second bug).
 * Chosen to stay distinguishable on the light canvas and to stay clear of
 * the three ACTOR colours (slate plinths, amber owner, near-ink gate).
 */

export interface EvidenceAgentEntry {
  slug: string;
  /** Fallback display name when the registry row is not loaded. */
  name: string;
  color: string;
}

export const EVIDENCE_AGENTS: readonly EvidenceAgentEntry[] = [
  { slug: 'evidence-framer', name: 'Framer', color: '#65A30D' },
  { slug: 'evidence-coordinator', name: 'Coordinator', color: '#7C3AED' },
  { slug: 'evidence-scout', name: 'Scout', color: '#C2410C' },
  { slug: 'evidence-literature', name: 'Literature', color: '#0D9488' },
  { slug: 'evidence-locator', name: 'Locator', color: '#0891B2' },
  { slug: 'evidence-extractor', name: 'Extractor', color: '#2563EB' },
  { slug: 'evidence-modeler', name: 'Modeler', color: '#DB2777' },
  { slug: 'evidence-reviewer', name: 'Reviewer', color: '#C026D3' },
  { slug: 'evidence-drafter', name: 'Drafter', color: '#4F46E5' },
];

/** Neutral dot for execution-layer agents (bpi, sfa, …) in the console. */
export const AGENT_COLOR_FALLBACK = '#64748B';

const BY_SLUG = new Map(EVIDENCE_AGENTS.map((entry) => [entry.slug, entry]));

export function agentColor(slug: string): string {
  return BY_SLUG.get(slug)?.color ?? AGENT_COLOR_FALLBACK;
}

export function agentFallbackName(slug: string): string {
  return BY_SLUG.get(slug)?.name ?? slug;
}
