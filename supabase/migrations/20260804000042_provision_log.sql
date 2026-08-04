-- ===========================================================================
-- THE PROVISIONING AUDIT LOG — who was granted what, when, by the one door.
-- ===========================================================================
-- Collaborator identities are owner-provisioned: the provision-collaborator
-- Edge Function (owner-credential-gated, service role) creates users, grants
-- membership, mints sign-in links, and revokes. Every one of those actions
-- lands here, so "who did I give access to and when" is answerable from the
-- database rather than from memory or a chat scrollback.
--
-- Same posture as private.os_auth_attempts: the table lives in `private`
-- (PostgREST never exposes it), every client role is revoked, and the ONE
-- door in is a SECURITY DEFINER function granted to service_role alone.
-- APPEND-ONLY — the function only inserts, and no update/delete path exists
-- for any role short of the database owner. The owner reads it in the SQL
-- editor.
--
-- Idempotent throughout. Down-migration lives in the repo:
-- supabase/migrations/down/20260804000042_provision_log_down.sql

create table if not exists private.os_provision_log (
  id           uuid primary key default gen_random_uuid(),
  action       text not null check (action in ('create', 'link', 'revoke', 'list')),
  -- Null for 'list', which targets nobody.
  email        text,
  entity_codes text[],
  created_at   timestamptz not null default now()
);

comment on table private.os_provision_log is
  'Append-only audit of collaborator provisioning: action, target email, entity codes, timestamp. Written only by os_provision_record (service_role) from the provision-collaborator Edge Function. Owner reads via SQL editor.';

revoke all on table private.os_provision_log from public, anon, authenticated;

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

-- Only the Edge Function's service role may write the log.
revoke all on function public.os_provision_record(text, text, text[])
  from public, anon, authenticated;
grant execute on function public.os_provision_record(text, text, text[]) to service_role;
