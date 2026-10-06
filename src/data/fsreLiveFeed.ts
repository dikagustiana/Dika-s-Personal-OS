/**
 * The FSRE building's live feed: the owner-checked edge function fsre-events
 * (supabase/functions/fsre-events). It answers pipeline events as metadata —
 * company, stage, status, titles, times — never model contents or a holdout
 * value, read from the suite's status view through a login role that can
 * read that view and nothing else.
 *
 * The anon key is public and is not authorization; the passphrase key in
 * x-app-key is, checked by the function before it reads anything. The
 * status is kept: an undeployed function's 404 and an unconfigured one's
 * "not-configured" are answers the building must say, not errors to hide.
 */
import { readStoredKey } from '../components/PassphraseGate';
import type { LiveFeedCall } from '../logic/lab/fsre/eventSource';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const fsreLiveFeed: LiveFeedCall | null =
  url && anonKey
    ? async (body) => {
        const appKey = readStoredKey();
        const response = await fetch(`${url}/functions/v1/fsre-events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            ...(appKey ? { 'x-app-key': appKey } : {}),
          },
          body: JSON.stringify(body),
        });
        const parsed: unknown = await response.json().catch(() => null);
        return { status: response.status, body: parsed };
      }
    : null;
