-- ===========================================================================
-- os_lab_stale_sweep() GETS A GATE. IT WAS THE ONE ANON-CALLABLE
-- SECURITY DEFINER FUNCTION IN public THAT ASKED NOBODY FOR ANYTHING.
-- ===========================================================================
--
-- WHAT WAS WRONG
-- 20260817000077 created the sweep as SECURITY DEFINER and granted EXECUTE to
-- anon. Every other anon-callable SECURITY DEFINER function in public either
-- IS a gate (os_key_valid, os_read_key_valid, os_verify_key), is self-scoping
-- on auth.uid() (os_member_entities), or opens with a gate call
-- (the four os_share_link_* functions all `perform private.os_share_owner_
-- gate()`). This one did neither, so `anon` — a role whose key is public by
-- design, ships in the client bundle, and is committed in
-- scripts/probe-password-grant.sh — could POST to
-- /rest/v1/rpc/os_lab_stale_sweep and reach two writes:
--
--   1. UPDATE os_lab_datapoints, demoting status 'V' -> 'IND' and appending
--      to verification_note. The Lab's verified/inference boundary is the
--      whole point of the epistemic layer; an unauthenticated caller must not
--      be able to move a datapoint across it in either direction.
--   2. INSERT one row into os_lab_sweep_log PER CALL, UNCONDITIONALLY — the
--      insert sits after `get diagnostics` and is not guarded by
--      `reverted > 0`. This is the half that was live regardless of how many
--      datapoints existed: with os_lab_datapoints empty, all ten sweep_log
--      rows to date carry rows_demoted = 0, which is the heartbeat working as
--      designed AND the proof that a caller needs no data present to append.
--      Unbounded, unauthenticated, one row per request.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
-- The body is preserved verbatim apart from the gate. In particular the
-- unconditional insert STAYS unconditional: 20260817000079 added it as a
-- heartbeat on the finding that a silent zero and a sweep that never ran were
-- indistinguishable, and "a zero is information" is the point. Once the
-- function refuses un-keyed callers, the only writer is the nightly cron and
-- the owner at the Evidence screen — one row a day, which is the intended
-- rate. Making the insert conditional would fix the symptom by deleting the
-- feature.
--
-- WHY THE GATE IS IN THE BODY AND THE anon GRANT STAYS
-- Revoking EXECUTE from anon would break the app: the Evidence screen calls
-- this through supabase-js, which authenticates as `anon` and carries the
-- passphrase in the x-app-key header. That is the same shape every
-- os_share_link_* function already uses — granted to anon, gated inside on
-- os_key_valid(). Following the established pattern rather than inventing a
-- second one.
--
-- WHY current_user IS PART OF THE PREDICATE
-- 20260817000077 also schedules this via pg_cron ('0 20 * * *'). A cron job
-- runs as the role that scheduled it (postgres) with no request.headers GUC
-- set, so os_key_valid() is false for it. Gating on the key ALONE would leave
-- the nightly sweep raising every night — silently, since nothing reads cron
-- job output — and the heartbeat would flatline while looking healthy. So the
-- predicate refuses the two PostgREST-facing roles unless they present the
-- key, and lets internal callers (postgres for cron, service_role for
-- server-side work) through as before.
--
-- Standing check added alongside this migration:
--   supabase/tests/anon_definer_gates.sql — asserts that EVERY anon-executable
--   SECURITY DEFINER function in public either calls a gate or is on a named
--   exemption list. One function fixed is a patch; that file is the fix.
--
-- Down-migration:
--   supabase/migrations/down/20260827000089_lab_stale_sweep_owner_gate_down.sql

create or replace function public.os_lab_stale_sweep()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  reverted int;
begin
  -- THE GATE. `anon` and `authenticated` are the roles PostgREST exposes to
  -- the internet; both must present the owner passphrase. Anything else
  -- reaching this function is already inside the database (pg_cron as
  -- postgres, the edge functions as service_role) and is unchanged.
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
  -- The heartbeat, unchanged: a zero is information ("ran, nothing expired")
  -- and its absence is a detectable condition rather than a silent one.
  insert into public.os_lab_sweep_log (rows_demoted) values (reverted);
  return reverted;
end;
$$;

comment on function public.os_lab_stale_sweep() is
  'Demotes verified datapoints whose verification has aged out, and logs every run including the quiet ones. OWNER-ONLY from the API: anon/authenticated must present the x-app-key passphrase (20260827000089). pg_cron (postgres) and service_role are unaffected. Guarded as a class by supabase/tests/anon_definer_gates.sql.';
