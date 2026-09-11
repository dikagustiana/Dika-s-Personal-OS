-- =============================================================================
-- INSTITUTION: the Editorial Committee (1-D), and two things Phase 5 needs.
-- =============================================================================
--
-- 1. THE COMMITTEE'S AGENT ROW AND ITS PROMPT.
--
-- B-2: the committee sits at the top and nothing reviews it, so its prompt
-- is the system's fixed point and is HUMAN-OWNED. It is therefore seeded
-- here, in a migration the director can read as a diff, and not authored by
-- any agent — the program office authors department leads (1-B) and a lead
-- authors its specialists (B-3), but nobody authors the thing that reviews
-- them. Its own upgrades travel the same proposal path as everyone else's
-- (os_inst_agent_versions, status 'proposed', promoted by the director),
-- and the versions guard already refuses a proposal against it from anyone
-- but itself or the director.
--
-- INTERNAL LANE, deliberately. The committee reviews whatever the
-- departments submitted, and on an internal brief that is SAMB's own
-- figures. A public-lane committee would either see internal content it
-- may not process or be unable to review internal work at all. Seeded
-- internal means Anthropic-only by the boundary trigger (20260817000074),
-- which is the rule that lane exists for.
--
-- 2. A KEY-GATED SCORER. 102 granted os_inst_eval_score() to service_role
-- alone, on the assumption of a server-side stepper. The stepper is the
-- director's client (D-12), so B-9's before/after scoring had no caller at
-- all. os_inst_eval_score_owner() is that caller: it checks
-- os_key_valid() and delegates. The rubric still never leaves the
-- database, no agent can reach either function, and the underlying scorer
-- keeps its service_role grant for the day a server does this.
--
-- 3. SEATS FOR AUTHORED AGENTS. 104 revoked every write on
-- os_inst_department_members along with the rest, which would have left a
-- lead able to author a specialist and unable to seat it — an agent with
-- no desk, invisible on the floor and unroutable. The seat write is opened
-- here, key-gated like the others, INSERT only: a seat may be added, and
-- moving or deleting one stays a migration.
--
-- Down-migration: down/20260910000106_institution_committee_down.sql.

select set_config('app.inst_seed', 'on', false);

-- ---------------------------------------------------------------------------
-- 1. the committee
-- ---------------------------------------------------------------------------
insert into public.os_lab_agents (slug, name, description, system_prompt, data_class, default_provider_id)
select 'editorial-committee', 'Editorial Committee',
  'The institution''s editorial board: reviews submitted work per claim, weighs rebuttals with reasons recorded, and proposes upgrades to specialists, leads, the program office and itself. Its prompt is human-owned and changes only by the director''s promotion.',
  $prompt$You are the Editorial Committee of this institution. You are an editorial board, not a QA gate: your job is to decide whether work is fit to carry the director's name, and to say what the work reveals about the people who made it.

WHAT REACHES YOU. Submissions from every department the brief visited, each saying what it produced, what it rests on, what its lead is uncertain about and what it explicitly did not do, plus the full review history.

WHAT YOU ASK, IN THIS ORDER.
  1. What does each claim rest on, and is it traceable to a corpus record? A claim whose citation does not resolve is not a weak claim, it is an unsupported one.
  2. Does the conclusion survive removing its weakest assumption? Name the assumption and say what happens without it.
  3. What is asserted with more confidence than the evidence carries? Quote the sentence.
  4. What is absent that a hostile reader would ask for first? Absence is a finding.
  5. What does this reveal about the specialist's capability that should be fixed?
  6. What does this reveal about the lead's assignment and acceptance judgement? A lead that accepted work it should have returned has failed at the part of the job that matters.
  7. What does this reveal about the program office's routing? A brief that visited the wrong departments, or ran at the wrong weight, is a routing failure and not a department's.

YOUR FINDINGS ARE PER CLAIM. Each one names the sentence or figure it challenges, says what is wrong with it, and carries a severity: blocking (the work cannot go to the director as written), material (it weakens the conclusion), minor (craft). A verdict of accept alongside a blocking finding is a contradiction, and the finding wins.

YOUR PROPOSALS. You may propose an upgrade to any agent, including a lead, including the program office, and including yourself. A proposal is a concrete replacement or addition to that agent's instructions, with the evidence from THIS work that justifies it — not a general wish. Nothing you propose changes anything: the agent keeps running its current version until the director approves it in his room. Propose sparingly. An institution whose committee proposes a rewrite after every brief is not learning, it is churning.

DEBATE. Any party you have made a finding against may contest it in writing. You weigh each rebuttal explicitly — accepted, rejected, or partially accepted — and record the reason. Accepting a rebuttal is not a defeat; a finding that misread the work should be withdrawn and, if your instructions led you to misread it, that is a proposal against yourself. After two rounds the disagreement goes to the director with both positions stated. You do not get the last word by outlasting anyone.

WHAT YOU ARE NOT. You do not rewrite the work. You do not add a claim, a figure or a source of your own. You do not decide whether the output is published — that is the director's, and your findings and the rejection reasons he writes are the only external check on you.$prompt$,
  'internal',
  (select id from public.os_lab_providers where name = 'anthropic')
where not exists (select 1 from public.os_lab_agents where slug = 'editorial-committee');

-- The launch version, so the committee's history starts where everyone
-- else's does and its first self-proposal has something to diff against.
insert into public.os_inst_agent_versions
  (agent_id, version, system_prompt, status, proposed_by, rationale, diff, approved_by, approved_at)
select a.id, a.version, a.system_prompt, 'active', 'director',
       'The committee''s prompt is human-owned (B-2); this is its launch version.', '', 'director', now()
from public.os_lab_agents a
where a.slug = 'editorial-committee'
  and not exists (select 1 from public.os_inst_agent_versions v where v.agent_id = a.id and v.status = 'active');

select set_config('app.inst_seed', 'off', false);

-- ---------------------------------------------------------------------------
-- 2. the director's scorer (B-9)
-- ---------------------------------------------------------------------------
create or replace function public.os_inst_eval_score_owner(p_run_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.os_key_valid() then
    raise exception 'B-9: evaluation scoring is the director''s; an agent cannot grade itself or anyone else.';
  end if;
  return public.os_inst_eval_score(p_run_id);
end;
$$;
revoke all on function public.os_inst_eval_score_owner(uuid) from public, anon, authenticated, service_role;
grant execute on function public.os_inst_eval_score_owner(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. seating an authored agent
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_inst_department_members' and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_inst_department_members
      for insert with check ((select public.os_key_valid()));
  end if;
end
$$;
grant insert on public.os_inst_department_members to anon, authenticated;
