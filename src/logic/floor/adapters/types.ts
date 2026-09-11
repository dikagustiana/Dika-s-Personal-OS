// =============================================================================
// FRAMEWORK ADAPTERS — foreign payloads in, semantic events out
// =============================================================================
//
// WHAT THESE ARE FOR NOW. In the standalone build a Fastify server received
// LangGraph / CrewAI / AutoGen webhooks and pushed the normalised events
// down a WebSocket. That server is deleted (B-11) and the floor's own
// figures come from the institution's rows, not from a webhook.
//
// These stay because the normalisation is the hard part and it is pure:
// each one is "framework payload in, SemanticEvent[] out", with no I/O, no
// clock and no wire format. When something outside this institution needs
// to appear on the floor — a LangGraph run the director is watching beside
// it — this is the seam it arrives through, and it arrives as SEMANTIC
// events, so the one rule the floor has still holds: the client may derive
// position, never state.
//
// They are not wired to anything today. PLACEHOLDERS.md says so; a file
// that quietly does nothing while looking load-bearing is worse than an
// entry in a list.
import type { SemanticEvent } from '../scenario/semantic';

export type AdapterName = 'langgraph' | 'crewai' | 'autogen' | 'custom';

/** A pure normaliser: framework payload in, semantic events out. Never touches the wire schema directly. */
export interface Adapter {
  readonly name: AdapterName;
  normalize(raw: unknown): SemanticEvent[];
}

/**
 * The institution's departments, as slugs. A foreign framework has no idea
 * this institution exists, so an agent that arrives without a department
 * has to be placed somewhere — and the honest place is the PROGRAM OFFICE,
 * which is where unrouted work goes in the real pipeline too.
 *
 * The keyword map below is a guess and is only ever consulted when the
 * payload did not say. It cannot invent a department that does not exist:
 * anything it cannot match lands in the program office rather than in a
 * plausible-looking wrong bay.
 */
export const PROGRAM_OFFICE = 'program-office';

const DEPARTMENTS = [
  'framing-office',
  'methodology-desk',
  'evidence-acquisition',
  'data-engineering',
  'quantitative-analysis',
  'domain-synthesis',
  'verification',
  'editorial',
  PROGRAM_OFFICE,
];

// Deliberately absent: "review", "lead", "manager", "analyst". Peer review
// happens inside every department, every department has a lead, and
// "analyst" fits four of them — a keyword that matches everywhere places
// nobody correctly and only makes the guess look confident.
const KEYWORDS: Array<[RegExp, string]> = [
  [/(verif|check|qa|test|quality|audit|fact)/, 'verification'],
  [/(edit|writ|copy|prose|draft|narrativ|report)/, 'editorial'],
  [/(method|protocol|design|approach)/, 'methodology-desk'],
  [/(search|retriev|acquir|scrape|fetch|source|librar)/, 'evidence-acquisition'],
  [/(etl|pipeline|ingest|clean|engineer|schema|sql)/, 'data-engineering'],
  [/(quant|model|forecast|regress|statis|simulat|numer)/, 'quantitative-analysis'],
  [/(synth|domain|analy|interpret|insight)/, 'domain-synthesis'],
  [/(frame|scope|question|brief|plan)/, 'framing-office'],
];

/** Map a role or agent name to a department slug; frameworks rarely carry one. */
export function inferDepartment(text: string | undefined, explicit?: unknown): string {
  if (typeof explicit === 'string' && DEPARTMENTS.includes(explicit)) return explicit;
  const t = (text ?? '').toLowerCase();
  for (const [pattern, slug] of KEYWORDS) if (pattern.test(t)) return slug;
  return PROGRAM_OFFICE;
}

export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
}

export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function clampProgress(p: number): number {
  return Math.min(100, Math.max(0, p));
}

export function truncate(s: string, n = 72): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}
