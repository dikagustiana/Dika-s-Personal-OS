-- Down-migration for 20260817000076_lab_epistemic_schema.
-- DESTROYS THE ENTIRE EPISTEMIC LAYER: every project, source snapshot
-- record, datapoint, verification, conflict resolution, claim, approval,
-- contradiction record and output — the record of what stands behind every
-- number, which exists nowhere else. Export before running.
-- Run down/20260817000077_lab_epistemic_gates_down.sql FIRST so no guard
-- sits on a table mid-drop. Drops in mirror order: dependents first,
-- policies before tables. Datapoints/claims survive in no other table;
-- os_lab_runs (execution layer) is untouched — the FKs point from here to
-- there, not back.

drop policy if exists "require app key to select" on public.os_lab_output_claims;
drop policy if exists "require app key to insert" on public.os_lab_output_claims;
drop policy if exists "require app key to update" on public.os_lab_output_claims;
drop policy if exists "require app key to delete" on public.os_lab_output_claims;
drop index if exists public.os_lab_output_claims_claim_idx;
drop table if exists public.os_lab_output_claims;

drop policy if exists "require app key to select" on public.os_lab_outputs;
drop policy if exists "require app key to insert" on public.os_lab_outputs;
drop policy if exists "require app key to update" on public.os_lab_outputs;
drop policy if exists "require app key to delete" on public.os_lab_outputs;
drop index if exists public.os_lab_outputs_project_idx;
drop table if exists public.os_lab_outputs;

drop policy if exists "require app key to select" on public.os_lab_claim_contradictions;
drop policy if exists "require app key to insert" on public.os_lab_claim_contradictions;
drop policy if exists "require app key to update" on public.os_lab_claim_contradictions;
drop policy if exists "require app key to delete" on public.os_lab_claim_contradictions;
drop index if exists public.os_lab_claim_contradictions_a_idx;
drop index if exists public.os_lab_claim_contradictions_b_idx;
drop table if exists public.os_lab_claim_contradictions;

drop policy if exists "require app key to select" on public.os_lab_claim_references;
drop policy if exists "require app key to insert" on public.os_lab_claim_references;
drop policy if exists "require app key to update" on public.os_lab_claim_references;
drop policy if exists "require app key to delete" on public.os_lab_claim_references;
drop index if exists public.os_lab_claim_references_reference_idx;
drop table if exists public.os_lab_claim_references;

drop policy if exists "require app key to select" on public.os_lab_claim_datapoints;
drop policy if exists "require app key to insert" on public.os_lab_claim_datapoints;
drop policy if exists "require app key to update" on public.os_lab_claim_datapoints;
drop policy if exists "require app key to delete" on public.os_lab_claim_datapoints;
drop index if exists public.os_lab_claim_datapoints_datapoint_idx;
drop table if exists public.os_lab_claim_datapoints;

drop policy if exists "require app key to select" on public.os_lab_claims;
drop policy if exists "require app key to insert" on public.os_lab_claims;
drop policy if exists "require app key to update" on public.os_lab_claims;
drop policy if exists "require app key to delete" on public.os_lab_claims;
drop index if exists public.os_lab_claims_project_idx;
drop index if exists public.os_lab_claims_status_idx;
drop index if exists public.os_lab_claims_run_idx;
drop table if exists public.os_lab_claims;

drop policy if exists "require app key to select" on public.os_lab_commitment_sources;
drop policy if exists "require app key to insert" on public.os_lab_commitment_sources;
drop policy if exists "require app key to update" on public.os_lab_commitment_sources;
drop policy if exists "require app key to delete" on public.os_lab_commitment_sources;
drop index if exists public.os_lab_commitment_sources_project_idx;
drop table if exists public.os_lab_commitment_sources;

drop policy if exists "require app key to select" on public.os_lab_references;
drop policy if exists "require app key to insert" on public.os_lab_references;
drop policy if exists "require app key to update" on public.os_lab_references;
drop policy if exists "require app key to delete" on public.os_lab_references;
drop table if exists public.os_lab_references;

drop policy if exists "require app key to select" on public.os_lab_datapoint_conflicts;
drop policy if exists "require app key to insert" on public.os_lab_datapoint_conflicts;
drop policy if exists "require app key to update" on public.os_lab_datapoint_conflicts;
drop policy if exists "require app key to delete" on public.os_lab_datapoint_conflicts;
drop index if exists public.os_lab_datapoint_conflicts_a_idx;
drop index if exists public.os_lab_datapoint_conflicts_b_idx;
drop table if exists public.os_lab_datapoint_conflicts;

drop policy if exists "require app key to select" on public.os_lab_datapoints;
drop policy if exists "require app key to insert" on public.os_lab_datapoints;
drop policy if exists "require app key to update" on public.os_lab_datapoints;
drop policy if exists "require app key to delete" on public.os_lab_datapoints;
drop index if exists public.os_lab_datapoints_source_idx;
drop index if exists public.os_lab_datapoints_status_idx;
drop table if exists public.os_lab_datapoints;

drop policy if exists "require app key to select" on public.os_lab_source_documents;
drop policy if exists "require app key to insert" on public.os_lab_source_documents;
drop policy if exists "require app key to update" on public.os_lab_source_documents;
drop policy if exists "require app key to delete" on public.os_lab_source_documents;
drop table if exists public.os_lab_source_documents;

drop trigger if exists os_lab_projects_updated_at on public.os_lab_projects;
drop policy if exists "require app key to select" on public.os_lab_projects;
drop policy if exists "require app key to insert" on public.os_lab_projects;
drop policy if exists "require app key to update" on public.os_lab_projects;
drop policy if exists "require app key to delete" on public.os_lab_projects;
drop table if exists public.os_lab_projects;
