-- Down-migration for 20260804000044_project_membership.
-- Run LAST when unwinding slice 1 (after J and I): the Migration I project
-- policy and the Migration J task policies call os_member_projects() and
-- must be gone before the function is dropped. Destroys membership rows;
-- they are owner-created grants and must be re-created by the owner if this
-- is ever re-run.

drop policy if exists "member reads own membership" on public.os_project_members;
drop policy if exists "require app key to select" on public.os_project_members;
drop policy if exists "require app key to insert" on public.os_project_members;
drop policy if exists "require app key to update" on public.os_project_members;
drop policy if exists "require app key to delete" on public.os_project_members;
drop function if exists public.os_member_projects();
drop table if exists public.os_project_members;
