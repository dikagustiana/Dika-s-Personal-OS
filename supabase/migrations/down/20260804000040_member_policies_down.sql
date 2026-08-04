-- Down-migration for 20260804000040_member_policies.
-- Run FIRST when unwinding this task (before C, B, A): these policies
-- reference os_member_entities() and os_projects.engagement. Dropping them
-- returns every table to the exact four-policy owner-only baseline recorded
-- in docs/preflight-collab.md.

drop policy if exists "member reads own-entity cells"   on public.os_finish_line_cells;
drop policy if exists "member updates own-entity cells" on public.os_finish_line_cells;
drop policy if exists "member reads items"              on public.os_finish_line_items;
drop policy if exists "member reads entities"           on public.os_finish_line_entities;
drop policy if exists "member reads account map"        on public.os_finish_line_account_map;
drop policy if exists "member reads own-entity deps"    on public.os_finish_line_deps;
drop policy if exists "member reads own-entity edges"   on public.os_finish_line_item_projects;
drop policy if exists "member reads samb work projects" on public.os_projects;
