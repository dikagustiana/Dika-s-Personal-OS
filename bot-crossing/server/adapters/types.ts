import type { SemanticEvent } from '../../src/core/scenario/semantic';

export type AdapterName = 'langgraph' | 'crewai' | 'autogen' | 'custom';

/** A pure normaliser: framework payload in, semantic events out. Never touches the wire schema directly. */
export interface Adapter {
  readonly name: AdapterName;
  normalize(raw: unknown): SemanticEvent[];
}

const DEPARTMENTS = ['Engineering Bay', 'Research Bay', 'Creative Bay', 'QA Bay', 'Executive Office'];

/** Map a role or agent name to a department by keyword; frameworks rarely carry one. */
export function inferDepartment(text: string | undefined, explicit?: unknown): string {
  if (typeof explicit === 'string' && DEPARTMENTS.includes(explicit)) return explicit;
  const t = (text ?? '').toLowerCase();
  if (/(qa|test|quality|security|release|review)/.test(t)) return 'QA Bay';
  if (/(research|analy|scien|data|knowledge|librar|forecast|quant)/.test(t)) return 'Research Bay';
  if (/(writ|design|copy|illustrat|creativ|video|motion|brand|market)/.test(t)) return 'Creative Bay';
  if (/(orchestrat|manager|supervisor|planner|lead|director|coordinator)/.test(t)) return 'Executive Office';
  return 'Engineering Bay';
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
