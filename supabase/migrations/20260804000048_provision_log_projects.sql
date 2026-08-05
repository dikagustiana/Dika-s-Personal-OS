-- ===========================================================================
-- THE PROVISION LOG LEARNS THE PROJECT AXIS — grants become audited actions.
-- ===========================================================================
-- Phase B of the close-everything pass. The panel's project grants were
-- direct repository writes: unaudited, and mounted behind Edge-Function
-- state that silently unmounted when the stored key expired — which is how
-- the owner's grant attempts produced zero rows and zero evidence. Grants
-- now travel through provision-collaborator like every other provisioning
-- act: owner-gated, service-role, and LOGGED. This migration gives the log
-- the two new action names and a column for which projects were touched.
--
-- The domain-guard trigger on os_project_members fires for the service role
-- too (triggers are not RLS) — the Edge Function's pre-validation is for a
-- clean message; the trigger remains the boundary.
--
-- os_provision_record grows a fourth defaulted parameter. CREATE OR REPLACE
-- with a new signature would leave the old 3-arg function behind as an
-- ambiguous overload, so the old one is DROPPED first; existing callers
-- (the deployed function names its arguments) resolve against the new one.
--
-- APPLIED 2026-08-05 via the Supabase apply_migration tool (ledger name
-- `provision_log_projects`). NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260804000048_provision_log_projects_down.sql

alter table private.os_provision_log
  add column if not exists project_ids uuid[];

comment on column private.os_provision_log.project_ids is
  'Projects touched by a grant-projects / revoke-project action, and the grants removed by a revoke. Null for entity-only and list actions.';

alter table private.os_provision_log
  drop constraint if exists os_provision_log_action_check;
alter table private.os_provision_log
  add constraint os_provision_log_action_check
  check (action in ('create', 'link', 'revoke', 'list', 'grant-projects', 'revoke-project'));

drop function if exists public.os_provision_record(text, text, text[]);

create or replace function public.os_provision_record(
  p_action text,
  p_email text default null,
  p_entity_codes text[] default null,
  p_project_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into private.os_provision_log (action, email, entity_codes, project_ids)
  values (p_action, p_email, p_entity_codes, p_project_ids);
end;
$$;

comment on function public.os_provision_record(text, text, text[], uuid[]) is
  'The one door into private.os_provision_log. Insert only; granted to service_role alone, called exclusively by the provision-collaborator Edge Function after a successful action.';

revoke all on function public.os_provision_record(text, text, text[], uuid[])
  from public, anon, authenticated;
grant execute on function public.os_provision_record(text, text, text[], uuid[]) to service_role;
