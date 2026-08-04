-- ===========================================================================
-- MEMBERSHIP: WHICH AUTH USER CONTRIBUTES TO WHICH CONSOLIDATION ENTITY.
-- ===========================================================================
-- First migration of the collaborator-access task. Everything here is
-- ADDITIVE: no existing policy or function is edited or dropped, the owner
-- passphrase path is untouched, and until Migration D lands a row in this
-- table grants nothing at all — the member policies do not exist yet.
--
-- NOTHING IS SEEDED. This table holds real colleagues' identities and the
-- repo is public. The first membership is one manual SQL insert, documented
-- in the README beside the passphrase statement, run by the owner against
-- production — the same channel the passphrase itself uses.
--
-- ONE ROLE, HARDCODED. 'contributor' is the only value the check accepts.
-- Generalising to a roles table is deliberately out of scope until a second
-- role actually exists.
--
-- APPLIED 2026-08-04 via the Supabase apply_migration tool (ledger name
-- `collab_membership`). NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit` — repo filenames and the live ledger use
-- different numbering, so any of those replays the entire history from
-- 0001_schema.sql against live production data.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260804000037_collab_membership_down.sql
-- (run down files in reverse order, D → A: the Migration D policies call
-- os_member_entities() and must be dropped before the function is).

create table if not exists public.os_entity_members (
  user_id     uuid not null references auth.users(id) on delete cascade,
  entity_code text not null references public.os_finish_line_entities(code) on delete cascade,
  role        text not null default 'contributor' check (role in ('contributor')),
  created_at  timestamptz not null default now(),
  primary key (user_id, entity_code)
);

-- The policy predicates filter on entity_code; user_id lookups ride the PK.
create index if not exists os_entity_members_entity_idx
  on public.os_entity_members (entity_code);

comment on table public.os_entity_members is
  'Which auth user contributes to which Finish Line entity. Never seeded by a migration: rows are real colleagues, inserted manually by the owner (see README). One role, contributor, hardcoded until a second role exists.';

alter table public.os_entity_members enable row level security;

-- Owner: full access via the passphrase header, exactly the house pattern —
-- EXCEPT that SELECT is os_key_valid() only. The share read-only key
-- (os_read_key_valid) deliberately does NOT read membership: a share
-- credential has no business enumerating who works here.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_entity_members'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_entity_members
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_entity_members'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_entity_members
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_entity_members'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_entity_members
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_entity_members'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_entity_members
      for delete using ((select public.os_key_valid()));
  end if;
  -- A member sees only their own membership rows. No member write path exists:
  -- there is deliberately no INSERT/UPDATE/DELETE policy for authenticated.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_entity_members'
                 and policyname = 'member reads own membership') then
    create policy "member reads own membership" on public.os_entity_members
      for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- THE LOOKUP HELPER. Array-returning so a policy predicate is ONE InitPlan
-- evaluation per query rather than per-row work — the bcrypt lesson
-- (migration 20260728000030) restated for the membership path. Inside every
-- policy it is called as `any ((select public.os_member_entities()))`; the
-- inner select is mandatory, without it the function runs per row.
--
-- Returns '{}' when auth.uid() is null — which is the owner passphrase path
-- (anon role, no JWT) — so the function is inert for the owner rather than a
-- special case.
-- ---------------------------------------------------------------------------
create or replace function public.os_member_entities()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(entity_code), '{}')
  from public.os_entity_members
  where user_id = (select auth.uid())
$$;

comment on function public.os_member_entities() is
  'Entity codes the calling JWT holds membership for; {} for anon and for the owner passphrase path. SECURITY DEFINER so policies get one indexed lookup; call it wrapped as (select ...) so it is an InitPlan, never per-row.';

-- anon can never hold membership, so anon gets no execute. The member
-- policies are `to authenticated`, which is the only role that evaluates
-- this function.
revoke all on function public.os_member_entities() from public;
revoke all on function public.os_member_entities() from anon;
grant execute on function public.os_member_entities() to authenticated;
