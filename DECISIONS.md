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

**D-16 — The committee is an internal-lane agent.** It reviews whatever the
departments submitted, and on an internal brief that is SAMB's own figures.
A public-lane committee would either be handed internal content it may not
process or be unable to review internal work at all. Seeded internal by
migration (director-created), which makes it Anthropic-only through the
existing boundary trigger. Its prompt stays human-owned (B-2) and its own
upgrades travel the ordinary proposal path.

**D-17 — The program office extension shipped as a proposal, not a write.**
1-B asks for the coordinator to become the Program Office. Writing that
prompt from a migration would have been the first violation of B-1 in the
institution's own construction, so `20260910000105` writes a
`status='proposed'` row carrying the full text, the diff and the reason.
The director promotes it in the director's room. The per-call prompts the
stepper sends already carry the instructions, so nothing is blocked
meanwhile — what is withheld is the agent's standing character, which is
exactly what the director should own.

**D-18 — Two key-gated wrappers were added for B-9's scoring.** 102 granted
`os_inst_eval_score()` and `os_inst_version_set_eval()` to `service_role`
alone, correct for a server stepper and wrong once the stepper became the
director's client. `os_inst_eval_score_owner()` and
`os_inst_version_set_eval_owner()` check `os_key_valid()` and delegate;
both are revoked from `service_role` so the wrapper is the director's path
and the unwrapped function stays the server's. The rubric is still read by
nothing outside the database.

**D-19 — An empty lead desk is staffed by the program office, and a named
empty specialist desk by that department's lead.** The alternative was an
institution that cannot start: the first brief would reach an unstaffed
Framing Office and stop. 1-B already gives the program office staffing, so
the pipeline emits the authoring action rather than blocking, and a second
failure at the same desk blocks and names the director. Filling a named
desk keeps the seat's slug, so the floor's name plate and every prompt that
refers to it still mean the same agent.

**D-20 — A refused evaluation run is unscored, not zero.** Averaging a
refusal in as 0 would read as the agent having failed the instrument when
in fact the instrument never ran. `meanScore` averages only what was
measured and returns null when nothing was.

**D-21 — The floor reads through the repository; no second data layer.**
The standalone build used `@tanstack/react-query` for one modal and a
WebSocket for everything else. The host app has neither and does not need
them: `useInstitutionFloor` calls the repository, and a Supabase Realtime
change re-runs the whole read rather than applying the payload. Applying
payloads incrementally would mean a second copy of the pipeline's rules in
the browser, and the second copy is always the one that drifts. The reads
are a handful of small queries and they cannot disagree with the database.

**D-22 — The floor is the only lazy route in the app.** Every other view
is small enough that a second request costs more than it saves. This one
pulls three.js, drei and the postprocessing stack — 1.21 MB, two thirds of
the main chunk again — so it is split, and the split is measured in
PROGRESS.md rather than asserted in a comment. Cost to every other page:
1.90 kB raw, 0.71 kB gzip.

**D-23 — `bot-crossing/` was deleted, not archived.** B-11 said to delete
it and the migration is complete: every pure module moved intact, the four
adapters moved, the Fastify server has no successor because the
institution's own rows replaced it, and the GLB moved to `public/models/`.
Keeping a second pnpm root with its own lockfile "just in case" is how a
repository ends up with two versions of the same file and no way to tell
which one ships. It is one `git revert` away if that judgement is wrong.

**D-24 — The mock is a synthetic institution, and it says so on screen.**
`?mock=1` builds a `FloorSnapshot` with one agent in every state the floor
can draw and three seats deliberately empty, so the building can be worked
on when the pipeline is idle. Every id is prefixed `mock-` and the HUD
carries a banner in the escalation colour. A mock indistinguishable from a
run destroys the only thing the floor is for: that every figure on it
traces to a row.

**D-25 — A foreign framework's agent lands in the program office, never in
a guessed department.** The four adapters' `inferDepartment` used to pick
"Engineering Bay" for anything it could not match. The institution's
version returns `program-office` instead, and its keyword list
deliberately omits "review", "lead", "manager" and "analyst" — words that
match everywhere and therefore place nobody. A confident wrong desk makes
the floor lie about who works where; an honest unrouted one does not.

**D-26 — Avatar tint is a grouping hint and is documented as one.** The
host ramp has four chart colours and the institution has ten rooms, so
tints repeat, and two of the four sit 1.06:1 apart in luminance. Which
department someone is in is read from the name plate and the bay they are
standing in — the floor already shows it twice. Minting six more colours
to make the tint authoritative would have put a second palette in a repo
whose Tailwind config deletes the default palette precisely to stop that.

**D-27 — A quiet occupied desk hides its plate until you zoom in; a
phantom desk never does.** Forty-seven name plates at the default zoom is
a wall of white bars over the building they describe. An empty seat is the
one thing on the floor you cannot infer by looking, so it is exempt: an
unlabelled empty desk is indistinguishable from furniture, and naming it
is the entire reason it is drawn.
