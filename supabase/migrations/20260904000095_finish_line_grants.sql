-- ===========================================================================
-- FINISH LINE GRANTS: ACCESS BECOMES (PERSON, ENTITY, SECTION, CAPABILITY).
-- ===========================================================================
-- Until this file a collaborator's access to the Finish line was one fact,
-- os_entity_members (user, entity), and that fact implied READ AND WRITE OVER
-- EVERY CELL OF THE ENTITY. Two people on the same entity could not be told
-- apart, nobody could be read-only, and nothing narrower than an entity could
-- be expressed. Share links cannot fill that gap: they are anonymous and
-- read-only by design (20260731000036).
--
-- This migration introduces the grant row — (user, entity, section,
-- capability) in public.os_finish_line_grants — makes the member policies on
-- os_finish_line_cells derive from it, and gives os_finish_line_accounts the
-- member SELECT policy it never had. It goes straight to the final shape in
-- one file: os_entity_members holds 19 rows and os_project_members holds
-- none, so a two-step migration would buy nothing but a second window to
-- get wrong.
--
-- ===========================================================================
-- THE DECISIONS THIS FILE ENCODES, AND WHY EACH ONE IS THE WAY IT IS
-- ===========================================================================
--  D1  THE UNIT OF SCOPE IS THE SECTION. Not the cell (53 x 7 = 371 of them,
--      no human can administer that), and not the project: the item ↔
--      project mapping is many-to-many and would scatter a person's scope
--      into fragments nobody can enumerate on a screen.
--  D2  EXPLICIT ROWS, NO WILDCARD. section_id is NOT NULL. A whole-entity
--      grant is one row per section. A null that means "everything" is the
--      fastest way to build an access dashboard that lies.
--  D3  UNMAPPED ACCOUNTS (cell_id null) ARE READABLE BY ANYONE HOLDING ANY
--      GRANT ON THAT ENTITY. share-view already argues this: hiding them makes
--      coverage look better than it is, and the unmapped list is exactly
--      what the people in the field need most.
--  D4  THE FOUR METRICS WITH NO PARENT SECTION STAY OUTSIDE EVERY GRANT. No
--      shadow section, no adoption by the nearest one: coalesce(parent_id,
--      id) resolves to the metric itself, which no grant can name (the guard
--      below refuses non-section ids), so those cells fail closed to the
--      owner. Their names are in the PR so they can be decided separately.
--      READ THE VERIFICATION NOTE BELOW: this is the one place the backfill
--      does not preserve today's access byte for byte.
--  D5  A NEW SECTION IS GRANTED TO NOBODY until the owner grants it. Fail
--      closed, like every other absence in this schema. "Grant every section"
--      is a panel action, never an implicit default.
--  D6  os_finish_line_accounts STAYS READ-ONLY FOR MEMBERS. One member SELECT
--      policy is added; no member INSERT/UPDATE/DELETE. The workbook owns
--      data_ideal / driver_type / driver_source / pic / business / is_dummy
--      and the app never edits them (table comment, 20260728000029).
--  D7  CAPABILITY LIVES ON THE GRANT ROW, NOT ON os_entity_members.role. One
--      person may read one section and write another; a role column cannot
--      say that. role is left exactly as it is.
--
-- MEMBERSHIP STAYS, AS THE ENROLMENT. os_entity_members is not dropped and
-- os_member_entities() is not edited: the process tables, the item and entity
-- structure reads and the entity picker still hang off it. What changes is
-- that membership no longer implies any CELL: cells and accounts come from
-- grants, and a grant REQUIRES a matching membership row — a composite FK to
-- os_entity_members(user_id, entity_code), on delete cascade, so a grant can
-- never outlive the enrolment it belongs to and revoking membership takes
-- the grants with it. That FK is this file's own decision, not the brief's.
--
-- ===========================================================================
-- THE VERIFICATION NOTE — WHAT THE BACKFILL PRESERVES, EXACTLY
-- ===========================================================================
-- Every os_entity_members row becomes one WRITE grant per section (19 rows x
-- 5 sections = 95 grants on live). For every member, every cell they read
-- today whose metric sits under a section is readable AND writable after
-- this file — the post-condition in section 9 refuses to commit otherwise.
-- The cells they lose are exactly the ones D4 names: 4 parentless metrics x
-- the entities they hold (28 for a seven-entity member, 20 for a five-entity
-- one, measured read-only on live before writing this). Those cells were
-- member-visible until now; D4 says they must not be. Both facts are stated
-- here so the owner decides with the numbers in front of them rather than
-- discovering the delta later. The NOTICE per user at the end prints them.
--
-- ===========================================================================
-- RLS SHAPE, AND THE TWO RULES THAT HAVE OUTAGES BEHIND THEM
-- ===========================================================================
-- The three new lookup functions mirror os_member_entities(): SECURITY
-- DEFINER, `set search_path = ''`, array-returning, called inside policies
-- as `any ((select public.fn())::type[])` so they run ONCE per statement as
-- an InitPlan (20260728000030 — the per-row bcrypt 500). Every new member
-- policy is `to authenticated`, which means `anon` never evaluates them and
-- the functions need EXECUTE for `authenticated` only (20260806000057 — the
-- 7 August outage — is what happens when a `to public` policy calls a
-- function anon cannot execute). Both facts are pinned by
-- supabase/tests/rls_function_grants.sql on every replay.
--
-- THE FOUR `require app key to …` POLICIES ON CELLS AND ACCOUNTS ARE NOT
-- TOUCHED. Section 1 snapshots them and section 9 refuses to commit if they
-- moved. The owner's path is byte-identical before and after.
--
-- The write-guard trigger on cells (20260804000039) is deliberately left as
-- it is: RLS decides WHICH rows a member may update (writable cells only), the
-- trigger decides WHAT an update may be. A read-only member's UPDATE matches
-- zero rows and never reaches the trigger.
--
-- ===========================================================================
-- NOT APPLIED. Idempotent throughout: create if not exists, create or
-- replace, policies dropped-if-exists before being recreated, backfill on
-- conflict do nothing. Safe to re-run.
--
-- APPLY BEFORE DEPLOY:
--   1. Apply once via the Supabase apply_migration tool, proposed ledger name
--      `finish_line_grants`. Read the NOTICE lines: one per member, with the
--      cells they read before, the cells they read after, and the
--      parentless-metric cells D4 moved to owner-only.
--   2. Run supabase/tests/rls_function_grants.sql and
--      supabase/tests/anon_definer_gates.sql against live (both read-only).
--      Zero rows each.
--   3. Run supabase/tests/collab_rls.sql against live (everything inside it
--      rolls back). It now seeds grants for its synthetic members and asserts
--      the grant model.
--   Nothing in the frontend changes shape in this stage; a contributor's
--   matrix simply shows the cells their grants reach, and their account
--   panel stops being empty.
-- NEVER apply with `supabase db push`, `migration up`, `db reset` or
-- `db remote commit` — this repo's filenames and the live ledger's versions
-- are different numbering schemes, so any of those replays the entire
-- history from 0001_schema.sql against live production data.
--
-- Down-migration:
-- supabase/migrations/down/20260904000095_finish_line_grants_down.sql
-- Drops the grants table and restores the two entity-wide member policies.
-- Any grant narrower than "every section, write" authored after apply is
-- destroyed by that; membership then reads entity-wide again.

-- 1. Snapshot the owner policies, so section 9 can prove they did not move --
create temp table if not exists os_fl_grants_policy_snapshot as
select tablename, policyname, cmd, roles::text as roles,
       coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('os_finish_line_cells', 'os_finish_line_accounts')
  and policyname like 'require app key%';

-- 2. The grant table -----------------------------------------------------------
create table if not exists public.os_finish_line_grants (
  user_id     uuid not null references auth.users(id) on delete cascade,
  entity_code text not null references public.os_finish_line_entities(code) on delete cascade,
  -- NOT NULL: no wildcard. See D2.
  section_id  uuid not null references public.os_finish_line_items(id) on delete cascade,
  -- write includes read. Checked by the policies, not by two rows.
  capability  text not null check (capability in ('read', 'write')),
  created_at  timestamptz not null default now(),
  -- 'owner' (passphrase path, no uid), a uuid, or 'backfill' for the rows this
  -- file derives from os_entity_members — the os_project_members convention.
  created_by  text not null,
  -- One capability per (person, entity, section): two rows that disagree
  -- cannot exist, and "upgrade to write" is an UPDATE, not a second row.
  primary key (user_id, entity_code, section_id),
  -- A grant requires the enrolment it refines. Cascade: revoking membership
  -- takes the grants with it, so no grant can outlive its membership.
  foreign key (user_id, entity_code)
    references public.os_entity_members(user_id, entity_code) on delete cascade
);

-- The PK covers user lookups. These cover the two FK cascades and the
-- dashboard's column axis.
create index if not exists os_finish_line_grants_section_idx
  on public.os_finish_line_grants (section_id);
create index if not exists os_finish_line_grants_entity_idx
  on public.os_finish_line_grants (entity_code, section_id);

comment on table public.os_finish_line_grants is
  'Who may read or write which Finish line cells, at the grain of (person, entity, section). One row per grant; capability is read or write, and write includes read. EXPLICIT ROWS ONLY (D2): section_id is NOT NULL and no value means "every section" — a whole-entity grant is one row per section, so the access dashboard can never show a scope the database does not literally hold. A NEW SECTION IS GRANTED TO NOBODY (D5): fail closed like every other absence here; "grant every section" is a panel action, never a default. CAPABILITY LIVES HERE, NOT ON os_entity_members.role (D7): one person may read one section and write another, which a role column cannot say. Membership remains the enrolment — a grant requires a matching os_entity_members row (FK, cascade) — and grants are the scope. Cells whose metric has no parent section are reachable by no grant (D4) and stay owner-only.';
comment on column public.os_finish_line_grants.section_id is
  'An os_finish_line_items row with kind = section — enforced by the os_finish_line_grants_section_guard trigger, because a foreign key cannot say which kind of item it points at. A grant on a metric or a note would mean nothing and look correct.';
comment on column public.os_finish_line_grants.capability is
  'read or write. write includes read: os_member_readable_cells() takes both, os_member_writable_cells() takes write alone.';
comment on column public.os_finish_line_grants.created_by is
  'Who created the grant: the literal ''owner'' (passphrase path, which carries no uid), a uuid, or ''backfill'' for the rows 20260904000095 derived from os_entity_members.';

-- 3. The section guard ---------------------------------------------------------
-- The FK proves the id is an item; only a trigger can prove it is a SECTION.
-- Without it one mis-pasted id makes a grant that grants nothing and shows no
-- error anywhere. SECURITY DEFINER so the lookup does not depend on the
-- caller's own read of os_finish_line_items; executable by no client role —
-- trigger firing does not check EXECUTE (20260804000041).
create or replace function public.os_finish_line_grants_section_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_kind text;
begin
  select i.kind into found_kind
    from public.os_finish_line_items i
   where i.id = new.section_id;
  if found_kind is distinct from 'section' then
    raise exception
      'finish line grants: section_id % is %, and a grant must name an item with kind = ''section''',
      new.section_id, coalesce('kind ' || quote_literal(found_kind), 'no item at all')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.os_finish_line_grants_section_guard() from public;
revoke all on function public.os_finish_line_grants_section_guard() from anon;
revoke all on function public.os_finish_line_grants_section_guard() from authenticated;

drop trigger if exists os_finish_line_grants_section_guard on public.os_finish_line_grants;
create trigger os_finish_line_grants_section_guard
  before insert or update of section_id on public.os_finish_line_grants
  for each row execute function public.os_finish_line_grants_section_guard();

-- 4. RLS on the grant table ----------------------------------------------------
-- The membership shape (20260804000037): four owner policies, SELECT on
-- os_key_valid() ALONE — the share read-only key has no business enumerating
-- who may see what — plus a member's read of their OWN rows, so the app can
-- tell a read-only person they are read-only instead of letting them find out
-- from a write that matches nothing. No member write path exists.
alter table public.os_finish_line_grants enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_grants'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_finish_line_grants
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_grants'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_finish_line_grants
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_grants'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_finish_line_grants
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_grants'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_finish_line_grants
      for delete using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_grants'
                 and policyname = 'member reads own grants') then
    create policy "member reads own grants" on public.os_finish_line_grants
      for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end
$$;

-- 5. Backfill: every membership becomes one WRITE grant per section -----------
-- Nobody loses a section they hold today. Idempotent through the PK.
insert into public.os_finish_line_grants (user_id, entity_code, section_id, capability, created_by)
select m.user_id, m.entity_code, s.id, 'write', 'backfill'
from public.os_entity_members m
cross join public.os_finish_line_items s
where s.kind = 'section'
on conflict (user_id, entity_code, section_id) do nothing;

-- 6. The lookup functions --------------------------------------------------------
-- All three: SECURITY DEFINER over the caller's own auth.uid(), '{}' when
-- there is no JWT (anon, and the owner passphrase path), array-returning so a
-- policy evaluates them once per statement. The cell join is
--   grant.section_id = coalesce(item.parent_id, item.id)
-- so a metric resolves to its section and a parentless metric resolves to
-- itself — which no grant can name (section 3), so it is unreachable (D4).
create or replace function public.os_member_readable_cells()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct c.id), '{}')
  from public.os_finish_line_grants g
  join public.os_finish_line_items i
    on coalesce(i.parent_id, i.id) = g.section_id
  join public.os_finish_line_cells c
    on c.item_id = i.id
   and c.entity_code = g.entity_code
  where g.user_id = (select auth.uid())
$$;

create or replace function public.os_member_writable_cells()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct c.id), '{}')
  from public.os_finish_line_grants g
  join public.os_finish_line_items i
    on coalesce(i.parent_id, i.id) = g.section_id
  join public.os_finish_line_cells c
    on c.item_id = i.id
   and c.entity_code = g.entity_code
  where g.user_id = (select auth.uid())
    and g.capability = 'write'
$$;

-- The entities on which the caller holds ANY grant — the D3 branch for
-- unmapped accounts. Deliberately NOT os_member_entities(): membership can
-- outlive every grant (revoke-scope removes grants, not enrolment), and a
-- person with an enrolment and no grant must see no account at all.
create or replace function public.os_member_granted_entities()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct g.entity_code), '{}')
  from public.os_finish_line_grants g
  where g.user_id = (select auth.uid())
$$;

comment on function public.os_member_readable_cells() is
  'Cell ids the calling JWT may read: every cell whose metric sits under a section the caller holds a grant on (read or write) for that entity. {} without a JWT. SECURITY DEFINER; call it wrapped as (select ...) so it is an InitPlan, never per-row.';
comment on function public.os_member_writable_cells() is
  'Cell ids the calling JWT may update: as os_member_readable_cells() but capability = write only. {} without a JWT. Wrap as (select ...).';
comment on function public.os_member_granted_entities() is
  'Entity codes on which the calling JWT holds at least one grant of any capability — what makes an unmapped account (cell_id null) of that entity readable (D3). Not membership: an enrolment with no grant yields {}.';

-- Every new member policy is `to authenticated`, so `authenticated` is the only
-- role that ever evaluates these. anon gets nothing; the rule is checked by
-- rls_function_grants.sql on every replay.
revoke all on function public.os_member_readable_cells()   from public;
revoke all on function public.os_member_readable_cells()   from anon;
grant execute on function public.os_member_readable_cells()   to authenticated;
revoke all on function public.os_member_writable_cells()   from public;
revoke all on function public.os_member_writable_cells()   from anon;
grant execute on function public.os_member_writable_cells()   to authenticated;
revoke all on function public.os_member_granted_entities() from public;
revoke all on function public.os_member_granted_entities() from anon;
grant execute on function public.os_member_granted_entities() to authenticated;

-- 7. Cells: the two member policies now read the grant table -------------------
-- Replaced, not edited in place, and renamed: "own-entity" is no longer what
-- they say. The four `require app key to …` policies beside them are not
-- touched (section 9 proves it).
drop policy if exists "member reads own-entity cells"   on public.os_finish_line_cells;
drop policy if exists "member updates own-entity cells" on public.os_finish_line_cells;
drop policy if exists "member reads granted cells"      on public.os_finish_line_cells;
drop policy if exists "member updates writable cells"   on public.os_finish_line_cells;

create policy "member reads granted cells" on public.os_finish_line_cells
  for select to authenticated
  using (id = any ((select public.os_member_readable_cells())::uuid[]));

create policy "member updates writable cells" on public.os_finish_line_cells
  for update to authenticated
  using (id = any ((select public.os_member_writable_cells())::uuid[]))
  with check (id = any ((select public.os_member_writable_cells())::uuid[]));

-- 8. Accounts: the member SELECT policy that never existed (D6, D3) ------------
-- Until now a signed-in collaborator saw cells and NO account beneath them:
-- the table carried os_key_valid() / os_read_key_valid() and nothing else.
-- SELECT only. The unmapped branch is a function, not scope logic rewritten
-- inside the policy. An unmapped account with entity_code NULL (4 on live)
-- matches neither branch and stays owner-only — it has no entity to grant.
drop policy if exists "member reads granted accounts" on public.os_finish_line_accounts;
create policy "member reads granted accounts" on public.os_finish_line_accounts
  for select to authenticated
  using (
    cell_id = any ((select public.os_member_readable_cells())::uuid[])
    or (
      cell_id is null
      and entity_code = any ((select public.os_member_granted_entities())::text[])
    )
  );

-- 9. Post-conditions, refused in-transaction ---------------------------------
do $$
declare
  missing   bigint;
  moved     bigint;
  r         record;
begin
  -- 9a. Every (membership, section) pair holds a grant.
  select count(*) into missing
  from public.os_entity_members m
  cross join public.os_finish_line_items s
  where s.kind = 'section'
    and not exists (
      select 1 from public.os_finish_line_grants g
      where g.user_id = m.user_id
        and g.entity_code = m.entity_code
        and g.section_id = s.id
    );
  if missing <> 0 then
    raise exception 'finish_line_grants: % (membership, section) pair(s) received no grant — the backfill is incomplete', missing;
  end if;

  -- 9b. No grant points at anything but a section (the trigger's promise,
  --     re-checked as data because the backfill filtered on kind itself).
  select count(*) into moved
  from public.os_finish_line_grants g
  join public.os_finish_line_items s on s.id = g.section_id
  where s.kind <> 'section';
  if moved <> 0 then
    raise exception 'finish_line_grants: % grant(s) name a non-section item', moved;
  end if;

  -- 9c. Per member: cells readable after == cells readable before minus the
  --     parentless-metric cells D4 makes owner-only. Anything else lost is a
  --     bug, and the migration refuses.
  for r in
    select m.user_id,
      (select count(*)
         from public.os_finish_line_cells c
         join public.os_entity_members em
           on em.user_id = m.user_id and em.entity_code = c.entity_code) as before_cells,
      (select count(distinct c.id)
         from public.os_finish_line_cells c
         join public.os_finish_line_items i on i.id = c.item_id
         join public.os_finish_line_grants g
           on g.user_id = m.user_id
          and g.entity_code = c.entity_code
          and g.section_id = coalesce(i.parent_id, i.id)) as after_cells,
      (select count(*)
         from public.os_finish_line_cells c
         join public.os_finish_line_items i on i.id = c.item_id
         join public.os_entity_members em
           on em.user_id = m.user_id and em.entity_code = c.entity_code
        where i.parent_id is null) as parentless_cells
    from (select distinct user_id from public.os_entity_members) m
  loop
    if r.after_cells <> r.before_cells - r.parentless_cells then
      raise exception
        'finish_line_grants: member % would read % cells after, expected % (% before minus % on parentless metrics)',
        left(r.user_id::text, 8), r.after_cells, r.before_cells - r.parentless_cells,
        r.before_cells, r.parentless_cells;
    end if;
    raise notice
      'finish_line_grants: member % — cells readable before %, after %, parentless-metric cells now owner-only % (D4)',
      left(r.user_id::text, 8), r.before_cells, r.after_cells, r.parentless_cells;
  end loop;

  -- 9d. The owner policies on cells and accounts are byte-identical to the
  --     snapshot taken before anything ran.
  select count(*) into moved from (
    (select tablename, policyname, cmd, roles::text, coalesce(qual, ''), coalesce(with_check, '')
       from pg_policies
      where schemaname = 'public'
        and tablename in ('os_finish_line_cells', 'os_finish_line_accounts')
        and policyname like 'require app key%'
     except
     select tablename, policyname, cmd, roles, qual, with_check from os_fl_grants_policy_snapshot)
    union all
    (select tablename, policyname, cmd, roles, qual, with_check from os_fl_grants_policy_snapshot
     except
     select tablename, policyname, cmd, roles::text, coalesce(qual, ''), coalesce(with_check, '')
       from pg_policies
      where schemaname = 'public'
        and tablename in ('os_finish_line_cells', 'os_finish_line_accounts')
        and policyname like 'require app key%')
  ) d;
  if moved <> 0 then
    raise exception 'finish_line_grants: an owner policy on cells or accounts changed — refusing';
  end if;

  raise notice 'finish_line_grants: % grants over % memberships and % sections',
    (select count(*) from public.os_finish_line_grants),
    (select count(*) from public.os_entity_members),
    (select count(*) from public.os_finish_line_items where kind = 'section');
end
$$;

drop table if exists os_fl_grants_policy_snapshot;
