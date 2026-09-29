/**
 * THE FINISH LINE SIMULATION, AS THE APP SEES IT.
 *
 * One private HTML build — made in a separate repository; this app only
 * stores and shows it — behind the finish-line-simulation Edge Function. This
 * file is the pure half of the client: the shapes, and the classifiers that
 * turn an HTTP status and body into the read's three outcomes and the
 * upload's two. Pure so the rule the tab depends on most runs under vitest
 * without a Supabase URL:
 *
 *     value: null means current.json was never written, and NOTHING else does.
 *
 * A function that is not deployed (the gateway's 404), a bucket that is not
 * there, a pointer that names a missing object: each is a failure with a
 * reason, and none of them may reach the tab as the empty state. That is the
 * readResult.ts discipline for the one read in the app that returns a single
 * object — see ReadValue.
 */
import {
  isSimulationGuardCode,
  type SimulationGuardCode,
} from '../../supabase/functions/_shared/simulationUpload';
import type { ReadFailure, ReadValue } from './readResult';

export const SIMULATION_FUNCTION = 'finish-line-simulation';

export interface FinishLineSimulationMeta {
  /** versions/<YYYYMMDDTHHMMSSZ>_<sha8>.html inside the bucket. */
  path: string;
  sha256: string;
  bytes: number;
  uploadedAt: string;
}

export interface FinishLineSimulation {
  html: string;
  meta: FinishLineSimulationMeta;
}

/**
 * A guard refusal is DATA, not an exception: the tab renders every code and
 * message, and useMutation turns a thrown error into a toast the tab cannot
 * read. Every other failure throws, so it gets the retryable toast.
 */
export type SimulationUploadOutcome =
  | { ok: true; meta: FinishLineSimulationMeta }
  | { ok: false; codes: SimulationGuardCode[]; messages: string[] };

const READ = 'readFinishLineSimulation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metaOf(value: unknown): FinishLineSimulationMeta | null {
  if (!isRecord(value)) return null;
  const { path, sha256, bytes, uploadedAt } = value;
  if (typeof path !== 'string' || typeof sha256 !== 'string') return null;
  if (typeof bytes !== 'number' || typeof uploadedAt !== 'string') return null;
  return { path, sha256, bytes, uploadedAt };
}

function reasonOf(body: unknown): string | undefined {
  return isRecord(body) && typeof body.reason === 'string' ? body.reason : undefined;
}

function messageOf(body: unknown): string {
  if (!isRecord(body)) return 'tanpa keterangan';
  const text = [body.message, body.error].find((part): part is string => typeof part === 'string');
  const retry = typeof body.retryAfter === 'number' ? ` (coba lagi dalam ${body.retryAfter} detik)` : '';
  return `${text ?? 'tanpa keterangan'}${retry}`;
}

/**
 * The answer of a repository that holds no owner key — a contributor's.
 * Returned WITHOUT a request: "a contributor sends nothing to this function"
 * is a property of the data layer as well as of the tab bar.
 */
export function simulationOwnerOnly(): ReadFailure {
  return {
    ok: false,
    reason: 'failed',
    detail: `${READ}: hanya untuk owner — sesi ini tidak membawa app key, jadi tidak ada request yang dikirim`,
  };
}

export function classifySimulationRead(
  status: number,
  body: unknown,
): ReadValue<FinishLineSimulation | null> {
  if (status === 200 && isRecord(body) && body.ok === true) {
    // `null` must be present and null. A body that simply lacks `value` is a
    // malformed answer, not "never uploaded".
    if ('value' in body && body.value === null) return { ok: true, value: null };
    const value = body.value;
    const meta = isRecord(value) ? metaOf(value.meta) : null;
    if (isRecord(value) && typeof value.html === 'string' && meta) {
      return { ok: true, value: { html: value.html, meta } };
    }
    return {
      ok: false,
      reason: 'failed',
      detail: `${READ}: 200 dengan isi yang tidak dikenal — bukan "belum ada versi"`,
    };
  }
  // The function never answers 404 itself; a 404 is the gateway saying the
  // function does not exist. Expected before the deploy lands, hence
  // missing-relation — the "not applied here yet" reason.
  if (status === 404) {
    return {
      ok: false,
      reason: 'missing-relation',
      detail: `${READ}: 404 — function ${SIMULATION_FUNCTION} belum di-deploy`,
    };
  }
  const reason = reasonOf(body);
  if (reason === 'bucket-missing') {
    return {
      ok: false,
      reason: 'missing-relation',
      detail: `${READ}: ${status} bucket-missing — ${messageOf(body)}`,
    };
  }
  if (reason?.startsWith('pointer-')) {
    return {
      ok: false,
      reason: 'failed',
      detail: `${READ}: ${status} ${reason} — pointer rusak: ${messageOf(body)}`,
    };
  }
  return {
    ok: false,
    reason: 'failed',
    detail: `${READ}: ${status}${reason ? ` ${reason}` : ''} — ${messageOf(body)}`,
  };
}

/** Resolves on success and on a guard refusal; throws for everything else. */
export function classifySimulationUpload(status: number, body: unknown): SimulationUploadOutcome {
  if (status === 200 && isRecord(body) && body.ok === true && isRecord(body.value)) {
    const meta = metaOf(body.value.meta);
    if (meta) return { ok: true, meta };
  }
  if (status === 422 && isRecord(body) && Array.isArray(body.codes) && Array.isArray(body.messages)) {
    const codes = body.codes.filter(isSimulationGuardCode);
    const messages = body.messages.filter((message): message is string => typeof message === 'string');
    if (codes.length > 0) return { ok: false, codes, messages };
  }
  if (status === 404) throw new Error(`function ${SIMULATION_FUNCTION} belum di-deploy (404).`);
  const reason = reasonOf(body);
  throw new Error(`${status}${reason ? ` ${reason}` : ''} — ${messageOf(body)}`);
}
