-- ===========================================================================
-- SHARE ONE PAGE, NOT THE APP.
-- ===========================================================================
-- The owner wants to show specific things to specific people. A second
-- passphrase is the wrong instrument even now that one exists that cannot
-- write, for two reasons:
--
--   * The scope he needs is usually not a table boundary. "The one entity's
--     view" is a ROW filter — os_finish_line_cells holds every entity in one
--     table. A key cannot express that without policies far more complex than
--     the ones that just produced a live 500.
--   * A passphrase cannot be scoped, expired or revoked individually. Once it
--     is in a chat thread it is permanent access to everything it covers.
--
-- So: a share link. A token that grants read-only access to ONE view, with
-- ONE filter, until it expires.
--
-- WHAT THIS MIGRATION DOES NOT DO. It grants nothing. It adds no policy, and
-- it touches none of the 84 that exist. The reading path is an Edge Function
-- holding the service role — deliberately NOT PostgREST with a permissive
-- policy, because a policy wide enough to serve a share link is a policy that
-- is also live for every other caller, and the scope would then have to be
-- re-expressed in every query instead of living in one place.
--
-- SAME POSTURE AS private.os_recovery_tokens, and the same reasoning end to
-- end: the table lives in `private`, which PostgREST does not expose, so the
-- SECURITY DEFINER functions below are its only door. Only a DIGEST of each
-- token is stored, and the digest is taken IN HERE rather than in the caller
-- so that storing a raw token is not merely discouraged but impossible — the
-- functions accept the token, the table never sees one.
--
-- WHY sha256 AND NOT bcrypt, WHICH IS WHAT THE PASSPHRASE USES. bcrypt is
-- slow on purpose because a passphrase is guessable. A share token is 32
-- bytes from a CSPRNG; there is no dictionary to walk and slowing the compare
-- buys nothing. It also costs something real: bcrypt salts per row, so a
-- lookup BY hash would have to scan the table and bcrypt every row — which is
-- exactly the per-row bcrypt that produced a live 500 in this project three
-- weeks ago. A digest is a unique-index lookup. Same choice, same reasoning,
-- as os_recovery_tokens.
--
-- APPLIED 2026-07-31 via the Supabase apply_migration tool. Never apply it
-- with a supabase CLI migration command — those replay the entire history
-- against live data; see the note in 20260724000016_research_pipeline.sql.
--
-- Idempotent: create table if not exists, create or replace function, grants
-- re-applied rather than assumed. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The links themselves
-- ---------------------------------------------------------------------------
create table if not exists private.os_share_links (
  id           uuid primary key default gen_random_uuid(),
  -- sha256 hex of the token. Unique because it is the lookup key: a duplicate
  -- would mean two links answer one token, and there is no honest way to pick.
  token_hash   text not null unique,
  "view"       text not null,
  -- The filter, e.g. {"entity":"…"}. Normalised by os_share_link_create, so
  -- what lands here is what that function built and never what a caller sent.
  scope        jsonb,
  -- The owner's own note about who he gave it to. Never shown to a recipient.
  label        text,
  -- NOT NULL on purpose. A link with no expiry is a passphrase with extra
  -- steps. Short by default (7 days) and extendable — see os_share_link_extend.
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  -- So the owner can tell whether a link is actually being used before he
  -- renews it. Written by os_share_link_claim, on this row only.
  last_seen_at timestamptz
);

comment on table private.os_share_links is
  'Read-only share links, stored as a sha256 digest of the token — never the token. Reached only through the os_share_link_* functions.';

-- The view name is a security boundary, not a label: it decides which reader
-- the Edge Function runs. Constrained here as well as allow-listed there, so
-- a row naming a view that does not exist cannot be written in the first
-- place. Adding a view is deliberately a migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'os_share_links_view_check'
  ) then
    alter table private.os_share_links
      add constraint os_share_links_view_check
      check ("view" in ('finish-line-group', 'finish-line-entity'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'os_share_links_expiry_check'
  ) then
    alter table private.os_share_links
      add constraint os_share_links_expiry_check
      check (expires_at > created_at);
  end if;
end $$;

revoke all on table private.os_share_links from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Managing links is an OWNER action, and only the owner key opens it
-- ---------------------------------------------------------------------------
-- The read-only key added in 20260728000034 satisfies SELECT everywhere. It
-- must not mint, list or revoke a share link: a credential that can create a
-- credential is the same credential. os_key_valid() alone, never
-- os_read_key_valid().
--
-- The four functions below are SECURITY DEFINER because `private` has no other
-- door, which means they run with the owner's rights and bypass RLS entirely.
-- That makes this gate the whole of their access control, so it is one
-- definition called by all four rather than four copies that can drift.
create or replace function private.os_share_owner_gate()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not (select public.os_key_valid()) then
    raise exception 'Share links may only be managed with the owner key'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Every function here returns jsonb rather than a table. RETURNS TABLE names
-- its outputs as parameters, and every name this table wants — id, scope,
-- label, expires_at — then shadows the column of the same name inside the
-- body. jsonb also lets the keys arrive camelCased, matching the TypeScript
-- types they are read into, with no mapping layer in between.

-- What the owner sees when he lists his links. token_hash is absent by
-- construction, not filtered out downstream: the digest is not useful to the
-- owner (it cannot be turned back into a link) and shipping it to the browser
-- would put a credential-shaped string in a page that never needs one.
create or replace function public.os_share_links_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.os_share_owner_gate();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'view', l."view",
        'scope', coalesce(l.scope, '{}'::jsonb),
        'label', l.label,
        'expiresAt', l.expires_at,
        'revokedAt', l.revoked_at,
        'createdAt', l.created_at,
        'lastSeenAt', l.last_seen_at
      )
      order by l.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from private.os_share_links l;

  return result;
end;
$$;

-- Issues a link. The caller supplies the token; only its digest is kept, so
-- the token is shown once at creation and is never retrievable afterwards. If
-- it is lost, revoke and reissue — the same contract as the passphrase.
--
-- The lifetime is given in DAYS and turned into a timestamp by the server
-- clock, not accepted as one. A caller cannot mint a ten-year link by sending
-- a ten-year date, and a browser with a wrong clock cannot mint a dead one.
create or replace function public.os_share_link_create(
  p_token text,
  p_view text,
  p_scope jsonb default null,
  p_label text default null,
  p_ttl_days integer default 7
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ttl integer;
  entity text;
  fresh private.os_share_links%rowtype;
begin
  perform private.os_share_owner_gate();

  -- A short token is a guessable token, and this is the only place that can
  -- refuse one. 32 random bytes in base64url is 43 characters.
  if p_token is null or length(p_token) < 24 then
    raise exception 'A share token must carry at least 24 characters of randomness';
  end if;

  ttl := least(greatest(coalesce(p_ttl_days, 7), 1), 90);

  -- The scope is REBUILT from the values this function validated rather than
  -- stored as handed over. An unrecognised key in the caller's object must not
  -- survive into the record the reading path treats as authoritative.
  if p_view = 'finish-line-entity' then
    entity := p_scope ->> 'entity';
    if entity is null or not exists (
      select 1 from public.os_finish_line_entities e where e.code = entity
    ) then
      raise exception 'An entity share must name an entity that exists';
    end if;
    p_scope := jsonb_build_object('entity', entity);
  elsif p_view = 'finish-line-group' then
    p_scope := '{}'::jsonb;
  else
    raise exception 'Unknown share view: %', p_view;
  end if;

  insert into private.os_share_links (token_hash, "view", scope, label, expires_at)
  values (
    encode(extensions.digest(p_token, 'sha256'), 'hex'),
    p_view,
    p_scope,
    nullif(btrim(coalesce(p_label, '')), ''),
    now() + make_interval(days => ttl)
  )
  returning * into fresh;

  return jsonb_build_object(
    'id', fresh.id,
    'view', fresh."view",
    'scope', fresh.scope,
    'label', fresh.label,
    'expiresAt', fresh.expires_at,
    'revokedAt', fresh.revoked_at,
    'createdAt', fresh.created_at,
    'lastSeenAt', fresh.last_seen_at
  );
end;
$$;

-- Revocation is idempotent and keeps the first time: "when did I cut this
-- off" is the useful fact, and a second call must not rewrite it.
create or replace function public.os_share_link_revoke(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  fresh private.os_share_links%rowtype;
begin
  perform private.os_share_owner_gate();

  update private.os_share_links l
     set revoked_at = coalesce(l.revoked_at, now())
   where l.id = p_id
  returning * into fresh;

  if fresh.id is null then
    raise exception 'No such share link';
  end if;

  return jsonb_build_object(
    'id', fresh.id,
    'view', fresh."view",
    'scope', fresh.scope,
    'label', fresh.label,
    'expiresAt', fresh.expires_at,
    'revokedAt', fresh.revoked_at,
    'createdAt', fresh.created_at,
    'lastSeenAt', fresh.last_seen_at
  );
end;
$$;

-- Extending is what makes a short default liveable. A revoked link is not
-- extendable: bringing one back would make revocation reversible, and the
-- owner's mental model of "I cut that off" has to stay true. Reissue instead.
create or replace function public.os_share_link_extend(
  p_id uuid,
  p_ttl_days integer default 7
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ttl integer;
  fresh private.os_share_links%rowtype;
begin
  perform private.os_share_owner_gate();

  ttl := least(greatest(coalesce(p_ttl_days, 7), 1), 90);

  update private.os_share_links l
     set expires_at = now() + make_interval(days => ttl)
   where l.id = p_id
     and l.revoked_at is null
  returning * into fresh;

  if fresh.id is null then
    raise exception 'No such share link, or it has been revoked';
  end if;

  return jsonb_build_object(
    'id', fresh.id,
    'view', fresh."view",
    'scope', fresh.scope,
    'label', fresh.label,
    'expiresAt', fresh.expires_at,
    'revokedAt', fresh.revoked_at,
    'createdAt', fresh.created_at,
    'lastSeenAt', fresh.last_seen_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Redeeming a link — the only function the share path calls
-- ---------------------------------------------------------------------------
-- EXPIRY AND REVOCATION ARE CHECKED HERE, ON EVERY CALL, against the row as
-- it stands right now. Not at issue time, and not from anything the caller
-- sent. Revoking a link therefore takes effect on the recipient's next
-- request, with no cache to wait out.
--
-- THE SCOPE IS RETURNED, NEVER ACCEPTED. This function takes one argument and
-- it is the token. There is no parameter through which a caller could name an
-- entity, so there is nothing for the Edge Function to prefer over the record
-- and no request field that could widen what comes back.
--
-- The single write in the whole share path is the last_seen_at touch below,
-- on this link's own row. It is here rather than in the Edge Function so that
-- the function itself contains no write at all — see the header of
-- supabase/functions/share-view/index.ts.
create or replace function public.os_share_link_claim(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rec private.os_share_links%rowtype;
begin
  if p_token is null or p_token = '' then
    return jsonb_build_object('valid', false, 'reason', 'unknown');
  end if;

  select * into rec
    from private.os_share_links l
   where l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- 'unknown' covers never-issued and mistyped alike. Guessing a 32-byte
  -- token is not a threat model, so this says nothing careful; it simply has
  -- nothing to say.
  if rec.id is null then
    return jsonb_build_object('valid', false, 'reason', 'unknown');
  end if;

  -- Revocation is checked before expiry so a link that is both reports the
  -- deliberate act rather than the passage of time.
  if rec.revoked_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'revoked');
  end if;

  if rec.expires_at <= now() then
    return jsonb_build_object(
      'valid', false, 'reason', 'expired', 'expiresAt', rec.expires_at);
  end if;

  update private.os_share_links l
     set last_seen_at = now()
   where l.id = rec.id;

  return jsonb_build_object(
    'valid', true,
    'reason', 'ok',
    'id', rec.id,
    'view', rec."view",
    'scope', coalesce(rec.scope, '{}'::jsonb),
    'label', rec.label,
    'expiresAt', rec.expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- The management functions are reachable by the app's anon role and gated
-- inside on the owner key — the same shape every other app call has. The
-- claim function is not: only the Edge Function's service role may redeem a
-- token, so the browser has no way to ask the database about one directly.
revoke all on function public.os_share_links_list() from public, anon, authenticated;
revoke all on function public.os_share_link_create(text, text, jsonb, text, integer)
  from public, anon, authenticated;
revoke all on function public.os_share_link_revoke(uuid) from public, anon, authenticated;
revoke all on function public.os_share_link_extend(uuid, integer) from public, anon, authenticated;
revoke all on function public.os_share_link_claim(text) from public, anon, authenticated;

grant execute on function public.os_share_links_list() to anon, authenticated;
grant execute on function public.os_share_link_create(text, text, jsonb, text, integer)
  to anon, authenticated;
grant execute on function public.os_share_link_revoke(uuid) to anon, authenticated;
grant execute on function public.os_share_link_extend(uuid, integer) to anon, authenticated;
grant execute on function public.os_share_link_claim(text) to service_role;

-- ---------------------------------------------------------------------------
-- Post-apply verification. Not run by the migration — paste it into the SQL
-- editor afterwards. `links` must be 0 (this migration issues nothing), and
-- the claim function's acl must read as service_role only.
--
--   select count(*) as links from private.os_share_links;
--
--   select p.proname, p.proacl
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'os_share%';
-- ---------------------------------------------------------------------------
