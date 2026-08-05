-- Down-migration for 20260804000048_provision_log_projects.
-- Restores the 3-argument os_provision_record and the four-action check.
-- WILL FAIL if any grant-projects / revoke-project rows exist — the check
-- cannot be narrowed over rows that use the new names. That is correct:
-- delete audit history by hand and on purpose, never as a side effect.

drop function if exists public.os_provision_record(text, text, text[], uuid[]);

create or replace function public.os_provision_record(
  p_action text,
  p_email text default null,
  p_entity_codes text[] default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into private.os_provision_log (action, email, entity_codes)
  values (p_action, p_email, p_entity_codes);
end;
$$;

comment on function public.os_provision_record(text, text, text[]) is
  'The one door into private.os_provision_log. Insert only; granted to service_role alone, called exclusively by the provision-collaborator Edge Function after a successful action.';

revoke all on function public.os_provision_record(text, text, text[])
  from public, anon, authenticated;
grant execute on function public.os_provision_record(text, text, text[]) to service_role;

alter table private.os_provision_log
  drop constraint if exists os_provision_log_action_check;
alter table private.os_provision_log
  add constraint os_provision_log_action_check
  check (action in ('create', 'link', 'revoke', 'list'));

alter table private.os_provision_log
  drop column if exists project_ids;
