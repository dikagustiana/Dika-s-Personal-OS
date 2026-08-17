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

/** SCOUT: pasted listings → candidate rows (four fields; the DB assigns tier). */
export function scoutSources(input: { pastedResults: string; projectId?: string }) {
  return call<ExtractResult>({ action: 'scout', ...input });
}

export interface SnapshotResult {
  runId?: string;
  storagePath: string;
  hash: string;
  sizeBytes: number;
}

/** Server-side fetch + SHA-256 into storage. No table writes — ingestion stays the owner's. */
export function snapshotUrl(input: { url: string }) {
  return call<SnapshotResult>({ action: 'snapshot', ...input });
}

export interface RecheckResult {
  runId?: string;
  changed: boolean;
  hash: string;
  storedHash: string;
}

/** Re-fetch + re-hash + FLAG. Detects that the page changed — never that the figure did. */
export function recheckSource(input: { sourceDocumentId: string }) {
  return call<RecheckResult>({ action: 'recheck', ...input });
}

export interface FrameCritiqueResult {
  runId: string;
  critique: string;
}

/** The framer critiques a framing. JSON back, no writes — ever. */
export function critiqueFraming(input: { rawStatement: string; framedQuestion?: string }) {
  return call<FrameCritiqueResult>({ action: 'frame-critique', ...input });
}

export interface FrameAlternativesResult {
  runId: string;
  alternatives: Array<{
    framedQuestion: string;
    why: string;
    subQuestions: Array<{ statement: string; falsifier: string }>;
  }>;
}

/**
 * 2–3 alternative framings, never one (an anchor is not a choice). The
 * owner picks; recording the pick is the owner's write, not the framer's.
 */
export function proposeFramings(input: { rawStatement: string }) {
  return call<FrameAlternativesResult>({ action: 'frame-alternatives', ...input });
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
