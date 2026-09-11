# INSTITUTION

The Lab as a think tank: what the audit found, what was built, how each
rule is enforced and where the proof is. Maintained through the run;
sections marked *(Phase N)* are filled when that phase lands.

---

## 1. Audit findings — the live system before Phase 1 (2026-09-10)

Read from the live catalog and data, the edge functions and the host source,
not from the brief.

| # | Finding | Consequence for the build |
| --- | --- | --- |
| A-01 | `os_lab_agents` held 13 agents, 10 internal: business-process-improvement, ceo-briefing-deck, evidence-coordinator, evidence-drafter, evidence-extractor, evidence-framer, evidence-literature, evidence-locator, evidence-modeler, evidence-reviewer, evidence-scout, pmo-coordinator, senior-finance-analyst. Providers: anthropic, deepseek, kimi. | The roster was seated as-is; nothing pre-existing was renamed or re-prompted. |
| A-02 | The brief listed eight further "existing" agents (account-universe-scan, math-specialist, manufacturing-finance-analyst, go-to-market, process-mapper, psak-consolidation, psak-intercompany, deck-layout). None had a row. They exist as the owner's Claude skills. | Seeded from the skills' declared scope as director-created rows (D-02). |
| A-03 | `evidence-coordinator`'s prompt is delegation ("decompose a research request into delegated tasks"); `pmo-coordinator`'s is coordination of the SAMB transformation. | Program Office lead = evidence-coordinator; pmo-coordinator seated in Domain Synthesis (D-01). |
| A-04 | `run-lab-agent` writes token counts once, at completion. Nothing streams. Run history exists for one agent only (evidence-literature; median 13.4 s over its runs). | Floor progress is an elapsed-vs-median estimate, labelled (D-05). |
| A-05 | The epistemic gates G-EXTRACT … G-NUMBER are enforced by 077/079/080/082 at the database; `_shared/numberScan.ts` is mirrored by `src/logic/lab/labNumbers.ts` with a drift test; `_shared/modelEval.ts` rule A5 forbids `eval`, `new Function` and WASM in model specs. | The institution inherits the gates; B-7's sandbox is a separate path, A5 untouched (D-06). |
| A-06 | 092 `lab_public_lane_guards` freezes `data_class` after insert; 093 governs deletes of public-lane rows. | Re-laning is delete-and-recreate; B-3 promotion is a creation-time director act (D-04). |
| A-07 | Production rows: `os_lab_datapoints`, `os_lab_claims`, `os_lab_outputs`, `os_lab_questions`, `os_lab_projects`, `os_lab_source_documents` all 0; `os_lab_agents` 13; `os_lab_runs` 5. The evidence layer is exercised, not adopted (CLAUDE.md §10 confirmed). | The institution's corpus is a new, simpler provenance store (`os_inst_corpus`) that the evidence layer can feed later; nothing in the evidence layer was deleted. |
| A-08 | The live migration ledger uses its own names and versions (CLAUDE.md landmine 12). | Phase 1 entries are named after their files (`institution_schema` …) and applied one at a time. |
| A-09 | Identity in RLS and gates is credential absence: `public.os_key_valid()` reads the `x-app-key` header; the service role sends none. Predicates use the `(select fn())` InitPlan wrapper. | The institution's guards use the same test and the same wrapper (D-10). |
| A-10 | Supabase's default privileges grant EXECUTE on every new `public` function to anon, authenticated and service_role explicitly; `revoke … from public` does not remove them. Found by the live check after applying 100. | Migration 102; 60 grant-matrix checks in the suite (D-08). |
| A-11 | The host has no router. `ShellArea = 'work' \| 'growth' \| 'lab'`; `LabView` is a union in `appStore`. `LabRegistry.tsx` edits `system_prompt` directly. | The director's room is a new `LabView`; the direct editor is blocked by B-1 today and replaced in Phase 6 (D-07). |
| A-12 | `bot-crossing/` is a standalone pnpm root: Next.js, a Fastify event server on :4000 with mock/live adapters, pure core modules (hex grid, A*, layout, lighting, schema, reducer, movement), a reconciler, a canonical event schema. | Phase 7 migrates the pure core and scene into `src/views/lab/floor/`, deletes the server, and projects Realtime rows onto the canonical events. |

---

## 2. Identity and enforcement model

Two identities, told apart by credential absence, exactly as the epistemic
gates do:

- **Director** — request carries `x-app-key`; `public.os_key_valid()` is true.
- **Agent / stepper / anyone else** — no header; `os_key_valid()` is false. The
  edge functions write under the service role and never forward the key.

Three GUCs, transaction-scoped, set only inside the functions named:

| GUC | Set by | Lets through |
| --- | --- | --- |
| `app.inst_promotion` | `os_inst_version_promote`, `_reject`, `_set_eval` | the version-row rewrite and (promote only) the live-prompt write |
| `app.inst_scoring` | `os_inst_eval_score` | the score column on an evaluation run |
| `app.inst_seed` | a migration, for its own session, switched off at its end | director-created internal agents, active versions, evaluations |

No flag, no bypass argument, no dev mode. Everything below is a trigger or a
`security definer` function with `search_path = ''`, EXECUTE revoked per
role (102).

---

## 3. The organisation as built

`kind`: program_office · department · committee. `pipeline_order` is the
default routing and the floorplan order. Status: **live** = agent row
exists; **lead** = seat only, authored by the Program Office in Phase 4
(public, B-3); **phantom** = seat only, authored by its lead in Phase 4;
**committee** = seat only, human-owned prompt seeded in Phase 5.

| Department | Lead | Seats (lane · status) |
| --- | --- | --- |
| 0 Program Office | evidence-coordinator (internal · live) | — |
| 1 Framing Office | framing-lead (lead) | evidence-framer (internal · live), scope-analyst (public · live), assumption-auditor (public · live) |
| 2 Methodology Desk | methodology-lead (lead) | method-scout, method-critic, prior-work-analyst (all public · live) |
| 3 Evidence & Data Acquisition | evidence-lead (lead) | evidence-scout (internal · live), account-universe-scan (public · live), public-data-retriever (public · live), source-appraiser (public · live), evidence-literature (internal · live), evidence-locator (internal · live), evidence-extractor (internal · live) |
| 4 Data Engineering | data-engineering-lead (lead) | consolidation-reporting (phantom), data-reconciler (public · live), dataset-curator (public · live) |
| 5 Quantitative Analysis | quant-lead (lead) | math-specialist (internal · live), evidence-modeler (internal · live), financial-modeling (phantom), scenario-analyst (public · live) |
| 6 Domain Synthesis | synthesis-lead (lead) | senior-finance-analyst (internal · live), manufacturing-finance-analyst (internal · live), go-to-market (internal · live), business-process-improvement (internal · live), process-mapper (internal · live), evidence-drafter (internal · live), pmo-coordinator (internal · live) |
| 7 Verification | verification-lead (lead) | verify-financial-model (phantom), psak-consolidation (internal · live), psak-intercompany (internal · live), provenance-checker (public · live), numeric-auditor (public · live), evidence-reviewer (internal · live) |
| 8 Editorial | editorial-lead (lead) | deck-narrative-drafter (phantom), ceo-briefing-deck (internal · live), deck-layout (public · live), copy-editor (public · live) |
| 9 Editorial Committee | editorial-committee (committee) | — |

Totals: 10 departments · 47 seats · 34 agent rows (16 internal, 18 public)
· 13 seats awaiting an agent row. Every agent row has an active version 1.

Each department row carries `purpose` and `accountable_for` — the sentence
the lead is measured against. They are in `20260910000101_institution_seed.sql`
and readable in `os_inst_departments`.

---

## 4. Enforcement — rule, mechanism, proof

"Harness" = `supabase/tests/institution_guards.sql` via
`scripts/institution-tests.sh` (both identities). "Live" = attempted against
the production project as the agent identity, rolled back (PROGRESS.md,
Phase 1 table).

| Rule | Mechanism | Proof |
| --- | --- | --- |
| B-1 no agent writes a live prompt | trigger `os_lab_agents_prompt_lock` (before update of `system_prompt`; passes only under `app.inst_promotion`) | harness; live #1 |
| B-1 upgrades are proposals | trigger `os_inst_agent_versions_guard`: born `proposed` with rationale ≥10 chars and a non-empty diff; no UPDATE/DELETE outside the definer functions | harness; live #2–5 |
| B-1 the director promotes | `os_inst_version_promote(uuid)`: key-gated; retires the active row, writes the prompt (074 bumps `version`), activates, logs `version.promoted` | harness (owner promotes, agent refused, identical prompt refused); live #6 |
| B-2 committee prompt is the fixed point | `os_inst_agent_versions_guard`: a proposal against the committee's agent comes from the committee itself or the director | harness (lead proposing against the committee refused) |
| B-3 agent-authored agents are public | trigger `os_lab_agents_lane_at_birth`: `internal` + `authored_by_agent_id` refused; `internal` without key (or seed) refused; `authored_by_agent_id` frozen | harness; live #7, #8, #10 |
| B-3 re-laning is the director's | `os_lab_agents_lane_at_birth` (update branch) behind 092's freeze | harness; live #9 (092 fires first — D-04) |
| data_class propagation | trigger `os_inst_corpus_guard`: a record derived from an internal record, produced by an internal agent, or belonging to an internal brief cannot be `public`; `os_inst_briefs_guard`: internal never becomes public | harness; live #11–13 |
| B-6 / B-8 provenance | `os_inst_corpus_guard`: `content_hash = sha256(content)` on insert; every column but `review_status` frozen; `derived_from` must resolve | harness; live #14–15 |
| 1-A a review is never by its author; lead review by that lead | trigger `os_inst_reviews_guard` | harness; live #23–24 |
| 1-D committee reviews by the committee; the committee never rebuts; a rebuttal is a record | triggers `os_inst_reviews_guard`, `os_inst_debates_guard` | harness; live #25 |
| 1-A a department does not submit to itself | trigger `os_inst_submissions_guard` | harness |
| B-5 bounded loops | CHECK: `rework_count` 0..2, review `round` 1..2, `return_count` 0..2, debate `round` 1..2 | harness (each bound attempted at 3) |
| B-9 held-fixed evaluations | trigger `os_inst_evaluations_owner_guard` on `os_inst_evaluations` and `private.os_inst_evaluation_rubrics` (key or seed only); `os_inst_eval_rubric()` key-gated; rubric table in `private` with no API-role USAGE; `os_inst_evaluation_runs_guard`: score only under `app.inst_scoring`, answer frozen, no delete; scorer + `set_eval` service-role-only | harness (incl. scorer = 1.000 on a correct answer); live #16–22; grant matrix 0/57 |
| 1-E the director decides | `os_inst_brief_decide(uuid, text, text)`: key-gated; approve/reject/publish; rejection needs a reason; publish after approve; logs `director.decided` | harness; live #26 |
| events are a record | trigger `os_inst_events_guard` (update/delete refused) | harness; live #27 |
| function grants | 102: helpers and trigger functions → nobody; director RPCs → anon, authenticated; scorer writes → service_role | harness (60 cells + negative control); live 0/57 |

---

## 5. Data model (Phase 1)

| Table | Holds |
| --- | --- |
| `os_inst_departments` | the org chart: slug, kind, pipeline order, lead slug, purpose, accountable_for |
| `os_inst_department_members` | seats: (department, agent_slug) unique, role lead/specialist, seat purpose, position |
| `os_inst_agent_versions` | every prompt an agent has had or been proposed: status proposed/active/retired/rejected, rationale, diff, proposer, eval before/after, approval |
| `os_inst_briefs` | a piece of work from intake to publication: question, restatement, weight class, lane, routing, status, estimate vs actual, director decision |
| `os_inst_corpus` | the record every later work cites: kind retrieval/dataset/methodology/execution/assumption/output/submission, hash, URL/status/fetched_at/query, provenance jsonb, derived_from, review_status |
| `os_inst_assignments` | one unit of work by one agent: kind, status, input/output, output corpus id, rework count, round, refusal reason |
| `os_inst_reviews` | peer / lead / committee reviews with findings and verdict |
| `os_inst_submissions` | a department handing work on, with return count |
| `os_inst_debates` | rebuttals to reviews, round-bounded, weighed later |
| `os_inst_evaluations` + `private.os_inst_evaluation_rubrics` | the held-fixed set and its private rubrics |
| `os_inst_evaluation_runs` | an agent's answer and its score, per phase before/after/baseline |
| `os_inst_egress_blocks` | B-4 blocks logged by the tool layer *(writer in Phase 2)* |
| `os_inst_events` | append-only log the floor projects |
| `os_lab_agents` (+2 cols) | `authored_by_agent_id`, `authoring_purpose` — provenance of an agent |

---

## 6. Evaluations (B-9)

Six public-knowledge tasks, one per pipeline department, weight 1 each:
`eval-bounded-review` (framing), `eval-method-cagr` (methodology),
`eval-primary-vs-secondary` (evidence), `eval-reconcile-units` (data
engineering), `eval-range-not-point` (quant), `eval-unattributed-claim`
(verification). Rubrics live in `private` and score deterministically:
`mustContain` (fraction hit), `mustContainNumbers` (token-bounded regex),
`mustNotContain` (all-or-nothing), `mustCite` (`[corpus:<id>]` or
`assumption:`), weighted; the score is `round(total / total_weight, 3)`.
Before/after scoring on promotion is Phase 5. The director extends the set
in the director's room (Phase 6); an agent cannot, and the harness proves it.

---

## 7. Prompts

**7.1 Seeded specialists (Phase 1).** The 21 prompts are in
`supabase/migrations/20260910000101_institution_seed.sql`, verbatim, and in
`os_inst_agent_versions` as version 1. The 13 pre-existing prompts were not
changed; each is backfilled as its agent's active version 1.

**7.2 Leads — THERE IS NO STANDING LEAD PROMPT, AND THIS IS THE DESIGN.**

Read this before looking for one. Eight of the ten `lead_agent_slug`
values — `framing-lead`, `methodology-lead`, `evidence-lead`,
`data-engineering-lead`, `quant-lead`, `synthesis-lead`,
`verification-lead`, `editorial-lead` — have **no row in
`os_lab_agents`**. Verified against production, not assumed. Only the
Program Office lead (`evidence-coordinator`, 944 characters, pre-existing)
and the committee (`editorial-committee`, 3,005 characters, seeded by
migration 106) have a standing `system_prompt`.

Those eight are authored by the Program Office when a brief first reaches
an unstaffed lead desk (D-03, D-19), as **public**-lane agents (B-3), and
no brief has yet run against a live provider. So the text does not exist
to quote. When it does, it will be a row in `os_inst_agent_versions` with
a rationale, and it will appear in the director's room like every other
version.

What governs a lead's behaviour TODAY is a template, rendered per brief
from that department's own `purpose` and `accountable_for` columns. The
template is `renderLeadIntake` and `renderLeadReview` in
`supabase/functions/_shared/institution/protocol.ts`. Reproduced here
because it is the operative instruction, and a reader looking for "the
lead prompt" should find it rather than conclude one is missing:

```
You are the lead of {NAME} in a research institution. {PURPOSE}
You are accountable for: {ACCOUNTABLE_FOR}

QUESTION AS ASKED: …
RESTATED BY THE PROGRAM OFFICE: …
WHAT WOULD COUNT AS AN ANSWER: …
OUT OF SCOPE: …
STATED ASSUMPTIONS SO FAR: …
WEIGHT CLASS: …
{lane note}

WHAT THE PREVIOUS DEPARTMENT SUBMITTED:
{upstream, when there is one}

YOUR BENCH (the specialists you may assign, and what each seat is for):
  {agent-slug} — {seat purpose}

YOUR DECISION. Accept this assignment, or return it as
unanswerable-as-written with a reason. A department that cannot refuse bad
input is a conveyor belt, not a function. Refuse when the question cannot
be answered as written, when what would count as an answer is not stated,
or when what arrived from upstream is not enough to work with.

If you accept: split the work by capability across the seats above. If a
capability you need has no seat, name it in "authorNeeded" and the
institution will have you author one — it will be a public-lane agent,
always.

Reply with ONE fenced JSON block and nothing else:
{ "accept", "reason", "assignTo", "authorNeeded", "instructions" }
```

and, on the way back out:

```
You are the lead of {NAME}, reviewing your department's combined output
against the assignment. You are accountable for: {ACCOUNTABLE_FOR}

{brief block}

THE WORK:
{combined specialist output}

WHAT PEER REVIEW FOUND:
  [{severity}] {claim} — {finding}

Accept it, or return it for rework. You may return work twice; after that
the program office arbitrates rather than a third round (B-5). Accepting
work that should have been returned is your failure, not the specialist's.
```

An unreadable reply to either is **not** treated as acceptance:
`parseLeadIntake` fails closed and returns the assignment with the reason
"the lead did not answer in the required form".

The eight instantiations, as they stand in `os_inst_departments`:

| Lead | {PURPOSE} | {ACCOUNTABLE_FOR} |
| --- | --- | --- |
| `framing-lead` | Owns the question. | A brief that can actually be answered, with scope boundaries and stated assumptions made explicit rather than left implied. Returns unanswerable briefs to the program office rather than passing them on. |
| `methodology-lead` | Owns how the work is done. | A method chosen on the record and defended: the standard approach, its assumptions, known critiques and failure modes. The output is a methodology note in the corpus that later work cites. |
| `evidence-lead` | Owns what is known. | Retrieval, archiving of every retrieval into the corpus before use, and appraisal of source quality: primary vs secondary, publication date, who benefits from the claim. |
| `data-engineering-lead` | Owns the shape of the data. | Retrieved material turned into corpus datasets with hashes, conflicting figures reconciled, every transformation documented. An un-hashed dataset may not enter analysis. |
| `quant-lead` | Owns the numbers. | Analysis and modelling under B-7 with uncertainty stated. A point estimate with no range, or a range with no basis, does not leave this department. |
| `synthesis-lead` | Owns the argument. | Findings turned into a conclusion that follows from them, with inline citations resolving to corpus records. The lead routes by domain; not every specialist works every brief. |
| `verification-lead` | Owns whether it holds. Never skipped, at any weight class. | Arithmetic and tie-outs, standards compliance, G-NUMBER clearance and provenance completeness: every claim resolving to a record or a stated assumption. |
| `editorial-lead` | Owns the delivery. | Formatting for the actual destination — memo, deck, site post, internal SAMB pack — without altering a claim. Any change that shifts meaning goes back to Synthesis. |

**7.3 Committee — human-owned (B-2), in full.**

Seeded by `20260910000106_institution_committee.sql` as
`editorial-committee`, **internal** lane, Anthropic provider, and locked
by the B-1 trigger like every other agent: the committee cannot edit its
own prompt, and neither can any other agent. Only the director can, and
only through a proposal he approves.

> You are the Editorial Committee of this institution. You are an editorial board, not a QA gate: your job is to decide whether work is fit to carry the director's name, and to say what the work reveals about the people who made it.
>
> WHAT REACHES YOU. Submissions from every department the brief visited, each saying what it produced, what it rests on, what its lead is uncertain about and what it explicitly did not do, plus the full review history.
>
> WHAT YOU ASK, IN THIS ORDER.
>   1. What does each claim rest on, and is it traceable to a corpus record? A claim whose citation does not resolve is not a weak claim, it is an unsupported one.
>   2. Does the conclusion survive removing its weakest assumption? Name the assumption and say what happens without it.
>   3. What is asserted with more confidence than the evidence carries? Quote the sentence.
>   4. What is absent that a hostile reader would ask for first? Absence is a finding.
>   5. What does this reveal about the specialist's capability that should be fixed?
>   6. What does this reveal about the lead's assignment and acceptance judgement? A lead that accepted work it should have returned has failed at the part of the job that matters.
>   7. What does this reveal about the program office's routing? A brief that visited the wrong departments, or ran at the wrong weight, is a routing failure and not a department's.
>
> YOUR FINDINGS ARE PER CLAIM. Each one names the sentence or figure it challenges, says what is wrong with it, and carries a severity: blocking (the work cannot go to the director as written), material (it weakens the conclusion), minor (craft). A verdict of accept alongside a blocking finding is a contradiction, and the finding wins.
>
> YOUR PROPOSALS. You may propose an upgrade to any agent, including a lead, including the program office, and including yourself. A proposal is a concrete replacement or addition to that agent's instructions, with the evidence from THIS work that justifies it — not a general wish. Nothing you propose changes anything: the agent keeps running its current version until the director approves it in his room. Propose sparingly. An institution whose committee proposes a rewrite after every brief is not learning, it is churning.
>
> DEBATE. Any party you have made a finding against may contest it in writing. You weigh each rebuttal explicitly — accepted, rejected, or partially accepted — and record the reason. Accepting a rebuttal is not a defeat; a finding that misread the work should be withdrawn and, if your instructions led you to misread it, that is a proposal against yourself. After two rounds the disagreement goes to the director with both positions stated. You do not get the last word by outlasting anyone.
>
> WHAT YOU ARE NOT. You do not rewrite the work. You do not add a claim, a figure or a source of your own. You do not decide whether the output is published — that is the director's, and your findings and the rejection reasons he writes are the only external check on you.

**7.4 Program Office lead** — `evidence-coordinator`'s existing prompt,
unchanged in Phase 1; its Program Office extension is a proposal in Phase 4.

---

## 8. Weight classes and loops

Bounds enforced by CHECK (B-5): peer review 2 rounds, lead rework 2,
upstream returns 2, debate 2 — then escalation. The database refuses a
third; `supabase/tests/institution_guards.sql` proves it by attempting one.

Weight classes live in `_shared/institution/weight.ts` and are chosen by
the Program Office at intake, with a cost estimate written BEFORE the work
and the actual written after (B-10). Both appear side by side in the
director's room, so the gap is read rather than reconstructed.

| Class | Max departments | Specialists each | Peer review | Lead review | Committee | Debate | Proposals | Evals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `brief` | 2 (the one it needs, plus Verification) | 1 | yes | yes | — | — | — | — |
| `standard` | 6 | 2 | yes | yes | yes | — | — | — |
| `full` | 9 | 3 | yes | yes | yes | yes | yes | yes |

`estimate()` counts the calls the class implies over the actual routing —
explicitly, line by line, "so an estimate that is wrong is wrong in a way
a reader can point at" — and prices them at the caller's measured tokens
per call. At 9,000 tokens/call and $6 per million tokens (an **assumption**
for illustration; the real figures come from `os_lab_runs` and the
provider row, and `Estimate.measured` says which):

| Class | Departments routed | Model calls | Tokens | USD |
| --- | --- | --- | --- | --- |
| `brief` | 2 | 12 | 108,000 | $0.65 |
| `standard` | 6 | 45 | 405,000 | $2.43 |
| `full` | 8 | 85 | 765,000 | $4.59 |

A `full` run breaks down as: 2 intake/routing, 8 lead intake, 24
specialist, 24 peer review, 16 lead review and submission, 1 committee,
4 debate, 2 proposals, 4 evaluations.

`withMandatoryStops()` puts **Verification** in every routing at every
class, including `brief`. It is not a stage the program office can drop
to save budget; skipping it is the cheapest possible way to produce a
confident wrong number, which is the failure this institution exists to
prevent. `checkOverrun()` compares actual against estimate and surfaces
the overrun to the director rather than silently continuing.

---

## 9. The floor *(Phase 7)*

The same institution, rendered as a building, at **Lab → The floor**.

The floorplan is generated from the database, not drawn: `buildCampus()`
takes the departments and their seat counts and lays the bays out in
pipeline order down two columns, so a brief's route across the building is
its route through the pipeline. Each department gets three rooms — a desk
bay, its lead's office and its own peer-review cluster — because a peer
review and a lead review are different events and one shared meeting room
would have made them look like the same one. The library (the corpus), the
committee chamber and the director's office are fixed rooms.

A seat with no agent renders as a **named empty desk**: 12 of the 47
today, including all eight department leads (§7.2). That is the honest
picture of an institution that has been built and not yet run.

The floor **derives position and never derives state**. Every figure on it
traces to a row — an assignment, a review, a submission, a debate, an
egress block — and `src/logic/floor/institution/project.test.ts` fails if
one does not. An `internal`-lane agent's task content is masked by default
(3-C); the reveal is per session and never persisted.
