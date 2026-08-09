-- ===========================================================================
-- READING GoTrue'S OWN MINT TIMESTAMP, WITHOUT EXPOSING THE auth SCHEMA.
-- ===========================================================================
-- os_collab_links.created_at is supposed to be the instant GoTrue minted the
-- token, not the instant our code noticed. The authoritative value lives in
-- auth.one_time_tokens.created_at.
--
-- The provisioning Edge Function cannot simply select it. PostgREST exposes
-- `public` (and `graphql_public`) and NOT `auth`, so a client-side
-- `.schema('auth').from('one_time_tokens')` fails — and it fails SOFTLY in our
-- code, falling back to the process clock. That fallback would have quietly
-- made "authoritative timestamp" false in practice while every test still
-- passed, which is the worst kind of wrong: invisible.
--
-- Widening the exposed schemas to include `auth` would fix it and is not worth
-- discussing — it would put every GoTrue table one policy mistake from the
-- REST surface. So one narrow SECURITY DEFINER function is exported instead,
-- and it can answer exactly one question: when was this user's outstanding
-- magic-link token created.
--
-- GoTrue FILES MAGIC-LINK TOKENS UNDER token_type 'recovery_token'. There is
-- no 'magiclink' member of that enum — verified live, where the two accounts
-- holding an unspent link both carry a 'recovery_token' row and the accounts
-- that have signed in carry none. That second fact is the useful one: the row
-- is DELETED on consumption, so its presence also means the link is unspent.
--
-- EXECUTE IS GRANTED TO service_role ONLY. anon and authenticated are revoked
-- explicitly rather than left to the default, so this never becomes a way for
-- a browser to probe whether a given user id has an outstanding token.
--
-- Returns NULL when there is no such row, which the caller treats as "not
-- known" — it never invents a time.
--
-- NOT APPLIED BY THIS FILE'S AUTHOR AT WRITE TIME. Apply via the Supabase
-- apply_migration tool. NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit`.
--
-- Idempotent. Down-migration:
-- supabase/migrations/down/20260809000072_collab_link_minted_at_down.sql

create or replace function public.os_collab_link_minted_at(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  -- created_at is `timestamp WITHOUT time zone` holding UTC; the explicit
  -- `at time zone 'utc'` is what stops it being read as server-local.
  select (t.created_at at time zone 'utc')
    from auth.one_time_tokens t
   where t.user_id = p_user_id
     and t.token_type = 'recovery_token'
   limit 1
$$;

comment on function public.os_collab_link_minted_at(uuid) is
  'When GoTrue minted this user''s outstanding magic-link token (auth.one_time_tokens.created_at, filed under token_type ''recovery_token''). Exists so the provisioning function can stamp os_collab_links.created_at authoritatively without the auth schema being exposed to PostgREST. service_role only.';

revoke all on function public.os_collab_link_minted_at(uuid) from public;
revoke all on function public.os_collab_link_minted_at(uuid) from anon;
revoke all on function public.os_collab_link_minted_at(uuid) from authenticated;
grant execute on function public.os_collab_link_minted_at(uuid) to service_role;
