-- Down-migration for 20260804000045_project_policy_replace.
-- Run AFTER 20260804000046_tasks_with_history_down.sql and BEFORE
-- 20260804000044_project_membership_down.sql. Drops the per-project policy
-- and restores the engagement-based policy exactly as 20260804000040 created
-- it — which means collaborators holding any entity membership regain read
-- on ALL SAMB WORK projects, the broad allow slice 1 removed on purpose.

drop policy if exists "member reads granted projects" on public.os_projects;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_projects'
                 and policyname = 'member reads samb work projects') then
    create policy "member reads samb work projects" on public.os_projects
      for select to authenticated
      using (domain = 'work'
             and engagement = 'samb'
             and (select public.os_member_entities()) <> '{}'::text[]);
  end if;
end
$$;
