-- ===========================================================================
-- REPLACE THE PROJECT POLICY: MEMBERSHIP-DRIVEN, NOT ENGAGEMENT-DRIVEN.
-- ===========================================================================
-- THE FIRST DELIBERATE REMOVAL OF A LIVE POLICY IN THIS PROJECT. Everything
-- before slice 1 was additive; this drops `member reads samb work projects`
-- (created in 20260804000040) and replaces it with a per-project grant. The
-- removal is intentional, it is the ONLY removal in the slice, and it is
-- recorded in REVIEW.md.
--
-- Why replaced rather than extended:
--   * The old predicate — domain='work' AND engagement='samb' AND "holds any
--     entity membership" — is a BROAD ALLOW: one entity grant exposed every
--     SAMB WORK project. Zero project members must read as zero projects.
--     Membership fails closed; an engagement predicate cannot.
--   * Hardcoding engagement='samb' would silently break the first time a
--     non-SAMB collaborator exists — confusing to diagnose, and it adds
--     nothing once the grant is explicit.
--
-- `engagement` is hereby demoted to a client attribute (grouping, reporting).
-- The owner's private WORK projects are simply projects with no members —
-- that replaces engagement='internal' as the visibility mechanism.
--
-- No `domain` condition either: a project the owner never granted is
-- invisible regardless of domain. GROWTH projects are protected the same way
-- everything else is — by the absence of a grant. The owner's four
-- `require app key to …` policies on os_projects are untouched, as is the
-- share read key's place in the owner SELECT policy.
--
-- The predicate wraps the helper as
-- `any ((select public.os_member_projects())::uuid[])` — the inner select
-- makes it ONE InitPlan evaluation per query (the live-500 lesson,
-- 20260728000030); the cast is the text[]/uuid[] lesson from Migration D.
--
-- APPLIED 2026-08-05 via the Supabase apply_migration tool (ledger name
-- `project_policy_replace`). NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Idempotent throughout. Down-migration restores the engagement-based policy
-- verbatim: supabase/migrations/down/20260804000045_project_policy_replace_down.sql

drop policy if exists "member reads samb work projects" on public.os_projects;

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
