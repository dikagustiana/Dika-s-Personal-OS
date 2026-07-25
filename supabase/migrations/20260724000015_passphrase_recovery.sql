-- v6 §9: one-time link for setting a NEW passphrase after repeated failures.
--
-- A recovery link, not a reminder. private.os_app_secret holds a bcrypt hash,
-- so the passphrase cannot be read back and nothing here tries to: the email
-- carries a URL, the URL lets the owner install a replacement, and the old
-- passphrase stays unrecoverable.
--
-- Same posture as the auth-attempt tables (…_auth_attempts): the token table
-- lives in `private`, which PostgREST does not expose, so an Edge Function
-- cannot reach it as a table even holding the service role. The three
-- SECURITY DEFINER functions below are its only door in, and they are granted
-- to service_role alone.
--
-- Only a HASH of each token is stored — same reasoning as the passphrase. The
-- digest is taken in here rather than in the caller so that storing a raw
-- token is not merely discouraged but impossible: the functions accept the
-- token, the table never sees it.
--
-- Deliberately unchanged: os_verify_key, os_key_valid(), every RLS policy, and
-- the existing lockout thresholds. The single write to private.os_app_secret
-- replaces the hash in its one row; the table's shape is untouched.
--
-- Idempotent: create table if not exists, create or replace function, and
-- grants re-applied rather than assumed. Safe to re-run.

create table if not exists private.os_recovery_tokens (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

comment on table private.os_recovery_tokens is
  'Passphrase-recovery links, stored as a sha256 digest of the token — never the token. Reached only through os_recovery_issue / os_recovery_consume (service_role).';

revoke all on table private.os_recovery_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Issues a token: stores its digest and reports whether the caller may send.
--
-- The rate limit lives here rather than in the Edge Function because this is
-- the only place that cannot be bypassed. The 3-failure trigger fires well
-- before the 15-minute lockout, so without a cap anyone could flood the
-- mailbox with deliberate typos.
--
-- Returns false when the last issue was inside p_min_gap_minutes. The caller
-- is expected to answer its own caller with success anyway (see the Edge
-- Function) — silence is the point; whoever is guessing learns nothing.
-- ---------------------------------------------------------------------------
create or replace function public.os_recovery_issue(
  p_token text,
  p_ttl_minutes integer default 30,
  p_min_gap_minutes integer default 60
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_token is null or p_token = '' then
    return false;
  end if;

  -- Serialise issuance so two simultaneous requests cannot both read an empty
  -- window and both send. Released with the transaction.
  perform pg_advisory_xact_lock(20260724000015);

  -- Housekeeping in lieu of a scheduled job. The threshold sits far outside
  -- the rate-limit window below, so pruning can never re-open it.
  delete from private.os_recovery_tokens t
  where t.expires_at < now() - interval '1 day';

  if exists (
    select 1
    from private.os_recovery_tokens t
    where t.created_at > now() - make_interval(mins => p_min_gap_minutes)
  ) then
    return false;
  end if;

  -- Recorded before the caller sends, not after: a send that fails costs the
  -- owner one hour, whereas recording afterwards would let a crash mid-send
  -- hand out an unlimited number of emails.
  insert into private.os_recovery_tokens (token_hash, expires_at)
  values (
    encode(extensions.digest(p_token, 'sha256'), 'hex'),
    now() + make_interval(mins => p_ttl_minutes)
  );

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Consumes a token and installs a new passphrase.
--
-- Returns 'ok', 'weak' (failed the length floor) or 'invalid' — one answer for
-- unknown, already used and expired alike.
-- ---------------------------------------------------------------------------
create or replace function public.os_recovery_consume(
  p_token text,
  p_new_passphrase text,
  p_min_length integer default 12
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  claimed text;
begin
  if p_token is null or p_token = '' then
    return 'invalid';
  end if;

  -- Strength before the claim, so a rejected passphrase does not burn the
  -- owner's single-use link. A floor here as well as in the client, because a
  -- caller that skips the UI must not be able to install 'x'.
  if p_new_passphrase is null or length(p_new_passphrase) < p_min_length then
    return 'weak';
  end if;

  -- Claim and expire in one statement: the row lock taken by UPDATE means two
  -- concurrent consumers cannot both win a single-use token. The comparison is
  -- an index lookup on a digest, so its timing says nothing about the token.
  update private.os_recovery_tokens t
  set used_at = now()
  where t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and t.used_at is null
    and t.expires_at > now()
  returning t.token_hash into claimed;

  if claimed is null then
    return 'invalid';
  end if;

  -- Same bcrypt storage the app has always used; only the hash lands.
  update private.os_app_secret
  set key_hash = extensions.crypt(p_new_passphrase, extensions.gen_salt('bf'))
  where id;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Clears the failed-attempt counter after a successful recovery.
--
-- Every row, not one client_key: the counter is keyed by a salted hash of the
-- caller IP, and the browser that opens an emailed link is routinely a
-- different device from the one that locked itself out. Whoever holds the link
-- controls the mailbox, which is the stronger claim of the two.
-- ---------------------------------------------------------------------------
create or replace function public.os_recovery_clear_attempts()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  cleared integer;
begin
  delete from private.os_auth_attempts;
  get diagnostics cleared = row_count;
  return cleared;
end;
$$;

-- Only the Edge Functions' service role may touch these.
revoke all on function public.os_recovery_issue(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.os_recovery_consume(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.os_recovery_clear_attempts()
  from public, anon, authenticated;
grant execute on function public.os_recovery_issue(text, integer, integer)
  to service_role;
grant execute on function public.os_recovery_consume(text, text, integer)
  to service_role;
grant execute on function public.os_recovery_clear_attempts()
  to service_role;

-- ---------------------------------------------------------------------------
-- Post-apply verification. Not run by the migration — paste it into the SQL
-- editor afterwards. `tokens` must be 0 (this migration issues nothing), and
-- each acl must read as service_role=X only, with no anon or authenticated.
--
--   select count(*) as tokens from private.os_recovery_tokens;
--
--   select p.proname, p.proacl
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'os_recovery%';
-- ---------------------------------------------------------------------------
