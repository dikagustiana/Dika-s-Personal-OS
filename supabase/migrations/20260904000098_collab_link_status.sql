-- ===========================================================================
-- THE LINK STATUS READER — every outstanding token, one call, GoTrue's truth.
-- ===========================================================================
-- 20260809000072 exported os_collab_link_minted_at(uuid): the mint instant of
-- ONE user's outstanding magic-link token, read from auth.one_time_tokens
-- through a SECURITY DEFINER function because PostgREST does not expose the
-- auth schema and widening that is not on the table. The provisioning
-- function used it to stamp os_collab_links.created_at authoritatively.
--
-- The access dashboard needs the same fact for EVERY collaborator at once —
-- "does this person still hold an unspent link, and since when" — so the
-- `list` action can put a status beside each name that comes from GoTrue's
-- own table rather than from what this app remembers filing. One call per
-- person would be N round trips inside one request; this is one.
--
-- WHAT IT ANSWERS AND WHAT IT DOES NOT. One row per user id that holds a
-- 'recovery_token' row (that is how GoTrue files magic links — there is no
-- 'magiclink' member of the enum, verified live), with GoTrue's created_at.
-- A user absent from the result holds no unspent token: consumed (GoTrue
-- deletes the row on use) or never minted. It says nothing about expiry — the
-- window is COLLAB_LINK_TTL_SECONDS in the function's environment and the
-- function applies it (supabase/functions/_shared/linkStatus.ts); nothing
-- here hardcodes a lifetime.
--
-- EXECUTE IS GRANTED TO service_role ONLY, exactly as 072: anon and
-- authenticated are revoked explicitly so this never becomes a way for a
-- browser to probe which accounts hold an outstanding token.
--
-- os_collab_link_minted_at(uuid) IS KEPT. The deployed function build calls
-- it, and a build deployed after this file falls back to it when this reader
-- is missing — so the two coexist by design until a later migration retires
-- the old one deliberately. Its down file stays valid.
--
-- APPLIED 2026-09-04 via the Supabase apply_migration tool (ledger name
-- `collab_link_status`), before the provision-collaborator redeploy.
-- Idempotent. Verified on live: EXECUTE is service_role only — anon and
-- authenticated are both refused — and os_collab_link_minted_at(uuid) is
-- still present as the fallback. NEVER apply with `supabase db push`,
-- `migration up`, `db reset` or `db remote commit`.
--
-- Down-migration:
-- supabase/migrations/down/20260904000098_collab_link_status_down.sql

create or replace function public.os_collab_link_status(p_user_ids uuid[])
returns table (user_id uuid, minted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  -- created_at is `timestamp WITHOUT time zone` holding UTC; the explicit
  -- `at time zone 'utc'` is what stops it being read as server-local.
  select t.user_id, (t.created_at at time zone 'utc')
    from auth.one_time_tokens t
   where t.token_type = 'recovery_token'
     and t.user_id = any (p_user_ids)
$$;

comment on function public.os_collab_link_status(uuid[]) is
  'For each given user id that still holds an unspent magic-link token (auth.one_time_tokens, token_type recovery_token): the instant GoTrue minted it. A user absent from the result holds none. Read by provision-collaborator''s list action to put a link status beside every collaborator; the expiry window is applied by the function from COLLAB_LINK_TTL_SECONDS, never here. service_role only.';

revoke all on function public.os_collab_link_status(uuid[]) from public;
revoke all on function public.os_collab_link_status(uuid[]) from anon;
revoke all on function public.os_collab_link_status(uuid[]) from authenticated;
grant execute on function public.os_collab_link_status(uuid[]) to service_role;
