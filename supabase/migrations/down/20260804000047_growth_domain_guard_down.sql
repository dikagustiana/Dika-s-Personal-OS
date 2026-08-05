-- Down-migration for 20260804000047_growth_domain_guard.
-- Run FIRST when unwinding (before the slice-1 downs). REOPENS THE GAP THIS
-- MIGRATION CLOSED: after this, a GROWTH project is grantable again and a
-- grant on one exposes the row to that member. Do not run casually.

-- Layer one: trigger + function gone.
drop trigger if exists os_project_members_domain_guard on public.os_project_members;
drop function if exists public.os_project_members_domain_guard();

-- Layer two: restore the unfiltered function, verbatim from 20260804000044.
create or replace function public.os_member_projects()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(project_id), '{}')
  from public.os_project_members
  where user_id = (select auth.uid())
$$;

comment on function public.os_member_projects() is
  'Project ids the calling JWT holds membership for; {} for anon and for the owner passphrase path. SECURITY DEFINER so policies get one indexed lookup; call it wrapped as (select ...) so it is an InitPlan, never per-row.';

revoke all on function public.os_member_projects() from public;
revoke all on function public.os_member_projects() from anon;
grant execute on function public.os_member_projects() to authenticated;

-- Layer three: restore the slice-1 policy, verbatim from 20260804000045.
drop policy if exists "member reads granted projects" on public.os_projects;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_projects'
                 and policyname = 'member reads granted projects') then
    create policy "member reads granted projects" on public.os_projects
      for select to authenticated
      using (id = any ((select public.os_member_projects())::uuid[]));
  end if;
end
$$;
