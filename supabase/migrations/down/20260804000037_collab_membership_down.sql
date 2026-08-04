-- Down-migration for 20260804000037_collab_membership.
-- Run AFTER 20260804000040_member_policies_down.sql — the Migration D
-- policies reference os_member_entities() and must be gone before the
-- function is dropped. Destroys membership rows; they are manual inserts
-- (see README) and must be re-created by the owner if this is ever re-run.

drop policy if exists "member reads own membership" on public.os_entity_members;
drop policy if exists "require app key to select" on public.os_entity_members;
drop policy if exists "require app key to insert" on public.os_entity_members;
drop policy if exists "require app key to update" on public.os_entity_members;
drop policy if exists "require app key to delete" on public.os_entity_members;
drop function if exists public.os_member_entities();
drop table if exists public.os_entity_members;
