/**
 * The partner room's approve button: the owner-checked edge function
 * fsre-approve (supabase/functions/fsre-approve). It carries the owner's
 * request to two database functions that hold every rule — fsre.can_approve
 * and fsre.approve_package — and returns their answer.
 *
 * A refusal ({ok: false, reasons}) is an answer the panel shows. Anything
 * else — the function not deployed, not configured, the key refused, the
 * network — throws, so useMutation's retryable toast says so and nothing on
 * screen pretends a decision happened.
 */
import { readStoredKey } from '../components/PassphraseGate';
import type { FsreApproval, FsreApprovalAnswer } from '../logic/lab/fsre/eventSource';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function call(action: 'check' | 'approve', company: string, version: string): Promise<FsreApprovalAnswer> {
  const appKey = readStoredKey();
  const response = await fetch(`${url}/functions/v1/fsre-approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey as string,
      Authorization: `Bearer ${anonKey as string}`,
      ...(appKey ? { 'x-app-key': appKey } : {}),
    },
    body: JSON.stringify({ action, company, version }),
  });
  const body: unknown = await response.json().catch(() => null);
  const answer = body as { ok?: unknown; reasons?: unknown; reason?: unknown } | null;
  if (response.status === 200 && answer && typeof answer.ok === 'boolean') {
    const reasons = Array.isArray(answer.reasons) ? answer.reasons.filter((r): r is string => typeof r === 'string') : [];
    return { ok: answer.ok, reasons };
  }
  const said = answer && typeof answer.reason === 'string' ? ` (${answer.reason})` : '';
  throw new Error(`the approval function answered ${response.status}${said}`);
}

export const fsreApproval: FsreApproval | null =
  url && anonKey
    ? { check: (company, version) => call('check', company, version), approve: (company, version) => call('approve', company, version) }
    : null;
