import { format, parseISO } from 'date-fns';
import type { ShareLink, ShareScope, ShareView } from '../data/types';

/**
 * ===========================================================================
 * A SHARE LINK: ONE VIEW, ONE FILTER, UNTIL IT EXPIRES.
 * ===========================================================================
 * The security model here is the SCOPE, not the token. A token is 32 bytes of
 * randomness and nobody is guessing it; what decides whether sharing was a
 * good idea is whether the owner understood what he was handing over. So the
 * sentence describing that lives in this file, is built by one function, and
 * is rendered in both places it matters — the dialog that creates a link and
 * the page a recipient opens. A dialog promising less than the page delivers
 * would make the whole mechanism a lie, and two copies of a sentence drift.
 *
 * Anything a recipient can see, they can screenshot. Nothing here pretends
 * otherwise. The point of the sentence is to make the scope decision
 * deliberate rather than incidental.
 */

/** The shape the token takes in a URL, and the floor the database enforces. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

/** Bytes of randomness behind a token. 32 is the recovery link's size too. */
const TOKEN_BYTES = 32;

/**
 * Short by default. A link with a long life is a passphrase with extra steps,
 * and extending one is a click — see extendShareLink.
 */
export const DEFAULT_TTL_DAYS = 7;

/** What the create dialog offers. The database clamps to 1…90 regardless. */
export const TTL_CHOICES = [7, 14, 30, 90] as const;

export const SHARE_VIEW_LABEL: Record<ShareView, string> = {
  'finish-line-group': 'Finish line — every entity',
  'finish-line-entity': 'Finish line — one entity',
};

/**
 * A fresh token, generated in the browser and shown once.
 *
 * base64url so it survives being pasted into a URL, a chat message and a
 * spreadsheet cell without being re-encoded on the way.
 */
export function newShareToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The token rides in the FRAGMENT, which browsers never send to a server — so
 * it stays out of access logs and Referer headers on every hop between the
 * owner's chat message and the recipient's browser. Same reasoning as the
 * recovery link, and it matters more here: a share link is pasted into group
 * threads and forwarded.
 */
export function shareUrl(origin: string, token: string): string {
  return `${origin}/#share=${token}`;
}

/** Where a link stands right now. Order matters: revoked beats expired. */
export type ShareStatus = 'active' | 'revoked' | 'expired';

export function shareStatus(link: ShareLink, now: Date): ShareStatus {
  if (link.revokedAt) return 'revoked';
  return parseISO(link.expiresAt) <= now ? 'expired' : 'active';
}

/**
 * A date a person can read. The year appears only when it is not this one —
 * '4 Aug' in a sentence about next week, '4 Aug 2027' when that is genuinely
 * what was chosen.
 */
export function shareDate(iso: string, now: Date): string {
  const at = parseISO(iso);
  return format(at, at.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yyyy');
}

/**
 * The two halves of the sentence: what the link hands over, and what it does
 * not. Split rather than concatenated at the source so a surface can lead with
 * the grant and set the limits in a quieter line, without either being
 * retyped. Same discipline as stateClauses in logic/finishLine.
 */
export interface ShareTerms {
  grants: string;
  withholds: string;
}

export function shareTerms(input: {
  view: ShareView;
  /** The entity's own label, never its code — the dialog is prose. */
  entityLabel?: string;
  expiresAt: string;
  now: Date;
}): ShareTerms {
  const until = `until ${shareDate(input.expiresAt, input.now)}`;
  if (input.view === 'finish-line-entity') {
    const who = input.entityLabel ?? 'that entity';
    return {
      grants: `Anyone with this link can see every cell and account under ${who} ${until}.`,
      withholds:
        'They cannot change anything, and they cannot see any other entity, your projects or your milestones.',
    };
  }
  return {
    grants: `Anyone with this link can see every cell and account in the Finish line, across every entity, ${until}.`,
    withholds:
      'They cannot change anything, and they cannot see your projects or your milestones.',
  };
}

/** The whole sentence, for surfaces that want it in one line. */
export function shareSentence(input: Parameters<typeof shareTerms>[0]): string {
  const terms = shareTerms(input);
  return `${terms.grants} ${terms.withholds}`;
}

/**
 * "Opened 2 days ago" / "Never opened". The owner's question before renewing
 * a link is whether anyone is actually using it, and a raw timestamp answers
 * it slower than a phrase does.
 */
export function describeLastSeen(lastSeenAt: string | undefined, now: Date): string {
  if (!lastSeenAt) return 'Never opened';
  const days = Math.floor((now.getTime() - parseISO(lastSeenAt).getTime()) / 86_400_000);
  if (days <= 0) return 'Opened today';
  if (days === 1) return 'Opened yesterday';
  return `Opened ${days} days ago`;
}

/** Scope as a short chip, for the list of existing links. */
export function describeScope(view: ShareView, scope: ShareScope): string {
  if (view === 'finish-line-entity') return scope.entity ?? 'an entity';
  return 'every entity';
}

/**
 * Why a link did not open, in the recipient's words rather than the
 * database's. Deliberately no distinction between "never issued" and
 * "mistyped": there is nothing useful to say and nothing to be careful about
 * either, since a 32-byte token is not being guessed.
 */
export const SHARE_REFUSAL: Record<string, string> = {
  expired: 'This link has expired. Ask whoever sent it for a new one.',
  revoked: 'This link has been turned off. Ask whoever sent it for a new one.',
  unknown: 'This link does not work. Check that it was copied in full.',
  unavailable: 'Could not reach the data behind this link. Try again in a moment.',
};

export function refusalCopy(reason: string | undefined): string {
  return SHARE_REFUSAL[reason ?? 'unknown'] ?? SHARE_REFUSAL.unknown;
}
