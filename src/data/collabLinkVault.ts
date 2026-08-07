/**
 * WHERE A MINTED SIGN-IN LINK LIVES BETWEEN MINTING AND HANDOVER.
 *
 * THE BUG THIS EXISTS TO CLOSE. The panel used to hold the freshly minted link
 * in component state. Navigating off Finish line unmounted the card, React
 * dropped the state, and the link was gone — with no way to ask for it back.
 * The only recovery was "Tautan baru", and that is precisely the thing that
 * must not be casually clicked:
 *
 *   auth.one_time_tokens carries a UNIQUE index on (user_id, token_type)
 *   (one_time_tokens_user_id_token_type_key, verified live). One live token
 *   per user. Minting a second one REPLACES the first.
 *
 * So the lost link was not merely lost — recovering it cut off whoever had
 * already been sent the previous one. That is how an owner ends up unable to
 * sign in with an account that holds every entity grant.
 *
 * WHY sessionStorage AND NOT A TABLE. The token is a Supabase magic link:
 * single-use, and alive only for the project's OTP window (Supabase default,
 * one hour). Persisting it server-side would put a live credential at rest in
 * a new table — a fresh exfiltration target — to buy durability the credential
 * itself does not have. sessionStorage is the honest match: it is where the
 * owner's app key already lives, it dies with the tab, and it survives the
 * SPA navigation that was the actual defect. The trade is explicit and
 * accepted: a link does NOT survive closing the tab or moving to another
 * device. Neither does it survive the hour, so little is given up.
 *
 * NOTHING HERE EVER LOGS. No console call, no error message, no analytics
 * touches a url or a token — a link in a log is a link handed to whoever can
 * read the log. Read failures degrade to "no stored link", which costs one
 * re-mint; they never throw and never report the value they choked on.
 */

const STORAGE_KEY = 'personal-os-collab-links';

/**
 * The assumed life of a minted link, used when the server does not say.
 * Supabase's default OTP expiry is one hour; `provisionLink` now returns an
 * authoritative `expiresAt` and that wins whenever it is present. This
 * constant is the fallback so the frontend is correct on its own, before and
 * without any Edge Function redeploy.
 */
export const LINK_TTL_MS = 60 * 60 * 1000;

export interface StoredCollabLink {
  /** Lower-cased, the same normalisation the Edge Function applies. */
  email: string;
  url: string;
  /** When this client minted it — the clock that decides "used since". */
  mintedAt: number;
  expiresAt: number;
}

export type CollabLinkVault = Record<string, StoredCollabLink>;

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    // Storage disabled (private mode, blocked cookies). The panel still works;
    // it just cannot re-open a link after navigating away.
    return null;
  }
}

function isStored(value: unknown): value is StoredCollabLink {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.email === 'string' &&
    typeof row.url === 'string' &&
    typeof row.mintedAt === 'number' &&
    typeof row.expiresAt === 'number' &&
    Number.isFinite(row.mintedAt) &&
    Number.isFinite(row.expiresAt)
  );
}

function readRaw(): CollabLinkVault {
  const store = storage();
  if (!store) return {};
  let parsed: unknown;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt or unreadable. Treat as empty rather than propagating — and
    // deliberately without echoing the payload anywhere.
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const vault: CollabLinkVault = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isStored(value)) vault[key] = value;
  }
  return vault;
}

function writeRaw(vault: CollabLinkVault): void {
  const store = storage();
  if (!store) return;
  try {
    if (Object.keys(vault).length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(vault));
  } catch {
    // Quota or disabled storage. The in-memory panel state still holds the
    // link for this mount; only the re-open-after-navigation affordance is
    // lost, and silently losing it beats throwing mid-mint.
  }
}

export function normalizeVaultEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Every link we still hold, expired ones dropped (and pruned from storage as
 * a side effect, so a stale token stops sitting in the tab once it is dead).
 */
export function recallAllCollabLinks(now: number = Date.now()): CollabLinkVault {
  const vault = readRaw();
  const live: CollabLinkVault = {};
  let pruned = false;
  for (const [key, entry] of Object.entries(vault)) {
    if (entry.expiresAt > now) live[key] = entry;
    else pruned = true;
  }
  if (pruned) writeRaw(live);
  return live;
}

/** The link we hold for one address, or null when there is none still alive. */
export function recallCollabLink(
  email: string,
  now: number = Date.now(),
): StoredCollabLink | null {
  return recallAllCollabLinks(now)[normalizeVaultEmail(email)] ?? null;
}

/**
 * Records a freshly minted link. Replaces any previous entry for the address,
 * mirroring the server: the old token is already dead by the time we get here.
 */
export function rememberCollabLink(
  entry: { email: string; url: string; expiresAt?: number },
  now: number = Date.now(),
): StoredCollabLink {
  const email = normalizeVaultEmail(entry.email);
  const expiresAt =
    typeof entry.expiresAt === 'number' && Number.isFinite(entry.expiresAt)
      ? entry.expiresAt
      : now + LINK_TTL_MS;
  const stored: StoredCollabLink = { email, url: entry.url, mintedAt: now, expiresAt };
  const vault = recallAllCollabLinks(now);
  vault[email] = stored;
  writeRaw(vault);
  return stored;
}

/** Drops one address's link — on revoke, and on an explicit discard. */
export function forgetCollabLink(email: string, now: number = Date.now()): void {
  const vault = recallAllCollabLinks(now);
  delete vault[normalizeVaultEmail(email)];
  writeRaw(vault);
}

/** Drops everything. The panel calls this when the owner session dies. */
export function clearCollabLinks(): void {
  writeRaw({});
}

// --- what a row should say about its link ------------------------------------

export type CollabLinkStatus =
  /** We hold nothing for this person — they may still have an old link out. */
  | { kind: 'none' }
  | { kind: 'live'; expiresAt: number; minutesLeft: number }
  /** They signed in at or after the mint, so this link is spent. */
  | { kind: 'used'; usedAt: string }
  | { kind: 'expired'; expiresAt: number };

/**
 * `belum pernah masuk` alone cannot answer "does this person need a new
 * link?" — it conflates "never sent one", "sent one that died unused", and
 * "sent one that is still good". Those need different actions, so they get
 * different words. The sign-in timestamp decides `used`: a magic link is
 * single-use, so a sign-in at or after the mint IS this link being spent.
 */
export function collabLinkStatus(
  stored: StoredCollabLink | null,
  lastSignInAt: string | null,
  now: number = Date.now(),
): CollabLinkStatus {
  if (!stored) return { kind: 'none' };
  const signedInAt = lastSignInAt ? Date.parse(lastSignInAt) : Number.NaN;
  if (Number.isFinite(signedInAt) && signedInAt >= stored.mintedAt) {
    return { kind: 'used', usedAt: lastSignInAt as string };
  }
  if (now >= stored.expiresAt) return { kind: 'expired', expiresAt: stored.expiresAt };
  return {
    kind: 'live',
    expiresAt: stored.expiresAt,
    minutesLeft: Math.max(0, Math.ceil((stored.expiresAt - now) / 60_000)),
  };
}

/** Local wall-clock HH:MM — the same shape the gate's lockout notice uses. */
export function clockTime(at: number): string {
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}

/** One short, actionable phrase per status. */
export function describeCollabLink(status: CollabLinkStatus): string {
  switch (status.kind) {
    case 'live':
      return status.minutesLeft <= 1
        ? `tautan berlaku < 1 menit lagi (${clockTime(status.expiresAt)})`
        : `tautan berlaku ${status.minutesLeft} menit lagi (sampai ${clockTime(status.expiresAt)})`;
    case 'used':
      return 'tautan sudah dipakai';
    case 'expired':
      return `tautan kedaluwarsa ${clockTime(status.expiresAt)}`;
    case 'none':
      return '';
  }
}

/**
 * The masked form. The DESTINATION stays readable and only the SECRET is
 * covered — the owner needs to see that a link points at their own site
 * (a wrong `origin` is a real failure mode, since the Edge Function takes the
 * site from the request header), and that check must not cost a reveal.
 */
export function maskCollabLink(url: string): string {
  const marker = '#collab_token=';
  const at = url.indexOf(marker);
  if (at === -1) return '•'.repeat(32);
  return `${url.slice(0, at + marker.length)}${'•'.repeat(24)}`;
}
