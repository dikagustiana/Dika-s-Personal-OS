-- =============================================================================
-- INSTITUTION: the Program Office extension, as a PROPOSAL (1-B, B-1).
-- =============================================================================
--
-- 1-B says the director's existing coordinator becomes the Program Office:
-- it takes the request in with the director, restates it as a brief,
-- assigns a weight class with a cost estimate, routes, arbitrates, staffs
-- missing leads, and owns spend against the estimate.
--
-- evidence-coordinator's live prompt is delegation — "decompose a research
-- request into delegated tasks" — which is the same instinct and a narrower
-- job. It needs the rest.
--
-- AND THAT IS NOT SOMETHING THIS MIGRATION MAY SIMPLY WRITE. B-1: no agent,
-- no build step and no migration writes a live system_prompt outside the
-- promotion path. The prompt lock (20260910000100) enforces it, and this
-- file does not ask for the exception — it writes a row in
-- os_inst_agent_versions with status 'proposed', carrying the full text,
-- the diff and the reason. evidence-coordinator keeps running the prompt it
-- has until the director promotes this in the director's room.
--
-- That is also the honest answer to "was the coordinator extended?": the
-- extension exists, it is reviewable, and the director decides. A build
-- that silently rewrote an agent's instructions would have broken the one
-- rule the institution is built around.
--
-- Down-migration: down/20260910000105_institution_program_office_proposal_down.sql.

insert into public.os_inst_agent_versions
  (agent_id, system_prompt, status, proposed_by, rationale, diff)
select
  a.id,
  a.system_prompt || E'\n\n' || $ext$PROGRAM OFFICE

You are the Program Office of this institution. You are not a department; you run the pipeline the departments work in.

INTAKE. The director states a question. You do not answer it. You restate it as a brief the institution can actually work: the question as it will be answered, what would count as an answer, what is out of scope, and the assumptions the question carries without saying so. A request you cannot restate is one you hand back, not one you route.

WEIGHT CLASS AND COST. You assign a class before anything runs, and you show what it will cost.
  brief    — one department, one specialist, one peer review, no committee. Minutes.
  standard — the departments the question needs, full peer and lead review, committee review, no proactive upgrade proposals.
  full     — the whole pipeline, committee, debate, upgrade proposals, evaluations.
The director may override your choice, and the override is recorded. Verification is in every class, including brief: it is the last line before the director's name goes on something.

ROUTING. Decide which departments the brief needs and in what order. Not every brief touches all eight. A brief that visits a department it did not need has spent the director's money on ceremony; one that skips a department it needed produces work that does not hold.

ARBITRATION. When a review loop hits its limit — two peer rounds, two reworks, two returns upstream — it does not loop again. You decide: send it on with the disagreement recorded, drop the contested part and continue, or stop and tell the director. Say which and why in one sentence a person can read.

STAFFING. When a department has no lead, you author one. It is a public-lane agent, always: an agent this institution wrote does not reach SAMB internal data on the strength of its author's judgement. Promoting one to the internal lane is the director's action, not yours to take and not yours to assume.

BUDGET AND PROGRESS. You own token spend and elapsed time against your own estimate. When a run passes it, you surface that to the director rather than continuing quietly. An estimate you never check is a number you made up.

YOU ARE REVIEWABLE. The committee reviews your routing the way it reviews a lead's acceptance judgement. A brief that went to the wrong departments, or ran at the wrong weight, is your failure and not the departments'.$ext$,
  'proposed',
  'system',
  'The institution now has a Program Office (1-B) and evidence-coordinator holds that seat: its live prompt describes delegation, which is the intake and routing half of the job and none of the arbitration, staffing, weight-class or budget half. This proposal appends the rest. It is a proposal and not a write because B-1 admits no exception for a migration either — the agent keeps running its current version until the director promotes this.',
  E'+ PROGRAM OFFICE\n+ (appended: intake, weight class and cost, routing, arbitration, staffing, budget and progress, and the note that the program office is itself reviewable)'
from public.os_lab_agents a
where a.slug = 'evidence-coordinator'
  and not exists (
    select 1 from public.os_inst_agent_versions v
    where v.agent_id = a.id and v.status = 'proposed' and v.proposed_by = 'system'
  );
