/**
 * The browser side of run-evidence-agent — the only code that talks to it.
 *
 * Every call is owner-initiated and carries the app key; the function's
 * writes run as the service role underneath, so the database rails bind
 * them whatever this file does. Results always carry the runId: the run
 * log is the record, these return values are for the screen watching.
 */
import { edgeFunctionCall, isSupabaseConfigured } from './supabaseRepository';
import { refusalDetail } from './researchModel';
import { readStoredKey } from '../components/PassphraseGate';
import type { NumberViolation } from '../logic/lab/labNumbers';

const FUNCTION = 'run-evidence-agent';

interface AgentFailure {
  ok: false;
  reason: string;
  runId?: string;
  /** G-NUMBER refusals carry the offending tokens so the screen names them. */
  blocked?: NumberViolation[];
}

async function call<T extends { runId?: string }>(
  body: Record<string, unknown>,
): Promise<(T & { ok: true }) | AgentFailure> {
  if (!isSupabaseConfigured) {
    return { ok: false, reason: 'Supabase is not configured — evidence agents need the live backend.' };
  }
  try {
    const data = await edgeFunctionCall<T & { error?: string; reason?: string; runId?: string }>(
      FUNCTION,
      { method: 'POST', appKey: readStoredKey() ?? undefined, body },
    );
    if (!data) return { ok: false, reason: 'The evidence agent answered nothing.' };
    if (data.error) {
      return {
        ok: false,
        reason: refusalDetail(data),
        runId: data.runId,
        ...(Array.isArray((data as { blocked?: NumberViolation[] }).blocked)
          ? { blocked: (data as { blocked?: NumberViolation[] }).blocked }
          : {}),
      };
    }
    return { ...(data as T), ok: true };
  } catch {
    return { ok: false, reason: 'Could not reach the evidence agent.' };
  }
}

export interface CoordinateResult {
  runId: string;
  plan: string;
  tasks: Array<{ id: string; title: string; agentSlug: string }>;
  skipped: string[];
}

export function coordinateEvidence(input: { request: string; projectId?: string }) {
  return call<CoordinateResult>({ action: 'coordinate', ...input });
}

export interface LocateResult {
  runId: string;
  locators: Array<{ locator: string; quantity: string; note: string }>;
}

export function locateQuantity(input: { quantity: string; documentText: string }) {
  return call<LocateResult>({ action: 'locate', ...input });
}

export interface ExtractResult {
  runId: string;
  created: string[];
  skipped: string[];
}

export function extractDatapoints(input: {
  sourceDocumentId: string;
  selectedText: string;
  quantity: string;
}) {
  return call<ExtractResult>({ action: 'extract', ...input });
}

export function structureLiterature(input: { pastedResults: string }) {
  return call<ExtractResult>({ action: 'literature', ...input });
}

export interface ReviewResult {
  runId: string;
  report: string;
  created: { conflicts: number; contradictions: number };
  skipped: string[];
}

export function runReviewer(input: { projectId: string }) {
  return call<ReviewResult>({ action: 'review', ...input });
}

export interface DraftResult {
  runId: string;
  outputId?: string;
  citedClaimIds?: string[];
  /** Present when G-NUMBER refused the draft server-side. */
  blocked?: NumberViolation[];
}

export function draftOutput(input: { projectId: string; outputType: string; instruction: string }) {
  return call<DraftResult>({ action: 'draft', ...input });
}
