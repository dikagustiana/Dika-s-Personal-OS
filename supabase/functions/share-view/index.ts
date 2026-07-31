// ===========================================================================
// THE ONLY WAY A SHARE LINK READS ANYTHING.
// ===========================================================================
// A share link grants read-only access to ONE view with ONE filter until it
// expires. That is served here rather than by PostgREST with a permissive
// policy, because a policy wide enough to serve a share link is live for
// every other caller too, and the scope would then have to be re-expressed in
// every query instead of living in one place.
//
// ---------------------------------------------------------------------------
// THIS FUNCTION CONTAINS NO WRITE. NOT ONE.
// ---------------------------------------------------------------------------
// Grepping this file for the four PostgREST mutation calls — insert, update,
// upsert, delete, each followed by an open bracket — finds nothing. The verbs
// are spelled out in prose here rather than written as calls precisely so that
// grep stays a real check: a comment listing them verbatim would match itself
// and quietly retire the test it exists to describe.
//
// That emptiness is an invariant to preserve, not an accident of the current
// feature set. This function holds the service role, which bypasses RLS
// completely: the database would not stop a write from here, so the absence
// of one is the whole of the protection. Every database call below is a
// .select, and there are five of them.
//
// The one mutation anywhere in the share path is the `last_seen_at` touch on
// the link's OWN row, and it happens inside os_share_link_claim, in the
// database. Nothing reachable from here can write a cell, an account, a
// project or a milestone.
//
// ---------------------------------------------------------------------------
// THE SCOPE COMES FROM THE TOKEN RECORD AND FROM NOWHERE ELSE.
// ---------------------------------------------------------------------------
// The request body is read for exactly one field — the token — and every
// other key in it is ignored, including one named `scope` or `entity`. There
// is no code path below in which a request value reaches a query filter. So
// changing an entity code in the URL or the body cannot change what comes
// back: the worst it can do is nothing.
//
// verify_jwt is left ON here, unlike verify-passphrase, and that is not a
// second credential: the anon key satisfies it, it ships in the public bundle,
// and the recipient's page already carries it. It buys one thing — unaddressed
// internet noise is refused at the gateway before this function runs. The
// TOKEN is the credential, and it is the only thing checked below.
//
// No x-app-key is involved anywhere. A recipient has no passphrase and never
// acquires one; the read is served by the service role under a scope the
// token record fixed at creation.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * The shape the app's own share links carry: 32 random bytes in base64url.
 * Checked before the database is touched so a flood of junk costs a regex
 * rather than a query. It is NOT a security control — a 32-byte token is not
 * guessable, so there is no rate limit here and none is needed. Deliberately
 * not wired into the passphrase lockout either: a stranger mistyping a share
 * link must never be able to lock the owner out of his own front door.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

/**
 * An entity code as os_share_link_create already validated it — it had to
 * match a row in os_finish_line_entities to be stored at all. Re-checked here
 * before it is composed into a filter expression, so that the question "could
 * a stored scope value be crafted to mean something else in a query" has a
 * one-line answer rather than a chain of reasoning about the write path.
 */
const ENTITY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Every view a token may name. The database constrains the column to the same
 * two values; this is the second half of that pair, and the half that decides
 * what is actually read. A token naming anything else is refused rather than
 * falling through to a default — a default here would be a view somebody was
 * granted by accident.
 */
const VIEWS = ['finish-line-group', 'finish-line-entity'] as const;
type ShareView = (typeof VIEWS)[number];

/**
 * What a recipient is given, per row. Deliberately narrower than the row the
 * owner's app reads: `notes` (the owner's own scratch text about an account),
 * `coa_entity` and `nature` are left out because no share view renders them,
 * and a field that is not sent cannot be leaked by a later UI change.
 */
const ACCOUNT_COLUMNS =
  'id, cell_id, entity_code, coa_consol, account_name, function, business, is_dummy, driver_type, driver_source, data_ideal, pic, sort_order, imported_at';

type Row = Record<string, unknown>;

function toItem(row: Row) {
  return {
    id: row.id,
    item: row.item,
    kind: row.kind,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    order: row.sort_order,
    ...(row.tag ? { tag: row.tag } : {}),
    ...(row.unit ? { unit: row.unit } : {}),
    ...(row.dp === null || row.dp === undefined ? {} : { dp: row.dp }),
    ...(row.style ? { style: row.style } : {}),
    ...(row.flag ? { flag: row.flag } : {}),
    ...(row.blocks ? { blocks: row.blocks } : {}),
  };
}

function toCell(row: Row) {
  return {
    id: row.id,
    itemId: row.item_id,
    entityCode: row.entity_code,
    state: row.state,
    ...(row.note ? { note: row.note } : {}),
  };
}

function toAccount(row: Row) {
  return {
    id: row.id,
    accountName: row.account_name,
    isDummy: row.is_dummy === true,
    order: row.sort_order,
    importedAt: row.imported_at,
    ...(row.cell_id ? { cellId: row.cell_id } : {}),
    ...(row.entity_code ? { entityCode: row.entity_code } : {}),
    ...(row.coa_consol ? { coaConsol: row.coa_consol } : {}),
    ...(row.function ? { function: row.function } : {}),
    ...(row.business ? { business: row.business } : {}),
    ...(row.driver_type ? { driverType: row.driver_type } : {}),
    ...(row.driver_source ? { driverSource: row.driver_source } : {}),
    ...(row.data_ideal ? { dataIdeal: row.data_ideal } : {}),
    ...(row.pic ? { pic: row.pic } : {}),
  };
}

/**
 * Reads the Finish line, optionally narrowed to one entity.
 *
 * `entity` is the value the CLAIM returned. It is a parameter of this function
 * and never of the request, which is what makes the filter unforgeable — there
 * is no argument the caller controls.
 *
 * What is deliberately absent: projects, milestones, edges and dependency
 * rows. A recipient sees the state of the pack, not the road behind it. That
 * also keeps the create dialog's sentence true — it promises cells and
 * accounts, and this returns cells and accounts.
 */
async function readFinishLine(
  // deno-lint-ignore no-explicit-any
  admin: any,
  entity: string | null,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
  const entities = entity
    ? await admin
        .from('os_finish_line_entities')
        .select('code, label, sort_order')
        .eq('code', entity)
    : await admin
        .from('os_finish_line_entities')
        .select('code, label, sort_order')
        .order('sort_order', { ascending: true });
  if (entities.error) return { ok: false, detail: 'entities' };

  // A token whose entity has since been deleted resolves to nothing. Refused
  // rather than served as an empty pack, which would read as "all clear".
  if (entity && (entities.data ?? []).length === 0) {
    return { ok: false, detail: 'entities' };
  }

  const items = await admin
    .from('os_finish_line_items')
    .select('id, item, kind, parent_id, sort_order, tag, unit, dp, style, flag, blocks')
    .in('kind', ['section', 'metric', 'note'])
    .order('sort_order', { ascending: true });
  if (items.error) return { ok: false, detail: 'items' };

  const cellQuery = admin
    .from('os_finish_line_cells')
    .select('id, item_id, entity_code, state, note');
  const cells = await (entity ? cellQuery.eq('entity_code', entity) : cellQuery);
  if (cells.error) return { ok: false, detail: 'cells' };

  // Accounts are scoped by the cells that survived the filter, OR by being
  // unmapped and carrying this entity code. Both halves matter: an unmapped
  // account belongs to the entity's population even though no cell claims it,
  // and dropping it here would make coverage look better than it is — the
  // same reasoning as listFinishLineAccounts in the owner's repository.
  //
  // Written against cell membership rather than against entity_code alone,
  // even though every mapped account now carries its cell's entity. Trusting
  // that column here would make this filter depend on a backfill staying
  // true, and a share boundary must not rest on an invariant enforced
  // somewhere else.
  const accountQuery = admin.from('os_finish_line_accounts').select(ACCOUNT_COLUMNS);
  const cellIds = (cells.data as Row[]).map((row) => row.id as string);
  const unmappedHere = `and(cell_id.is.null,entity_code.eq.${entity})`;
  const accounts = await (entity
    ? accountQuery.or(
        cellIds.length > 0 ? `cell_id.in.(${cellIds.join(',')}),${unmappedHere}` : unmappedHere,
      )
    : accountQuery
  ).order('sort_order', { ascending: true });
  if (accounts.error) return { ok: false, detail: 'accounts' };

  return {
    ok: true,
    data: {
      entities: (entities.data as Row[]).map((row) => ({
        code: row.code,
        label: row.label,
        order: row.sort_order,
      })),
      items: (items.data as Row[]).map(toItem),
      cells: (cells.data as Row[]).map(toCell),
      accounts: (accounts.data as Row[]).map(toAccount),
    },
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, reason: 'unknown' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return json({ ok: false, reason: 'unavailable' }, 500);

  // The ONLY field read from the request. Anything else the caller sends —
  // including `scope`, `entity` or `view` — is never looked at.
  let token = '';
  try {
    const body = await request.json();
    token = typeof body?.token === 'string' ? body.token : '';
  } catch {
    return json({ ok: false, reason: 'unknown' });
  }
  if (!TOKEN_PATTERN.test(token)) return json({ ok: false, reason: 'unknown' });

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

  // Validity, expiry and revocation are decided here, on this request, by the
  // database reading the row as it stands now. Revoking a link takes effect on
  // the recipient's next request with no cache to wait out.
  const { data: claim, error } = await admin.rpc('os_share_link_claim', { p_token: token });
  if (error) return json({ ok: false, reason: 'unavailable' }, 500);
  if (!claim || claim.valid !== true) {
    return json({ ok: false, reason: claim?.reason ?? 'unknown' });
  }

  const view = claim.view as ShareView;
  if (!VIEWS.includes(view)) return json({ ok: false, reason: 'unknown' });

  // The scope, taken from the record the claim returned.
  const entity =
    view === 'finish-line-entity' ? String(claim.scope?.entity ?? '') : null;
  if (entity !== null && !ENTITY_PATTERN.test(entity)) {
    return json({ ok: false, reason: 'unknown' });
  }

  const result = await readFinishLine(admin, entity);
  if (!result.ok) return json({ ok: false, reason: 'unavailable' }, 500);

  return json({
    ok: true,
    view,
    // Echoed so the page can state its own scope and expiry in the same words
    // the create dialog used. Both render from the record, never from the URL.
    scope: entity ? { entity } : {},
    expiresAt: claim.expiresAt,
    data: result.data,
  });
});
