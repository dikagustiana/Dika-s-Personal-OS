// Core provisioning actions for collaborator access — create, link, revoke,
// list, grant-projects, revoke-project, grant-scope, revoke-scope — extracted
// so the owner-gated wrapper (provision-collaborator) stays a thin door and
// the logic itself is a single copy.
//
// EVERYTHING HERE RUNS WITH THE SERVICE ROLE AND BYPASSES RLS. It is the most
// privileged code path in the app, and it is treated accordingly:
//   - The service role key is read from the function environment only. It
//     never appears in src/, in a bundle, in a migration, or in the repo.
//   - Inputs are validated HERE, not in the wrappers, so no wrapper can
//     forget: emails must be well-formed, every entity code must exist in
//     os_finish_line_entities, every section id must be an item of kind
//     'section' (scopeInput.ts holds the pure rules), and the role is
//     hardcoded 'contributor' — no request ever carries one.
//   - Since 20260904000095 membership is the ENROLMENT and
//     os_finish_line_grants (user, entity, section, capability) is the SCOPE.
//     create writes write-on-every-section grants beside the membership,
//     grant-scope / revoke-scope edit single rows, revoke lets the cascading
//     FK take the grants with the membership, and list reports them.
//   - No table name, column name, or predicate is ever taken from a request.
//   - NO EMAIL IS EVER SENT. generateLink mints the token without sending;
//     the owner hands the link over out of band. That is the entire design.

import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';
import {
  parseGrantScope,
  parseRevokeScope,
  sortScopeGrants,
  UUID_RE,
  type ScopeCapability,
  type ScopeGrant,
} from './scopeInput.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SITE = 'https://dika-personal-os.vercel.app';
/**
 * Deliberately states no number. The window is the project's OTP setting,
 * which this function cannot read — see linkTtlSeconds below. Naming an hour
 * here, as this string used to, is how a stale figure ends up on screen.
 */
export const LINK_EXPIRY_NOTE =
  'Sekali pakai; berlaku mengikuti masa OTP email proyek. Kirim segera.';

/**
 * ===========================================================================
 * THE LINK'S LIFETIME IS CONFIGURATION, NOT A CONSTANT IN THIS FILE.
 * ===========================================================================
 * This used to be `export const LINK_TTL_SECONDS = 3600` with `expiresAt()`
 * returning `now + 3600`. That was a guess wearing a constant's clothing, and
 * it is about to become a WRONG guess: the project's OTP window is being set
 * to 86400, and nothing would have made this number follow it.
 *
 * GoTrue gives us no way to stop guessing from the response — generateLink
 * returns `action_link`, `email_otp`, `hashed_token`, `redirect_to` and
 * `verification_type`, and no expiry among them. `otp_exp` is a GoTrue setting
 * readable only through the Management API, which this function has no
 * credential for and should not be given one.
 *
 * So the number moves OUT of code and into the function's environment, where
 * it can be set to match the dashboard without a deploy. Unset is a first-class
 * answer: it yields a null deadline, and every surface downstream says the
 * window is not known rather than drawing a countdown it cannot justify. A
 * wrong deadline is worse than an absent one — it tells the owner a link is
 * good for another twenty hours when it died at minute sixty.
 */
function linkTtlSeconds(): number | null {
  const raw = Deno.env.get('COLLAB_LINK_TTL_SECONDS');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * When the token was minted, according to GoTrue rather than to this process.
 *
 * GoTrue files a magic-link token in auth.one_time_tokens under token_type
 * 'recovery_token' — there is no 'magiclink' member of that enum, verified
 * live. The row is deleted when the token is consumed, so its PRESENCE also
 * means the link has not been spent yet.
 *
 * Returns null rather than throwing: a link that cannot be timestamped is
 * still a link, and refusing to hand it over because we could not read a
 * clock would be the wrong trade.
 */
async function mintedAt(admin: SupabaseClient, userId: string): Promise<string | null> {
  // THROUGH AN RPC, NOT A DIRECT SELECT. PostgREST exposes `public` and not
  // `auth`, so `.schema('auth').from('one_time_tokens')` would fail — and it
  // would fail softly here, silently downgrading "GoTrue's timestamp" to this
  // process's clock while every test still passed. The narrow SECURITY DEFINER
  // reader from migration 20260809000072 is what makes the claim true.
  const { data, error } = await admin.rpc('os_collab_link_minted_at', {
    p_user_id: userId,
  });
  if (error || !data) return null;
  const parsed = Date.parse(data as string);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function expiryFrom(createdAt: string | null): string | null {
  const ttl = linkTtlSeconds();
  if (!createdAt || ttl === null) return null;
  return new Date(Date.parse(createdAt) + ttl * 1000).toISOString();
}

/**
 * Records the minted link so the owner can copy it a SECOND time without
 * minting a replacement — replacing it is what cuts off whoever is holding the
 * current one.
 *
 * NEVER THROWS, AND NEVER FAILS THE CALLER. The link has already been minted
 * by the time this runs; the previous token is already dead. Refusing to
 * return the link because we could not file it would destroy access to buy
 * bookkeeping, which is precisely backwards. A missing row costs one re-mint;
 * a swallowed link costs somebody their account.
 *
 * This also covers the pre-migration window: before 20260809000071 the table
 * does not exist, the insert answers 42P01, and minting carries on unchanged.
 */
async function rememberLink(
  admin: SupabaseClient,
  userId: string,
  link: string,
  createdAt: string | null,
  expiresAt: string | null,
): Promise<void> {
  try {
    await admin.from('os_collab_links').upsert(
      {
        user_id: userId,
        link,
        // Falling back to now() only when GoTrue's own row could not be read.
        created_at: createdAt ?? new Date().toISOString(),
        expires_at: expiresAt,
        // A fresh link is unspent by definition, and this is an upsert over a
        // row that may describe a link that WAS spent — so it must be cleared.
        used_at: null,
      },
      { onConflict: 'user_id' },
    );
  } catch {
    // Deliberately silent, and deliberately without echoing the link.
  }
}

/** Drops a stored link. Same never-throw contract, same reason. */
async function forgetLink(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    await admin.from('os_collab_links').delete().eq('user_id', userId);
  } catch {
    // The grants are already gone; a stale row reads as "aktif" at worst and
    // opens nothing, because a membershipless session is signed straight out.
  }
}

export type ProvisionOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string };

export function adminClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** The handover link points at OUR app, carrying the hashed token; the gate
 *  consumes it with verifyOtp. No Supabase redirect, no allowlist dependency,
 *  and nothing for a mis-set Site URL to break. */
function appLink(site: string, hashedToken: string): string {
  return `${site.replace(/\/+$/, '')}/#collab_token=${hashedToken}`;
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  // Paginated scan; this app has a handful of users, not thousands.
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((user) => (user.email ?? '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function memberships(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('os_entity_members')
    .select('entity_code')
    .eq('user_id', userId)
    .order('entity_code');
  if (error) throw new Error(`membership read failed: ${error.message}`);
  return (data as { entity_code: string }[]).map((row) => row.entity_code);
}

/** The second axis: project ids this user holds grants on. */
async function projectGrants(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('os_project_members')
    .select('project_id')
    .eq('user_id', userId)
    .order('project_id');
  if (error) throw new Error(`project grant read failed: ${error.message}`);
  return (data as { project_id: string }[]).map((row) => row.project_id);
}

interface ScopeGrantRow {
  user_id?: string;
  entity_code: string;
  section_id: string;
  capability: ScopeCapability;
}

function toScopeGrant(row: ScopeGrantRow): ScopeGrant {
  return { entityCode: row.entity_code, sectionId: row.section_id, capability: row.capability };
}

/**
 * The third axis: the (entity, section, capability) rows that decide which
 * cells and accounts this person reads and writes since 20260904000095.
 * Throws when unreadable — every caller of this one is about to report the
 * result of a write, and a write whose outcome cannot be read back has not
 * been confirmed.
 */
async function scopeGrants(admin: SupabaseClient, userId: string): Promise<ScopeGrant[]> {
  const { data, error } = await admin
    .from('os_finish_line_grants')
    .select('entity_code, section_id, capability')
    .eq('user_id', userId);
  if (error) throw new Error(`scope grant read failed: ${error.message}`);
  return sortScopeGrants((data as ScopeGrantRow[]).map(toScopeGrant));
}

/**
 * Every grant, grouped by user, for `list` and for the count a full revoke
 * reports. NULL — not an empty map — when the table is not there yet (the
 * window between deploying this build and applying 095): the panel must read
 * "not known", never "nobody holds a grant". Same two codes the frontend's
 * ReadResult treats as a missing relation.
 */
async function scopeGrantsByUser(
  admin: SupabaseClient,
): Promise<Map<string, ScopeGrant[]> | null> {
  const { data, error } = await admin
    .from('os_finish_line_grants')
    .select('user_id, entity_code, section_id, capability');
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return null;
    throw new Error(`scope grant read failed: ${error.message}`);
  }
  const byUser = new Map<string, ScopeGrant[]>();
  for (const row of data as Required<ScopeGrantRow>[]) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), toScopeGrant(row)]);
  }
  for (const [userId, grants] of byUser) byUser.set(userId, sortScopeGrants(grants));
  return byUser;
}

/** Every section id — what a whole-entity grant is spelled out over, one row
 *  per section, because D2 allows no wildcard row. */
async function allSectionIds(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin
    .from('os_finish_line_items')
    .select('id')
    .eq('kind', 'section');
  if (error) throw new Error(`section read failed: ${error.message}`);
  return (data as { id: string }[]).map((row) => row.id);
}

async function generateAppLink(
  admin: SupabaseClient,
  email: string,
  site: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  const hashed = data.properties?.hashed_token;
  if (!hashed) throw new Error('generateLink returned no token');
  return appLink(site, hashed);
}

type AuditAction =
  | 'create'
  | 'link'
  | 'revoke'
  | 'list'
  | 'grant-projects'
  | 'revoke-project'
  | 'grant-scope'
  | 'revoke-scope';

interface AuditScope {
  sectionIds: string[];
  /** Null for a revoke, which removes whatever capability was held. */
  capability: ScopeCapability | null;
}

async function audit(
  admin: SupabaseClient,
  action: AuditAction,
  email: string | null,
  entityCodes: string[] | null,
  projectIds: string[] | null = null,
  scope: AuditScope | null = null,
): Promise<void> {
  // The two scope arguments are sent ONLY when a scope is being recorded. A
  // build deployed ahead of 20260904000096 therefore keeps every older action
  // working against the 4-argument os_provision_record, and fails the scope
  // actions loudly here — fail closed, in the direction that costs one retry
  // after the migration lands rather than an unrecorded grant.
  const args: Record<string, unknown> = {
    p_action: action,
    p_email: email,
    p_entity_codes: entityCodes,
    p_project_ids: projectIds,
  };
  if (scope) {
    args.p_section_ids = scope.sectionIds;
    args.p_capability = scope.capability;
  }
  const { error } = await admin.rpc('os_provision_record', args);
  // An unlogged provisioning action must not succeed silently.
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

export async function provisionCreate(
  admin: SupabaseClient,
  rawEmail: unknown,
  rawCodes: unknown,
  site: string = DEFAULT_SITE,
): Promise<ProvisionOutcome> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: 'A well-formed email is required' };
  if (!Array.isArray(rawCodes) || rawCodes.length === 0 || !rawCodes.every((c) => typeof c === 'string')) {
    return { ok: false, status: 400, error: 'entityCodes must be a non-empty array of codes' };
  }
  const requested = [...new Set(rawCodes.map((code) => code.trim()))];

  const { data: entityRows, error: entityError } = await admin
    .from('os_finish_line_entities')
    .select('code');
  if (entityError) return { ok: false, status: 500, error: 'Could not read entities' };
  const known = new Set((entityRows as { code: string }[]).map((row) => row.code));
  const unknown = requested.filter((code) => !known.has(code));
  if (unknown.length > 0) {
    return { ok: false, status: 400, error: `Unknown entity codes: ${unknown.join(', ')}` };
  }

  // Confirmed on creation, so no verification email exists to send. An
  // already-registered address is looked up instead of failing: create is
  // "make sure this person exists and holds these grants".
  let user = await findUserByEmail(admin, email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) {
      return { ok: false, status: 500, error: `createUser failed: ${error?.message ?? 'no user'}` };
    }
    user = data.user;
  }

  // Idempotent on the composite PK; role is hardcoded server-side.
  const rows = requested.map((code) => ({
    user_id: user.id,
    entity_code: code,
    role: 'contributor',
  }));
  const { error: memberError } = await admin
    .from('os_entity_members')
    .upsert(rows, { onConflict: 'user_id,entity_code', ignoreDuplicates: true });
  if (memberError) {
    return { ok: false, status: 500, error: `membership grant failed: ${memberError.message}` };
  }

  // Since 20260904000095 membership alone opens no cell. Create keeps its
  // pre-095 meaning — "this person now sees these entities" — by writing a
  // WRITE grant on every section of each requested entity, exactly what the
  // backfill wrote for the people who were already here. ignoreDuplicates: a
  // grant the owner has since narrowed to read is not widened by a repeat
  // create for the same address. Written BEFORE the link is minted, so a
  // failure here leaves the person's current link alive.
  const sections = await allSectionIds(admin);
  const grantRows = requested.flatMap((code) =>
    sections.map((sectionId) => ({
      user_id: user.id,
      entity_code: code,
      section_id: sectionId,
      capability: 'write',
      created_by: 'owner',
    })),
  );
  if (grantRows.length > 0) {
    const { error: grantError } = await admin
      .from('os_finish_line_grants')
      .upsert(grantRows, { onConflict: 'user_id,entity_code,section_id', ignoreDuplicates: true });
    if (grantError) {
      return { ok: false, status: 500, error: `scope grant failed: ${grantError.message}` };
    }
  }

  const link = await generateAppLink(admin, email, site);
  const createdAt = await mintedAt(admin, user.id);
  const expires = expiryFrom(createdAt);
  await rememberLink(admin, user.id, link, createdAt, expires);
  const granted = await memberships(admin, user.id);
  const grants = await scopeGrants(admin, user.id);
  await audit(admin, 'create', email, granted, null, { sectionIds: sections, capability: 'write' });
  return {
    ok: true,
    body: {
      userId: user.id,
      email,
      entityCodes: granted,
      grants,
      link,
      expiry: LINK_EXPIRY_NOTE,
      // Both may be null: GoTrue's row could not be read, or the OTP window
      // is not configured. Null means "not known", never "does not expire".
      expiresAt: expires,
      createdAt,
    },
  };
}

export async function provisionLink(
  admin: SupabaseClient,
  rawEmail: unknown,
  site: string = DEFAULT_SITE,
): Promise<ProvisionOutcome> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: 'A well-formed email is required' };
  const user = await findUserByEmail(admin, email);
  if (!user) return { ok: false, status: 404, error: 'No such user — provision them first' };
  const codes = await memberships(admin, user.id);
  if (codes.length === 0) {
    // A link for a membershipless user signs them into nothing and the gate
    // signs them straight back out — refuse rather than hand out a dud.
    return { ok: false, status: 409, error: 'User has no membership; grant entities first' };
  }
  const link = await generateAppLink(admin, email, site);
  const createdAt = await mintedAt(admin, user.id);
  const expires = expiryFrom(createdAt);
  await rememberLink(admin, user.id, link, createdAt, expires);
  await audit(admin, 'link', email, codes);
  return {
    ok: true,
    body: {
      userId: user.id,
      email,
      entityCodes: codes,
      link,
      expiry: LINK_EXPIRY_NOTE,
      expiresAt: expires,
      createdAt,
    },
  };
}

export async function provisionRevoke(
  admin: SupabaseClient,
  rawEmail: unknown,
): Promise<ProvisionOutcome> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: 'A well-formed email is required' };
  const user = await findUserByEmail(admin, email);
  if (!user) return { ok: false, status: 404, error: 'No such user' };
  const before = await memberships(admin, user.id);
  const beforeProjects = await projectGrants(admin, user.id);
  // Counted before the membership goes: the grants ride on it through the
  // cascading FK from 095, so there is nothing to delete here and no second
  // call that could be skipped. Null when the table is not there yet.
  const beforeGrants = (await scopeGrantsByUser(admin))?.get(user.id) ?? null;
  const { error } = await admin.from('os_entity_members').delete().eq('user_id', user.id);
  if (error) return { ok: false, status: 500, error: `revoke failed: ${error.message}` };
  // BOTH AXES, server-side, one action. Leaving the project axis to the
  // client (as the first cut did) left a "revoked" account still reading its
  // granted projects whenever the second call was skipped or failed.
  const { error: projectError } = await admin
    .from('os_project_members')
    .delete()
    .eq('user_id', user.id);
  if (projectError) {
    return { ok: false, status: 500, error: `project revoke failed: ${projectError.message}` };
  }
  // The auth user is DELIBERATELY kept: history rows reference actor, and
  // deleting the user would null who did what. With zero membership on
  // either axis, os_member_entities() and os_member_projects() both return
  // {} and every member policy fails closed — access is gone the moment
  // this commits, whatever JWT they still hold.
  //
  // The stored link goes, though. It now opens nothing — a membershipless
  // session is signed straight back out — so keeping it would only leave a
  // live credential lying in a table for no benefit. This is the one place
  // discarding a link costs nothing.
  await forgetLink(admin, user.id);
  await audit(admin, 'revoke', email, before, beforeProjects);
  return {
    ok: true,
    body: {
      userId: user.id,
      email,
      removedEntityCodes: before,
      removedProjectIds: beforeProjects,
      // Null means "not known" (pre-095), never zero.
      removedGrants: beforeGrants === null ? null : beforeGrants.length,
    },
  };
}

/**
 * Grants one user several WORK projects in one audited action. The domain
 * pre-check here exists for a clean 400 — THE BOUNDARY IS THE DATABASE
 * TRIGGER on os_project_members, which fires for this service role exactly
 * as it fires for everyone (verified live: a growth insert as service_role
 * raises).
 */
export async function provisionGrantProjects(
  admin: SupabaseClient,
  rawEmail: unknown,
  rawProjectIds: unknown,
): Promise<ProvisionOutcome> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: 'A well-formed email is required' };
  if (
    !Array.isArray(rawProjectIds) ||
    rawProjectIds.length === 0 ||
    !rawProjectIds.every((id) => typeof id === 'string' && UUID_RE.test(id))
  ) {
    return { ok: false, status: 400, error: 'projectIds must be a non-empty array of project ids' };
  }
  const requested = [...new Set(rawProjectIds as string[])];

  const user = await findUserByEmail(admin, email);
  if (!user) return { ok: false, status: 404, error: 'No such user — provision them first' };

  const { data: projectRows, error: projectError } = await admin
    .from('os_projects')
    .select('id, domain')
    .in('id', requested);
  if (projectError) return { ok: false, status: 500, error: 'Could not read projects' };
  const byId = new Map((projectRows as { id: string; domain: string }[]).map((row) => [row.id, row.domain]));
  const unknown = requested.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    return { ok: false, status: 400, error: `Unknown project ids: ${unknown.join(', ')}` };
  }
  const nonWork = requested.filter((id) => byId.get(id) !== 'work');
  if (nonWork.length > 0) {
    return {
      ok: false,
      status: 400,
      error: 'Only WORK projects are grantable; sharing a growth project requires a migration, not a grant',
    };
  }

  const rows = requested.map((id) => ({
    user_id: user.id,
    project_id: id,
    role: 'contributor',
    created_by: 'owner',
  }));
  const { error: grantError } = await admin
    .from('os_project_members')
    .upsert(rows, { onConflict: 'user_id,project_id', ignoreDuplicates: true });
  if (grantError) {
    return { ok: false, status: 500, error: `project grant failed: ${grantError.message}` };
  }

  const granted = await projectGrants(admin, user.id);
  await audit(admin, 'grant-projects', email, null, requested);
  return { ok: true, body: { userId: user.id, email, projectIds: granted } };
}

/** Removes one project grant, audited. The auth user and every other grant stay. */
export async function provisionRevokeProject(
  admin: SupabaseClient,
  rawEmail: unknown,
  rawProjectId: unknown,
): Promise<ProvisionOutcome> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: 'A well-formed email is required' };
  if (typeof rawProjectId !== 'string' || !UUID_RE.test(rawProjectId)) {
    return { ok: false, status: 400, error: 'projectId must be a project id' };
  }
  const user = await findUserByEmail(admin, email);
  if (!user) return { ok: false, status: 404, error: 'No such user' };
  const { error } = await admin
    .from('os_project_members')
    .delete()
    .eq('user_id', user.id)
    .eq('project_id', rawProjectId);
  if (error) return { ok: false, status: 500, error: `project revoke failed: ${error.message}` };
  const remaining = await projectGrants(admin, user.id);
  await audit(admin, 'revoke-project', email, null, [rawProjectId]);
  return { ok: true, body: { userId: user.id, email, projectIds: remaining } };
}

/**
 * Grants one person one or more SECTIONS of one entity, at one capability, in
 * one audited action — the write behind a click on the access dashboard and
 * behind "grant every section". Upsert on the (user, entity, section) key, so
 * the same action also moves a section between read and write; nothing here
 * ever deletes a row.
 *
 * ENROLS ON THE WAY IN. A grant requires its membership (FK, 095), and the only
 * other way to enrol an existing collaborator on a further entity is `create`,
 * which also mints a link — and minting KILLS the link they are holding. So a
 * grant on an entity the person is not yet enrolled in writes the membership
 * row first, role hardcoded 'contributor', and says so in the response.
 * Membership alone opens nothing since 095; the enrolment is bookkeeping, the
 * grant is the access.
 *
 * The pre-checks buy a clean 400. THE BOUNDARY IS THE DATABASE: the section
 * guard trigger refuses a non-section id for this service role exactly as for
 * everyone, and the FK refuses a grant without its membership.
 */
export async function provisionGrantScope(
  admin: SupabaseClient,
  rawEmail: unknown,
  rawEntityCode: unknown,
  rawSectionIds: unknown,
  rawCapability: unknown,
): Promise<ProvisionOutcome> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: 'A well-formed email is required' };
  const parsed = parseGrantScope(rawEntityCode, rawSectionIds, rawCapability);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { entityCode, sectionIds: requested, capability } = parsed.value;

  const user = await findUserByEmail(admin, email);
  if (!user) return { ok: false, status: 404, error: 'No such user — provision them first' };

  const { data: entityRow, error: entityError } = await admin
    .from('os_finish_line_entities')
    .select('code')
    .eq('code', entityCode)
    .maybeSingle();
  if (entityError) return { ok: false, status: 500, error: 'Could not read entities' };
  if (!entityRow) return { ok: false, status: 400, error: `Unknown entity code: ${entityCode}` };

  const { data: itemRows, error: itemError } = await admin
    .from('os_finish_line_items')
    .select('id, kind')
    .in('id', requested);
  if (itemError) return { ok: false, status: 500, error: 'Could not read sections' };
  const kindOf = new Map(
    (itemRows as { id: string; kind: string }[]).map((row) => [row.id.toLowerCase(), row.kind]),
  );
  const notSections = requested.filter((id) => kindOf.get(id) !== 'section');
  if (notSections.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Not sections (a grant names a section, never a metric or a note): ${notSections.join(', ')}`,
    };
  }

  const enrolledBefore = await memberships(admin, user.id);
  const enrolled = !enrolledBefore.includes(entityCode);
  if (enrolled) {
    // Idempotent on the composite PK; role is hardcoded server-side.
    const { error: memberError } = await admin
      .from('os_entity_members')
      .upsert([{ user_id: user.id, entity_code: entityCode, role: 'contributor' }], {
        onConflict: 'user_id,entity_code',
        ignoreDuplicates: true,
      });
    if (memberError) {
      return { ok: false, status: 500, error: `membership grant failed: ${memberError.message}` };
    }
  }

  const rows = requested.map((sectionId) => ({
    user_id: user.id,
    entity_code: entityCode,
    section_id: sectionId,
    capability,
    created_by: 'owner',
  }));
  // No ignoreDuplicates: an existing row takes the new capability.
  const { error: grantError } = await admin
    .from('os_finish_line_grants')
    .upsert(rows, { onConflict: 'user_id,entity_code,section_id' });
  if (grantError) return { ok: false, status: 500, error: `scope grant failed: ${grantError.message}` };

  await audit(admin, 'grant-scope', email, [entityCode], null, { sectionIds: requested, capability });
  return {
    ok: true,
    body: {
      userId: user.id,
      email,
      entityCode,
      enrolled,
      grants: await scopeGrants(admin, user.id),
    },
  };
}

/**
 * Removes one (entity, section) grant, audited. The membership stays — it is
 * the enrolment, and with no grant left on the entity it opens structure and
 * nothing else — as does every other grant. The full `revoke` is the action
 * that removes a person.
 */
export async function provisionRevokeScope(
  admin: SupabaseClient,
  rawEmail: unknown,
  rawEntityCode: unknown,
  rawSectionId: unknown,
): Promise<ProvisionOutcome> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: 'A well-formed email is required' };
  const parsed = parseRevokeScope(rawEntityCode, rawSectionId);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { entityCode, sectionId } = parsed.value;

  const user = await findUserByEmail(admin, email);
  if (!user) return { ok: false, status: 404, error: 'No such user' };

  const { data: removedRows, error } = await admin
    .from('os_finish_line_grants')
    .delete()
    .eq('user_id', user.id)
    .eq('entity_code', entityCode)
    .eq('section_id', sectionId)
    .select('section_id');
  if (error) return { ok: false, status: 500, error: `scope revoke failed: ${error.message}` };

  await audit(admin, 'revoke-scope', email, [entityCode], null, {
    sectionIds: [sectionId],
    capability: null,
  });
  return {
    ok: true,
    body: {
      userId: user.id,
      email,
      entityCode,
      removed: (removedRows ?? []).length,
      grants: await scopeGrants(admin, user.id),
    },
  };
}

export async function provisionList(admin: SupabaseClient): Promise<ProvisionOutcome> {
  const { data: memberRows, error: memberError } = await admin
    .from('os_entity_members')
    .select('user_id, entity_code');
  if (memberError) return { ok: false, status: 500, error: 'Could not read memberships' };
  const byUser = new Map<string, string[]>();
  for (const row of memberRows as { user_id: string; entity_code: string }[]) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.entity_code]);
  }

  // The project axis rides the same list, so the panel renders both grant
  // sets from one gated read.
  const { data: grantRows, error: grantError } = await admin
    .from('os_project_members')
    .select('user_id, project_id');
  if (grantError) return { ok: false, status: 500, error: 'Could not read project grants' };
  const projectsByUser = new Map<string, string[]>();
  for (const row of grantRows as { user_id: string; project_id: string }[]) {
    projectsByUser.set(row.user_id, [...(projectsByUser.get(row.user_id) ?? []), row.project_id]);
  }

  // The scope axis rides the same list. `grants` is OMITTED, not emptied,
  // while the table is not there yet: an absent field reads "not known" and
  // an empty array reads "nobody holds anything", and the second is the
  // confident zero this app has rendered twice before.
  const scopeByUser = await scopeGrantsByUser(admin);

  const users: Array<Record<string, unknown>> = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { ok: false, status: 500, error: 'Could not list users' };
    for (const user of data.users) {
      users.push({
        userId: user.id,
        email: user.email ?? '',
        entityCodes: (byUser.get(user.id) ?? []).sort(),
        projectIds: (projectsByUser.get(user.id) ?? []).sort(),
        ...(scopeByUser ? { grants: scopeByUser.get(user.id) ?? [] } : {}),
        lastSignInAt: user.last_sign_in_at ?? null,
        createdAt: user.created_at ?? null,
      });
    }
    if (data.users.length < 200) break;
    page += 1;
  }
  users.sort((a, b) => String(a.email).localeCompare(String(b.email)));
  await audit(admin, 'list', null, null);
  return { ok: true, body: { users } };
}
