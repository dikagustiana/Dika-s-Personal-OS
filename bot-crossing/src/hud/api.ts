'use client';
// REST access for telemetry that is not on the stream: output documents and
// event history. Used through TanStack Query.
import type { CanonicalEvent } from '@/core/events/schema';

export interface OutputDocument {
  taskId: string;
  agentId: string;
  title: string;
  department: string;
  format: 'markdown';
  content: string;
  generatedAt: string;
}

export function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, '');
  if (typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:4000`;
  return 'http://localhost:4000';
}

/** Null means "no output for this task yet" — a normal state, not an error. */
export async function fetchOutput(taskId: string): Promise<OutputDocument | null> {
  const res = await fetch(`${apiBase()}/api/tasks/${encodeURIComponent(taskId)}/output`);
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Output request failed (${res.status})`);
  return (await res.json()) as OutputDocument;
}

export async function fetchHistory(agentId: string, limit = 100): Promise<CanonicalEvent[]> {
  const res = await fetch(`${apiBase()}/api/agents/${encodeURIComponent(agentId)}/history?limit=${limit}`);
  if (!res.ok) throw new Error(`History request failed (${res.status})`);
  return (await res.json()) as CanonicalEvent[];
}
