/**
 * The browser side of the Lab executor — the only code that talks to the
 * run-lab-agent Edge Function.
 *
 * STREAMING IS TRANSPORT, THE RUN ROW IS TRUTH. The function writes the run
 * row before dispatch and finalizes it whatever happens to this connection;
 * everything returned here is for the screen that is watching. A caller that
 * needs the authoritative record reads the run log, which is why every
 * outcome carries the runId.
 *
 * REFUSALS COME IN TWO SHAPES and both are read, exactly as researchModel
 * documents: the guard answers `{ error }` with a real status (401/429/400),
 * the function's own refusals answer `{ reason }` (unconfigured, boundary).
 * refusalDetail is imported rather than re-implemented so the two subsystems
 * cannot drift apart.
 */
import { edgeFunctionCall, isSupabaseConfigured } from './supabaseRepository';
import { refusalDetail } from './researchModel';
import { readStoredKey } from '../components/PassphraseGate';
import type { LabProviderName } from './labTypes';

const FUNCTION = 'run-lab-agent';

export interface LabCapabilities {
  configured: boolean;
  providers: Record<LabProviderName, boolean>;
}

export const LAB_UNCONFIGURED: LabCapabilities = {
  configured: false,
  providers: { anthropic: false, deepseek: false, kimi: false },
};

export async function probeLab(): Promise<LabCapabilities> {
  if (!isSupabaseConfigured) return LAB_UNCONFIGURED;
  try {
    const data = await edgeFunctionCall<LabCapabilities>(FUNCTION, { method: 'GET' });
    if (!data) return LAB_UNCONFIGURED;
    return {
      configured: Boolean(data.configured),
      providers: {
        anthropic: Boolean(data.providers?.anthropic),
        deepseek: Boolean(data.providers?.deepseek),
        kimi: Boolean(data.providers?.kimi),
      },
    };
  } catch {
    // Unreachable and unconfigured render the same way: run buttons that
    // explain themselves instead of failing.
    return LAB_UNCONFIGURED;
  }
}

export interface LabRunRequest {
  agentSlug: string;
  input: string;
  /** Provider NAME override; absent means the agent's default. */
  provider?: LabProviderName;
  chainId?: string;
  stepIndex?: number;
  parentRunId?: string;
  /** Fires as soon as the run row exists, before any token arrives. */
  onRunStart?: (info: { runId: string; provider: string; model: string }) => void;
  onDelta?: (text: string) => void;
  /** Lets the screen abort mid-stream; the server still finalizes the row. */
  signal?: AbortSignal;
}

export type LabRunOutcome =
  | {
      ran: true;
      runId: string;
      tokensIn: number | null;
      tokensOut: number | null;
      costUsd: number | null;
      durationMs: number | null;
    }
  | { ran: false; reason: string; runId?: string };

interface StreamFrame {
  event: string;
  data: Record<string, unknown>;
}

/** Parses one SSE buffer increment into complete frames, keeping the tail. */
export function drainSseBuffer(buffer: string): { frames: StreamFrame[]; rest: string } {
  const frames: StreamFrame[] = [];
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      frames.push({ event, data: JSON.parse(data) as Record<string, unknown> });
    } catch {
      // A torn frame is dropped; the run row remains the record.
    }
  }
  return { frames, rest };
}

/**
 * Runs one agent, streaming. Resolves when the stream ends — with the
 * accounting from the `done` frame, or with the server's stated reason.
 */
export async function runLabAgent(request: LabRunRequest): Promise<LabRunOutcome> {
  if (!isSupabaseConfigured) {
    return { ran: false, reason: 'Supabase is not configured — Lab runs need the live backend.' };
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/${FUNCTION}`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        ...(readStoredKey() ? { 'x-app-key': readStoredKey() as string } : {}),
      },
      body: JSON.stringify({
        action: 'run',
        agentSlug: request.agentSlug,
        input: request.input,
        ...(request.provider ? { provider: request.provider } : {}),
        ...(request.chainId ? { chainId: request.chainId } : {}),
        ...(request.stepIndex === undefined ? {} : { stepIndex: request.stepIndex }),
        ...(request.parentRunId ? { parentRunId: request.parentRunId } : {}),
        confirmed: true,
      }),
    });
  } catch (error) {
    if (request.signal?.aborted) {
      return { ran: false, reason: 'Dibatalkan sebelum dispatch.' };
    }
    void error;
    return { ran: false, reason: 'Could not reach the lab executor.' };
  }

  const contentType = response.headers.get('content-type') ?? '';

  // Everything that is not a stream is a refusal or a guard error, in the
  // usual two shapes. A boundary refusal additionally carries the runId of
  // its error row, so the log link still works.
  if (!contentType.includes('text/event-stream')) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; reason?: string; retryAfter?: number; runId?: string }
      | null;
    return {
      ran: false,
      reason: refusalDetail(body),
      ...(body?.runId ? { runId: body.runId } : {}),
    };
  }

  if (!response.body) {
    return { ran: false, reason: 'The executor answered with no stream body.' };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let runId = '';
  let outcome: LabRunOutcome | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = drainSseBuffer(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.event === 'run') {
          runId = String(frame.data.runId ?? '');
          request.onRunStart?.({
            runId,
            provider: String(frame.data.provider ?? ''),
            model: String(frame.data.model ?? ''),
          });
        } else if (frame.event === 'delta') {
          request.onDelta?.(String(frame.data.text ?? ''));
        } else if (frame.event === 'done') {
          outcome = {
            ran: true,
            runId: String(frame.data.runId ?? runId),
            tokensIn: numberOrNull(frame.data.tokensIn),
            tokensOut: numberOrNull(frame.data.tokensOut),
            costUsd: numberOrNull(frame.data.costUsd),
            durationMs: numberOrNull(frame.data.durationMs),
          };
        } else if (frame.event === 'error') {
          outcome = {
            ran: false,
            reason: String(frame.data.message ?? 'The run failed.'),
            runId: String(frame.data.runId ?? runId) || undefined,
          };
        }
      }
    }
  } catch {
    // Reader threw: an abort or a dropped connection. The server finalizes
    // the row either way; report what this screen knows.
    return {
      ran: false,
      reason: request.signal?.aborted
        ? 'Dibatalkan — output parsial tersimpan di run log.'
        : 'The stream dropped mid-run. Check the run log for the outcome.',
      ...(runId ? { runId } : {}),
    };
  }

  if (outcome) return outcome;
  // Stream ended without a terminal frame — the row, not this screen, knows.
  return {
    ran: false,
    reason: 'The stream ended without a verdict. Check the run log.',
    ...(runId ? { runId } : {}),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Marks the never-dispatched steps of an aborted chain. Returns how many. */
export async function markChainAborted(input: {
  chainId: string;
  failedStepIndex: number;
  failedAgentSlug: string;
  failedRunId?: string;
  remaining: Array<{ agentSlug: string; stepIndex: number }>;
}): Promise<number> {
  if (!isSupabaseConfigured) return 0;
  try {
    const data = await edgeFunctionCall<{ marked?: number }>(FUNCTION, {
      method: 'POST',
      appKey: readStoredKey() ?? undefined,
      body: { action: 'abortChain', ...input },
    });
    return data?.marked ?? 0;
  } catch {
    return 0;
  }
}

export type LabArtifactSave =
  | { saved: true; id: string }
  | { saved: false; reason: string };

export async function saveRunArtifact(input: {
  runId: string;
  filename: string;
  mime: string;
  content: string;
}): Promise<LabArtifactSave> {
  if (!isSupabaseConfigured) {
    return { saved: false, reason: 'Supabase is not configured.' };
  }
  try {
    const data = await edgeFunctionCall<{ id?: string; error?: string; reason?: string }>(
      FUNCTION,
      {
        method: 'POST',
        appKey: readStoredKey() ?? undefined,
        body: { action: 'saveArtifact', ...input },
      },
    );
    if (data?.id) return { saved: true, id: data.id };
    return { saved: false, reason: refusalDetail(data) };
  } catch {
    return { saved: false, reason: 'Could not reach the lab executor.' };
  }
}

/** A one-hour signed download URL, or null with the reason lost to a toast. */
export async function artifactDownloadUrl(artifactId: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const data = await edgeFunctionCall<{ url?: string }>(FUNCTION, {
      method: 'POST',
      appKey: readStoredKey() ?? undefined,
      body: { action: 'artifactUrl', artifactId },
    });
    return data?.url ?? null;
  } catch {
    return null;
  }
}
