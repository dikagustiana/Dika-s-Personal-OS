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
import { useLabLiveStore } from '../store/labLiveStore';
import type { NumberViolation } from '../logic/lab/labNumbers';

const FUNCTION = 'run-evidence-agent';

/**
 * Which agent each action dispatches — the live store publishes under this
 * slug so the Flow floorplan animates the right station. Actions absent
 * here (snapshot, recheck, run-model) run no model and publish nothing:
 * a token for the evaluator would be the UI claiming an agent where there
 * is only first-party code.
 */
const ACTION_AGENT: Record<string, string> = {
  coordinate: 'evidence-coordinator',
  locate: 'evidence-locator',
  extract: 'evidence-extractor',
  literature: 'evidence-literature',
  review: 'evidence-reviewer',
  scout: 'evidence-scout',
  draft: 'evidence-drafter',
  'propose-spec': 'evidence-modeler',
  'frame-critique': 'evidence-framer',
  'frame-alternatives': 'evidence-framer',
};

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
  // The evidence layer's live-store choke point (see labModel.runLabAgent
  // for the execution layer's). Every screen that dispatches goes through
  // here, so the Flow surfaces need no per-screen wiring.
  const action = typeof body.action === 'string' ? body.action : '';
  const agentSlug = ACTION_AGENT[action];
  if (agentSlug) useLabLiveStore.getState().start({ agentSlug, action });
  const finish = <R extends { ok: boolean }>(outcome: R, runId?: string, error?: string): R => {
    if (agentSlug) {
      useLabLiveStore.getState().end({
        agentSlug,
        action,
        ok: outcome.ok,
        ...(error ? { error } : {}),
        ...(runId ? { runId } : {}),
      });
    }
    return outcome;
  };
  try {
    const data = await edgeFunctionCall<T & { error?: string; reason?: string; runId?: string }>(
      FUNCTION,
      { method: 'POST', appKey: readStoredKey() ?? undefined, body },
    );
    if (!data) return finish({ ok: false, reason: 'The evidence agent answered nothing.' } as AgentFailure);
    if (data.error) {
      const failure: AgentFailure = {
        ok: false,
        reason: refusalDetail(data),
        runId: data.runId,
        ...(Array.isArray((data as { blocked?: NumberViolation[] }).blocked)
          ? { blocked: (data as { blocked?: NumberViolation[] }).blocked }
          : {}),
      };
      return finish(failure, data.runId, failure.reason);
    }
    return finish({ ...(data as T), ok: true }, data.runId);
  } catch {
    return finish({ ok: false, reason: 'Could not reach the evidence agent.' } as AgentFailure);
  }
}

/** Key presence for the Layanan panel — same GET probe shape as probeLab. */
export async function probeEvidenceAgents(): Promise<{ configured: boolean; anthropic: boolean } | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const data = await edgeFunctionCall<{ configured?: boolean; providers?: { anthropic?: boolean } }>(
      FUNCTION,
      { method: 'GET' },
    );
    if (!data) return null;
    return { configured: Boolean(data.configured), anthropic: Boolean(data.providers?.anthropic) };
  } catch {
    // Unreachable renders as "could not check", never as "not configured".
    return null;
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

export interface ProposeSpecResult {
  runId: string;
  specId: string;
  params: string[];
  skipped: string[];
}

/** MODELER: propose a DECLARATIVE spec as a draft — never code, never approval. */
export function proposeModelSpec(input: { projectId: string; brief: string }) {
  return call<ProposeSpecResult>({ action: 'propose-spec', ...input });
}

export interface RunModelResult {
  runId?: string;
  resultId: string;
  evaluatorVersion: string;
  value: number | null;
  unit: string;
  summary: Record<string, unknown>;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  checksPassed: boolean;
  sensitivityPassed: boolean;
}

/** Runs a spec through the version-pinned evaluator; every check lands as a row. */
export function runModel(input: { specId: string; seed?: number }) {
  return call<RunModelResult>({ action: 'run-model', ...input });
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
