/**
 * The partner room's approve button: the owner-checked edge function
 * fsre-approve (supabase/functions/fsre-approve). It carries the owner's
 * request to three database functions that hold every rule — fsre.can_approve,
 * fsre.preview_package and fsre.approve_package — and returns their answer.
 *
 * `check` and `approve`: a refusal ({ok: false, reasons}) is an answer the
 * panel shows. Anything else — the function not deployed, not configured, the
 * key refused, the network — throws, so useMutation's retryable toast says so
 * and nothing on screen pretends a decision happened.
 *
 * `preview` is a READ, so it answers a result instead of throwing, the same
 * idea as ReadResult (src/data/readResult.ts) and the live feed's load()
 * (src/logic/lab/fsre/eventSource.ts): "the function is not deployed" and
 * "the database refused" are states the partner room must SAY beside the
 * approve button, not exceptions to catch in a component. The status is
 * read the way feedFailure reads it: 404 is an undeployed function,
 * `not-configured` is one without its secret, 401/403 is a session the gate
 * no longer accepts, and the rest is a failure with its status.
 */
import { z } from 'zod';
import { readStoredKey } from '../components/PassphraseGate';
import type { FsreApproval, FsreApprovalAnswer, FsrePreviewResult } from '../logic/lab/fsre/eventSource';
import { formatNumber } from '../logic/lab/fsre/format';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** One HTTP call to the function; the status is kept because it is part of the answer. */
export type FsreApproveCall = (body: { action: 'check' | 'preview' | 'approve'; company: string; version: string }) => Promise<{ status: number; body: unknown }>;

async function post(body: Parameters<FsreApproveCall>[0]): Promise<{ status: number; body: unknown }> {
  const appKey = readStoredKey();
  const response = await fetch(`${url}/functions/v1/fsre-approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey as string,
      Authorization: `Bearer ${anonKey as string}`,
      ...(appKey ? { 'x-app-key': appKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json().catch(() => null);
  return { status: response.status, body: parsed };
}

async function call(send: FsreApproveCall, action: 'check' | 'approve', company: string, version: string): Promise<FsreApprovalAnswer> {
  const { status, body } = await send({ action, company, version });
  const answer = body as { ok?: unknown; reasons?: unknown; reason?: unknown } | null;
  if (status === 200 && answer && typeof answer.ok === 'boolean') {
    const reasons = Array.isArray(answer.reasons) ? answer.reasons.filter((r): r is string => typeof r === 'string') : [];
    return { ok: answer.ok, reasons };
  }
  const said = answer && typeof answer.reason === 'string' ? ` (${answer.reason})` : '';
  throw new Error(`the approval function answered ${status}${said}`);
}

/** What fsre.preview_package answers for a staged or published release (0005_preview). */
const previewSchema = z.object({
  ok: z.literal(true),
  company: z.string().min(1),
  version: z.string().min(1),
  wave_id: z.string().min(1),
  status: z.enum(['staged', 'published']),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  staged_at: z.string().min(1),
  /** The package as staged. Not parsed here: the viewer validates it against the contract. */
  package: z.record(z.unknown()),
});
const refusalSchema = z.object({ ok: z.literal(false), reasons: z.array(z.string()) });

function reasonOf(body: unknown): string | null {
  return typeof body === 'object' && body !== null && 'reason' in body ? String((body as { reason: unknown }).reason) : null;
}

/** The read's outcome from the function's status and body; exported so the mapping is tested without a network. */
export function previewResult(status: number, body: unknown): FsrePreviewResult {
  if (status === 200) {
    const preview = previewSchema.safeParse(body);
    if (preview.success) {
      const { data } = preview;
      return {
        ok: true,
        preview: { company: data.company, version: data.version, waveId: data.wave_id, status: data.status, contentHash: data.content_hash, stagedAt: data.staged_at, package: data.package },
      };
    }
    const refusal = refusalSchema.safeParse(body);
    if (refusal.success) {
      return { ok: false, reason: 'refused', detail: 'The database refused to show this package.', reasons: refusal.data.reasons };
    }
    return { ok: false, reason: 'failed', detail: 'The approval function answered 200 with a shape the preview does not understand.', reasons: [] };
  }
  const said = reasonOf(body);
  if (status === 404) {
    return { ok: false, reason: 'not-connected', detail: 'The approval function (fsre-approve) is not deployed yet, so the package cannot be read.', reasons: [] };
  }
  if (said === 'not-configured') {
    return { ok: false, reason: 'not-connected', detail: 'The approval function is deployed but has no database connection yet (its secret FSRE_APPROVER_DB_URL is not set).', reasons: [] };
  }
  if (status === 401 || status === 403) {
    return { ok: false, reason: 'failed', detail: 'The approval function did not accept this session. Unlock the app with the passphrase again.', reasons: [] };
  }
  return { ok: false, reason: 'failed', detail: `The approval function answered ${formatNumber(status)}${said ? ` (${said})` : ''}.`, reasons: [] };
}

async function preview(send: FsreApproveCall, company: string, version: string): Promise<FsrePreviewResult> {
  try {
    const { status, body } = await send({ action: 'preview', company, version });
    return previewResult(status, body);
  } catch (error) {
    return { ok: false, reason: 'failed', detail: `The approval function could not be reached: ${error instanceof Error ? error.message : String(error)}`, reasons: [] };
  }
}

/** The approval over an injected call; the view uses the one below, the tests a scripted call. */
export function createFsreApproval(send: FsreApproveCall): FsreApproval {
  return {
    check: (company, version) => call(send, 'check', company, version),
    preview: (company, version) => preview(send, company, version),
    approve: (company, version) => call(send, 'approve', company, version),
  };
}

export const fsreApproval: FsreApproval | null = url && anonKey ? createFsreApproval(post) : null;
