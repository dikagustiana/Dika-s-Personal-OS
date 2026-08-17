-- Down-migration for 20260817000077_lab_epistemic_gates.
-- REMOVES EVERY EPISTEMIC GATE: after this, verification and approval are
-- ordinary column writes any caller can make, layer A claims unfreeze,
-- finalized outputs can cite anything, and nothing expires. The data
-- survives; what it MEANS stops being enforced. Run before the schema down
-- (76), never to "unblock" a gate refusal — the refusal is the feature.
-- Cron first, then triggers, then functions, mirror order.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('lab-stale-sweep');
    exception when others then
      null;
    end;
  end if;
end
$$;

drop function if exists public.os_lab_stale_sweep();

drop trigger if exists os_lab_output_claims_gate_guard on public.os_lab_output_claims;
drop function if exists public.os_lab_output_claims_gate_guard();

drop trigger if exists os_lab_outputs_gate_guard on public.os_lab_outputs;
drop function if exists public.os_lab_outputs_gate_guard();

drop trigger if exists os_lab_contradictions_gate_guard on public.os_lab_claim_contradictions;
drop function if exists public.os_lab_contradictions_gate_guard();

drop trigger if exists os_lab_claim_references_gate_guard on public.os_lab_claim_references;
drop trigger if exists os_lab_claim_datapoints_gate_guard on public.os_lab_claim_datapoints;
drop function if exists public.os_lab_claim_links_gate_guard();

drop trigger if exists os_lab_claims_gate_guard on public.os_lab_claims;
drop function if exists public.os_lab_claims_gate_guard();

drop trigger if exists os_lab_references_gate_guard on public.os_lab_references;
drop function if exists public.os_lab_references_gate_guard();

drop trigger if exists os_lab_conflicts_gate_guard on public.os_lab_datapoint_conflicts;
drop function if exists public.os_lab_conflicts_gate_guard();

drop trigger if exists os_lab_datapoints_cascade_guard on public.os_lab_datapoints;
drop function if exists public.os_lab_datapoints_cascade_guard();

drop trigger if exists os_lab_datapoints_gate_guard on public.os_lab_datapoints;
drop function if exists public.os_lab_datapoints_gate_guard();

drop trigger if exists os_lab_commitment_sources_owner_guard on public.os_lab_commitment_sources;
drop trigger if exists os_lab_source_documents_owner_guard on public.os_lab_source_documents;
drop trigger if exists os_lab_projects_owner_guard on public.os_lab_projects;
drop function if exists public.os_lab_owner_write_guard();
