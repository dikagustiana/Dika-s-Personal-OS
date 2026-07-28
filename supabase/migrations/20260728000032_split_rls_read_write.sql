-- ===========================================================================
-- SPLIT EVERY os_ TABLE'S POLICY INTO READ AND WRITE.
-- ===========================================================================
-- Every table had one FOR ALL policy, so any key that passes os_key_valid()
-- could insert, update and delete — not merely read. With one key and one
-- user nothing is exposed, but a second way in for other people is coming,
-- and under FOR ALL a reader could delete milestones. Not because they
-- would; because nothing stops them.
--
-- This migration changes NOTHING about who can do what today. Every new
-- predicate is the same ( select os_key_valid() ). It makes the read/write
-- distinction expressible, so a later change can tighten writes without
-- touching reads — one security change at a time, each verifiable alone.
--
-- One FOR ALL policy becomes FOUR, not two: Postgres allows exactly one
-- command per policy and no "all writes" command, so the write side is
-- INSERT + UPDATE + DELETE. The subquery wrapping stays on every predicate
-- including WITH CHECK — dropping it on the write path would reintroduce the
-- per-row bcrypt cost (the defect that produced a live 500) as a slow save.
--
-- Enumerated from pg_policy at execution time, not hardcoded: a table added
-- since this file was written gets the split too, and re-running is a no-op
-- (no FOR ALL policy calling os_key_valid survives the first run).
--
-- The DO block is atomic, and RLS without a policy denies rather than
-- exposes, so there is no window in which anything is reachable that was
-- not reachable before.
--
-- os_key_valid() itself is untouched: body, volatility, SECURITY DEFINER,
-- search_path all unchanged.

do $$
declare
  pol record;
begin
  for pol in
    select n.nspname as schema_name, c.relname as table_name, p.polname as policy_name
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and p.polcmd = '*'
      and pg_get_expr(p.polqual, p.polrelid) ilike '%os_key_valid%'
  loop
    execute format('drop policy %I on %I.%I',
                   pol.policy_name, pol.schema_name, pol.table_name);
    execute format(
      'create policy "require app key to select" on %I.%I for select
         using ((select public.os_key_valid()))',
      pol.schema_name, pol.table_name);
    execute format(
      'create policy "require app key to insert" on %I.%I for insert
         with check ((select public.os_key_valid()))',
      pol.schema_name, pol.table_name);
    execute format(
      'create policy "require app key to update" on %I.%I for update
         using ((select public.os_key_valid()))
         with check ((select public.os_key_valid()))',
      pol.schema_name, pol.table_name);
    execute format(
      'create policy "require app key to delete" on %I.%I for delete
         using ((select public.os_key_valid()))',
      pol.schema_name, pol.table_name);
    raise notice 'split policy on %.%', pol.schema_name, pol.table_name;
  end loop;
end $$;
