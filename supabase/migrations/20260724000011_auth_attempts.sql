-- v5 B6, part 1 of 2: where failed passphrase attempts are counted.
--
-- Purely additive and safe to apply at any time. The lockdown that actually
-- forces traffic through the Edge Function is a separate migration
-- (…_verify_key_lockdown), because it must not land before the client that
-- calls that function is deployed.
--
-- The table lives in `private`, which PostgREST does not expose, so the Edge
-- Function cannot reach it as a table even with the service role. The two
-- SECURITY DEFINER functions below are its only door in, and they are granted
-- to service_role alone.

create table if not exists private.os_auth_attempts (
  client_key text primary key,
  failures integer not null default 0,
  first_failure_at timestamptz not null default now(),
  last_failure_at timestamptz not null default now(),
  locked_until timestamptz
);

comment on table private.os_auth_attempts is
  'Failed passphrase attempts per client, keyed by a salted hash of the caller IP. Reached only through os_auth_state / os_auth_record (service_role).';

revoke all on table private.os_auth_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Current standing for a client. Failures older than p_window_minutes are
-- forgiven, so one bad day does not permanently poison a caller.
-- ---------------------------------------------------------------------------
create or replace function public.os_auth_state(
  p_client_key text,
  p_window_minutes integer default 60
)
returns table (failures integer, locked_until timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
begin
  return query
  select
    case
      when a.first_failure_at < now() - make_interval(mins => p_window_minutes) then 0
      else a.failures
    end,
    a.locked_until
  from private.os_auth_attempts a
  where a.client_key = p_client_key;

  if not found then
    return query select 0, null::timestamptz;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Records the outcome of one attempt and returns the client's new standing.
-- A success clears the record outright.
-- ---------------------------------------------------------------------------
create or replace function public.os_auth_record(
  p_client_key text,
  p_success boolean,
  p_lockout_after integer default 10,
  p_lockout_minutes integer default 15,
  p_window_minutes integer default 60
)
returns table (failures integer, locked_until timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
declare
  current_failures integer := 0;
  next_failures integer;
  next_lock timestamptz;
begin
  if p_success then
    delete from private.os_auth_attempts a where a.client_key = p_client_key;
    return query select 0, null::timestamptz;
    return;
  end if;

  select
    case
      when a.first_failure_at < now() - make_interval(mins => p_window_minutes) then 0
      else a.failures
    end
  into current_failures
  from private.os_auth_attempts a
  where a.client_key = p_client_key;

  next_failures := coalesce(current_failures, 0) + 1;
  next_lock := case
    when next_failures >= p_lockout_after
      then now() + make_interval(mins => p_lockout_minutes)
    else null
  end;

  insert into private.os_auth_attempts as a
    (client_key, failures, first_failure_at, last_failure_at, locked_until)
  values (p_client_key, next_failures, now(), now(), next_lock)
  on conflict (client_key) do update
    set failures = next_failures,
        last_failure_at = now(),
        -- Restart the window when the previous one had already lapsed.
        first_failure_at = case when next_failures = 1 then now() else a.first_failure_at end,
        locked_until = next_lock;

  return query select next_failures, next_lock;
end;
$$;

-- Only the Edge Function's service role may touch these.
revoke all on function public.os_auth_state(text, integer) from public, anon, authenticated;
revoke all on function public.os_auth_record(text, boolean, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.os_auth_state(text, integer) to service_role;
grant execute on function public.os_auth_record(text, boolean, integer, integer, integer)
  to service_role;
