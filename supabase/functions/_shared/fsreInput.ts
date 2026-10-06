// Input rules for the FSRE building's two Edge Functions, fsre-events and
// fsre-approve, kept PURE (no Deno API, no npm import) so
// src/data/fsreFunctions.test.ts executes them under vitest the way
// scopeInput.ts is executed. The functions import them; the tests import
// them; there is one copy of the rules.
//
// WHAT A REQUEST MAY SAY, AND NOTHING ELSE:
//   fsre-events    wave      a wave id (absent: the list of waves)
//                  afterSeq  the last event number the building holds (absent: 0)
//   fsre-approve   action    exactly 'check' or 'approve'. NO DEFAULT: a request
//                            that does not say which is refused.
//                  company   a company id of the pipeline
//                  version   the staged package version the approval names
//
// THE APPROVER IS NOT AN INPUT. Nothing here reads who approves; fsre-approve
// records the owner by a constant, after checkAppKey has said the caller is
// the owner. No host, URL or SQL is ever an input either: each function's
// only database is its own secret connection string.

export const WAVE_ID = /^wave-[a-z0-9-]{1,40}$/;
export const COMPANY_ID = /^[A-Z0-9][A-Z0-9-]{1,11}$/;
export const PACKAGE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** At most this many events per fsre-events answer; `more` says when to ask again at once. */
export const MAX_EVENTS = 500;

export type EventsRequest =
  | { ok: true; wave: string | null; afterSeq: number }
  | { ok: false; reason: 'bad-wave' | 'bad-after-seq' };

export function parseEventsRequest(body: unknown): EventsRequest {
  const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  let wave: string | null = null;
  if (input.wave !== undefined) {
    if (typeof input.wave !== 'string' || !WAVE_ID.test(input.wave)) return { ok: false, reason: 'bad-wave' };
    wave = input.wave;
  }
  let afterSeq = 0;
  if (input.afterSeq !== undefined) {
    // A bad cursor is refused, not read as 0: a silent 0 would resend the whole wave.
    if (typeof input.afterSeq !== 'number' || !Number.isSafeInteger(input.afterSeq) || input.afterSeq < 0) {
      return { ok: false, reason: 'bad-after-seq' };
    }
    afterSeq = input.afterSeq;
  }
  return { ok: true, wave, afterSeq };
}

export type ApprovalRequest =
  | { ok: true; action: 'check' | 'approve'; company: string; version: string }
  | { ok: false; reason: 'bad-request' };

export function parseApprovalRequest(body: unknown): ApprovalRequest {
  const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const action = input.action === 'check' || input.action === 'approve' ? input.action : null;
  const company = typeof input.company === 'string' && COMPANY_ID.test(input.company) ? input.company : null;
  const version = typeof input.version === 'string' && PACKAGE_VERSION.test(input.version) ? input.version : null;
  if (!action || !company || !version) return { ok: false, reason: 'bad-request' };
  return { ok: true, action, company, version };
}
