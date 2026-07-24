-- Security posture (see REVIEW.md for the full rationale + residual risk).
--
-- Single-user app, no auth system. The whole database sits behind ONE
-- passphrase, enforced server-side: every request must carry an `x-app-key`
-- header whose value matches the bcrypt hash stored in private.os_app_secret.
-- RLS on every os_ table calls os_key_valid(); without the header, reads
-- return nothing and writes are rejected — the anon key alone grants nothing.
--
-- The hash below is a placeholder that matches NO passphrase. Set the real
-- one (outside version control) with:
--
--   update private.os_app_secret
--   set key_hash = extensions.crypt('your-passphrase', extensions.gen_salt('bf'));

create extension if not exists pgcrypto with schema extensions;

-- Private schema: not exposed through PostgREST, unreadable by anon.
create schema if not exists private;

create table private.os_app_secret (
  id boolean primary key default true check (id), -- at most one row
  key_hash text not null
);

insert into private.os_app_secret (key_hash) values ('unset');

-- True when the x-app-key request header matches the stored hash.
-- SECURITY DEFINER so it can read private.os_app_secret; STABLE so it is
-- evaluated once per statement, not per row.
create or replace function public.os_key_valid()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate text;
  stored text;
begin
  candidate := coalesce(
    current_setting('request.headers', true)::json ->> 'x-app-key',
    ''
  );
  select key_hash into stored from private.os_app_secret;
  if candidate = '' or stored is null or stored = 'unset' then
    return false;
  end if;
  return extensions.crypt(candidate, stored) = stored;
end;
$$;

-- Explicit passphrase check for the app's unlock gate. SELECT on RLS-guarded
-- tables returns empty rather than erroring, so the gate needs a definitive
-- yes/no before storing the key.
create or replace function public.os_verify_key(candidate text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  stored text;
begin
  select key_hash into stored from private.os_app_secret;
  if candidate is null or candidate = '' or stored is null or stored = 'unset' then
    return false;
  end if;
  return extensions.crypt(candidate, stored) = stored;
end;
$$;

revoke all on function public.os_key_valid() from public;
revoke all on function public.os_verify_key(text) from public;
grant execute on function public.os_key_valid() to anon, authenticated;
grant execute on function public.os_verify_key(text) to anon, authenticated;

-- RLS: one policy per table, all operations, gated on the header check.
alter table public.os_entries enable row level security;
alter table public.os_daily_logs enable row level security;
alter table public.os_weekly_plans enable row level security;
alter table public.os_projects enable row level security;

create policy "require app key" on public.os_entries
  for all to anon, authenticated
  using (public.os_key_valid())
  with check (public.os_key_valid());

create policy "require app key" on public.os_daily_logs
  for all to anon, authenticated
  using (public.os_key_valid())
  with check (public.os_key_valid());

create policy "require app key" on public.os_weekly_plans
  for all to anon, authenticated
  using (public.os_key_valid())
  with check (public.os_key_valid());

create policy "require app key" on public.os_projects
  for all to anon, authenticated
  using (public.os_key_valid())
  with check (public.os_key_valid());
