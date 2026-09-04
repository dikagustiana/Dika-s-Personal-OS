-- Down-migration for 20260904000098_collab_link_status.
-- Drops the set-returning reader. The provisioning function falls back to
-- os_collab_link_minted_at(uuid) (072, untouched by 098) for the mint instant
-- it stamps on a fresh link, and reports the link status of every listed
-- collaborator from the filed row alone, or as `unknown` when none was filed.

drop function if exists public.os_collab_link_status(uuid[]);
