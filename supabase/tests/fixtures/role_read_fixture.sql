-- ===========================================================================
-- FIXTURE FOR THE PER-ROLE READ SUITE. THROWAWAY CLUSTER ONLY.
-- ===========================================================================
-- Creates the three identities §11 reads as, and nothing else. It writes to
-- auth.users and os_entity_members, so it must NEVER be run against the live
-- project — the guard below refuses if the real app secret is present, which
-- is the one cheap way to tell a throwaway cluster from production.
--
-- Loaded by scripts/role-read-tests.sh after all migrations have replayed.

do $$
begin
  if exists (select 1 from private.os_app_secret where key_hash <> 'unset') then
    raise exception
      'REFUSING TO SEED: private.os_app_secret is set, so this is not a throwaway cluster. This fixture writes auth.users and os_entity_members rows and must only ever run against a disposable database.';
  end if;
end
$$;

-- The owner's passphrase. `os_key_valid()` bcrypt-compares the x-app-key
-- header against this hash, so the suite can hold a real owner session by
-- setting one GUC.
update private.os_app_secret
   set key_hash = extensions.crypt('role-suite-owner-passphrase', extensions.gen_salt('bf'));

-- Two contributors with fixed uuids so the suite can name them without a
-- lookup. Both have last_sign_in_at null: the collaborator screen renders
-- that as `belum pernah masuk`, and it is irrelevant to what they can READ,
-- which is the point of pinning it here.
insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'five-entity-member@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'arbi-only-member@example.test')
on conflict (id) do nothing;

-- Contributor A holds the five ORIGINAL entities — the shape of the real
-- collaborator who prompted the member policies. PINNED BY CODE, not read
-- from os_finish_line_entities: 20260807000059 added MAM and KGR to that
-- table with deliberately zero memberships (nobody is granted a new column
-- automatically), and a fixture that selects every entity row would quietly
-- re-grant them here the moment it replays. With KGR's chain seeded, A now
-- reads LESS than the owner — SAMB and ARBI, zero KGR — and the suite
-- asserts exactly that.
insert into public.os_entity_members (user_id, entity_code)
select '11111111-1111-4111-8111-111111111111'::uuid, code
from unnest(array['SAMB', 'ASI', 'ARBI', 'KNI', 'KDU']) as code
on conflict do nothing;

-- Contributor B holds ARBI alone. B is the proof that the entity picker
-- narrows itself with no frontend code: B receives ARBI rows and zero SAMB
-- rows, so the picker B renders has one entity in it.
insert into public.os_entity_members (user_id, entity_code)
values ('22222222-2222-4222-8222-222222222222', 'ARBI')
on conflict do nothing;

-- ===========================================================================
-- ONE AUDIT ROW, WITHOUT WHICH THE MOST IMPORTANT ASSERTION IS VACUOUS.
-- ===========================================================================
-- os_process_text_history is empty in production, so "a member reads zero
-- rows from it" would pass against an empty table no matter what the policy
-- said — including if someone added a member policy tomorrow. Seeding one row
-- makes the owner's read 1 and the member's read 0, so the assertion is
-- actually testing the missing policy rather than the missing data.
--
-- Written as postgres, which owns the table and bypasses RLS; the append-only
-- INSERT policy requires os_key_valid() and is not in the way here.
insert into public.os_process_text_history (table_name, row_id, field, old_value, new_value)
select 'os_process_steps', s.id::text, 'label', '18b', '18b'
from public.os_process_steps s
where s.entity_code = 'SAMB' and s.label = '18b';
