-- Down-migration for 20260809000072_collab_link_minted_at.
-- Drops the mint-timestamp reader. Nothing is lost from the database: the
-- function reads auth.one_time_tokens and stores nothing.
--
-- What it costs is accuracy, not data. Without it the provisioning function
-- cannot reach GoTrue's own timestamp — PostgREST does not expose the auth
-- schema — and falls back to its own clock when filing os_collab_links.
-- created_at. The link still works and is still copyable; only the mint
-- instant becomes approximate.

drop function if exists public.os_collab_link_minted_at(uuid);
