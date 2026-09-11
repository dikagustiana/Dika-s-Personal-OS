# PROGRESS

Run log for the institution-and-floor build (spec Parts 0–7, one continuous
run, 2026-09-10). One entry per phase. Each entry says what landed, how it
was verified — real output, not a description of output — and what is
deliberately not done yet. Companions: `DECISIONS.md` (why), `INSTITUTION.md`
(the org as built and how it is enforced), `PLACEHOLDERS.md` (what is
stubbed and when it goes), `ASSETS.md` (binary assets and their origin).

Phase commits are `phase N: <what landed>` on `claude/adoring-franklin-m3cr1j`.

---

## Phase 1 — schema, guards, grants, seed — DONE

### What landed

Four migrations, written to the tree and then applied to the live project one
at a time with `apply_migration` (never `db push`), in file order, each with
a down file under `supabase/migrations/down/`:

| File | Ledger name | Contents |
| --- | --- | --- |
| `20260910000099_institution_schema.sql` | `institution_schema` | 14 public tables + `private.os_inst_evaluation_rubrics`; two provenance columns on `os_lab_agents` (`authored_by_agent_id`, `authoring_purpose`); CHECK bounds for B-5 (rework 0..2, review round 1..2, submission returns 0..2, debate round 1..2); select-only RLS gated on the owner key or read key; realtime publication for the floor. |
| `20260910000100_institution_guards.sql` | `institution_guards` | Triggers: B-1 prompt lock, B-3 lane-at-birth + authorship freeze, version immutability (B-1/B-2), corpus hash/lane/immutability, brief lane, reviews (never by author, lead review by that lead, committee review by the committee), debates, submissions, evaluations owner-only, evaluation runs (score only through the scorer, answer frozen), events append-only. Definer RPCs: `os_inst_version_promote/reject` (director), `os_inst_version_set_eval` + `os_inst_eval_score` (service role), `os_inst_eval_rubric` (director), `os_inst_brief_decide` (director). |
| `20260910000101_institution_seed.sql` | `institution_seed` | 10 departments, 47 seats, 21 agents seeded from the owner's skill library (6 internal, 15 public), 6 evaluations with private rubrics, active version-1 backfill for every live prompt. |
| `20260910000102_institution_function_grants.sql` | `institution_function_grants` | Per-role EXECUTE revokes on all 19 new functions, then the intended grants. Exists because the live check after 100 found the grant model open (see Verified). |

Also: `supabase/tests/institution_guards.sql` (attempted violations under
both identities, 60 grant-matrix checks, audit-inert floor of 100 checks) and
`scripts/institution-tests.sh` (throwaway cluster, full replay, two negative
controls that must go red).

### Verified

Local harness, `scripts/institution-tests.sh`, final run:

```
==> 99 migrations replayed cleanly

ok    institution_guards (B-1 prompt lock, B-2 committee, B-3 lane at birth, data_class propagation, reviews, B-5 bounds, B-9 evals, 1-E decisions)

==> negative control: dropping os_lab_agents_prompt_lock
ok    suite goes red when the prompt lock is dropped (it catches the regression)

==> negative control: re-granting anon EXECUTE on os_inst_eval_score(uuid) (the grant 100 left open, 102 closed)
ok    suite goes red when anon can call the scorer (it catches the regression)

PASS — the institution's guards hold at the database layer, both negative controls red as required
```

Live project, violations attempted as the agent identity (connection with no
`x-app-key`, `os_key_valid()` = false), each inside a sub-transaction that
was rolled back whether or not the guard fired, so the probe left no rows:

| # | Attempt | Result |
| --- | --- | --- |
| 1 | direct `UPDATE os_lab_agents SET system_prompt` | blocked, B-1 |
| 2 | version row inserted as `active` | blocked, B-1 "born proposed" |
| 3 | proposal without a rationale | blocked, B-1 |
| 4 | direct `UPDATE` of a version row | blocked, B-1 |
| 5 | `DELETE` of a version row | blocked, immutable |
| 6 | agent calls `os_inst_version_promote()` on its own proposal | blocked, "only the director promotes" |
| 7 | coordinator-authored agent born `internal` | blocked, B-3 |
| 8 | `internal` agent created without the director credential | blocked, B-3 |
| 9 | agent re-lanes a public agent to internal | blocked (by 092's `data_class` freeze, which fires before the B-3 branch — see DECISIONS D-04) |
| 10 | `authored_by_agent_id` rewritten after insert | blocked, B-3 provenance frozen |
| 11 | corpus record produced by an internal agent written as `public` | blocked, data_class |
| 12 | output derived from an internal record written as `public` | blocked, data_class |
| 13 | internal brief downgraded to `public` | blocked, data_class |
| 14 | `content_hash` that does not verify | blocked |
| 15 | corpus content edited after insert | blocked, frozen |
| 16–18 | agent inserts / updates / deletes an evaluation | blocked, B-9 |
| 19 | agent writes a rubric | blocked, B-9 |
| 20 | agent reads a rubric via `os_inst_eval_rubric()` | blocked, B-9 |
| 21 | agent writes its own score on an evaluation run | blocked, B-9 |
| 22 | evaluation answer edited after recording | blocked, B-9 frozen |
| 23 | author reviews its own work | blocked, 1-A |
| 24 | lead review filed by a non-lead | blocked, 1-A |
| 25 | committee review filed by a non-committee agent | blocked, 1-D |
| 26 | agent calls `os_inst_brief_decide()` | blocked, 1-E |
| 27 | `UPDATE` of an event | blocked, append-only |

Live grant matrix (`has_function_privilege` for anon / authenticated /
service_role across the 19 functions, 57 cells):

| When | Mismatches |
| --- | --- |
| after 100 + 101 | 3 — anon and authenticated could execute `os_inst_eval_score(uuid)`; anon could execute the trigger function `os_lab_agents_prompt_lock()` (and by the same mechanism `os_inst_version_set_eval`) |
| after 102 | 0 |

Live seed sanity after 101: 10 departments; 47 seats; 34 agents (16
internal, 18 public), all seated; 34 active version rows, none missing; 6
evaluations, 6 rubrics; 13 seats with no agent row yet (8 leads, 4 phantoms,
the committee); probe residue 0 in every table; `app.inst_seed` unset after
the migration; ledger tail `institution_schema, institution_guards,
institution_seed, institution_function_grants`.

Root gate on this tree: `pnpm typecheck` exit 0; `pnpm test:run` 94 files /
1667 tests passed; `pnpm build` exit 0 (`✓ built in 8.63s`). Main bundle
baseline for the Phase 7 bundle report: `dist/assets/index-*.js` 1,808.69 kB
(gzip 485.16 kB), Vite's >500 kB warning already present before any
Three.js — the floor must not raise this chunk.

### Effect on `main` today

B-1 is live. The legacy prompt editor in `src/views/lab/LabRegistry.tsx`
still issues a direct `UPDATE` and now receives the B-1 sentence as a
retryable toast. That is the intended state until Phase 6 replaces the
editor with proposals; the director can still promote through the RPC.

### Not in this phase

The tool layer (Phase 2), the department machinery (Phase 3), the eight
leads and four phantoms as agent rows (Phase 4 — authored by the program
office and leads, public by B-3), the committee's agent row and prompt
(Phase 5), the director's room (Phase 6), the floor (Phase 7).

---

## Phase 2 — shared tool layer — DONE

### What landed

`supabase/functions/institution-tools/` — one function, eight tools, for
every specialist, every lead, the program office and the committee.
`web_search`, `web_fetch`, `public_data`, `methodology_research`, `execute`,
`synthesize`, `corpus_get`, `corpus_search`.

The rules it carries live in pure modules under
`supabase/functions/_shared/institution/`, so the function and the client
import the same copy and vitest runs them directly:

| Module | Carries |
| --- | --- |
| `egress.ts` | B-4. Numeric literals and 5-word shingles of the run's internal content, matched against every outbound string; a hit blocks the call and logs it. |
| `robots.ts` | robots.txt, parsed properly: longest match, `Allow` over `Disallow`, `*` and `$`, our own token before the wildcard, crawl-delay honoured. |
| `rateLimit.ts` | Per-host pacing, where the memory is the archive itself (B-6 records every fetch, so the log of what we asked a host is complete). |
| `extract.ts` | Page → the text the agent actually reads, which is what gets archived. |
| `searchParse.ts` | Search results from a JSON or an HTML endpoint, reporting which shape it parsed. |
| `provenance.ts` | B-8 and the synthesize gate: citations resolve, every factual claim carries one or is a numbered assumption, G-NUMBER with the agent's own tags switched off. |
| `policy.ts` | Which calls are scanned, and the refusal that stops a public agent ever holding internal content. |
| `sandbox/` | B-7. A tokeniser, parser and evaluator for a small analysis language whose only callables are its own 41-function library. |

Migration `20260910000103_institution_eval_cagr_fix.sql`
(`institution_eval_cagr_fix`, applied) corrects a wrong answer the sandbox
found in the held-fixed evaluation set, and
`20260910000104_institution_director_writes.sql`
(`institution_director_writes`, applied) opens the pipeline's own tables to
the director's client and closes the write grants Supabase's defaults had
left wide open.

### Verified

**The deployed artefact is the reviewed source.** The function was deployed
from a generated single-file bundle (`scripts/bundle-institution-tools.sh`),
then read back and compared byte-for-byte:

```
dc8d3bdc16c161b2fb92acd41d70be4c74d390e99d12a7897732da71bd5c1c6e  institution-tools.bundle.ts
dc8d3bdc16c161b2fb92acd41d70be4c74d390e99d12a7897732da71bd5c1c6e  deployed.ts   (read back)
```

Live capability probe, `GET /functions/v1/institution-tools`, HTTP 200:

```json
{"configured":true,"toolLayer":"1.0.0","tools":["web_search","web_fetch","public_data","methodology_research","execute","synthesize","corpus_get","corpus_search"],"search":{"configured":true,"keyed":false,"endpoint":"https://html.duckduckgo.com/html/?…"},"sandbox":{"version":"institution-stdlib@1.0.0","network":false,"functions":["abs","breakeven","cagr",…,"variance"]}}
```

**The sandbox has no network, proved by attempting it.**
`src/logic/institution/sandbox.test.ts` runs ten escapes against the same
code that is deployed — `fetch`, `globalThis`, `Deno.env.get`, `require`,
`eval`, `Function`, dynamic `import`, `process.env`, `XMLHttpRequest`,
`WebSocket` — and every one is refused with "there is no function … in the
sandbox". The error names what IS available, so the refusal is usable.

**Everything else the phase asks for, by attempt, under vitest** (159 cases
at this point, 233 by the end of Phase 3):

| Attempt | Result |
| --- | --- |
| an internal figure in a search query | blocked, logged as a `number` match |
| the same figure percent-encoded in a URL | blocked |
| a lifted internal sentence with no figure in it | blocked as a `phrase` match |
| an ordinary public query | passes |
| a year or a small count that also appears internally | passes (blocking them would block language) |
| a draft with an unattributed factual claim | refused |
| a citation that resolves to nothing | refused |
| a figure no cited record contains | refused, G-NUMBER |
| the same figure with a self-minted `[C]` tag | still refused (B-7) |
| the same figure inside quotation marks | still refused |
| a retrieval record with no URL, status or timestamp | refused (B-6) |
| an execution record missing script, inputs, library version, runtime or seed | refused (B-7) |
| a dataset naming no sources | refused |
| a script asking for 1,000,000 range elements | refused |
| a script exceeding its step or time budget | refused |

**The deployed code refusing things, in production.** Every tool call is
behind the director's `x-app-key`, which this run must never hold, so the
end-to-end paths (a real search archived to the corpus, a real egress block
row) were not exercised against production. The gap is closed as far as it
can be: the open capability probe answers `?selftest=1` by ATTEMPTING the
violations against the running code with synthetic data — no row read, no
row written, no request made, no secret touched. `GET …?selftest=1`
returned HTTP 200 with `"ok": true, "passed": 13, "failed": 0` (the handler
answers 500 if any case fails, so the status is itself the assertion):

| case | result in production |
| --- | --- |
| sandbox refuses `fetch` | refused: "there is no function fetch in the sandbox. The sandbox has no network, no filesystem and no host access; available functions: abs, breakeven, cagr, …" |
| sandbox refuses `Deno.env` | refused: "unknown name Deno" |
| sandbox refuses `eval` | refused: "there is no function eval in the sandbox…" |
| sandbox refuses `globalThis` | refused: "unknown name globalThis" |
| sandbox computes | 4.22 |
| egress blocks an internal figure | blocked: `[{"kind":"number","excerpt":"8.675.309.000"}]` |
| egress blocks a percent-encoded figure | blocked: two matches |
| egress passes a public query | not blocked: `[]` |
| synthesis refuses an unattributed claim | refused: `["unattributed"]` |
| synthesis refuses a figure no cited record contains | refused: `["number"]` |
| synthesis refuses a self-minted `[C]` tag | refused: `["number"]` |
| synthesis accepts a cited claim | accepted: `[]` |
| robots disallows what it disallows | not allowed: `Disallow: /private/` |

A tool call with no `x-app-key` is refused before any context assembly:
HTTP 401, `{"error":"Unauthorized"}`.

The deployed artefact was read back and compared again after this change:
`b8baaed54af3a3ca32c30284b77306e191cb57eb407da1c42f5c1e9ce1176489`, both
files 136,310 bytes, `diff` empty.

### Not in this phase

A search API key (P-11). The tool layer runs on DuckDuckGo's keyless HTML
endpoint and reports a 403 or 429 as a failed retrieval with its status,
archived, rather than as "no results".

---

## Phase 3 — department contract machinery — DONE

### What landed

1-A implemented once, in three pure modules, plus the stepper that performs
what they decide:

| File | Job |
| --- | --- |
| `_shared/institution/department.ts` | The contract: intake and refusal, delegation by capability respecting the lane, authoring a missing capability (always public), peer reviewer selection that is never the author, the B-5 bounds, the submission record. |
| `_shared/institution/weight.ts` | B-10: the three class shapes, the cost estimate as arithmetic over measured per-call cost, Verification in every routing, the overrun check. |
| `_shared/institution/pipeline.ts` | The decider: from the rows as they stand, what the institution does next. Every state is a value a test can construct. |
| `_shared/institution/protocol.ts` | What the institution says to an agent and what it accepts back. Every parser fails closed. |
| `src/logic/institution/runner.ts` | The stepper: one call, one step, state in the database rather than in a process. |
| `src/data/institutionRepository.ts`, `institutionMock.ts`, `institutionTypes.ts`, `institutionTools.ts` | The seam, in memory and against Supabase, and the browser side of the tool layer. |

### Verified

`pnpm test:run` — 107 files, 1900 tests, all passing. 233 of them are the
institution's. The ones this phase is judged on:

| Attempt | Result |
| --- | --- |
| instantiate two departments from config alone | both run, with no department-specific code anywhere |
| a specialist output reviewed by its author | impossible: the reviewer is chosen from siblings, and the database and the mock both refuse a self-review |
| a lead returns work three times | it cannot: two reworks, then the program office arbitrates |
| a lead reviewed the same work twice already | a third review escalates instead of a third rework |
| an assignment that says nothing about what an answer would be | returned unanswerable-as-written, **before any model call is spent** |
| a lead that answers in prose instead of the required form | the assignment is returned, not read as a yes |
| an unreadable review | escalates, never accepted |
| an unreadable arbitration | stops and tells the director, never waves work onward |
| a committee rebuttal the committee did not weigh | recorded as unresolved, so it survives to the director |
| an authored agent | public, attributed to the lead that asked for it |
| an authored agent with a three-sentence prompt | refused |
| a blocked egress attempt mid-run | recorded as an event; the run continues and still reaches the director |
| the executor refusing (no API key) | recorded, the step stops, nothing is half-written |

A brief-class question runs end to end against the fakes: intake, routing,
Framing, peer review, lead review, submission, Verification, the director's
room — with the estimate written before the run and the actual after.

### Not in this phase

A run against the live provider. Phase 4's verification asks for one, and
it needs the director's passphrase.

## Phase 4 — all eight departments and the program office — DONE

### What landed

The org chart was already rows (Phase 1); this made the institution able to
START from them.

- **An empty lead desk is staffed, not worked around.** 1-B says the
  program office may author a department's missing lead. The pipeline now
  emits that action instead of blocking, so the first brief that needs an
  unstaffed department staffs it. A second failure at the same desk blocks
  and names the director.
- **A lead fills its own named empty desks.** The four phantom specialists
  (`consolidation-reporting`, `financial-modeling`, `verify-financial-model`,
  `deck-narrative-drafter`) are seats the institution decided it needs; a
  department with one unfilled is incomplete, so its lead authors the agent
  before work starts. Filling a named desk KEEPS the slug: the seat, the
  floor's name plate and every prompt that refers to it still mean the same
  agent.
- Both paths, and "a capability with no seat at all", run through one
  `agent_authoring` action and one `authorAgent` port — always public,
  always attributed (B-3).
- `src/logic/institution/institutionPorts.ts` wires the stepper to the real
  repository, the real tool layer and the real executor, with a per-call
  cost figure **measured** from `os_lab_runs` and marked `measured: false`
  when there is no history.
- `src/logic/institution/roster.ts` computes the roster property the phase
  asks for, so the director's room can show it.
- Migration `20260910000105_institution_program_office_proposal.sql`
  (`institution_program_office_proposal`, applied) extends
  `evidence-coordinator` into the Program Office per 1-B — **as a
  proposal**, because B-1 admits no exception for a migration either.

### Verified

Live roster, computed from the rows:

| check | result |
| --- | --- |
| agents seated exactly once | 47 |
| agents seated more than once | none |
| active agents with no seat | none |
| departments whose named lead is not in its lead seat | none |
| named empty desks | 13 → 12 after Phase 5 seeds the committee |

The program office proposal on production, read back:

| field | value |
| --- | --- |
| status | `proposed` |
| proposed_by | `system` |
| live prompt unchanged | true (the proposal is the live prompt plus an appended section) |
| live version | 1 |

That is B-1 working on production: the extension exists, is reviewable, and
changed nothing.

### Not in this phase

A run against the live provider. Every model call is behind the director's
passphrase, which this run must never hold, so the brief-class and
standard-class runs were exercised end to end against fakes rather than
against Anthropic or Moonshot. What that leaves unproven is timing and
model behaviour, not routing: the routing, the class shapes, the estimates
and the refusals are the same code either way.

---

## Phase 5 — committee, debate, proposals, evaluations — DONE

### What landed

- **The committee exists**, seeded by
  `20260910000106_institution_committee.sql` (`institution_committee`,
  applied) with a **human-owned prompt** (B-2) and on the **internal lane**:
  it reviews whatever the departments submitted, and on an internal brief
  that is SAMB's own figures, so a public-lane committee could not do the
  job without breaking the lane. Its launch version is recorded like
  everyone else's.
- **Bounded debate.** After a committee review with findings, every
  reviewed party may contest; the committee weighs each rebuttal with a
  reason; an unweighed rebuttal is recorded as unresolved rather than
  disappearing; after two rounds the disagreement goes to the director with
  both positions.
- **Proposals, including self-proposals.** Recorded as
  `os_inst_agent_versions` rows with `status='proposed'`, a rationale and a
  diff. The database refuses a proposal against the committee from anyone
  but the committee or the director (B-2).
- **The held-fixed set runs before and after a promotion**
  (`promoteWithEvaluations`), and the score is computed **inside the
  database** from a rubric nothing outside it reads. Two migrations were
  needed for that:
  `20260910000106` adds `os_inst_eval_score_owner()` and
  `20260910000107_institution_director_evals.sql` adds
  `os_inst_version_set_eval_owner()` — both key-gated, both revoked from
  `service_role`. Without them B-9's scoring had no caller at all once the
  stepper became the director's client (D-12).

### Verified

`scripts/institution-tests.sh` — 103 migrations replayed, suite green, both
negative controls red. New cases in it:

| attempt | result |
| --- | --- |
| the committee is public | caught: the suite fails if its lane is not internal |
| the committee has no launch version | caught |
| an agent calls the director's scorer | refused, "the director" |
| the director scores a run | permitted, and a score is written |
| `service_role` reaching the key-gated wrapper | refused |
| an agent attaches a before/after score to a proposal | refused |
| a client role updating or deleting a seat | refused (INSERT only) |

`src/logic/institution/committee.test.ts` — a full-class run end to end:

| attempt | result |
| --- | --- |
| the committee reviews after every department submits | one review, per-claim findings |
| its proposals change a live prompt | they do not: every version row is `proposed`, and the agent still returns its old prompt |
| a reviewed party contests a finding | filed, weighed, reason recorded |
| an accepted rebuttal | the committee proposes against ITSELF, attributed to itself |
| a rebuttal the committee does not weigh | recorded as unresolved, survives to the director |
| a standing disagreement | goes to the director rather than a third round |
| a refused evaluation run | left unscored, never averaged in as a zero |
| a score computed in the browser | it is not: the client writes the answer and asks the database for the number |
| promoting the same version twice | refused |
| rejecting a proposal | reason stored, agent unchanged |
| a proposal with no rationale | refused (B-1) |

### Not in this phase

One real full-class research task against the live provider — same reason
as Phase 4.

### Root gate at the end of Phase 5

`pnpm typecheck` clean; `pnpm test:run` **109 files / 1921 tests** passing
(254 of them the institution's); `pnpm build` exit 0. The Phase 4–5 commit
message says 1954, which was written before the run and is wrong; 1921 is
the measured figure.

## Phase 6 — the director's room — DONE

`src/views/lab/institution/InstitutionDirector.tsx`, reached from the Lab
rail as **Director's room** (Gavel). Six panels, all read-only except the
two decisions only the director can make:

| Panel | What it shows |
| --- | --- |
| Briefs | Every brief with its weight class, routing, status, and **estimate vs actual** in both tokens and USD — the estimate is written before the work and the actual after, so the gap is visible rather than reconstructed |
| Provenance | One brief's whole tree: assignment → review → submission → corpus record, each with its round and its B-5 counter, so "why did this take four passes" is answered by reading down |
| Reviews & debates | Every peer, lead and committee verdict, and every rebuttal with how the committee weighed it. An unresolved rebuttal is marked and survives to the director rather than being closed by silence |
| Evaluations | The held-fixed set, per-agent, before and after each promotion. A refused run is shown as unscored (D-20), never as zero |
| Proposals | Every `proposed` version with a **word-level diff** against the live prompt, its rationale, and Approve / Reject. Approving is the ONLY way a live `system_prompt` changes (B-1) |
| Corpus | What the institution has archived, by kind, with hashes |

`LabRegistry.tsx` no longer issues a direct prompt `UPDATE` (P-08 closed):
editing a prompt there now opens a proposal with a required rationale and
routes through `repository.institution.proposeVersion`, which is the same
path the committee uses. The database refused the old write anyway; the UI
now matches the boundary instead of discovering it.

## Phase 7 — the floor at /lab/floor — DONE

Bot Crossing is now a view in the Lab, not an app. **`bot-crossing/` is
deleted** — 106 tracked files, including the Fastify server, the Next.js
root, its own `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
`tailwind.config.ts` and `vitest.config.ts`. The `bot-crossing/**` exclude
is gone from `vite.config.ts` and the root vitest run now sweeps the
floor's tests like any other.

### Where it landed

| Was | Is |
| --- | --- |
| `src/core/**` (pure: hex, A*, layout, movement, events, time, text) | `src/logic/floor/**` — unchanged logic, 79 tests still green |
| `src/scene/**`, `src/components/**` (R3F + HUD) | `src/views/lab/floor/{scene,hud,store,transport}` |
| A Fastify server on :4000 inventing events | Nothing. The floor reads the institution's rows through the repository |
| A WebSocket bus | Supabase Realtime on 8 institution tables (`transport/institutionStream.ts`) |
| `server/adapters/**` | `src/logic/floor/adapters/**`, kept, with department inference rewritten from four invented bays to the institution's real slugs |
| `server/sources/MockEventSource.ts` | `src/logic/floor/scenario/roster.ts` → `mockSnapshot()`, behind `?mock=1` |
| A hard-coded 20-agent office | `buildCampus(spec)` generates the floorplan from the departments and seat counts the database reports |

### The rule this migration existed to keep

The client may derive POSITION. It may never derive STATE.
`src/logic/floor/institution/project.ts` turns rows into semantic events
("this agent is working", "these two are in a review") and says nothing
about where anyone is; the positioner adds where. `project.test.ts` proves
it by removing the rows: with no assignments, no reviews and no egress
blocks, every staffed agent is idle and every marker list is empty. A
floor that invented an arrival or a collaboration would fail there.

### Read the floor and the institution is legible

Bays are laid out in **pipeline order** down two columns, so a brief's
route across the building is its route through the pipeline. Every
department has three rooms — a desk bay, its lead's office, and its own
peer-review cluster — because a peer review inside the department and a
lead review in the lead's office are different events, and one shared
meeting room would have made them look like the same one. The library
(the corpus), the committee chamber and the director's office are fixed
rooms. A department the brief did not visit is dark.

**Phantom desks.** A seat in `os_inst_department_members` with no agent row
renders as an empty desk with its name plate and its purpose — 12 of the
47 seats today. It is the only way an unfilled seat is visible without
reading a warning banner, so a phantom plate is drawn at every zoom while
an occupied quiet desk earns its plate by being zoomed in on (47 plates at
once hid the building they described).

**Redaction (3-C).** An `internal`-lane agent's task title, subtask and
output document are masked by default. Masking happens in the data loop,
before the event reaches the store, so no surface downstream can leak by
forgetting to ask. The toggle is per session and never persisted.

### The render budget (3-D)

A skinned avatar is ~8.5k vertices, 65 joints, an animation mixer and a
per-frame skinning pass. Only five states earn one — walking, working,
collaborating, delivering, error. Everything else is a **quiet desk**:
three boxes and a sprite, `castShadow` off, raycast disabled. Skinned
meshes cast no shadow at all; each avatar gets a contact disc instead.
`src/logic/floor/layout/budget.test.ts` is the CI guard on the shape of
that: it fails if the campus stops growing linearly in departments, if
desks stop matching seats, or if `idle` ever joins the expensive path.

Measured on the production build, 43 mock agents (27 on the expensive
path, 16 quiet), 1600×1000:

| | |
| --- | --- |
| Draw calls | 321–337 |
| Triangles | 753k |
| Skinned runtimes | 27 (22 seated, 5 standing) |

**The frame rate has NOT been measured on the owner's hardware and this
report will not pretend otherwise.** The only machine available to this
run was the build container — 4 vCPU Intel Xeon @ 2.10 GHz, 15 GB, no GPU,
WebGL through SwiftShader software rasterisation — where it renders at
**0.8–1.6 fps / ~950–1230 ms per frame**. That is a software-rasteriser
floor, not a prediction: it says the scene composes and draws, and nothing
about what it will do on a real GPU. To read the real figure, open
`/lab/floor?dev=1` and look at the dev panel, or read `window.__floorPerf`.

### Bundle report (B-11)

`pnpm build`, measured, not asserted:

| Chunk | Raw | gzip | Three.js present? |
| --- | --- | --- | --- |
| `index-*.js` (main) | 1,858.86 kB | 498.03 kB | **no** |
| `OfficeApp-*.js` (HUD, lazy) | 110.51 kB | 32.01 kB | **no** |
| `OfficeCanvas-*.js` (scene, lazy) | 1,211.97 kB | 371.81 kB | yes |

Probed by grep over the emitted chunks: `WebGLRenderer`, `BufferGeometry`,
`@react-three`, `react-three-fiber`, `postprocessing` and `GLTFLoader` all
occur **0 times** in the main chunk and in the HUD chunk, and 1–6 times
each in the canvas chunk.

Cost of the route itself, measured by building twice — once with the
`/lab/floor` route and nav entry removed, once with them:

| | main chunk | gzip |
| --- | --- | --- |
| without the floor | 1,856.96 kB | 497.32 kB |
| with the floor | 1,858.86 kB | 498.03 kB |
| **the floor's cost to every other page** | **+1.90 kB** | **+0.71 kB** |

The Phase 0 baseline was 1,808.69 kB / 485.16 kB; the remaining ~50 kB of
growth is Phases 2–6 (the institution's types, repository and director's
room), not the floor. The 2.3 MB GLB is a static file under `public/`, so
it is not in any chunk and is fetched only when the canvas mounts.

### Design tokens

The standalone build shipped a second design system: a dark glass panel,
`#e9eef5` ink, a `#37d2c6` teal accent and its own warn/error/ok trio.
All of it is gone. The HUD now resolves `hsl(var(--token))` like every
other surface (`.floor-panel`, `.floor-seg`, `.floor-range`,
`.floor-toggle` in `src/index.css`, built only from host variables), and
the 3D world's interface colours — name plates, badges, the selection
ring, avatar tints — come from `src/logic/floor/theme/palette.ts`, a
**mirror** of `index.css` that `palette.test.ts` re-derives from the HSL
triplets and fails on drift. Sand, pavement, sky and furniture are
deliberately NOT on the ramp: they are a desert, not an interface.

### Root gate at the end of Phase 7

`pnpm typecheck` exit 0. `pnpm test:run` **127 files / 2084 tests** passing — measured after the
change, not before it.
`pnpm build` exit 0. No SQL changed in this phase, so no `scripts/*-tests.sh`
run was required.

Screenshot: `docs/v9/lab-floor-institution-mockdata.png` (the synthetic
institution under `?mock=1`, scrubbed to midday).
