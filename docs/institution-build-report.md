# The institution and the floor — build report

One continuous run, seven phases, September 2026. Branch
`claude/adoring-franklin-m3cr1j`.

This is the Part 7 report. It is written to be read once, by the director,
and then left as the record. Where a number appears it was measured; where
something was not measured this says so rather than estimating and calling
it a measurement. `PROGRESS.md` is the phase-by-phase log, `DECISIONS.md`
the numbered decisions, `INSTITUTION.md` the org and its prompts,
`PLACEHOLDERS.md` what is stubbed. This file says what happened and what
is not true that you might otherwise assume.

---

## 1. Audit findings

### 1.1 The token-increment answer

The audit question has two readings and both have answers, so both are
here.

**Reading A — do token counts increment as a run streams?** No. They are
written **exactly once, at completion**.
`supabase/functions/run-lab-agent/index.ts` streams text to the browser
frame by frame but accumulates `tokensIn` / `tokensOut` in local
variables and writes them in a single terminal `restUpdate` on
`os_lab_runs`, together with `cost_usd` and `duration_ms`, behind a
`finalized` latch that makes a second write impossible. The comment at
line 220 states the reason: a malformed frame is dropped rather than
aborting, because "the terminal usage frame is what accounting needs, and
both providers send it last and well-formed or fail the whole request".

Three consequences the institution had to absorb:

1. **A run that is killed mid-flight has no token count at all.** Not a
   partial one — `null`. The row stays `running` and is inspectable, which
   the executor prefers to throwing inside a cancelled stream.
2. **There is no live spend figure.** B-10's "actual after" is genuinely
   after; during a `full` run the director can see how many calls have
   completed but not what has been spent so far.
3. **Progress on the floor cannot be measured and is therefore an
   estimate, labelled one** (D-05). `progressOf()` in
   `src/logic/floor/institution/project.ts` derives a percentage from the
   assignment's *stage*, and the HUD says "estimated" beside it. A bar
   that looks measured and is guessed is precisely the failure this
   institution exists to prevent, so it is not allowed to look measured.

The audit also found that **no token or cost accounting existed anywhere
in this codebase before the Lab**: `run-research-prompt` returns the
provider's `usage` object and nothing reads it. B-10's estimate/actual
machinery (`_shared/institution/weight.ts`) is new ground, not a reuse.

**Reading B — does `os_lab_agents.version` increment on a prompt edit?**
It did, and the institution **reversed that decision**. The Phase 0 Lab
audit (`docs/lab-phase-0-findings.md`, finding C10) set v1 semantics as
"version starts at 1 and increments on any edit to `system_prompt`; **no
history table** (that would be the version-compare feature by the back
door)". B-1 makes a history table mandatory: a proposal has to exist as a
row before the director approves it, and the thing he approves has to be
comparable with what is live. `os_inst_agent_versions` is that table.
`20260910000101` backfills every live prompt as its agent's active
version 1 and the trigger in `...100` freezes a version row after insert,
so the increment now records a promotion rather than an edit — because an
edit by anything other than the director no longer happens.

### 1.2 The grant model was open twice, in two different ways

This is the finding worth remembering, because it will recur on the next
migration anyone writes here.

**Supabase grants EXECUTE, INSERT, UPDATE and DELETE to `anon`,
`authenticated` and `service_role` explicitly**, as part of its default
privileges. `revoke ... from public` does not remove them: it revokes the
`PUBLIC` pseudo-role, and these are named grants. Every RLS argument in
this repo assumes the opposite.

* After `...100`, `anon` and `authenticated` could EXECUTE
  `os_inst_eval_score(uuid)` and even the trigger function
  `os_lab_agents_prompt_lock()`. Fixed by `...102`: per-role revokes on
  all 19 functions, then the intended grants, plus 60 grant-matrix
  assertions in `supabase/tests/institution_guards.sql` and a negative
  control in `scripts/institution-tests.sh` that re-grants `anon` on the
  scorer and asserts the suite goes red.
* The same class on tables: `anon` and `authenticated` held INSERT,
  UPDATE and DELETE on all 13 institution tables. Fixed by `...104`:
  revoke every write on every table first, then grant back exactly 8
  INSERTs and 4 UPDATEs. DELETE is granted nowhere.

Neither hole was reachable through the app — RLS still refused every row —
but "RLS refused it" is one layer, and the whole posture of this schema is
that one layer is not a boundary. Recorded as D-08.

**A catalog check cannot find this.** Both were found by *attempting the
call as each role* against live production and reading the refusal. That
is now the house method: `institution_guards.sql` attempts ~50 violations
under two identities and returns zero rows when healthy.

### 1.3 A wrong answer in the held-fixed evaluation set

B-9's set is the instrument that decides whether a promotion helped. One
of the six seeded evaluations asked for a CAGR and the seeded answer was
**4.23%**; the B-7 sandbox, asked the same question, returned **4.22%**.
The sandbox was right. Worse, the rubric's token-bounded number matcher
would have marked the *correct* answer wrong, so the instrument was
mis-calibrated in the direction that punishes a better agent. Fixed by
`20260910000103`.

An evaluation set nobody has checked is not a control, it is a source of
confident error with an official-looking score attached.

### 1.4 `current_user` inside a `SECURITY DEFINER` function

Already a landmine in `CLAUDE.md` (#11) and it nearly recurred: a gate
written against `current_user` reads `postgres` no matter who called, so
it never fires. Every gate in `...100` uses `current_setting('role',
true)` or `os_key_valid()`, and `institution_guards.sql` tests each gate
**behaviourally** — by calling through it as the wrong identity — rather
than by checking that the predicate is present in the catalog.

---

## 2. The organisation as built

Ten rooms, 47 seats, 21 agents seeded, 12 seats deliberately empty.

| Room | Lead | Owns | Specialist seats | Unstaffed |
| --- | --- | --- | --- | --- |
| Program Office | `evidence-coordinator` | Runs the whole pipeline: intake, routing, arbitration, staffing, budget, progress | — | 0 |
| Framing Office | `framing-lead` | The question | 3 | 1 |
| Methodology Desk | `methodology-lead` | How the work is done | 3 | 1 |
| Evidence & Data Acquisition | `evidence-lead` | What is known | 7 | 1 |
| Data Engineering | `data-engineering-lead` | The shape of the data | 3 | 2 |
| Quantitative Analysis | `quant-lead` | The numbers | 4 | 2 |
| Domain Synthesis | `synthesis-lead` | The argument | 7 | 1 |
| Verification | `verification-lead` | Whether it holds — never skipped, at any weight class | 6 | 2 |
| Editorial | `editorial-lead` | The delivery | 4 | 2 |
| Editorial Committee | `editorial-committee` | Fitness to carry the director's name | — | 0 |

**Eight of the ten leads have no agent row.** Only the Program Office lead
(pre-existing) and the committee (seeded, human-owned) exist. This is the
design, not an omission: the Program Office authors a lead when a brief
first reaches an unstaffed lead desk, and a lead fills its own phantom
specialist desks (D-03, D-19). Every agent created that way is
**`public`**-lane, enforced at birth by a trigger (B-3), so no coordinator
can mint itself something that reads SAMB's figures.

The consequence, stated plainly: **the institution has been built and has
never run.** `os_inst_briefs` is empty. The eight lead prompts do not
exist as text. See §9.

### How work moves

Director → Program Office (restates the question, says what would count as
an answer, picks a weight class, writes a cost estimate, routes) →
each department in pipeline order (lead accepts *or returns it as
unanswerable-as-written*; assigns specialists; peer review inside the
department; lead review; submit) → Editorial Committee (per-claim
findings, verdict, proposals) → bounded debate → director.

Every loop is bounded by a CHECK constraint, not by convention: peer
review 2 rounds, lead rework 2, upstream returns 2, debate 2. The database
refuses a third and the suite proves it by attempting one.

**A department that cannot refuse bad input is a conveyor belt, not a
function.** Refusal is in every lead's instructions and is the first
decision the contract asks for.

---

## 3. Migrations applied, and the violations attempted against each

Nine migrations, all applied one at a time through `apply_migration`
against production, all with a `down/` rollback. `supabase db push`,
`migration up`, `db reset` and `db remote commit` were never run
(`CLAUDE.md` landmine 12).

| File | Ledger name | What it does |
| --- | --- | --- |
| `...099_institution_schema` | `institution_schema` | 14 public tables + `private.os_inst_evaluation_rubrics`; provenance columns on `os_lab_agents`; B-5 CHECK bounds; select-only RLS; realtime publication |
| `...100_institution_guards` | `institution_guards` | B-1 prompt lock, B-3 lane-at-birth, version immutability, corpus hash/lane/immutability, review/debate/submission guards, B-9 owner guards, append-only events, 19 definer RPCs |
| `...101_institution_seed` | `institution_seed` | 10 departments, 47 seats, 21 agents, 6 evaluations + private rubrics, version-1 backfill |
| `...102_institution_function_grants` | `institution_function_grants` | Per-role EXECUTE revokes on all 19 functions, then the intended grants (see §1.2) |
| `...103_institution_eval_cagr_fix` | `institution_eval_cagr_fix` | Corrects the wrong CAGR answer and its token-bounded rubric (see §1.3) |
| `...104_institution_director_writes` | `institution_director_writes` | Revokes every write on all 13 tables, then key-gated INSERT/UPDATE on 8 pipeline tables. Corpus, egress and evaluations stay service-role only |
| `...105_institution_program_office_proposal` | `institution_program_office_proposal` | The Program Office's own extension, as `status='proposed'` — the institution's first proposal is against itself, and the director decides it |
| `...106_institution_committee` | `institution_committee` | The committee agent (internal lane, Anthropic), its launch version, `os_inst_eval_score_owner()`, seat INSERT grant |
| `...107_institution_director_evals` | `institution_director_evals` | `os_inst_version_set_eval_owner()` — B-9 scoring for a client-side stepper |

### Violations attempted, and refused

Proved at three levels. **The harness** (`scripts/institution-tests.sh`:
throwaway cluster, full replay of all 104 migrations, two negative
controls that must go red). **Live production** (27 attempts, each rolled back).
**The deployed function** (`?selftest=1`, 13 attempts against the running
code, all refused, HTTP 200).

| Attempted | Result |
| --- | --- |
| An agent writes a live `system_prompt` | refused (B-1 trigger) |
| A coordinator creates an `internal`-lane agent | refused (B-3 lane-at-birth) |
| An agent edits its own authorship provenance | refused (frozen after insert) |
| A version row edited after insert | refused (immutable) |
| Promoting the same version twice | refused |
| A proposal with no rationale | refused (B-1) |
| A corpus record without a content hash | refused |
| A corpus record edited after insert | refused |
| A third peer-review round | refused (B-5 CHECK) |
| A third rework | refused (B-5 CHECK) |
| A third upstream return | refused (B-5 CHECK) |
| A third debate round | refused (B-5 CHECK) |
| A review by the work's own author | refused |
| A lead review by someone who is not that lead | refused |
| A committee review by an agent that is not the committee | refused |
| An agent writes or reads an evaluation rubric | refused (rubric lives in `private`) |
| An agent scores its own evaluation run | refused (score only through the scorer) |
| An evaluation answer edited after the run | refused (frozen) |
| An agent attaches a before/after score to a proposal | refused |
| `service_role` reaching a key-gated wrapper | refused |
| An event row updated or deleted | refused (append-only) |
| `anon` / `authenticated` EXECUTE on any institution function | refused (after `...102`) |
| `anon` / `authenticated` INSERT/UPDATE/DELETE on any institution table | refused (after `...104`) |
| DELETE by any client role, anywhere | refused (granted nowhere) |
| An outbound query carrying internal content | blocked and logged (B-4 egress check) |
| A sandbox script opening a network connection | refused (no network primitive exists) |
| A sandbox script reading a non-corpus input | refused (inputs are corpus-addressed) |
| A figure in output prose with no backing datapoint | refused (G-NUMBER) |
| An agent minting its own `[C]` / `[sim:]` exemption tag | refused |
| The committee is created in the `public` lane | caught by the suite |
| The committee has no launch version | caught by the suite |
| A client role updating or deleting a seat | refused (INSERT only) |

The suite carries an **audit-inert floor of 157 checks**: if the matcher
ever breaks, the suite fails rather than silently reporting health.

---

## 4. The prompts, in full

**They are in `INSTITUTION.md` §7, not duplicated here**, because one
canonical copy that stays current beats two that diverge.

* **§7.2 — the leads.** There is no standing lead prompt for any of the
  eight department leads, and §7.2 explains why at length. What governs a
  lead today is the `renderLeadIntake` / `renderLeadReview` template,
  reproduced there in full, instantiated per department from that
  department's own `purpose` and `accountable_for` columns — all eight
  instantiations are tabulated.
* **§7.3 — the committee.** The full 3,005-character prompt, verbatim.
  Human-owned (B-2), seeded by `...106`, internal lane, Anthropic
  provider, and locked by the same B-1 trigger as every other agent: the
  committee cannot edit its own prompt either.

The one line from the committee's prompt worth repeating here, because it
is the institution's whole theory of itself:

> You do not decide whether the output is published — that is the
> director's, and your findings and the rejection reasons he writes are
> the only external check on you.

---

## 5. Cost and time per weight class

`estimate()` counts the calls a class implies over the actual routing —
explicitly, line by line, "so an estimate that is wrong is wrong in a way
a reader can point at" — and prices them at the caller's measured tokens
per call.

| Class | Max departments | Specialists each | Committee | Debate | Proposals | Evals |
| --- | --- | --- | --- | --- | --- | --- |
| `brief` | 2 (the one it needs + Verification) | 1 | — | — | — | — |
| `standard` | 6 | 2 | yes | — | — | — |
| `full` | 9 | 3 | yes | yes | yes | yes |

At **9,000 tokens per call and $6 per million tokens** — an *assumption*
for illustration, flagged as one; the real figures come from `os_lab_runs`
and the provider row, and `Estimate.measured` reports which:

| Class | Departments routed | Model calls | Tokens | USD |
| --- | --- | --- | --- | --- |
| `brief` | 2 | 12 | 108,000 | $0.65 |
| `standard` | 6 | 45 | 405,000 | $2.43 |
| `full` | 8 | 85 | 765,000 | $4.59 |

A `full` run: 2 intake/routing, 8 lead intake, 24 specialist, 24 peer
review, 16 lead review and submission, 1 committee, 4 debate, 2 proposals,
4 evaluations.

**Elapsed time is not estimated, because there is nothing to estimate it
from.** The audit found run history for exactly one agent
(`evidence-literature`, median 13.4 s across 5 runs). Multiplying one
agent's median by 85 calls and presenting the product as a duration would
be arithmetic dressed as evidence. `Estimate.measured` is `false` for
every class today and the director's room shows the estimate marked
unmeasured until `os_lab_runs` has history to draw on.

**Verification is in every class, `brief` included.** It is not a stage
the Program Office can drop to save budget: skipping it is the cheapest
possible way to produce a confident wrong number.

---

## 6. Placeholders

All 25 are in `PLACEHOLDERS.md` with what each stands in for and what
replaces it. The ones that change how you should read the system:

| # | Placeholder | Why it matters |
| --- | --- | --- |
| P-01 | 8 lead seats with no agent row | The institution cannot run a brief end to end until the Program Office authors them |
| P-02 | 4 phantom specialist seats | Named in the spec; their leads author them |
| P-11 | No search API key; the default backend is DuckDuckGo's keyless HTML endpoint | A 403 or 429 is archived **with its status**, never returned as "no results". Set `INSTITUTION_SEARCH_URL` / `INSTITUTION_SEARCH_API_KEY` as function secrets |
| P-12 | The sandbox library is 41 functions, not a statistics package | Regression, forecast, Monte Carlo, scenario, sensitivity, NPV/IRR and descriptive statistics are implemented. Anything else is a script over them |
| P-24 | Progress is derived from stage, not measured | See §1.1. Labelled at every surface |
| P-23 | `coffeeBar` furniture exists in the catalog and is placed nowhere | **Proposed for deletion, not deleted** (`CLAUDE.md` §11) |

---

## 7. Decisions taken under 0-C

27 entries in `DECISIONS.md`, each with the alternative that was rejected.
The ones that shaped everything downstream:

| # | Decision |
| --- | --- |
| D-01 | Program Office lead is `evidence-coordinator`; `pmo-coordinator` is a Domain Synthesis specialist. Rejected: a new `program-office-lead`, which would have left the existing coordinator with nothing to coordinate |
| D-02 | The eight "existing" skill agents had no rows; they are seeded by migration as director-created, with lanes assigned by what they read |
| D-05 | Progress is an estimate and is labelled one (see §1.1) |
| D-08 | The grant model is asserted per role, not assumed from `revoke ... from public` (see §1.2) |
| D-12 | The stepper runs in the **client**, not a new Edge Function — matching how the Lab already works, because every billable call here is user-initiated and there is no cron in the subsystem. Accepted consequence: a run stops when the director closes the tab and resumes from the brief's state, because every step is a row before it is a fact |
| D-18 | Two key-gated wrappers for B-9 scoring, because D-12 made the director the caller and `...102` had granted the scorer to `service_role` alone |
| D-19 | An empty lead desk is staffed by the Program Office, a named empty specialist desk by that department's lead — otherwise the first brief reaches an unstaffed Framing Office and stops |
| D-20 | A refused evaluation run is **unscored, not zero**. Averaging a refusal in as 0 reads as the agent failing an instrument that never ran |
| D-21 | The floor reads through the repository; no second data layer. A Realtime change re-reads rather than applying the payload, because an incremental applier is a second copy of the pipeline's rules and the second copy is the one that drifts |
| D-23 | `bot-crossing/` was deleted, not archived |
| D-25 | A foreign framework's agent lands in the program office, never in a guessed department |

---

## 8. The floor: render budget and bundle

### Frame rate — what was and was not measured

**The frame rate has not been measured on your hardware, and this report
will not invent a number.** The only machine available to this run was the
build container: **4 vCPU Intel Xeon @ 2.10 GHz, 15 GB RAM, no GPU, WebGL
through SwiftShader software rasterisation**. On that, the production
build at 43 agents renders at **0.8–1.6 fps, ~950–1,230 ms per frame**.
That figure is a software-rasteriser floor. It says the scene composes,
loads the rig and draws; it says nothing about a real GPU.

To read the real one: open the floor with `?dev=1` and look at the dev
panel, or read `window.__floorPerf`.

What *was* measured, and is hardware-independent, on the production build
at 1600×1000 with 43 agents (27 on the expensive path, 16 quiet):

| | |
| --- | --- |
| Draw calls | 321–337 |
| Triangles | 753,000 |
| Skinned avatar runtimes | 27 (22 seated, 5 standing) |

The budget's central bet: a skinned avatar is ~8.5k vertices, 65 joints,
an animation mixer and a per-frame skinning pass, and **only five states
earn one** — walking, working, collaborating, delivering, error.
Everything else is a quiet desk: three boxes and a sprite, `castShadow`
off, raycast disabled. Skinned meshes cast no shadow at all; each avatar
gets a contact disc instead, because at this staff count the shadow pass
was the single largest cost and what it bought was a shadow nobody reads.
`src/logic/floor/layout/budget.test.ts` guards the shape of that in CI: it
fails if the campus stops growing linearly in departments, if desks stop
matching seats, or if `idle` ever joins the expensive path.

Worst case today is 35 avatars — every staffed seat busy at once, which
would require the Program Office to route one brief to every department.

### Bundle report (B-11)

| Chunk | Raw | gzip | Three.js? |
| --- | --- | --- | --- |
| `index-*.js` (main) | 1,858.86 kB | 498.02 kB | **no** |
| `OfficeApp-*.js` (HUD, lazy) | 110.51 kB | 32.01 kB | **no** |
| `OfficeCanvas-*.js` (scene, lazy) | 1,211.97 kB | 371.81 kB | yes |

Probed by grep over the emitted chunks: `WebGLRenderer`, `BufferGeometry`,
`@react-three`, `react-three-fiber`, `postprocessing` and `GLTFLoader` all
occur **0 times** in the main chunk and **0 times** in the HUD chunk.

Cost of the route to every other page in the app, measured by building
twice — once with `/lab/floor` and its nav entry removed, once with them:

| | main chunk | gzip |
| --- | --- | --- |
| without the floor | 1,856.96 kB | 497.32 kB |
| with the floor | 1,858.86 kB | 498.03 kB |
| **the floor's cost** | **+1.90 kB** | **+0.71 kB** |

The Phase 0 baseline was 1,808.69 kB / 485.16 kB; the remaining ~50 kB of
growth is Phases 2–6 — the institution's types, repository and director's
room — not the floor. The 2.3 MB GLB is a static file under `public/`, so
it is in no chunk and is fetched only when the canvas mounts.

---

## 9. What was not built, and why

1. **No brief has ever run end to end against a live provider.** This is
   the largest gap and everything else in this section follows from it.
   Every part is proved — the department contract has 17 test files, the
   committee loop runs end to end in `committee.test.ts`, the tool layer
   self-tests against the deployed function — but the *whole* has been
   exercised only against fixtures. The reason is that a `full` run is
   ~85 billable calls at an unmeasured cost, against an institution whose
   eight leads do not exist yet, and this run held no director key: every
   billable call in this codebase is user-initiated and explicitly
   confirmed, which is exactly the property that made it impossible to
   start one autonomously. **This is the first thing to do next**, and it
   is what fills §4's gap and §5's `measured: false`.

2. **The eight lead prompts.** Consequence of (1). They are authored on
   first contact with a brief.

3. **No elapsed-time estimate.** Consequence of one agent's run history
   (§5).

4. **No search API key.** The default backend is DuckDuckGo's keyless HTML
   endpoint (P-11), which rate-limits. Archiving the 429 rather than
   reporting "no results" is the correct behaviour and also a poor
   substitute for a contract.

5. **No RLS suite run for Phase 7.** No SQL changed in that phase, so
   `scripts/*-tests.sh` was not required and was not run. Phases 1–5 ran
   `scripts/institution-tests.sh` after every migration.

6. **No frame rate on real hardware** (§8).

7. **The mock's departments are the fallback spec, not the database.**
   `?mock=1` builds from `FALLBACK_SPEC`, which happens to match the live
   specialist counts exactly today. If a department is added, the mock
   will lag until `FALLBACK_SPEC` is updated. The real floor reads the
   database and does not.

---

## 10. Where the codebase contradicts the prompt's assumptions

Stated in the prompt's own order. In each case the codebase won, because
the codebase is what ships.

1. **"Bot Crossing lands at `/lab/floor`."** *There is no router.*
   `CLAUDE.md` §1: "Routing: **None.** No router dependency. Views are
   zustand state." The Finish line owns the only URL in the app, and
   landmine 7 says leaving it must restore the address. So the floor is a
   `LabView` value, reached at **Lab → The floor**; `/lab/floor` is the
   name of the view in this report and in the code comments, not an
   address you can type. Adding a router for one view would have been a
   routing change under `CLAUDE.md` §11, which requires asking first.

2. **The prompt assumes an agent runtime that streams progress.** It does
   not (§1.1). Tokens land once, at completion; there is no percentage
   anywhere to read. Everything the floor shows as progress is derived
   from a stage and labelled an estimate.

3. **The prompt assumes a server-side stepper.** The Lab is
   client-driven: `run-lab-agent` executes one agent call per request and
   the browser drives the chain (D-12). The institution follows that
   pattern rather than introducing a second one. This bit twice — B-9's
   scorer had to grow two key-gated wrappers (D-18) because the caller
   turned out to be the director's browser, not a service role.

4. **The prompt assumes `revoke ... from public` closes a function.** It
   does not, in Supabase (§1.2). Two migrations exist solely because of
   this.

5. **The prompt's phantom-desk requirement assumes the seats are the
   exception.** Twelve of 47 are empty, including *every department
   lead*. The floor therefore renders phantom plates at every zoom while
   occupied quiet desks hide theirs until you zoom in (D-27) — the
   opposite of the emphasis the prompt implies, and the right way round
   for an institution in this state.

6. **The prompt treats the Lab as a place where things can be added.**
   `CLAUDE.md` §10 says the Lab evidence layer is half-built, not dead,
   and that nothing there may be deleted without asking. Nothing was.
   `os_lab_datapoints`, `os_lab_claims`, `os_lab_outputs`,
   `os_lab_questions`, `os_lab_projects` and `os_lab_source_documents`
   remain at zero rows; the institution writes to its own 14 tables and
   the epistemic gates are untouched.

7. **"Delete the standalone pnpm root" versus `CLAUDE.md` §11's "delete a
   file believed unused — propose it."** The instruction to delete
   `bot-crossing/` is explicit and specific, so it was carried out
   (D-23). The general rule was applied to the one thing the instruction
   did *not* name: `coffeeBar` furniture, now unplaced by the institution
   floorplan, is **proposed for deletion in `PLACEHOLDERS.md` (P-23) and
   left in the tree**.

8. **Dependencies.** `CLAUDE.md` §11 forbids adding one without asking.
   Migrating the floor necessarily added `three`, `@react-three/fiber`,
   `@react-three/drei`, `@react-three/postprocessing`, `postprocessing`,
   `honeycomb-grid`, `zod` and `@types/three`, all pinned exactly. The
   instruction to migrate the floor is the authorisation; naming them
   here is the disclosure. `honeycomb-grid` looks unnecessary and is not:
   it is the **test oracle** the hand-written hex maths is checked
   against, tree-shaken out of the app path. `next`, `fastify`,
   `@fastify/*`, `ws`, `@tanstack/react-query` and `n8ao` were
   deliberately not carried over.

---

## 11. Verification, in full

Every gate, with real output, at the end of the run:

```
$ pnpm typecheck
> tsc -b --force
(exit 0, no output)

$ pnpm test:run
 Test Files  127 passed (127)
      Tests  2084 passed (2084)

$ pnpm build
dist/assets/index-t0TOY6Jg.css          48.38 kB │ gzip:  10.04 kB
dist/assets/OfficeApp-CtJuHh3D.js      110.51 kB │ gzip:  32.01 kB
dist/assets/OfficeCanvas-UcfACSF5.js 1,211.97 kB │ gzip: 371.81 kB
dist/assets/index-De1nXqHM.js        1,858.86 kB │ gzip: 498.02 kB
✓ built in 13.89s
```

SQL suites (`scripts/institution-tests.sh`, plus the pre-existing five)
were run after every migration in Phases 1–5. No SQL changed in Phases 6
or 7, so none was required there — but the institution suite was re-run
at the end of the run anyway, against the current tree:

```
$ scripts/institution-tests.sh
==> 104 migrations replayed cleanly
ok    institution_guards (B-1 prompt lock, B-2 committee, B-3 lane at birth,
      data_class propagation, reviews, B-5 bounds, B-9 evals, 1-E decisions)
==> negative control: dropping os_lab_agents_prompt_lock
ok    suite goes red when the prompt lock is dropped
==> negative control: re-granting anon EXECUTE on os_inst_eval_score(uuid)
ok    suite goes red when anon can call the scorer
PASS — the institution's guards hold at the database layer, both negative
controls red as required
```

The one honest caveat on the test count: the commit message for Phases 4+5
said 1,954 tests, which was written before the run and was wrong; 1,921
was the measured figure, corrected in `PROGRESS.md` in a follow-up commit
rather than by rewriting history. Every figure in this report was measured
after the change it describes.
