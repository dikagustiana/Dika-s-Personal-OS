-- ===========================================================================
-- CORRECTS 20260827000089. THAT GATE COULD NEVER FIRE.
-- ===========================================================================
--
-- 89 tested `current_user in ('anon','authenticated')`. Inside a SECURITY
-- DEFINER function current_user is the function OWNER, not the caller, so the
-- condition was false for every caller alive and the gate was decorative.
-- 89 is left in place rather than edited: it is applied to production and to
-- the ledger, and editing an applied migration is how the two histories come
-- apart. This corrects it forward.
--
-- Measured on the live database while diagnosing:
--
--   set local role anon;  select * from probe();
--   -> current_user = postgres | session_user = postgres | role GUC = anon
--
-- So the caller's role is the `role` GUC. PostgREST sets it per request with
-- `set local role`; pg_cron does not set it at all, where it reads 'none'.
--
-- ALLOW-LIST, NOT DENY-LIST. 89 named the two roles to refuse, which fails
-- OPEN for any API role added later. This names the two to admit — 'none'
-- (pg_cron, no set role) and service_role (a secret credential whose holder
-- already owns everything) — and refuses everything else without the app key.
--
-- WHY THE SUITE DID NOT CATCH THIS, WHICH IS THE MORE IMPORTANT HALF.
-- supabase/tests/anon_definer_gates.sql matches gate names against prosrc. The
-- broken body DID contain `public.os_key_valid()`, so the check passed on
-- textual presence while the gate did nothing — and the negative control
-- passed too, because deleting the body deletes the text. A catalog check
-- cannot tell a gate that runs from a gate that is merely mentioned.
--
-- supabase/tests/anon_definer_gate_behaviour.sql is added alongside this
-- migration and closes that: it CALLS every non-exempt anon-executable
-- definer as anon with no key and asserts each one raises, inside a
-- transaction that ends in ROLLBACK. That is the check that fails on 89's
-- body and passes on this one.
--
-- Down-migration:
--   supabase/migrations/down/20260827000091_lab_stale_sweep_gate_fix_definer_context_down.sql

-- Diagnostic function created while establishing the context above. It has no
-- business existing in this schema; dropped here so the repo and the live
-- database agree that it is gone.
drop function if exists public._audit_probe_ctx();

create or replace function public.os_lab_stale_sweep()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  reverted int;
  caller text := coalesce(current_setting('role', true), 'none');
begin
  -- THE GATE. current_user is useless here — it is the definer. The caller's
  -- role is the `role` GUC. Allow-list, so a role that does not exist yet is
  -- refused by default rather than admitted by omission.
  if not public.os_key_valid() and caller not in ('none', 'service_role') then
    raise exception 'os_lab_stale_sweep: the stale sweep demotes verified datapoints and is owner-only (caller role %).', caller
      using errcode = 'insufficient_privilege';
  end if;

  update public.os_lab_datapoints
     set status = 'IND',
         verification_note = verification_note
           || ' [verification expired ' || to_char(now(), 'YYYY-MM-DD') || ']'
   where status = 'V'
     and ((volatility_class = 'volatile' and verified_at < now() - interval '180 days')
       or (volatility_class = 'slow'     and verified_at < now() - interval '365 days'));
  get diagnostics reverted = row_count;
  -- Unchanged: a zero is information ("ran, nothing expired") and its absence
  -- is a detectable condition rather than a silent one.
  insert into public.os_lab_sweep_log (rows_demoted) values (reverted);
  return reverted;
end;
$$;

comment on function public.os_lab_stale_sweep() is
  'Demotes verified datapoints whose verification has aged out, and logs every run including the quiet ones. OWNER-ONLY from the API: a role-switched caller must present the x-app-key passphrase (20260827000089, corrected by 20260827000091 which fixed a gate that read current_user inside a SECURITY DEFINER body and therefore never fired). pg_cron and service_role are unaffected.';
