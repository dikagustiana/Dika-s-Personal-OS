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
 * already been sent the previous one.
 *
 * ===========================================================================
 * THIS MODULE IS NOW THE FALLBACK, NOT THE STORE.
 * ===========================================================================
 * sessionStorage closed the navigation half of that bug and left the rest
 * open, because it is scoped to ONE TAB ON ONE DEVICE: close the tab, switch
 * browser, or reach for the phone, and the link is gone again. The durable
 * store is now public.os_collab_links (migration 20260809000071), owner-only
 * in the database and written by the provisioning function.
 *
 * What is kept here, and why it is not deleted:
 *
 *   1. The frontend ships BEFORE the migration. Until the table exists, this
 *      is the only thing standing between a misplaced link and a re-mint that
 *      cuts somebody off.
 *   2. A write to the table is deliberately non-fatal in the edge function —
 *      the link is returned even when it could not be filed. Holding it in the
 *      tab as well means that case degrades to "this tab still has it" rather
 *      than "it is gone".
 *
 * `mergeCollabLinks` decides which of the two a row shows, and the stored row
 * always wins: it knows things this side cannot, above all whether the link
 * has actually been spent.
 *
 * NOTHING HERE EVER LOGS. No console call, no error message, no analytics
 * touches a url or a token — a link in a log is a link handed to whoever can
 * read the log. Read failures degrade to "no stored link", which costs one
 * re-mint; they never throw and never report the value they choked on.
 */

const STORAGE_KEY = 'personal-os-collab-links';

/**
 * ===========================================================================
 * THERE IS NO DEFAULT LIFETIME HERE, AND THAT IS THE CHANGE.
 * ===========================================================================
 * This module used to carry `LINK_TTL_MS = 60 * 60 * 1000` and apply it
 * whenever the server sent no deadline. That was defensible while the OTP
 * window actually was an hour. It stops being defensible the moment the window
 * is set to 86400: the panel would count down from sixty minutes and call a
 * link dead while it had twenty-three hours left, which is exactly the kind of
 * wrong that makes the owner re-mint and cut somebody off.
 *
 * A deadline is therefore either KNOWN — supplied by the server, derived from
 * GoTrue's own auth.one_time_tokens.created_at plus the configured window — or
 * NULL, meaning not known. Null is never treated as "does not expire", and no
 * number is invented to stand in for it.
 */
export interface StoredCollabLink {
  /** Lower-cased, the same normalisation the Edge Function applies. */
  email: string;
  url: string;
  /** When this client minted it — the clock that decides "used since". */
  mintedAt: number;
  /** null = the OTP window is not known, so the deadline is not known. */
  expiresAt: number | null;
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
  const expiryOk =
    row.expiresAt === null ||
    (typeof row.expiresAt === 'number' && Number.isFinite(row.expiresAt));
  return (
    typeof row.email === 'string' &&
    typeof row.url === 'string' &&
    typeof row.mintedAt === 'number' &&
    Number.isFinite(row.mintedAt) &&
    expiryOk
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
 * Every link this tab still holds, ones with a PASSED deadline dropped (and
 * pruned from storage, so a dead token stops sitting in the tab).
 *
 * An entry whose deadline is UNKNOWN is kept. Pruning it would mean guessing a
 * lifetime, which is the thing this module stopped doing — and the entry dies
 * with the tab regardless.
 */
export function recallAllCollabLinks(now: number = Date.now()): CollabLinkVault {
  const vault = readRaw();
  const live: CollabLinkVault = {};
  let pruned = false;
  for (const [key, entry] of Object.entries(vault)) {
    if (entry.expiresAt === null || entry.expiresAt > now) live[key] = entry;
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
 *
 * An absent `expiresAt` stays absent. It is NOT filled in with an assumed hour.
 */
export function rememberCollabLink(
  entry: { email: string; url: string; expiresAt?: number | null },
  now: number = Date.now(),
): StoredCollabLink {
  const email = normalizeVaultEmail(entry.email);
  const expiresAt =
    typeof entry.expiresAt === 'number' && Number.isFinite(entry.expiresAt)
      ? entry.expiresAt
      : null;
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

// --- the two sources, merged ------------------------------------------------

/**
 * One collaborator's link as the panel should treat it, whichever side it came
 * from.
 *
 * `source` exists so the surface can be honest about durability: a link held
 * only by this tab is one closed tab away from needing a re-mint, and that is
 * worth saying out loud rather than letting the owner discover it.
 */
export interface HeldCollabLink {
  email: string;
  url: string;
  /** The mint instant. From GoTrue's own row when the link is stored. */
  mintedAt: number;
  /** null = the window is not known. Never means "does not expire". */
  expiresAt: number | null;
  /** null = unspent. Authoritative only on a stored link. */
  usedAt: number | null;
  source: 'stored' | 'tab';
}

/** A row of public.os_collab_links, already parsed into instants. */
export interface CollabLinkRecord {
  email: string;
  url: string;
  mintedAt: number;
  expiresAt: number | null;
  usedAt: number | null;
}

/**
 * The stored row WINS wherever both exist.
 *
 * It is not a close call. The database row carries `used_at`, written by a
 * trigger on the sign-in itself, so it can say a link is spent as a fact
 * rather than as an inference from a timestamp. It also survives the tab. The
 * tab copy only fills addresses the store has nothing for — which is the
 * pre-migration window, and the case where filing the link failed but minting
 * it did not.
 */
export function mergeCollabLinks(
  stored: CollabLinkRecord[],
  tab: CollabLinkVault,
): Record<string, HeldCollabLink> {
  const held: Record<string, HeldCollabLink> = {};
  for (const [key, entry] of Object.entries(tab)) {
    held[key] = {
      email: entry.email,
      url: entry.url,
      mintedAt: entry.mintedAt,
      expiresAt: entry.expiresAt,
      usedAt: null,
      source: 'tab',
    };
  }
  for (const row of stored) {
    const key = normalizeVaultEmail(row.email);
    held[key] = { ...row, email: key, source: 'stored' };
  }
  return held;
}

// --- what a row should say about its link ------------------------------------

export type CollabLinkStatus =
  /** We hold nothing for this person — they may still have an old link out. */
  | { kind: 'none' }
  /** `expiresAt` null means the window is not known; so is `minutesLeft`. */
  | { kind: 'live'; expiresAt: number | null; minutesLeft: number | null }
  /** Spent. Either the store says so, or a sign-in landed after the mint. */
  | { kind: 'used'; usedAt: string }
  | { kind: 'expired'; expiresAt: number };

/**
 * `belum pernah masuk` alone cannot answer "does this person need a new
 * link?" — it conflates "never sent one", "sent one that died unused", and
 * "sent one that is still good". Those need different actions, so they get
 * different words.
 *
 * TWO WAYS TO KNOW A LINK IS SPENT, and the better one is preferred. A stored
 * row carries `usedAt`, stamped by a trigger on the sign-in that spent it. In
 * its absence the sign-in timestamp is the fallback inference: a magic link is
 * single-use, so a sign-in at or after the mint IS this link being spent.
 */
export function collabLinkStatus(
  held: HeldCollabLink | null,
  lastSignInAt: string | null,
  now: number = Date.now(),
): CollabLinkStatus {
  if (!held) return { kind: 'none' };
  if (held.usedAt !== null) {
    return { kind: 'used', usedAt: new Date(held.usedAt).toISOString() };
  }
  const signedInAt = lastSignInAt ? Date.parse(lastSignInAt) : Number.NaN;
  if (Number.isFinite(signedInAt) && signedInAt >= held.mintedAt) {
    return { kind: 'used', usedAt: lastSignInAt as string };
  }
  if (held.expiresAt !== null && now >= held.expiresAt) {
    return { kind: 'expired', expiresAt: held.expiresAt };
  }
  return {
    kind: 'live',
    expiresAt: held.expiresAt,
    minutesLeft:
      held.expiresAt === null ? null : Math.max(0, Math.ceil((held.expiresAt - now) / 60_000)),
  };
}

/** Local wall-clock HH:MM — the same shape the gate's lockout notice uses. */
export function clockTime(at: number): string {
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}

/**
 * One short, actionable phrase per status.
 *
 * Every state is carried by WORDS, never by colour alone — four links at 10px
 * have to be told apart by everyone reading the screen.
 */
export function describeCollabLink(status: CollabLinkStatus): string {
  switch (status.kind) {
    case 'live':
      if (status.expiresAt === null || status.minutesLeft === null) {
        // The honest sentence when COLLAB_LINK_TTL_SECONDS is not configured.
        // Inventing a countdown here is what this whole change removes.
        return 'tautan aktif, masa berlaku tidak diketahui';
      }
      return status.minutesLeft <= 1
        ? `tautan aktif, berlaku < 1 menit lagi (${clockTime(status.expiresAt)})`
        : `tautan aktif, berlaku sampai ${clockTime(status.expiresAt)} (${status.minutesLeft} menit lagi)`;
    case 'used':
      return 'tautan sudah dipakai';
    case 'expired':
      return `tautan kedaluwarsa ${clockTime(status.expiresAt)}`;
    case 'none':
      return 'belum ada tautan';
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
