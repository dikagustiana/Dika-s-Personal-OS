-- ===========================================================================
-- SCENARIO FOR THE GRANT-SCOPE SUITE — run AFTER 20260904000095 has backfilled.
-- ===========================================================================
-- The backfill gives every membership a WRITE grant on every section. The
-- suite needs the shapes the backfill cannot produce:
--
--   A  keeps write on (SAMB, S1) and every other pair EXCEPT:
--        (SAMB, S2) is downgraded to READ   → cell SAMB/B1 readable, not writable
--        (ASI,  S2) is REVOKED              → cell ASI/B1 invisible
--   B  untouched: write on (ARBI, S1) and (ARBI, S2)
--   C  every grant removed, membership kept → sees no cell and no account
--
-- Same throwaway-cluster guard as the fixture.

do $$
begin
  if not exists (
    select 1 from private.os_app_secret
    where key_hash <> 'unset'
      and extensions.crypt('role-suite-owner-passphrase', key_hash) = key_hash
  ) then
    raise exception 'REFUSING: not the throwaway cluster.';
  end if;
end
$$;

update public.os_finish_line_grants
   set capability = 'read'
 where user_id = '11111111-1111-4111-8111-111111111111'
   and entity_code = 'SAMB'
   and section_id = 'f1a70000-0000-4000-8000-000000000a02';

delete from public.os_finish_line_grants
 where user_id = '11111111-1111-4111-8111-111111111111'
   and entity_code = 'ASI'
   and section_id = 'f1a70000-0000-4000-8000-000000000a02';

delete from public.os_finish_line_grants
 where user_id = '33333333-3333-4333-8333-333333333333';
