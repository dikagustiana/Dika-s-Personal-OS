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

## Phase 2 — shared tool layer — NOT STARTED
## Phase 3 — department contract machinery — NOT STARTED
## Phase 4 — departments and program office — NOT STARTED
## Phase 5 — committee, debate, proposals, evaluations — NOT STARTED
## Phase 6 — director's room — NOT STARTED
## Phase 7 — the floor at /lab/floor — NOT STARTED
