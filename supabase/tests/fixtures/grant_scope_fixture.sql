-- ===========================================================================
-- FIXTURE FOR THE GRANT-SCOPE SUITE. THROWAWAY CLUSTER ONLY.
-- ===========================================================================
-- Loaded by scripts/grant-scope-tests.sh AFTER fixtures/role_read_fixture.sql,
-- which already created two contributors (A holds SAMB/ASI/ARBI/KNI/KDU, B
-- holds ARBI alone) and set the owner's throwaway passphrase. This file adds
-- the Finish line rows the replay cannot carry — items, cells, accounts are
-- populated by no migration in the repo — plus a third contributor C who
-- holds a membership and, once the scenario step removes them, no grants.
--
-- REFUSES ANYWHERE BUT A THROWAWAY CLUSTER: the guard requires the stored app
-- secret to be the role suite's throwaway passphrase, which is only ever true
-- after role_read_fixture.sql has run against a disposable database.
--
-- Shape (fixed uuids so the suite can name rows without lookups):
--   sections   S1 "Fixture section A"   S2 "Fixture section B"
--   metrics    A1, A2 under S1 · B1 under S2 · O1 with NO parent (the D4 case)
--   note       N1 under S1 (a grant naming it must be refused)
--   cells      A1/A2/B1/O1 x SAMB, ARBI, ASI = 12, all `input`
--   accounts   mapped and unmapped, per entity, plus one unmapped with no
--              entity at all (readable by nobody but the owner)

do $$
begin
  if not exists (
    select 1 from private.os_app_secret
    where key_hash <> 'unset'
      and extensions.crypt('role-suite-owner-passphrase', key_hash) = key_hash
  ) then
    raise exception
      'REFUSING TO SEED: the app secret is not the role suite''s throwaway passphrase, so this is not the throwaway cluster after role_read_fixture.sql. This fixture writes Finish line rows and must never run elsewhere.';
  end if;
end
$$;

-- Contributor C: enrolled on SAMB, to become the "membership without grants"
-- identity once the scenario step deletes the grants the backfill gives them.
insert into auth.users (id, email)
values ('33333333-3333-4333-8333-333333333333', 'samb-member-no-grants@example.test')
on conflict (id) do nothing;
insert into public.os_entity_members (user_id, entity_code)
values ('33333333-3333-4333-8333-333333333333', 'SAMB')
on conflict do nothing;

-- Items. area/target_state/status are nullable since the matrix migration.
insert into public.os_finish_line_items (id, item, kind, parent_id, sort_order) values
  ('f1a70000-0000-4000-8000-000000000a01', 'Fixture section A', 'section', null, 9001),
  ('f1a70000-0000-4000-8000-000000000a02', 'Fixture section B', 'section', null, 9002),
  ('f1a70000-0000-4000-8000-000000000b01', 'Fixture metric A1', 'metric',  'f1a70000-0000-4000-8000-000000000a01', 9011),
  ('f1a70000-0000-4000-8000-000000000b02', 'Fixture metric A2', 'metric',  'f1a70000-0000-4000-8000-000000000a01', 9012),
  ('f1a70000-0000-4000-8000-000000000b03', 'Fixture metric B1', 'metric',  'f1a70000-0000-4000-8000-000000000a02', 9021),
  ('f1a70000-0000-4000-8000-000000000b04', 'Fixture metric O1 (no parent)', 'metric', null, 9031),
  ('f1a70000-0000-4000-8000-000000000c01', 'Fixture note N1', 'note',      'f1a70000-0000-4000-8000-000000000a01', 9041)
on conflict (id) do nothing;

-- Cells: the four metrics x three entities. The write guard fires on UPDATE
-- only, so these inserts as postgres are plain.
insert into public.os_finish_line_cells (id, item_id, entity_code, state, actor_kind)
select ('f1a7ce11-0000-4000-8000-' || lpad(to_hex(m.n * 10 + e.n), 12, '0'))::uuid,
       m.item_id, e.code, 'input', 'owner'
from (values (1, 'f1a70000-0000-4000-8000-000000000b01'::uuid),
             (2, 'f1a70000-0000-4000-8000-000000000b02'::uuid),
             (3, 'f1a70000-0000-4000-8000-000000000b03'::uuid),
             (4, 'f1a70000-0000-4000-8000-000000000b04'::uuid)) as m(n, item_id)
cross join (values (1, 'SAMB'), (2, 'ARBI'), (3, 'ASI')) as e(n, code)
on conflict (item_id, entity_code) do nothing;

-- Accounts. Names are distinct so the natural key never collides.
insert into public.os_finish_line_accounts (account_name, cell_id, entity_code, coa_entity, coa_consol)
values
  -- SAMB: two under A1, one under B1, two unmapped
  ('fixture SAMB A1 account 1', (select id from public.os_finish_line_cells where item_id = 'f1a70000-0000-4000-8000-000000000b01' and entity_code = 'SAMB'), 'SAMB', '9001', '9001'),
  ('fixture SAMB A1 account 2', (select id from public.os_finish_line_cells where item_id = 'f1a70000-0000-4000-8000-000000000b01' and entity_code = 'SAMB'), 'SAMB', '9002', '9002'),
  ('fixture SAMB B1 account',   (select id from public.os_finish_line_cells where item_id = 'f1a70000-0000-4000-8000-000000000b03' and entity_code = 'SAMB'), 'SAMB', '9003', '9003'),
  ('fixture SAMB O1 account',   (select id from public.os_finish_line_cells where item_id = 'f1a70000-0000-4000-8000-000000000b04' and entity_code = 'SAMB'), 'SAMB', '9004', '9004'),
  ('fixture SAMB unmapped 1',   null, 'SAMB', '9005', '9005'),
  ('fixture SAMB unmapped 2',   null, 'SAMB', '9006', '9006'),
  -- ARBI: one under A1, one unmapped
  ('fixture ARBI A1 account',   (select id from public.os_finish_line_cells where item_id = 'f1a70000-0000-4000-8000-000000000b01' and entity_code = 'ARBI'), 'ARBI', '9011', '9011'),
  ('fixture ARBI unmapped',     null, 'ARBI', '9012', '9012'),
  -- ASI: one under B1
  ('fixture ASI B1 account',    (select id from public.os_finish_line_cells where item_id = 'f1a70000-0000-4000-8000-000000000b03' and entity_code = 'ASI'), 'ASI', '9021', '9021'),
  -- No entity at all: readable by nobody but the owner (D3 has nothing to key on)
  ('fixture unmapped no entity', null, null, '9031', '9031')
on conflict do nothing;
