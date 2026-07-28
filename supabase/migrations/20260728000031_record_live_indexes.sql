-- ===========================================================================
-- RECORD TWO INDEXES THAT EXIST LIVE BUT IN NO MIGRATION FILE.
-- ===========================================================================
-- A schema audit diffed a fresh apply of every migration against production:
-- tables, views, functions and all 202 columns matched exactly. Two indexes
-- did not — they were applied directly to the live database at some point and
-- never written down. This file records them so the repo describes
-- production; on the live database both statements are no-ops.
--
--   os_finish_line_item_projects_uniq
--     Uniqueness of a link row by CELL (cell_id, project_id, milestone_id,
--     nulls not distinct). The migrated os_finish_line_item_projects_unique_link
--     enforces the same idea by ITEM — both exist live and both are kept
--     here: dropping either changes write behaviour, which is a decision,
--     not a recording.
--
--   os_projects_dashboard_pinned_idx
--     Partial index over the pinned flag, matching the dashboard's read.

create unique index if not exists os_finish_line_item_projects_uniq
  on public.os_finish_line_item_projects (cell_id, project_id, milestone_id)
  nulls not distinct;

create index if not exists os_projects_dashboard_pinned_idx
  on public.os_projects (dashboard_pinned)
  where dashboard_pinned;
