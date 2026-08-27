-- Down-migration for 20260827000091_lab_stale_sweep_gate_fix_definer_context.sql
--
-- Restores 89's body — the version whose gate reads current_user inside a
-- SECURITY DEFINER function and therefore never fires. Applying this makes
-- os_lab_stale_sweep callable by anon again with no key.
--
-- It is here because every migration carries a rollback, not because it is
-- ever the right move. Note that the catalog check in anon_definer_gates.sql
-- will still pass against this body — that is the whole reason
-- anon_definer_gate_behaviour.sql exists. Run that one to see it fail.

create or replace function public.os_lab_stale_sweep()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  reverted int;
begin
  if current_user in ('anon', 'authenticated') and not public.os_key_valid() then
    raise exception 'os_lab_stale_sweep: the stale sweep demotes verified datapoints and is owner-only.'
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
  insert into public.os_lab_sweep_log (rows_demoted) values (reverted);
  return reverted;
end;
$$;
