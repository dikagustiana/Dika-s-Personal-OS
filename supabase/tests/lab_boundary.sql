-- ===========================================================================
-- THE LAB DATA BOUNDARY, PROVEN AT THE DATABASE LAYER ALONE.
-- ===========================================================================
--
-- Runs as postgres — superuser, so RLS is not binding and no application
-- code is anywhere in the path. That is the point: Part B of the lab brief
-- requires proof that the DATABASE rejects an internal agent on a
-- non-Anthropic provider with the application layer bypassed entirely, and
-- a superuser session is the strongest bypass available — it stands in for
-- the service role the Edge Function uses, and for any future caller with
-- a bug. If the triggers hold here, no client posture weakens them.
--
-- Same contract as every suite in this directory: every query returns ZERO
-- ROWS when healthy, and any row returned names what broke. Everything
-- happens inside one transaction that ends in ROLLBACK — nothing this file
-- does survives it, so it is safe against a live database too.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/lab_boundary.sql
-- or:   scripts/lab-boundary-tests.sh   (throwaway cluster, full replay,
--                                        negative control included)

begin;

create temp table lab_findings (finding text);

do $$
declare
  v_anthropic uuid;
  v_deepseek  uuid;
  v_kimi      uuid;
  v_internal  uuid;
  v_public    uuid;
  v_flip      uuid;
  v_version   int;
begin
  select id into v_anthropic from public.os_lab_providers where name = 'anthropic';
  select id into v_deepseek  from public.os_lab_providers where name = 'deepseek';
  select id into v_kimi      from public.os_lab_providers where name = 'kimi';

  if v_anthropic is null or v_deepseek is null or v_kimi is null then
    insert into lab_findings values
      ('lab boundary: seed providers missing — apply 20260817000075 before running this suite');
    return;
  end if;

  -- =========================================================================
  -- agents: the guard must REFUSE these four
  -- =========================================================================

  -- 1. internal agent born on DeepSeek.
  begin
    insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id)
    values ('t-internal-on-deepseek', 't', 'p', 'internal', v_deepseek);
    insert into lab_findings values
      ('lab boundary: internal agent ACCEPTED with a DeepSeek default provider');
  exception when others then
    if sqlerrm not ilike '%lab boundary%' then
      insert into lab_findings values
        ('lab boundary: internal-on-deepseek refused, but by the wrong rule: ' || sqlerrm);
    end if;
  end;

  -- 2. internal agent born with NULL provider — the NULL-vacuity case the
  --    brief names explicitly. NOT EXISTS over NULL must refuse, not pass.
  begin
    insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id)
    values ('t-internal-null-provider', 't', 'p', 'internal', null);
    insert into lab_findings values
      ('lab boundary: internal agent ACCEPTED with a NULL default provider');
  exception when others then
    if sqlerrm not ilike '%lab boundary%' then
      insert into lab_findings values
        ('lab boundary: internal-null refused, but by the wrong rule: ' || sqlerrm);
    end if;
  end;

  -- 3. an existing internal agent repointed at Kimi by UPDATE.
  insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id)
  values ('t-internal-ok', 't', 'p', 'internal', v_anthropic)
  returning id into v_internal;

  begin
    update public.os_lab_agents set default_provider_id = v_kimi where id = v_internal;
    insert into lab_findings values
      ('lab boundary: internal agent UPDATE to a Kimi default was accepted');
  exception when others then
    if sqlerrm not ilike '%lab boundary%' then
      insert into lab_findings values
        ('lab boundary: repoint-to-kimi refused, but by the wrong rule: ' || sqlerrm);
    end if;
  end;

  -- 4. a public agent on DeepSeek flipped to internal without repointing.
  insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id)
  values ('t-public-on-deepseek', 't', 'p', 'public', v_deepseek)
  returning id into v_flip;

  begin
    update public.os_lab_agents set data_class = 'internal' where id = v_flip;
    insert into lab_findings values
      ('lab boundary: public→internal flip accepted while the default is DeepSeek');
  exception when others then
    if sqlerrm not ilike '%lab boundary%' then
      insert into lab_findings values
        ('lab boundary: class flip refused, but by the wrong rule: ' || sqlerrm);
    end if;
  end;

  -- =========================================================================
  -- agents: the guard must PERMIT these — an over-blocking boundary is a
  -- different bug with the same shape (nothing runs, nobody trusts it)
  -- =========================================================================

  -- 5. internal on Anthropic (already inserted above as t-internal-ok) —
  --    and a public agent may sit on any provider, NULL included.
  begin
    insert into public.os_lab_agents (slug, name, system_prompt, data_class, default_provider_id)
    values ('t-public-null', 't', 'p', 'public', null);
  exception when others then
    insert into lab_findings values
      ('lab boundary: guard OVER-BLOCKS — public agent with NULL provider refused: ' || sqlerrm);
  end;

  -- =========================================================================
  -- runs: the trigger every dispatch lands on
  -- =========================================================================

  -- 6. THE CENTRAL CASE. A runs row: internal agent, DeepSeek provider,
  --    inserted by a superuser with no application code in the path.
  begin
    insert into public.os_lab_runs (agent_id, provider_id, input, status)
    values (v_internal, v_deepseek, 'internal figures', 'running');
    insert into lab_findings values
      ('lab boundary: RUNS row ACCEPTED for an internal agent on DeepSeek — the boundary does not hold');
  exception when others then
    if sqlerrm not ilike '%lab boundary%' then
      insert into lab_findings values
        ('lab boundary: internal-run-on-deepseek refused, but by the wrong rule: ' || sqlerrm);
    end if;
  end;

  -- 7. Same, via UPDATE: a legal run repointed after insert.
  begin
    insert into public.os_lab_runs (agent_id, provider_id, input, status)
    values (v_internal, v_anthropic, 'internal figures', 'running');
    update public.os_lab_runs set provider_id = v_kimi
    where agent_id = v_internal and provider_id = v_anthropic;
    insert into lab_findings values
      ('lab boundary: RUNS row UPDATE repointed an internal run to Kimi');
  exception when others then
    if sqlerrm not ilike '%lab boundary%' then
      insert into lab_findings values
        ('lab boundary: run repoint refused, but by the wrong rule: ' || sqlerrm);
    end if;
  end;

  -- 8. Permitted: internal on Anthropic, public on DeepSeek.
  begin
    select id into v_public from public.os_lab_agents where slug = 't-public-on-deepseek';
    insert into public.os_lab_runs (agent_id, provider_id, input, status)
    values (v_public, v_deepseek, 'public content', 'running');
  exception when others then
    insert into lab_findings values
      ('lab boundary: guard OVER-BLOCKS — public agent run on DeepSeek refused: ' || sqlerrm);
  end;

  -- =========================================================================
  -- providers: the row the comparisons key on cannot be pulled out from
  -- under the agents that depend on it
  -- =========================================================================

  -- 9. Changing the Anthropic row's adapter while an internal agent
  --    references it. (Renaming is additionally blocked by the unique +
  --    check constraints; the adapter is the mutable surface left.)
  begin
    update public.os_lab_providers set adapter = 'openai' where id = v_anthropic;
    insert into lab_findings values
      ('lab boundary: the Anthropic provider row changed adapter while internal agents reference it');
  exception when others then
    if sqlerrm not ilike '%lab boundary%' then
      insert into lab_findings values
        ('lab boundary: provider mutation refused, but by the wrong rule: ' || sqlerrm);
    end if;
  end;

  -- =========================================================================
  -- version semantics, owned by the same guard
  -- =========================================================================

  -- 10. A system_prompt edit must arrive as version+1 without the client
  --     asking; a no-op edit must not bump.
  update public.os_lab_agents set system_prompt = 'p2' where id = v_internal;
  select version into v_version from public.os_lab_agents where id = v_internal;
  if v_version <> 2 then
    insert into lab_findings values
      ('lab boundary: system_prompt edit did not bump version (expected 2, got ' || v_version || ')');
  end if;

  update public.os_lab_agents set name = 'renamed' where id = v_internal;
  select version into v_version from public.os_lab_agents where id = v_internal;
  if v_version <> 2 then
    insert into lab_findings values
      ('lab boundary: a name-only edit bumped version (expected 2, got ' || v_version || ')');
  end if;
end
$$;

-- The verdict. Zero rows = the boundary holds at the database layer.
select finding from lab_findings;

rollback;
