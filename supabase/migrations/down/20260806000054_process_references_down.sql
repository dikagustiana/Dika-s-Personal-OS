-- Down-migration for 20260806000054_process_references.
-- Drops the reading list outright. Nothing else in the schema points at it —
-- the table references nothing and is referenced by nothing — so this cannot
-- cascade into the process tables or the Finish line. Any hand-added rows are
-- lost; they exist nowhere else, so export os_process_references first if the
-- list has grown beyond the seeded row.

drop policy if exists "require app key to select" on public.os_process_references;
drop policy if exists "require app key to insert" on public.os_process_references;
drop policy if exists "require app key to update" on public.os_process_references;
drop policy if exists "require app key to delete" on public.os_process_references;
drop table if exists public.os_process_references;
