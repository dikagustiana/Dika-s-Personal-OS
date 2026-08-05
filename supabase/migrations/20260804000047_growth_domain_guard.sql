-- ===========================================================================
-- CLOSE THE GROWTH DOMAIN GAP: A WRONG GRANT MUST FAIL, IN THREE LAYERS.
-- ===========================================================================
-- Slice 1 replaced the engagement predicate with pure membership and dropped
-- the `domain` condition on purpose. Dropping `engagement` was correct;
-- dropping `domain` was not, because the two protect against DIFFERENT
-- failures: membership fails closed against the ABSENCE of a grant, and does
-- nothing against a WRONG grant. One mis-click in the collaborator panel
-- would have exposed a GROWTH project row — all 16 GROWTH rows carry real
-- milestone content — and the same gap ran downstream into os_tasks, whose
-- member policies consume the same function. That violates the invariant
-- held since the first migration: GROWTH is never reachable by an
-- authenticated non-owner through any code path.
--
-- Three layers, deliberately redundant:
--
--   1. THE GRANT ITSELF FAILS. A trigger on os_project_members refuses any
--      non-WORK project — INCLUDING FROM THE OWNER PATH. GROWTH isolation is
--      not a permission the owner can spend; it is a property of the schema.
--      If a GROWTH project ever genuinely needs sharing, the escape hatch is
--      a migration — a deliberate act with a diff, not a click in a panel.
--   2. THE FUNCTION FILTERS. os_member_projects() joins os_projects and
--      keeps only domain='work', so every consumer — the projects policy,
--      all three task policies, anything added later — inherits the guard in
--      one place, still as ONE InitPlan evaluation per query. This holds
--      even if a GROWTH membership row somehow exists in spite of layer one
--      (say, a project whose domain is flipped AFTER a grant): the row is
--      inert. The task policies carry no domain condition BY DESIGN — they
--      consume this function; do not add a redundant join later thinking
--      the omission was an oversight.
--   3. THE POLICY SAYS IT OUT LOUD. `member reads granted projects` gains an
--      explicit `domain = 'work'` conjunct. Redundant given layer two, and
--      kept anyway: it is a column check on the row already being filtered,
--      so it costs nothing, and it makes the intent readable in the policy
--      list. THE SECOND DELIBERATE POLICY REPLACEMENT in this project
--      (the first: 20260804000045) — recorded in REVIEW.md, with a
--      down-migration restoring the slice-1 predicate verbatim.
--
-- The panel's work-only picker remains what it always was: convenience.
-- These three layers are the boundary.
--
-- Standing check: integrity_checks.sql gains a zero-rows-when-healthy check
-- for membership rows whose project is not WORK (the domain-flip case that
-- layer one cannot see).
--
-- APPLIED 2026-08-05 via the Supabase apply_migration tool (ledger name
-- `growth_domain_guard`). NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260804000047_growth_domain_guard_down.sql

-- 1. Layer one: the grant itself fails ---------------------------------------
create or replace function public.os_project_members_domain_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_domain text;
begin
  select p.domain into project_domain
  from public.os_projects p
  where p.id = new.project_id;

  -- Distinct message when the id does not resolve at all: the FK would also
  -- refuse it, but this trigger fires first and should say what it saw.
  if project_domain is null then
    raise exception 'project membership: % does not resolve to a project', new.project_id;
  end if;

  if project_domain <> 'work' then
    raise exception 'project membership: only WORK projects are grantable — % is %; sharing a growth project requires a migration, not a grant',
      new.project_id, project_domain;
  end if;

  return new;
end;
$$;

-- A trigger function is invoked by the trigger machinery, which does not
-- check the caller's EXECUTE privilege — no client role needs, or should
-- have, any grant on it (the 20260804000041 lesson).
revoke all on function public.os_project_members_domain_guard() from public;
revoke all on function public.os_project_members_domain_guard() from anon;
revoke all on function public.os_project_members_domain_guard() from authenticated;

drop trigger if exists os_project_members_domain_guard on public.os_project_members;
create trigger os_project_members_domain_guard
  before insert or update on public.os_project_members
  for each row execute function public.os_project_members_domain_guard();

-- 2. Layer two: the guard lives in the function ------------------------------
-- Same signature, same posture, same grants; the body now joins os_projects
-- and keeps WORK only. Still one InitPlan per query — a join inside a STABLE
-- function evaluated once, not a per-row exists.
create or replace function public.os_member_projects()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.project_id), '{}')
  from public.os_project_members m
  join public.os_projects p on p.id = m.project_id
  where m.user_id = (select auth.uid())
    and p.domain = 'work'
$$;

comment on function public.os_member_projects() is
  'WORK project ids the calling JWT holds membership for; {} for anon and for the owner passphrase path. The domain filter lives HERE so every consumer (projects policy, task policies, later slices) inherits it — task policies carry no domain condition by design. SECURITY DEFINER; call wrapped as (select ...) so it is an InitPlan, never per-row.';

revoke all on function public.os_member_projects() from public;
revoke all on function public.os_member_projects() from anon;
grant execute on function public.os_member_projects() to authenticated;

-- 3. Layer three: the policy says it out loud --------------------------------
drop policy if exists "member reads granted projects" on public.os_projects;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_projects'
                 and policyname = 'member reads granted projects') then
    create policy "member reads granted projects" on public.os_projects
      for select to authenticated
      using (domain = 'work'
             and id = any ((select public.os_member_projects())::uuid[]));
  end if;
end
$$;
