-- Down-migration for 20260928000108_finish_line_simulation_bucket.sql
--
-- THIS FILE DELETES NOTHING, AND THAT IS THE ROLLBACK.
--
-- Live carries Supabase's own guard, protect_buckets_delete (BEFORE DELETE ON
-- storage.buckets, executing storage.protect_delete()), which refuses a SQL
-- DELETE on storage.buckets with 42501 unless storage.allow_delete_query is
-- set. The guard exists so a bucket row is never removed out from under its
-- objects — which is exactly what a SQL rollback would do here once a single
-- version has been uploaded, because versions are never deleted by the app.
-- Flipping that switch to get a tidy down file would be bypassing a guard in
-- order to orphan files; the owner decided against it (plan decision D2).
--
-- To roll back:
--   1. Dashboard → Storage → finish-line-simulation → Delete bucket. That goes
--      through the Storage API, which empties the bucket properly first.
--   2. Run this file. It changes nothing; it reports whether step 1 is done.
--   3. The tab then reads "tidak bisa dicek" (bucket-missing) — never the
--      empty state. The Edge Function tells the two apart.
--
-- 20260817000073's own down file still issues a DELETE against storage.buckets
-- and would be refused live the same way. Noted here, not changed.

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'storage schema absent (local replay) — nothing to roll back here';
  elsif exists (select 1 from storage.buckets where id = 'finish-line-simulation') then
    raise notice 'finish-line-simulation still exists — delete it from the Dashboard (Storage → Delete bucket); this file does not';
  else
    raise notice 'finish-line-simulation is gone — rollback complete';
  end if;
end
$$;
