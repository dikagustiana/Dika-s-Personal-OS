/**
 * THE ACCESS MATRIX, AS PURE FUNCTIONS.
 *
 * The dashboard draws one row per person and one column per (entity,
 * section), and every cell is one of three words: nothing, read, write.
 * Everything that decides what a cell shows, what a click turns it into, and
 * what the local copy of the grants looks like while the server is still
 * answering lives here, so it can be tested without a DOM and so the view
 * stays a renderer.
 *
 * The rows it works on are ScopeGrant — the (entity, section, capability)
 * triples the provisioning function reports per person (20260904000095). No
 * function here talks to the network; the view owns the calls and applies
 * these transforms optimistically, rolling back to the snapshot it took when
 * the call fails.
 */
import type { ReadResult } from '../data/readResult';
import type {
  FinishLineItem,
  ScopeCapability,
  ScopeGrant,
  SignInEvent,
} from '../data/types';

/** A matrix cell: the two capabilities, or no grant at all. */
export type MatrixCapability = ScopeCapability | 'none';

/** The glyph the cell shows. Words, not colours, carry the state. */
export const CAPABILITY_GLYPH: Record<MatrixCapability, string> = {
  none: '—',
  read: 'R',
  write: 'W',
};

export function describeCapability(capability: MatrixCapability): string {
  switch (capability) {
    case 'none':
      return 'tidak ada akses';
    case 'read':
      return 'baca';
    case 'write':
      return 'baca + tulis';
  }
}

/** The matrix's columns within an entity: sections only, in pack order. */
export function sectionColumns(items: FinishLineItem[]): FinishLineItem[] {
  return items
    .filter((item) => item.kind === 'section')
    .sort((a, b) => a.order - b.order || a.item.localeCompare(b.item));
}

export function capabilityAt(
  grants: ScopeGrant[],
  entityCode: string,
  sectionId: string,
): MatrixCapability {
  const hit = grants.find(
    (grant) => grant.entityCode === entityCode && grant.sectionId === sectionId,
  );
  return hit ? hit.capability : 'none';
}

/**
 * The click cycle: none → read → write → none. One click is one audited
 * call, and the order climbs before it clears so the common act — opening a
 * section to someone — is one click and the destructive one is two.
 */
export function nextCapability(current: MatrixCapability): MatrixCapability {
  switch (current) {
    case 'none':
      return 'read';
    case 'read':
      return 'write';
    case 'write':
      return 'none';
  }
}

function sorted(grants: ScopeGrant[]): ScopeGrant[] {
  return [...grants].sort((a, b) =>
    a.entityCode === b.entityCode
      ? a.sectionId.localeCompare(b.sectionId)
      : a.entityCode.localeCompare(b.entityCode),
  );
}

/**
 * What the person's grants look like once a grant-scope lands: an upsert on
 * (entity, section) — the same key the table has — so a capability change
 * replaces the row rather than adding a second one. Returns a new array;
 * the snapshot the caller holds is untouched.
 */
export function applyGrant(
  grants: ScopeGrant[],
  entityCode: string,
  sectionIds: string[],
  capability: ScopeCapability,
): ScopeGrant[] {
  const wanted = new Set(sectionIds);
  const kept = grants.filter(
    (grant) => !(grant.entityCode === entityCode && wanted.has(grant.sectionId)),
  );
  const added = sectionIds.map((sectionId) => ({ entityCode, sectionId, capability }));
  return sorted([...kept, ...added]);
}

/** What the grants look like once a revoke-scope lands: that one row gone. */
export function removeGrant(
  grants: ScopeGrant[],
  entityCode: string,
  sectionId: string,
): ScopeGrant[] {
  return sorted(
    grants.filter((grant) => !(grant.entityCode === entityCode && grant.sectionId === sectionId)),
  );
}

export interface LastSignIn {
  /** ISO instant, or null when the person has never signed in. */
  at: string | null;
  /** Where the instant came from. `none` renders as "belum pernah masuk". */
  source: 'log' | 'auth' | 'none';
}

/**
 * When a person last signed in, preferring the app's own append-only record
 * (os_sign_in_log, 20260809000070) and falling back to GoTrue's
 * last_sign_in_at for sign-ins that predate the log or when the log could
 * not be read. A person with neither has never signed in — that is a fact
 * about them, not a missing read, and the badge says so.
 */
export function lastSignIn(
  userId: string,
  log: ReadResult<SignInEvent>,
  authLastSignInAt: string | null,
): LastSignIn {
  if (log.ok) {
    const latest = log.rows
      .filter((event) => event.userId === userId)
      .map((event) => event.signedInAt)
      .sort()
      .at(-1);
    if (latest) return { at: latest, source: 'log' };
  }
  if (authLastSignInAt) return { at: authLastSignInAt, source: 'auth' };
  return { at: null, source: 'none' };
}

/** Local `YYYY-MM-DD HH:MM` for a row, the same shape the collaborator panel uses. */
export function shortInstant(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}
