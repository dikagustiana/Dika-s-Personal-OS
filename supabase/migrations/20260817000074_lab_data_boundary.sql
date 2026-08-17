-- =============================================================================
-- LAB: the data boundary. Internal SAMB data reaches Anthropic models only.
-- =============================================================================
--
-- APPLIED 2026-08-17 via the Supabase apply_migration tool (ledger name
-- `lab_data_boundary`). Verified live after applying: an insert of a runs
-- row (internal agent, DeepSeek provider) was refused with the boundary
-- message and os_lab_runs stayed at zero rows. Never `supabase db push` /
-- `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260817000074_lab_data_boundary_down.sql.
--
-- THE RULE, stated once: an agent whose data_class is 'internal' processes
-- internal SAMB Group financial data, and that data may only ever be sent to
-- Anthropic models. DeepSeek and Kimi hold ~1bn tokens of credit, which is
-- exactly why the rule is enforced HERE, in the database, and not in the
-- code that feels the temptation: the executor re-checks it (layer 2) and
-- the UI disables the selector (layer 3), but this file is the layer that
-- holds when both of those have a bug. The triggers below fire for EVERY
-- role — the service role the Edge Function uses included. RLS does not
-- bind the service role; triggers do.
--
-- There is no flag, env var, or dev mode that relaxes this, and none may be
-- added. A session that needs the boundary lowered is a session that should
-- be asking the owner instead.
--
-- Three guards, one per direction the invariant can be attacked from:
--
--   1. os_lab_agents_boundary_guard   — an internal agent cannot point its
--      default_provider_id anywhere but the Anthropic row, and cannot leave
--      it NULL: written as "must resolve to name = 'anthropic'", so a NULL,
--      a dangling id and a wrong provider all fail the same way. It cannot
--      be satisfied by a NULL. (This guard also owns the agent's version
--      bump and updated_at — see below.)
--
--   2. os_lab_runs_boundary_guard     — a runs row cannot exist where the
--      agent is internal and the resolved provider is not Anthropic. Both
--      lookups raise on NULL/missing rather than pass: an id that resolves
--      to nothing is an error, never a permission.
--
--   3. os_lab_providers_boundary_guard — the row internal agents depend on
--      cannot be renamed away from 'anthropic', and its adapter cannot be
--      changed, while any internal agent references it. Without this, the
--      first two guards compare against a column the owner could edit in
--      the table editor, and the boundary would be one rename deep.
--
-- House conventions (20260804000041/47): function and trigger share a name;
-- security definer; set search_path = ''; EXECUTE revoked from all client
-- roles (trigger machinery does not check the caller's EXECUTE privilege,
-- so no client role needs, or should have, any grant).

-- ---------------------------------------------------------------------------
-- 1. agents
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_agents_boundary_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.data_class = 'internal' then
    -- One EXISTS, three failures: NULL default_provider_id, an id that
    -- resolves to no provider, and a provider that is not Anthropic all
    -- land here. NOT EXISTS over a NULL id is true, so a NULL cannot
    -- satisfy the boundary by vacuity.
    if not exists (
      select 1 from public.os_lab_providers p
      where p.id = new.default_provider_id and p.name = 'anthropic'
    ) then
      raise exception 'lab boundary: agent % is internal — its default provider must be the Anthropic row, and may not be null. Internal SAMB data is processed by Anthropic models only.',
        new.slug;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- The guard owns the clock and the version counter, per the cell
    -- guard's precedent: a client cannot backdate updated_at, and a
    -- system_prompt edit cannot forget to become a new version. Only an
    -- unchanged version is bumped — an explicit client-set version (a
    -- deliberate re-stamp) is left alone.
    if new.system_prompt is distinct from old.system_prompt
       and new.version = old.version then
      new.version := old.version + 1;
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.os_lab_agents_boundary_guard() from public;
revoke all on function public.os_lab_agents_boundary_guard() from anon;
revoke all on function public.os_lab_agents_boundary_guard() from authenticated;

drop trigger if exists os_lab_agents_boundary_guard on public.os_lab_agents;
create trigger os_lab_agents_boundary_guard
  before insert or update on public.os_lab_agents
  for each row execute function public.os_lab_agents_boundary_guard();

-- ---------------------------------------------------------------------------
-- 2. runs
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_runs_boundary_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  agent_class text;
  provider_name text;
begin
  select a.data_class into agent_class
  from public.os_lab_agents a
  where a.id = new.agent_id;

  if agent_class is null then
    raise exception 'lab boundary: run does not resolve to an agent (%).', new.agent_id;
  end if;

  select p.name into provider_name
  from public.os_lab_providers p
  where p.id = new.provider_id;

  if provider_name is null then
    raise exception 'lab boundary: run does not resolve to a provider (%).', new.provider_id;
  end if;

  -- IS DISTINCT FROM, not <>: if provider_name could ever arrive NULL past
  -- the check above, NULL <> 'anthropic' is NULL and the branch would be
  -- skipped — the exact NULL-vacuity this file exists to refuse.
  if agent_class = 'internal' and provider_name is distinct from 'anthropic' then
    raise exception 'lab boundary: agent is internal and % is not Anthropic. Internal SAMB data is processed by Anthropic models only — no fallback, no override.',
      provider_name;
  end if;

  return new;
end;
$$;

revoke all on function public.os_lab_runs_boundary_guard() from public;
revoke all on function public.os_lab_runs_boundary_guard() from anon;
revoke all on function public.os_lab_runs_boundary_guard() from authenticated;

drop trigger if exists os_lab_runs_boundary_guard on public.os_lab_runs;
create trigger os_lab_runs_boundary_guard
  before insert or update on public.os_lab_runs
  for each row execute function public.os_lab_runs_boundary_guard();

-- ---------------------------------------------------------------------------
-- 3. providers
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_providers_boundary_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.name = 'anthropic'
     and (new.name is distinct from 'anthropic'
          or new.adapter is distinct from old.adapter)
     and exists (
       select 1 from public.os_lab_agents a
       where a.default_provider_id = old.id and a.data_class = 'internal'
     ) then
    raise exception 'lab boundary: internal agents reference this provider as Anthropic — its name and adapter cannot change while they do. Repoint the agents first.';
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_providers_boundary_guard() from public;
revoke all on function public.os_lab_providers_boundary_guard() from anon;
revoke all on function public.os_lab_providers_boundary_guard() from authenticated;

drop trigger if exists os_lab_providers_boundary_guard on public.os_lab_providers;
create trigger os_lab_providers_boundary_guard
  before update on public.os_lab_providers
  for each row execute function public.os_lab_providers_boundary_guard();
