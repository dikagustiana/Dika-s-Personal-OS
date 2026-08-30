-- ===========================================================================
-- THE WALL BETWEEN THE TWO LAB LANES, CALLED RATHER THAN READ.
-- ===========================================================================
--
-- Same contract as every suite here: ZERO ROWS when healthy; any row it
-- returns names what broke.
--
-- Runs as postgres inside one transaction that ends in ROLLBACK — the
-- lab_epistemic_gates.sql posture, which is what makes writing test rows safe
-- against live.
--
-- BEHAVIOURAL, NOT TEXTUAL, and deliberately so. anon_definer_gates.sql
-- matches gate names against prosrc; that check could not tell a gate that
-- runs from a gate that is merely mentioned, and a decorative gate reached
-- production once on the strength of it (20260827000089, corrected by 091).
-- So this file ATTEMPTS the writes and asserts they are refused.
--
--     psql "$DATABASE_URL" -f supabase/tests/lab_public_lane.sql
--     scripts/role-read-tests.sh

begin;

create temp table lane_findings (finding text);

do $$
declare
  v_pub uuid;
  v_int uuid;
  v_anthropic uuid;
  v_examined int := 0;
begin
  select id into v_anthropic from public.os_lab_providers where name = 'anthropic';
  if v_anthropic is null then
    insert into lane_findings values
      ('SETUP: no provider row named anthropic — the internal boundary has no destination to trust.');
    return;
  end if;

  -- Two throwaway agents, one per lane. The public one gets no provider on
  -- purpose: a public agent is not required to name one, which is part of
  -- what makes the lane thin.
  insert into public.os_lab_agents (slug, name, description, system_prompt, data_class, default_provider_id)
  values ('zz-lane-test-public', 'lane test public', '', 'draft an IELTS task 2 essay', 'public', null)
  returning id into v_pub;

  insert into public.os_lab_agents (slug, name, description, system_prompt, data_class, default_provider_id)
  values ('zz-lane-test-internal', 'lane test internal', '', 'analyse SAMB margins', 'internal', v_anthropic)
  returning id into v_int;

  -- === 1. internal → public must be refused (the laundering vector) ========
  v_examined := v_examined + 1;
  begin
    update public.os_lab_agents set data_class = 'public' where id = v_int;
    insert into lane_findings values (
      'LAUNDERING OPEN: an internal agent was flipped to public. Its system prompt carries SAMB context and it can now be pointed at a non-Anthropic provider. os_lab_agents_class_freeze_guard did not fire.');
  exception when others then null;  -- refused: correct
  end;

  -- === 2. public → internal must also be refused ==========================
  -- Both directions, because a public agent promoted into the internal lane
  -- would inherit internal routing without ever having been reviewed for it.
  v_examined := v_examined + 1;
  begin
    update public.os_lab_agents set data_class = 'internal' where id = v_pub;
    insert into lane_findings values (
      'CLASS NOT FROZEN: a public agent was promoted to internal. data_class must be immutable in both directions.');
  exception when others then null;
  end;

  -- === 3. an ordinary edit on a public agent must still WORK ===============
  -- The wall must not make the lane heavy. If editing a prompt fails, the
  -- freeze is over-broad and the lane is unusable.
  v_examined := v_examined + 1;
  begin
    update public.os_lab_agents
       set system_prompt = 'draft an IELTS task 2 essay, band 8 target', name = 'renamed'
     where id = v_pub;
  exception when others then
    insert into lane_findings values (format(
      'LANE TOO HEAVY: editing a public agent''s prompt/name was refused (%s). The freeze must block data_class only.', sqlerrm));
  end;

  -- === 4. internal agents still cannot point away from Anthropic ==========
  -- Pre-existing guard (074). Asserted here because this suite is the one
  -- that would notice if 092 disturbed it.
  v_examined := v_examined + 1;
  begin
    update public.os_lab_agents set default_provider_id = null where id = v_int;
    insert into lane_findings values (
      'BOUNDARY REGRESSED: an internal agent now accepts a null provider. 20260817000074 should refuse this.');
  exception when others then null;
  end;

  -- === 5. the anthropic endpoint must be pinned ===========================
  v_examined := v_examined + 1;
  begin
    update public.os_lab_providers set base_url = 'https://evil.example.com' where id = v_anthropic;
    insert into lane_findings values (
      'ENDPOINT UNPINNED: the anthropic row was repointed at another host. Internal content is sent to base_url in the request body, before any auth failure — this leaks it. os_lab_providers_endpoint_pin_guard did not fire.');
  exception when others then null;
  end;

  -- === 6. public-lane providers stay editable =============================
  -- deepseek/kimi carry no internal content; pinning them would be ceremony.
  v_examined := v_examined + 1;
  begin
    update public.os_lab_providers set base_url = 'https://api.deepseek.com/v2'
     where name = 'deepseek';
  exception when others then
    insert into lane_findings values (format(
      'PIN TOO BROAD: a public-lane provider''s base_url was frozen (%s). Only the anthropic row should be pinned.', sqlerrm));
  end;

  -- === 7. an internal agent must NOT be deletable from the app ============
  v_examined := v_examined + 1;
  begin
    delete from public.os_lab_agents where id = v_int;
    insert into lane_findings values (
      'INTERNAL DELETABLE: an internal-lane agent was deleted. Internal agents are cited by run rows and sibling prompts; os_lab_agents_delete_guard did not fire.');
  exception when others then null;
  end;

  -- === 8. a public agent MUST be deletable — the lane is disposable =======
  -- If this fails the lane is not thin: an agent you cannot throw away is an
  -- agent you hesitate to create.
  v_examined := v_examined + 1;
  begin
    delete from public.os_lab_agents where id = v_pub;
  exception when others then
    insert into lane_findings values (format(
      'LANE NOT DISPOSABLE: deleting a public agent was refused (%s). Public agents must be removable in one click.', sqlerrm));
  end;

  -- Audit-inert floor: a suite that stops attempting things reads healthy
  -- forever. Eight cases are attempted above; fewer means the block aborted
  -- early rather than the schema shrinking.
  if v_examined < 8 then
    insert into lane_findings values (format(
      'AUDIT INERT: only %s of 8 cases were attempted — the suite aborted early. Fix it before trusting a zero-row result.', v_examined));
  end if;
end $$;

select finding from lane_findings order by finding;

rollback;
