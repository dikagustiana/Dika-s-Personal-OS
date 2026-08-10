-- Down-migration for 20260809000071_collab_link_store.
-- Drops the stored sign-in links and the trigger that marks them spent.
--
-- WHAT IS LOST is not history: it is at most one live, un-handed-over link per
-- collaborator. Anyone still holding a copy can keep using it — dropping this
-- table does not revoke anything, because the credential lives in
-- auth.one_time_tokens and not here. What the owner loses is the ability to
-- copy it a second time; recovering it after this means "Tautan baru", which
-- kills whatever token is already out there. Copy anything still needed first.
--
-- The trigger goes first so no sign-in can attempt a write against a table
-- that is mid-drop. Dropping it cannot affect authentication: auth.users is
-- otherwise untouched, and BOTH other triggers on that table —
-- os_record_sign_in (20260809000070) and os_auth_users_birth_password_guard
-- (20260804000049) — are separate objects this file does not name. That
-- independence is the whole reason this was a second trigger rather than an
-- edit to the first.
--
-- Nothing references os_collab_links — user_id carries no foreign key, matching
-- every other public table — so the drop cannot cascade anywhere.

drop trigger if exists os_mark_collab_link_used on auth.users;
drop function if exists public.os_mark_collab_link_used();

drop policy if exists "require app key to select" on public.os_collab_links;
drop policy if exists "require app key to insert" on public.os_collab_links;
drop policy if exists "require app key to update" on public.os_collab_links;
drop policy if exists "require app key to delete" on public.os_collab_links;

drop index if exists public.os_collab_links_expiry_idx;
drop table if exists public.os_collab_links;
