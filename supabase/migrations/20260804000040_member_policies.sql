-- ===========================================================================
-- THE MEMBER POLICIES: WHAT A CONTRIBUTOR JWT CAN REACH, STATED AS SQL.
-- ===========================================================================
-- All ADDITIVE. The four `require app key to …` policies on every table stay
-- byte-identical; these sit beside them and Postgres ORs permissive policies.
-- Every new policy is `to authenticated` (the owner's passphrase requests run
-- as anon and never evaluate these) and named with a `member ` prefix so the
-- inventory reads clearly against the existing set.
--
-- The predicate calls os_member_entities() wrapped as
-- `any ((select public.os_member_entities())::text[])` — the inner select is what
-- makes Postgres evaluate it ONCE per query as an InitPlan instead of per
-- row. Dropping the wrap reintroduces the per-row cost class that produced a
-- live 500 once already (see migration 20260728000030).
--
-- What deliberately gets NO member policy:
--   os_finish_line_accounts   — 560 rows of real chart of accounts, the most
--                               sensitive layer in the matrix. Owner-only.
--                               The app renders the member's empty result as
--                               a clean empty state.
--   every GROWTH table        — not scoped, not filtered: ABSENT. GROWTH
--                               isolation is the absence of a policy, not a
--                               predicate that could be misconfigured.
--   os_entries / daily logs / weekly plans — same reasoning.
--   cells INSERT and DELETE   — matrix structure is the owner's. Cell-grain
--                               writes only, and only UPDATE.
--
-- Structure tables (items, entities, account map) are readable UNFILTERED to
-- any user who holds at least one membership: a member cannot render their
-- own column without the row and column headers. Cell-grain rows are what
-- carry entity data, and those are entity-scoped.
--
-- Item-grain edges (cell_id is null) fail the exists() and stay invisible —
-- correct: they carry no entity.
--
-- Idempotent throughout. Down-migration lives in the repo:
-- supabase/migrations/down/20260804000040_member_policies_down.sql

do $$
begin
  -- ----- cells: the working surface -----------------------------------------
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

  -- ----- structure: readable once you are a member of anything --------------
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_items'
                 and policyname = 'member reads items') then
    create policy "member reads items" on public.os_finish_line_items
      for select to authenticated
      using ((select public.os_member_entities()) <> '{}'::text[]);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_entities'
                 and policyname = 'member reads entities') then
    create policy "member reads entities" on public.os_finish_line_entities
      for select to authenticated
      using ((select public.os_member_entities()) <> '{}'::text[]);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_finish_line_account_map'
                 and policyname = 'member reads account map') then
    create policy "member reads account map" on public.os_finish_line_account_map
      for select to authenticated
      using ((select public.os_member_entities()) <> '{}'::text[]);
  end if;

  -- ----- entity-joined rows: deps and cell-grain edges ----------------------
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

  -- ----- projects: WORK, SAMB engagement, read only -------------------------
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
