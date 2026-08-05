-- ===========================================================================
-- PROJECT MEMBERSHIP: THE SECOND TENANCY AXIS, INDEPENDENT OF THE FIRST.
-- ===========================================================================
-- Slice 1 of WORK collaboration. Finish Line cells tenant on entity_code and
-- that keeps working untouched; tasks belong to projects, and projects have
-- no reliable entity link (entity_tag is free text on 5 of 24 WORK rows). So
-- project access is its own grant: os_project_members beside
-- os_entity_members, os_member_projects() beside os_member_entities().
-- Neither axis is derived from the other — holding an entity grants no
-- project, holding a project grants no entity.
--
-- Everything here is ADDITIVE and inert until Migration I lands: no policy
-- reads this table yet, so a row grants nothing at all when this applies.
--
-- NOTHING IS SEEDED. Rows are real colleagues' identities and the repo is
-- public — memberships are created by the owner through the Kolaborator
-- panel (or manual SQL), the same channel entity memberships use.
--
-- ONE ROLE, HARDCODED, same as the entity axis: 'contributor' until a second
-- role actually exists.
--
-- APPLIED 2026-08-05 via the Supabase apply_migration tool (ledger name
-- `project_membership`). NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit` — repo filenames and the live ledger use
-- different numbering, so any of those replays the entire history from
-- 0001_schema.sql against live production data.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260804000044_project_membership_down.sql
-- (run down files in reverse order, J → I → H: the Migration I project
-- policy and the Migration J task policies call os_member_projects() and
-- must be dropped before the function is).

create table if not exists public.os_project_members (
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.os_projects(id) on delete cascade,
  role       text not null default 'contributor' check (role in ('contributor')),
  created_at timestamptz not null default now(),
  created_by text not null,
  primary key (user_id, project_id)
);

-- The policy predicates filter on project_id; user_id lookups ride the PK.
create index if not exists os_project_members_project_idx
  on public.os_project_members (project_id);

comment on table public.os_project_members is
  'Which auth user contributes to which project. The second tenancy axis, independent of os_entity_members: neither grant implies the other. Never seeded by a migration: rows are real colleagues, created by the owner. One role, contributor, hardcoded until a second role exists.';
comment on column public.os_project_members.created_by is
  'Who created the grant: the literal ''owner'' (passphrase path, which carries no uid) or a uuid — the actor_kind pattern collapsed into one text column.';

alter table public.os_project_members enable row level security;

-- Owner: full access via the passphrase header, exactly the house pattern —
-- EXCEPT that SELECT is os_key_valid() only. The share read-only key
-- (os_read_key_valid) deliberately does NOT read membership, same stance as
-- os_entity_members: a share credential has no business enumerating who
-- works here.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_project_members'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_project_members
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_project_members'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_project_members
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_project_members'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_project_members
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_project_members'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_project_members
      for delete using ((select public.os_key_valid()));
  end if;
  -- A member sees only their own membership rows. No member write path exists:
  -- there is deliberately no INSERT/UPDATE/DELETE policy for authenticated.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_project_members'
                 and policyname = 'member reads own membership') then
    create policy "member reads own membership" on public.os_project_members
      for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- THE LOOKUP HELPER. Mirrors os_member_entities() exactly: array-returning so
-- a policy predicate is ONE InitPlan evaluation per query rather than per-row
-- work — the bcrypt lesson (migration 20260728000030) restated for this axis.
-- Inside every policy it is called as
-- `any ((select public.os_member_projects())::uuid[])`; the inner select is
-- mandatory, without it the function runs per row.
--
-- Returns '{}' when auth.uid() is null — which is the owner passphrase path
-- (anon role, no JWT) — so the function is inert for the owner rather than a
-- special case.
-- ---------------------------------------------------------------------------
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

-- anon can never hold membership, so anon gets no execute. The member
-- policies are `to authenticated`, which is the only role that evaluates
-- this function.
revoke all on function public.os_member_projects() from public;
revoke all on function public.os_member_projects() from anon;
grant execute on function public.os_member_projects() to authenticated;
