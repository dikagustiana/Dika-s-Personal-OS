// Core provisioning actions for collaborator access — create, link, revoke,
// list — extracted so the owner-gated wrapper (provision-collaborator) stays
// a thin door and the logic itself is a single copy.
//
// EVERYTHING HERE RUNS WITH THE SERVICE ROLE AND BYPASSES RLS. It is the most
// privileged code path in the app, and it is treated accordingly:
//   - The service role key is read from the function environment only. It
//     never appears in src/, in a bundle, in a migration, or in the repo.
//   - Inputs are validated HERE, not in the wrappers, so no wrapper can
//     forget: emails must be well-formed, every entity code must exist in
//     os_finish_line_entities, and the role is hardcoded 'contributor'.
//   - No table name, column name, or predicate is ever taken from a request.
//   - NO EMAIL IS EVER SENT. generateLink mints the token without sending;
//     the owner hands the link over out of band. That is the entire design.

import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SITE = 'https://dika-personal-os.vercel.app';
export const LINK_EXPIRY_NOTE =
  'Sekali pakai; berlaku mengikuti masa OTP email proyek (default Supabase: 1 jam). Kirim segera.';

/**
 * The assumed life of a minted link, in seconds — the Supabase default OTP
 * expiry. GoTrue does not report the deadline back through generateLink, so
 * this is the honest best estimate rather than a reading of the setting; if
 * the project's OTP expiry is changed, change it here too.
 *
 * It exists so the panel can show a real countdown instead of one fixed
 * sentence. The client treats it as advisory and defaults to the same hour on
 * its own, so this file and the frontend can ship independently.
 */
export const LINK_TTL_SECONDS = 3600;

function expiresAt(): string {
  return new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString();
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function audit(
  admin: SupabaseClient,
  action: 'create' | 'link' | 'revoke' | 'list' | 'grant-projects' | 'revoke-project',
  email: string | null,
  entityCodes: string[] | null,
  projectIds: string[] | null = null,
): Promise<void> {
  const { error } = await admin.rpc('os_provision_record', {
    p_action: action,
    p_email: email,
    p_entity_codes: entityCodes,
    p_project_ids: projectIds,
  });
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

  const link = await generateAppLink(admin, email, site);
  const granted = await memberships(admin, user.id);
  await audit(admin, 'create', email, granted);
  return {
    ok: true,
    body: {
      userId: user.id,
      email,
      entityCodes: granted,
      link,
      expiry: LINK_EXPIRY_NOTE,
      expiresAt: expiresAt(),
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
  await audit(admin, 'link', email, codes);
  return {
    ok: true,
    body: {
      userId: user.id,
      email,
      entityCodes: codes,
      link,
      expiry: LINK_EXPIRY_NOTE,
      expiresAt: expiresAt(),
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
  await audit(admin, 'revoke', email, before, beforeProjects);
  return {
    ok: true,
    body: {
      userId: user.id,
      email,
      removedEntityCodes: before,
      removedProjectIds: beforeProjects,
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
