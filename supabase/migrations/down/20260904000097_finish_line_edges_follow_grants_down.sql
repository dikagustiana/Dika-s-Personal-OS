-- Down-migration for 20260904000097_finish_line_edges_follow_grants.
-- Restores the two entity-wide member policies from 20260804000040 verbatim:
-- a member reads the deps and edges of every cell in an entity they are
-- enrolled in, whatever their grants say. Run 095's down file AFTER this one
-- if unwinding both — 095 drops os_member_readable_cells(), which the
-- policies this file removes still name.

drop policy if exists "member reads granted deps"  on public.os_finish_line_deps;
drop policy if exists "member reads granted edges" on public.os_finish_line_item_projects;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_deps'
                 and policyname = 'member reads own-entity deps') then
    create policy "member reads own-entity deps" on public.os_finish_line_deps
      for select to authenticated
      using (exists (
        select 1 from public.os_finish_line_cells c
        where c.id = cell_id
          and c.entity_code = any ((select public.os_member_entities())::text[])
      ));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_item_projects'
                 and policyname = 'member reads own-entity edges') then
    create policy "member reads own-entity edges" on public.os_finish_line_item_projects
      for select to authenticated
      using (exists (
        select 1 from public.os_finish_line_cells c
        where c.id = cell_id
          and c.entity_code = any ((select public.os_member_entities())::text[])
      ));
  end if;
end
$$;
