-- ===========================================================================
-- WHAT collab_rls.sql NEEDS THAT THE REPLAY DOES NOT CARRY. THROWAWAY ONLY.
-- ===========================================================================
-- supabase/tests/collab_rls.sql was written to run against live, where it
-- finds projects and cells to work on. A replayed cluster has neither: the
-- migrations create os_projects and os_finish_line_cells and populate
-- neither, and fixtures/grant_scope_fixture.sql adds cells for SAMB, ARBI
-- and ASI only. This file adds the rest of what that suite reaches for, so
-- scripts/grant-scope-tests.sh can run the whole file — 40 cases, four
-- blocks — against the grant model before the owner runs it against live.
--
--   three WORK projects   slice-1 block: granted / other / second
--   one GROWTH project    domain-guard block: the project that must refuse
--   one KNI cell          block 1, case 9: the cross-entity update that must
--                         match zero rows
--
-- LOAD ORDER MATTERS. The KNI cell hangs off fixture metric A1, and
-- contributor A holds a KNI membership, so once this file is in A reads one
-- cell more than finish_line_grants.sql pins. Load it AFTER that suite has
-- run, which is what the harness does.
--
-- Same throwaway-cluster guard as the grant fixture: the stored app secret
-- must be the role suite's throwaway passphrase.

do $$
begin
  if not exists (
    select 1 from private.os_app_secret
    where key_hash <> 'unset'
      and extensions.crypt('role-suite-owner-passphrase', key_hash) = key_hash
  ) then
    raise exception
      'REFUSING TO SEED: not the throwaway cluster after role_read_fixture.sql. This fixture writes os_projects and os_finish_line_cells rows and must never run elsewhere.';
  end if;
end
$$;

insert into public.os_projects
  (id, domain, title, type, status, milestones, engagement, sort_order)
values
  ('c011ab00-0000-4000-8000-000000000001', 'work',   'Fixture WORK project 1', 'other', 'active', '[]', 'samb',     9001),
  ('c011ab00-0000-4000-8000-000000000002', 'work',   'Fixture WORK project 2', 'other', 'active', '[]', 'samb',     9002),
  ('c011ab00-0000-4000-8000-000000000003', 'work',   'Fixture WORK project 3', 'other', 'active', '[]', 'samb',     9003),
  ('c011ab00-0000-4000-8000-000000000004', 'growth', 'Fixture GROWTH project', 'study', 'active', '[]', 'internal', 9004)
on conflict (id) do nothing;

-- KNI x A1. The write guard fires on UPDATE only, so this insert as postgres
-- is plain.
insert into public.os_finish_line_cells (id, item_id, entity_code, state, actor_kind)
values ('f1a7ce11-0000-4000-8000-00000000004b',
        'f1a70000-0000-4000-8000-000000000b01', 'KNI', 'input', 'owner')
on conflict (item_id, entity_code) do nothing;
