-- ===========================================================================
-- DELETING AN AGENT IS A PUBLIC-LANE PRIVILEGE.
-- ===========================================================================
--
-- The public lane is meant to be disposable: assemble an agent, run it, throw
-- it away, in minutes. That requires a delete verb, and until now the Lab had
-- none at all — os_lab_agents and os_lab_chains were create/update only
-- (src/data/labRepository.ts had no delete before 20260827).
--
-- But delete cannot be uniform across the two lanes. An internal agent is
-- cited by run rows (os_lab_runs.agent_id, a NOT NULL foreign key) and by
-- sibling agents' system prompts, which name slugs as delegation targets.
-- Removing one silently orphans that history. Public agents carry none of
-- that weight by construction.
--
-- So: an internal agent is not deletable from the app. Removing one is a
-- migration — a deliberate act with a diff, the same escape hatch the GROWTH
-- domain guard uses for the same reason.
--
-- WHY A TRIGGER AND NOT ONLY THE REPOSITORY FILTER. The Supabase client sends
-- `.eq('data_class','public')` on its delete, which is the fast failure so the
-- owner reads a sentence instead of a PostgREST error. That filter is not the
-- boundary: a UI-only guard is bypassed by the first caller that forgets, and
-- this codebase has the scar to prove it (labGuards.ts's header, and the
-- view-layer mirrors noted in SYSTEM-MAP §6). The trigger is the boundary.
--
-- Chains are deliberately NOT gated: a chain is a route, not a lane. Deleting
-- one removes an ordering and leaves every agent and run row intact, so it is
-- freely deletable in both lanes.
--
-- Verified on the local replay before writing: os_lab_runs.agent_id is
-- `not null references public.os_lab_agents(id)` with no ON DELETE clause
-- (20260817000073:139), so Postgres already refuses to delete any agent that
-- has ever run. This trigger is therefore belt-and-braces for internal agents
-- AND the thing that lets a never-run public agent be removed cleanly.
--
-- Down-migration:
--   supabase/migrations/down/20260827000093_lab_public_lane_delete_down.sql
-- Standing test:
--   supabase/tests/lab_public_lane.sql (cases 7 and 8)

create or replace function public.os_lab_agents_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.data_class <> 'public' then
    raise exception
      'os_lab_agents: agent % is internal-lane and is not deletable from the app. Internal agents are cited by run history and by sibling prompts; removing one is a migration, not a button.',
      old.slug
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

revoke all on function public.os_lab_agents_delete_guard() from public;
revoke all on function public.os_lab_agents_delete_guard() from anon;
revoke all on function public.os_lab_agents_delete_guard() from authenticated;

drop trigger if exists os_lab_agents_delete_guard on public.os_lab_agents;
create trigger os_lab_agents_delete_guard
  before delete on public.os_lab_agents
  for each row execute function public.os_lab_agents_delete_guard();
