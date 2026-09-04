// Owner-provisioned collaborator access — the one door.
//
// The app never sends email. The OWNER creates the user, grants entity
// membership, and receives a one-time sign-in link to hand over out of band
// (WhatsApp). This function is that door, and it opens only for the owner:
// every call is gated by checkAppKey — the SAME bcrypt compare, escalating
// delay, and lockout counter as the passphrase gate itself (see
// _shared/appKeyAuth.ts) — before anything else runs. A caller without the
// passphrase gets 401 and walks the identical lockout as one hammering the
// front door.
//
// It runs with the service role and BYPASSES EVERY RLS POLICY, which makes it
// the most privileged code path in the app:
//   - the service role key exists only in this function's environment
//   - the action set is a closed enum (create / link / revoke / list /
//     grant-projects / revoke-project / grant-scope / revoke-scope); role is
//     hardcoded 'contributor' and no request field can set it
//   - emails are validated, entity codes are checked against
//     os_finish_line_entities, project ids against os_projects, section ids
//     against os_finish_line_items (kind = section) — and the GROWTH domain
//     guard trigger and the section guard trigger fire for this service role
//     exactly as for everyone, so the function cannot grant a growth project
//     or a metric-level scope even if its own pre-check were wrong
//   - every successful action is appended to private.os_provision_log via
//     os_provision_record (service_role-only), and a failed audit write fails
//     the action — an unlogged grant must not succeed silently
//
// verify_jwt is ON (the client sends the anon bearer, as every edge call here
// does); the real gate is the owner credential.

import { checkAppKey } from '../_shared/appKeyAuth.ts';
import {
  adminClient,
  provisionCreate,
  provisionGrantProjects,
  provisionGrantScope,
  provisionLink,
  provisionList,
  provisionRevoke,
  provisionRevokeProject,
  provisionRevokeScope,
} from '../_shared/provision.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-app-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // The owner credential, checked FIRST — before the body is even parsed.
  const gate = await checkAppKey(request);
  if (!gate.ok) return json({ error: gate.reason, retryAfter: gate.retryAfter }, gate.status);

  const admin = adminClient();
  if (!admin) return json({ error: 'Function is not configured' }, 500);

  let action = '';
  let email: unknown;
  let entityCodes: unknown;
  let projectIds: unknown;
  let projectId: unknown;
  let entityCode: unknown;
  let sectionIds: unknown;
  let sectionId: unknown;
  let capability: unknown;
  try {
    const body = await request.json();
    action = typeof body?.action === 'string' ? body.action : '';
    email = body?.email;
    entityCodes = body?.entityCodes;
    projectIds = body?.projectIds;
    projectId = body?.projectId;
    // The scope axis. `role` is deliberately NOT read from the body.
    entityCode = body?.entityCode;
    sectionIds = body?.sectionIds;
    sectionId = body?.sectionId;
    capability = body?.capability;
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  // The site the handover link points at. Origin only misleads the owner's
  // own copy of the link, and the owner's browser sets it honestly.
  const site = request.headers.get('origin') ?? undefined;

  try {
    const outcome =
      action === 'create'
        ? await provisionCreate(admin, email, entityCodes, site)
        : action === 'link'
          ? await provisionLink(admin, email, site)
          : action === 'revoke'
            ? await provisionRevoke(admin, email)
            : action === 'list'
              ? await provisionList(admin)
              : action === 'grant-projects'
                ? await provisionGrantProjects(admin, email, projectIds)
                : action === 'revoke-project'
                  ? await provisionRevokeProject(admin, email, projectId)
                  : action === 'grant-scope'
                    ? await provisionGrantScope(admin, email, entityCode, sectionIds, capability)
                    : action === 'revoke-scope'
                      ? await provisionRevokeScope(admin, email, entityCode, sectionId)
                      : null;
    if (!outcome) return json({ error: 'Unknown action' }, 400);
    if (!outcome.ok) return json({ error: outcome.error }, outcome.status);
    return json(outcome.body);
  } catch (error) {
    // Detail goes to the function log, not to the wire.
    console.error('provision-collaborator:', error);
    return json({ error: 'Provisioning failed' }, 500);
  }
});
