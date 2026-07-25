-- Pinned projects for the WORK dashboard.
--
-- The dashboard's project card shows a set the owner chooses, not a ranking.
-- With 27 active projects any automatic ordering floods with close-cycle rows
-- the moment a cycle opens, which is most of the month — so the selection is
-- explicit and stored.
--
-- One boolean, defaulting to false: nothing is pinned until the owner pins
-- it, and no existing row changes meaning. Close-cycle projects
-- (recurring = 'monthly') are excluded in the UI rather than here — the
-- column stays a plain flag and the policy about what may be pinned lives in
-- one place, in the app.
--
-- No RLS change: os_projects already carries the "require app key" policy,
-- which covers every column of the table.
--
-- Idempotent: re-running against a database that already has the column is a
-- no-op.

alter table public.os_projects
  add column if not exists dashboard_pinned boolean not null default false;

-- ---------------------------------------------------------------------------
-- Post-apply verification. Not run by the migration — paste it into the SQL
-- editor afterwards. `pinned` must be 0 and `projects` unchanged at 27: this
-- migration adds a capability, it does not pin anything.
--
--   select count(*)                                  as projects,
--          count(*) filter (where dashboard_pinned)  as pinned
--   from public.os_projects;
-- ---------------------------------------------------------------------------
