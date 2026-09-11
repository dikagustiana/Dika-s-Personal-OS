# DECISIONS

Decisions the run made under Part 0-C (the director pre-answered B-1..B-11;
everything not covered there is decided here, with the alternative that was
rejected and where the decision bites). Numbered D-NN, append-only. When a
later phase reverses one, the reversal is a new entry that cites the old.

---

**D-01 — Program Office lead is `evidence-coordinator`; `pmo-coordinator`
sits in Domain Synthesis.** The audit read both prompts. The evidence
coordinator's is delegation ("decompose a research request into delegated
tasks") — the Program Office's job. The PMO coordinator's is project
coordination of the SAMB transformation (plans, RACI, trackers) — a
synthesis specialism, not pipeline management. Rejected: a new
`program-office-lead` agent, which would have left the one existing
coordinator with nothing to coordinate.

**D-02 — The eight "existing" skill agents are seeded by migration as
director-created rows.** The brief listed account-universe-scan,
math-specialist, manufacturing-finance-analyst, go-to-market,
process-mapper, psak-consolidation, psak-intercompany and deck-layout as
roster agents. None had a row in `os_lab_agents`; they exist as the owner's
Claude skills. Their prompts are written from those skills' declared scope.
A migration is a deliberate act with a diff — the same escape hatch this
repo uses for GROWTH sharing — so the seed sets `app.inst_seed = 'on'` and
the lane-at-birth guard accepts internal rows only in that context. Lanes:
the six that read SAMB figures are internal (Anthropic only); account
universe scanning and deck layout handle public material and are public.
The thirteen specialists the institution names and the roster lacked
(scope-analyst … copy-editor) are seeded the same way, all public.

**D-03 — Leads and phantoms are not seeded. The Program Office authors the
leads and the leads author the phantoms, at run time, always public.**
Their seats exist with name plates and an empty desk. B-3 makes every
agent-authored agent public. Consequence, accepted: an internal-lane brief
cannot be worked until the director promotes the leads it needs to
internal; until Phase 6 exposes that action the intake refuses internal
briefs with a sentence saying so, rather than routing internal content to a
public lead that may run on a non-Anthropic provider. Rejected: seeding the
leads as director-created internal agents — it would make the org chart a
seed file rather than something the institution built, and would hide the
B-3 consequence instead of surfacing it.

**D-04 — Re-laning an existing agent is delete-and-recreate; B-3's
"promotion to internal" is a director act at creation, not an UPDATE.**
Migration 092 (`lab_public_lane_guards`) freezes `data_class` after insert;
the live probe confirmed it fires before the institution's B-3 branch. The
run did not weaken 092. Trade-off recorded for the director: recreating an
agent cascades its version history (`os_inst_agent_versions` FK) and orphans
its run history. If promotion-in-place is wanted, it is a one-line amendment
to 092 gated on `os_key_valid()` — a migration the director applies, not a
decision the run takes. Reported in the final report as a place where the
audit outranks the prompt.

**D-05 — Progress on the floor is an elapsed-time estimate, labelled as
such.** `run-lab-agent` writes token counts once at completion; nothing
streams. The audit found run history for one agent only
(`evidence-literature`, median 13.4 s). A progress bar that pretends to know
more would be a lie in the UI; the floor will show elapsed against the
agent's median where one exists and "no history" where none does.

**D-06 — `modelEval` stays declarative; the B-7 sandbox is a separate
path.** `_shared/modelEval.ts` rule A5 forbids `eval`, `new Function` and
WASM for model specs. B-7 requires executed code. These are two different
things: A5 governs declarative model specs over verified datapoints; B-7's
sandbox executes scripts against corpus-addressed inputs and returns an
execution record. Phase 2 adds the sandbox beside the evaluator, without
touching A5. The contradiction is named so nobody "unifies" them later.

**D-07 — B-1 goes live before the UI that replaces the prompt editor.**
Applying 100 blocks `LabRegistry.tsx`'s direct prompt write on `main` until
Phase 6. This is B-1's intent: the lock is a property of the database, not
of a screen. The owner sees the B-1 sentence as a retryable toast, loses no
text (the draft stays on screen per the `useMutation` contract), and can
promote through the RPC meanwhile.

**D-08 — Per-role revokes on every function, and the SQL suite asserts the
whole grant matrix.** Migration 100 revoked from `public` only; Supabase's
default privileges (mirrored by `scripts/lib/pg-cluster.sh`) had already
granted EXECUTE to anon, authenticated and service_role explicitly, so the
live check found anon able to call the scorer and `os_inst_version_set_eval`
— B-9 open through the API key. Fixed by 102, and the suite now carries 60
grant checks plus a negative control that re-grants anon and must go red.
The lesson is the one 074 and 077 already encode in their three-statement
revokes; the run missed it because its own test did not look at grants.

**D-09 — The evaluation set is six public-knowledge tasks scored by a
deterministic in-SQL rubric that never leaves `private`.** Rubric shapes:
`mustContain`, `mustContainNumbers`, `mustNotContain`, `mustCite`, with
weights. The scorer is service-role-only and writes nothing but the score;
the director reads rubrics through a key-gated RPC. Rejected: an LLM judge
— it would put a model's opinion where B-9 wants a held-fixed measure, and
it would need a rubric in its prompt, which is the one thing the rubric must
never do.

**D-10 — Identity is credential absence plus transaction-scoped GUCs. No
flags.** The director is `os_key_valid()` (x-app-key present); every agent
and the stepper are its absence. `app.inst_promotion` and `app.inst_scoring`
are set only inside the definer functions that need them, for the
transaction; `app.inst_seed` only inside a migration. There is no bypass
argument anywhere, matching `labGuards.ts`.

**D-11 — The committee's seat exists in Phase 1; its agent row and
human-owned prompt land in Phase 5.** `os_inst_committee_slug()` reads the
seat, so the 1-D review and debate guards already know who the committee is;
the B-2 proposal guard becomes testable live once the row exists (it is
tested in the harness now). Rejected: seeding a placeholder committee prompt
— a placeholder prompt in the fixed point of the system is worse than an
empty desk.

**D-12 — The institution's stepper runs in the client, not in a new Edge
Function.** The Lab already works this way: `run-lab-agent` executes ONE
agent call per request and the browser drives the chain, because every
billable call in this codebase is user-initiated and explicitly confirmed
and there is no cron anywhere in the subsystem. The institution follows it:
the department machinery, the routing, the weight classes and the committee
loop are pure TypeScript under `supabase/functions/_shared/institution/`
(so the tool layer can import the same rules) and are driven from
`src/logic/institution/` + `src/data/institutionRepository.ts`. One Edge
Function is added — `institution-tools` — because it is the only part that
must hold secrets and reach the network. Consequences, accepted: a run stops
when the director closes the tab, and resumes from the brief's state on
reopening, because every step is a row before it is a fact. Rejected: a
long-running server stepper, which would need a scheduler the director
explicitly does not have and would spend money with nobody watching.

**D-13 — The search backend is a secret with a keyless default.** The
institution has no search contract. `INSTITUTION_SEARCH_URL` is a URL
template the director sets; the default is DuckDuckGo's keyless HTML
endpoint. When it answers 403 or 429 the tool archives the attempt with its
status and says the source did not answer — it never returns an empty result
set that reads like "nothing exists". Recorded in PLACEHOLDERS as P-11: a
real search API key is a configuration the director adds, not code to write.

**D-14 — The sandbox is a small language, not a JavaScript sandbox.** B-7
requires execution with no network. Every way of running JavaScript in this
runtime keeps a path to the host: `eval` and `new Function` see the
enclosing scope and `globalThis` (which is why `_shared/modelEval.ts` rule
A5 forbids them), a Worker still carries `fetch`, and a vendored WASM
interpreter would be a binary blob nobody here can audit. So
`_shared/institution/sandbox/` implements a tokeniser, a parser and an
evaluator for a small analysis language whose only callables are its own
standard library. "No network" is then a property of the grammar rather than
a permission, and the test suite proves it by calling `fetch`, `eval`,
`Deno.env.get` and five other escapes inside a script and asserting each is
told the function does not exist. The cost is that scripts are not
JavaScript; the gain is that there is nothing to escape to.

**D-15 — The deployed Edge Function is a generated single-file bundle.** The
tool layer is 17 modules; the deploy path available here takes an inline
file set. `scripts/bundle-institution-tools.sh` concatenates them in
dependency order, stripping local imports, and the deployed artefact is
verified byte-for-byte against the bundle after deployment. The repo files
stay the source of truth: they are what vitest runs and what a reader
reviews.
