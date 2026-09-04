-- Down-migration for 20260904000096_provision_scope_audit.
-- Restores the 4-argument os_provision_record from 048 and the six-action
-- check. WILL FAIL if any grant-scope / revoke-scope rows exist — the check
-- cannot be narrowed over rows that use the new names, and the two columns
-- cannot be dropped while they describe real actions. That is correct: audit
-- history is deleted by hand and on purpose, never as a side effect.
--
-- Deploy the previous provision-collaborator build BEFORE running this: the
-- current build passes p_section_ids / p_capability for scope actions, which
-- the 4-arg function does not accept.

drop function if exists public.os_provision_record(text, text, text[], uuid[], uuid[], text);

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

alter table private.os_provision_log
  drop constraint if exists os_provision_log_action_check;
alter table private.os_provision_log
  add constraint os_provision_log_action_check
  check (action in ('create', 'link', 'revoke', 'list', 'grant-projects', 'revoke-project'));

alter table private.os_provision_log
  drop constraint if exists os_provision_log_capability_check;
alter table private.os_provision_log
  drop column if exists capability;
alter table private.os_provision_log
  drop column if exists section_ids;
