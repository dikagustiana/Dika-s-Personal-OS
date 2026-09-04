-- ===========================================================================
-- DEPS AND EDGES FOLLOW THE GRANT, NOT THE MEMBERSHIP.
-- ===========================================================================
-- 20260904000095 made a member's cells and accounts derive from
-- os_finish_line_grants and left two member policies from 20260804000040 on
-- the entity-wide predicate: "member reads own-entity deps" on
-- os_finish_line_deps and "member reads own-entity edges" on
-- os_finish_line_item_projects. Both say: a member reads the row when the
-- row's cell belongs to an entity the member is enrolled in.
--
-- After 095 that is wider than the cells themselves. A person holding one
-- section of SAMB could read the derivation edges and the project links of
-- every SAMB cell — cell ids, input ids, project ids — for cells they cannot
-- read. Nothing sensitive leaks through an id, but the model is supposed to
-- have one answer to "what may this person see of this entity", and this is
-- a second one. So both policies are replaced with the same predicate the
-- cells use: the row's cell must be in os_member_readable_cells().
--
-- Behaviour kept on purpose:
--   - A dep is visible by its cell_id, not by its input_id — as before. The
--     input being readable does not make the dependency of an unreadable
--     cell visible.
--   - A row-grain edge (item_id set, cell_id null) stays invisible to members,
--     as before: `null = any (...)` is null, never true.
--   - The owner path (`require app key …`) is untouched.
--
-- Same rules as 095 for the function call: `to authenticated`, so anon never
-- evaluates it and the EXECUTE grant 095 gave authenticated is the only one
-- needed — rls_function_grants.sql pins that on every replay.
--
-- APPLIED 2026-09-04 via the Supabase apply_migration tool (ledger name
-- `finish_line_edges_follow_grants`), after 20260904000095. Idempotent.
-- Verified on live: both tables carry exactly one member policy, each named
-- `member reads granted …` and each keyed on os_member_readable_cells().
-- NEVER apply with `supabase db push`,
-- `migration up`, `db reset` or `db remote commit`.
--
-- Down-migration:
-- supabase/migrations/down/20260904000097_finish_line_edges_follow_grants_down.sql

drop policy if exists "member reads own-entity deps"  on public.os_finish_line_deps;
drop policy if exists "member reads granted deps"     on public.os_finish_line_deps;
create policy "member reads granted deps" on public.os_finish_line_deps
  for select to authenticated
  using (cell_id = any ((select public.os_member_readable_cells())::uuid[]));

drop policy if exists "member reads own-entity edges" on public.os_finish_line_item_projects;
drop policy if exists "member reads granted edges"    on public.os_finish_line_item_projects;
create policy "member reads granted edges" on public.os_finish_line_item_projects
  for select to authenticated
  using (cell_id = any ((select public.os_member_readable_cells())::uuid[]));
