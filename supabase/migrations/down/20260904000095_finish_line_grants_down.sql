-- Down-migration for 20260904000095_finish_line_grants.
--
-- Returns the Finish line to membership-scoped access: the two entity-wide
-- member policies from 20260804000040 come back on os_finish_line_cells, the
-- member SELECT policy on os_finish_line_accounts goes (members read no
-- account again — the pre-095 bug, restored faithfully), the three lookup
-- functions and the section guard go, and the grant table is dropped.
--
-- WHAT THIS DESTROYS. Every grant row. The backfilled rows are recomputable
-- (they were derived from os_entity_members, which stays), but any grant
-- authored AFTER the apply that is narrower than "every section, write" —
-- a read-only person, a person holding two sections of seven — is lost, and
-- membership then reads the whole entity again for them. Export
-- os_finish_line_grants first if any such row exists.
--
-- The four parentless-metric cells per entity become member-visible again,
-- which is what they were before 095.
--
-- Order matters: the policies call the functions, so policies go first; the
-- table's own policies and trigger go with the table.

drop policy if exists "member reads granted accounts" on public.os_finish_line_accounts;
drop policy if exists "member reads granted cells"    on public.os_finish_line_cells;
drop policy if exists "member updates writable cells" on public.os_finish_line_cells;

-- 20260804000040, verbatim.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_cells'
                 and policyname = 'member reads own-entity cells') then
    create policy "member reads own-entity cells" on public.os_finish_line_cells
      for select to authenticated
      using (entity_code = any ((select public.os_member_entities())::text[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_cells'
                 and policyname = 'member updates own-entity cells') then
    create policy "member updates own-entity cells" on public.os_finish_line_cells
      for update to authenticated
      using (entity_code = any ((select public.os_member_entities())::text[]))
      with check (entity_code = any ((select public.os_member_entities())::text[]));
  end if;
end
$$;

drop function if exists public.os_member_readable_cells();
drop function if exists public.os_member_writable_cells();
drop function if exists public.os_member_granted_entities();

drop trigger if exists os_finish_line_grants_section_guard on public.os_finish_line_grants;
drop function if exists public.os_finish_line_grants_section_guard();

drop table if exists public.os_finish_line_grants;
