// Where a collaborator's sign-in link stands, derived — never guessed — from
// the three things that can be known about it. PURE (no Deno API, no jsr
// import) so src/data/provisionLink.test.ts executes it under vitest; the
// Edge Function's `list` action calls it once per person.
//
// THE THREE INPUTS AND WHERE EACH COMES FROM
//   tokenMintedAt   GoTrue's own row in auth.one_time_tokens, read through the
//                   SECURITY DEFINER reader os_collab_link_status (migration
//                   20260904000098; PostgREST does not expose `auth`, and
//                   widening that is not on the table). A string is the mint
//                   instant of the OUTSTANDING token; null means GoTrue holds
//                   no token for this person — it was consumed (GoTrue deletes
//                   the row on use) or never minted; UNDEFINED means the reader
//                   could not be reached, which is a different fact from
//                   "no token" and is kept apart on purpose.
//   stored          the row this app filed when it minted the link
//                   (public.os_collab_links): the mint instant it recorded, the
//                   deadline it could compute, and used_at, stamped by the
//                   sign-in trigger.
//   ttlSeconds      COLLAB_LINK_TTL_SECONDS from the function's environment —
//                   NEVER a literal here. Null means the window is not
//                   configured, and then no deadline is invented: a live link
//                   reports expiresAt null, which every surface reads as "not
//                   known", never as "does not expire".
//
// THE VERDICT
//   live      GoTrue still holds the token and its deadline (if known) is ahead
//   expired   GoTrue still holds the token but the configured window has passed
//             — or GoTrue holds nothing and the stored deadline has passed
//   used      GoTrue holds nothing and either the trigger stamped used_at, a
//             sign-in landed at or after the mint, or the token simply is not
//             there any more before its deadline (GoTrue removes a token on
//             consumption; that is the one way it goes early)
//   none      GoTrue holds nothing and this app never filed a link
//   unknown   the reader was unavailable and nothing was filed to fall back on

export type CollabLinkStatusKind = 'none' | 'live' | 'used' | 'expired' | 'unknown';

export interface CollabLinkState {
  status: CollabLinkStatusKind;
  mintedAt: string | null;
  expiresAt: string | null;
  usedAt: string | null;
}

export interface StoredLinkRow {
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
}

export interface LinkStateInput {
  tokenMintedAt: string | null | undefined;
  stored: StoredLinkRow | null;
  lastSignInAt: string | null;
  ttlSeconds: number | null;
  /** Epoch milliseconds — passed in so the derivation is deterministic. */
  now: number;
}

function instant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function deriveLinkState(input: LinkStateInput): CollabLinkState {
  const { tokenMintedAt, stored, lastSignInAt, ttlSeconds, now } = input;
  const storedUsedAt = stored?.usedAt ?? null;

  if (tokenMintedAt === undefined) {
    // The reader is not there. Fall back to the filed row alone, the way the
    // panel does locally; with nothing filed there is nothing to say.
    if (!stored) return { status: 'unknown', mintedAt: null, expiresAt: null, usedAt: null };
    const minted = instant(stored.createdAt);
    const deadline = instant(stored.expiresAt);
    const signedIn = instant(lastSignInAt);
    if (storedUsedAt) return { status: 'used', mintedAt: stored.createdAt, expiresAt: stored.expiresAt, usedAt: storedUsedAt };
    if (minted !== null && signedIn !== null && signedIn >= minted) {
      return { status: 'used', mintedAt: stored.createdAt, expiresAt: stored.expiresAt, usedAt: lastSignInAt };
    }
    if (deadline !== null && now >= deadline) {
      return { status: 'expired', mintedAt: stored.createdAt, expiresAt: stored.expiresAt, usedAt: null };
    }
    return { status: 'live', mintedAt: stored.createdAt, expiresAt: stored.expiresAt, usedAt: null };
  }

  if (tokenMintedAt !== null) {
    // GoTrue holds an unspent token. Its deadline is the mint instant plus the
    // configured window; with no window configured, the filed deadline (which
    // was computed from the same setting at mint time) is the only other
    // honest source, and past that there is none.
    const minted = instant(tokenMintedAt);
    const deadline =
      minted !== null && ttlSeconds !== null
        ? minted + ttlSeconds * 1000
        : instant(stored?.expiresAt ?? null);
    if (deadline !== null && now >= deadline) {
      return { status: 'expired', mintedAt: tokenMintedAt, expiresAt: iso(deadline), usedAt: null };
    }
    return {
      status: 'live',
      mintedAt: tokenMintedAt,
      expiresAt: deadline === null ? null : iso(deadline),
      usedAt: null,
    };
  }

  // GoTrue holds no token.
  if (!stored) return { status: 'none', mintedAt: null, expiresAt: null, usedAt: null };
  const minted = instant(stored.createdAt);
  const deadline = instant(stored.expiresAt);
  const signedIn = instant(lastSignInAt);
  if (storedUsedAt) {
    return { status: 'used', mintedAt: stored.createdAt, expiresAt: stored.expiresAt, usedAt: storedUsedAt };
  }
  if (minted !== null && signedIn !== null && signedIn >= minted) {
    return { status: 'used', mintedAt: stored.createdAt, expiresAt: stored.expiresAt, usedAt: lastSignInAt };
  }
  if (deadline !== null && now >= deadline) {
    return { status: 'expired', mintedAt: stored.createdAt, expiresAt: stored.expiresAt, usedAt: null };
  }
  // Token gone before its deadline, no sign-in seen: GoTrue removes a token
  // when it is consumed, and that is the only way it goes early.
  return { status: 'used', mintedAt: stored.createdAt, expiresAt: stored.expiresAt, usedAt: null };
}
