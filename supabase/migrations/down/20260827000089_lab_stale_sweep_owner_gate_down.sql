-- Down-migration for 20260827000089_lab_stale_sweep_owner_gate.sql
--
-- Restores os_lab_stale_sweep() to its 20260817000079 body VERBATIM — the
-- ungated version, in which any holder of the public anon key can demote
-- verified datapoints and append a row to os_lab_sweep_log per request.
--
-- Applying this REOPENS the hole. It exists because every migration here
-- carries a rollback, not because rolling back is advisable; if the gate is
-- causing a problem, the problem is almost certainly a caller that should be
-- presenting the passphrase, not the gate.

create or replace function public.os_lab_stale_sweep()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  reverted int;
begin
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

comment on function public.os_lab_stale_sweep() is null;
