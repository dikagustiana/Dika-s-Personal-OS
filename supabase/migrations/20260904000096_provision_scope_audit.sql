-- ===========================================================================
-- THE PROVISION LOG LEARNS THE SCOPE AXIS — grant-scope and revoke-scope.
-- ===========================================================================
-- 20260904000095 made a collaborator's access a set of (person, entity,
-- section, capability) rows. Those rows need a door: the provision-collaborator
-- Edge Function gains two actions, `grant-scope` (one entity, several
-- sections, one capability) and `revoke-scope` (one entity, one section), and
-- like every other provisioning act they must land in private.os_provision_log
-- or not happen at all. This file gives the log the two action names and the
-- two columns that say what a scope action touched, and teaches
-- os_provision_record to refuse a scope row that cannot answer "who was
-- granted what" — an audit that accepts a grant-scope entry with no sections
-- is an audit that will one day contain one.
--
-- WHAT IS AUDITED AND WHAT IS NOT. A grant-scope row carries the entity in
-- entity_codes (exactly one), the sections in section_ids, and the capability.
-- A revoke-scope row carries the entity and exactly one section. A `create`
-- row may now also carry section_ids and capability = 'write', because create
-- writes the write-on-every-section grants that keep a new collaborator's
-- first sign-in from landing on an empty matrix. A full `revoke` carries none
-- of it: the grants go with the membership through the cascading FK from 095,
-- and the entity codes it already records name what was taken away.
--
-- os_provision_record grows two defaulted parameters. As in 048, CREATE OR
-- REPLACE with a new signature would leave the old 4-arg function behind as
-- an ambiguous overload, so the old one is DROPPED first. The deployed Edge
-- Function names its arguments and passes the new two only for scope actions,
-- so a function deployed BEFORE this file is applied keeps every old action
-- working and fails the two new ones loudly ("audit write failed") — which is
-- fail closed, the right direction.
--
-- APPLIED 2026-09-04 via the Supabase apply_migration tool (ledger name
-- `provision_scope_audit`), after 20260904000095 and before the
-- provision-collaborator redeploy. Idempotent throughout. Verified on live:
-- the action check carries all eight names, the capability check is in place,
-- os_provision_record is the 6-argument version and EXECUTE on it is
-- service_role only. NEVER apply with `supabase db push`,
-- `migration up`, `db reset` or `db remote commit` — the repo's filenames and
-- the live ledger's versions are different numbering schemes and any of those
-- replays from 0001_schema.sql against live data.
--
-- Down-migration:
-- supabase/migrations/down/20260904000096_provision_scope_audit_down.sql

alter table private.os_provision_log
  add column if not exists section_ids uuid[];
alter table private.os_provision_log
  add column if not exists capability text;

comment on column private.os_provision_log.section_ids is
  'Finish line sections touched by a grant-scope / revoke-scope action, or written by create. Null for every other action.';
comment on column private.os_provision_log.capability is
  'read or write for a grant-scope action (and write for the grants create writes). Null otherwise — a revoke-scope row removes whatever capability was held.';

alter table private.os_provision_log
  drop constraint if exists os_provision_log_capability_check;
alter table private.os_provision_log
  add constraint os_provision_log_capability_check
  check (capability is null or capability in ('read', 'write'));

alter table private.os_provision_log
  drop constraint if exists os_provision_log_action_check;
alter table private.os_provision_log
  add constraint os_provision_log_action_check
  check (action in ('create', 'link', 'revoke', 'list',
                    'grant-projects', 'revoke-project',
                    'grant-scope', 'revoke-scope'));

drop function if exists public.os_provision_record(text, text, text[], uuid[]);

create or replace function public.os_provision_record(
  p_action      text,
  p_email       text   default null,
  p_entity_codes text[] default null,
  p_project_ids uuid[] default null,
  p_section_ids uuid[] default null,
  p_capability  text   default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- A scope row must say what it touched. The Edge Function fails the whole
  -- action when this raises (audit failed = action failed), so a grant that
  -- cannot be described cannot be recorded as having happened.
  if p_action = 'grant-scope' then
    if p_entity_codes is null or cardinality(p_entity_codes) <> 1
       or p_section_ids is null or cardinality(p_section_ids) = 0
       or p_capability is null then
      raise exception
        'provision log: a grant-scope entry needs exactly one entity, at least one section and a capability'
        using errcode = 'check_violation';
    end if;
  elsif p_action = 'revoke-scope' then
    if p_entity_codes is null or cardinality(p_entity_codes) <> 1
       or p_section_ids is null or cardinality(p_section_ids) <> 1 then
      raise exception
        'provision log: a revoke-scope entry needs exactly one entity and exactly one section'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into private.os_provision_log
    (action, email, entity_codes, project_ids, section_ids, capability)
  values
    (p_action, p_email, p_entity_codes, p_project_ids, p_section_ids, p_capability);
end;
$$;

comment on function public.os_provision_record(text, text, text[], uuid[], uuid[], text) is
  'The one door into private.os_provision_log. Insert only; granted to service_role alone, called exclusively by the provision-collaborator Edge Function after a successful action. Refuses a grant-scope / revoke-scope entry that does not name its entity and sections.';

revoke all on function public.os_provision_record(text, text, text[], uuid[], uuid[], text)
  from public, anon, authenticated;
grant execute on function public.os_provision_record(text, text, text[], uuid[], uuid[], text)
  to service_role;
