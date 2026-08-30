-- ===========================================================================
-- TWO ADDITIVE GUARDS SO THE PUBLIC LANE CANNOT BECOME A DOOR INTO THE HEAVY ONE.
-- ===========================================================================
--
-- The Lab has two lanes, distinguished by os_lab_agents.data_class:
--   internal — SAMB content; routed to Anthropic only, verified, gated.
--   public   — IELTS drafts, thesis research, site copy; disposable, ungated.
--
-- The public lane already half-existed: createAgent/updateAgent and the
-- registry form have always accepted data_class = 'public'. What was missing
-- is the WALL. This migration adds it, as two NEW guards. It touches no
-- existing trigger, guard, gate or enforcement migration — every existing
-- object is left exactly as it was (house constraint for this work).
--
-- ---------------------------------------------------------------------------
-- GUARD 1 — data_class is frozen after insert.
-- ---------------------------------------------------------------------------
-- Measured before writing this: updateAgent re-sends data_class on every edit
-- (src/data/labRepository.ts:282 → agentPayload includes data_class), and the
-- existing boundary guard (20260817000074) permits internal → public on
-- UPDATE — its data_class branch only fires when the NEW value is 'internal'.
-- So today an internal agent, carrying an internal system prompt full of SAMB
-- context, can be flipped to 'public' and then pointed at Kimi or DeepSeek.
-- That is the laundering vector, live in code.
--
-- The fix is not to police the flip but to forbid it: an agent is born into
-- its lane and stays there. Re-lane by deleting and recreating — a deliberate
-- act, not a column edit. No migration anywhere UPDATEs data_class (grepped:
-- it is INSERT-only), so freezing it cannot break a replay or any seed.
--
-- This runs ALONGSIDE os_lab_agents_boundary_guard, not instead of it. Both
-- are BEFORE UPDATE; Postgres fires them alphabetically (boundary before
-- class_freeze), and neither touches what the other reads.
--
-- ---------------------------------------------------------------------------
-- GUARD 2 — the provider named 'anthropic' is pinned to Anthropic's endpoint.
-- ---------------------------------------------------------------------------
-- The internal→Anthropic boundary checks provider.name = 'anthropic'
-- (trigger 074, executor run-lab-agent:167). But "anthropic" is only a label:
-- the request is sent to os_lab_providers.base_url (run-lab-agent:229), and
-- nothing froze that column. Editing the anthropic row's base_url to another
-- endpoint would send internal content there — the content rides in the POST
-- body, transmitted before any auth failure. name is CHECK-constrained to
-- {anthropic,deepseek,kimi}; base_url was not constrained at all.
--
-- This pins it: the row named 'anthropic' must carry base_url
-- 'https://api.anthropic.com'. Verified live 2026-08-27 that this is already
-- its value, so the guard is inert against the current row and fires only on
-- an attempt to repoint it. Changing Anthropic's endpoint, if it ever moves,
-- is then a migration with a diff — the deliberate act it should be.
--
-- Down-migration:
--   supabase/migrations/down/20260827000092_lab_public_lane_guards_down.sql
-- Standing test:
--   supabase/tests/lab_public_lane.sql (wired into scripts/role-read-tests.sh
--   with negative controls that must go red).

-- --- guard 1: class freeze -------------------------------------------------
create or replace function public.os_lab_agents_class_freeze_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.data_class is distinct from old.data_class then
    raise exception
      'os_lab_agents: data_class is frozen after insert (% → % on agent %). An agent belongs to one lane for life; re-lane by deleting and recreating, not by editing the column — that is the wall between public and internal work.',
      old.data_class, new.data_class, old.slug
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_agents_class_freeze_guard() from public;
revoke all on function public.os_lab_agents_class_freeze_guard() from anon;
revoke all on function public.os_lab_agents_class_freeze_guard() from authenticated;

drop trigger if exists os_lab_agents_class_freeze_guard on public.os_lab_agents;
create trigger os_lab_agents_class_freeze_guard
  before update on public.os_lab_agents
  for each row execute function public.os_lab_agents_class_freeze_guard();

-- --- guard 2: anthropic endpoint pin ---------------------------------------
create or replace function public.os_lab_providers_endpoint_pin_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the Anthropic row is pinned, because it is the only destination the
  -- internal boundary trusts by name. deepseek/kimi base_urls stay editable —
  -- they are the public lane's endpoints and carry no internal content.
  if new.name = 'anthropic' and new.base_url is distinct from 'https://api.anthropic.com' then
    raise exception
      'os_lab_providers: the anthropic row is pinned to https://api.anthropic.com (got %). Internal SAMB data is routed to this row by name; repointing its base_url would send that data elsewhere. Moving the Anthropic endpoint is a migration, not a column edit.',
      new.base_url
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_providers_endpoint_pin_guard() from public;
revoke all on function public.os_lab_providers_endpoint_pin_guard() from anon;
revoke all on function public.os_lab_providers_endpoint_pin_guard() from authenticated;

drop trigger if exists os_lab_providers_endpoint_pin_guard on public.os_lab_providers;
create trigger os_lab_providers_endpoint_pin_guard
  before insert or update on public.os_lab_providers
  for each row execute function public.os_lab_providers_endpoint_pin_guard();
