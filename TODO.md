# TODO — deferred deliberately

Things ruled out of scope by the briefs (the Lab brief's Part G and the
hardening prompt's Part G), plus gaps discovered while building that were
noted rather than scope-crept. Nothing here is half-built; each item is
absent on purpose, with its reason.

## Shipped since the last revision of this file

The hardening build (migrations 079–082) closed several entries that used to
live here: the **snapshot tooling** (the `snapshot` action fetches, hashes
and stores the bytes — ingestion itself stays an owner act), **automatic
contradiction detection** (the REVIEWER records candidates; a DIRECT open
contradiction now blocks approval of either side), the **extraction WIP cap**
(25 open IND datapoints, refused before anything is billed), the **coverage
views** (`os_lab_question_coverage`, `os_lab_sub_question_coverage`,
security_invoker), and the three new roles: FRAMER (intake with falsifiers,
write scope EMPTY), SCOUT (candidates without judgement columns, allowlist
tiers, rechecks that flag and never demote) and MODELER (declarative specs
run only by the version-pinned first-party evaluator; `[sim]` grew an id).

The Flow build (migration 083 + the Flow tab) added: **the Flow view**
between Chains and Evidence — 13 stages derived by query over the epistemic
tables (no tracking table, on purpose: it would be a second source of truth
and it would drift), an isometric floorplan whose viewBox is computed from
scene bounds and pinned by test, human stations drawn heavier than agent
stations, blocked stations barred (never hidden) with the blocker AND record
id named; **refusal persistence** (`os_lab_runs.refusals`, written by the
executor at run completion, so the Penolakan tab shows history that survives
a reload — the WIP-cap refusal alone stays response-only BY CONSTRUCTION: it
fires before any run row exists, and its standing condition renders live as
the IND-vs-cap meter); and **lab-eval-2**: the sensitivity smoke test now
also fails a spec whose output does not move when its inputs do (a hardcoded
answer is not a model) — closing the gap where only singularities failed it.

## Deferred deliberately — each with its reason, not as an oversight

**1. Structured `definition_scope`.** Still free text with a 20-character
floor. Decomposing it into typed fields — entity, metric, period start/end,
basis (consolidated / standalone / segment), unit, currency, framework — is
**the highest-value change still outstanding after this build**, because
definition drift is the one error class that survives every gate and is
invisible in the finished output. It is a migration large enough to deserve
its own pass, and it unblocks item 2.

**2. The coordinator → extractor scope contract.** A task record carries a
free-text brief; a datapoint carries a free-text `definition_scope`; nothing
compares them. So the system cannot detect the most common research error —
the right number for the wrong thing. The fix is structured
`expected_entity / expected_metric / expected_period / expected_unit /
expected_basis` on the task record, compared at datapoint save and refused
on mismatch. **This is blocked on item 1**: there is nothing to compare
against until the delivered scope is structured too. Sequence them together
in the same pass.

**3. Locator → extractor text slicing.** Stage 1 returns locator strings;
the owner pastes the region by hand. Note that Phase 1.1's echo check now
covers the danger this was meant to address for the *pasted* region — what
remains unautomated is the paste itself, which needs a document store rather
than prompts.

**4. Value-level revision detection.** The recheck detects that a source
PAGE changed (hash comparison, flag only); detecting that a specific FIGURE
was revised depends on documents stored as text, which is the same document
store item 3 needs.

**5. Full datapoint versioning.** The build detects that a result's inputs
moved — a datapoint losing V flips `stale_input` on every result standing on
it, via `input_datapoint_ids`. It does not let a result be *reproduced*
against the values as they stood. True versioning (append-only datapoint
revisions, model results pinning version ids) is the complete answer and is
not needed until a result must be defended months later.

**6. Re-typing the value at verification.** Held in reserve. The
source-match surface shows the locator, source and definition scope beside
the match note; requiring the owner to re-type the value would add friction
that only pays if batch-clicking is observed in practice. Adopt only then.

**7. Workflow consolidation (a proposal, not a change).** The current path
has five human checkpoints. Two are weak: approving a claim and then
approving it again at finalize is the same person ratifying his own work
with a passphrase that establishes identity, not independence; and promoting
a reference to `full_text_read` is close to a file-presence check. Merging
claim formation with approval, running the reviewer *before* claim formation
so its output can still change a decision, and automating the reference
promotion check would take five checkpoints to three without losing a real
control. This is a workflow decision for the owner, not a code change to
make unilaterally — recorded here as a proposal, and stopped there.

**8. Method reports for models.** The build stores the spec, the FK'd
parameter provenance and the checks jsonb. Rendering that into a prose
methods document is deferred, and when it is built it must be **assembled
from structured fields**, never written by an agent — a model authoring its
own methodological justification with its own citations is the exact pattern
that produces invented references, arriving at the point a reader checks
least.

## Also still deferred from earlier passes

- **Literature / live SEARCH wiring.** evidence-literature and
  evidence-scout structure PASTED results; neither searches. Live search
  waits for the owner's explicit say-so now that publisher tiering ships —
  an agent that searches and cites in one breath is how invented papers
  arrive.
- **Portfolio WIP limiting.** Projects carry `wip_slot`; nothing enforces a
  portfolio cap. (The extraction WIP cap — 25 open IND — shipped; this is
  the project-count cap, a different control.)

## Deferred by the Flow build, each with its reason

- **Locator rows.** S3's honest count is the run ledger's: locator output is
  consumed at extraction time, not stored. Storing locator regions properly
  belongs to the same document store items 3 and 4 wait on.
- **Background refresh / realtime for the Flow.** The screen re-reads when a
  dispatch ends and on demand; it never polls. The system is owner-initiated
  — a self-refreshing state view would imply activity the architecture does
  not have. Revisit only if the owner starts running chains long enough to
  leave the tab.
- **The WIP-cap refusal event in Penolakan.** Response-only by construction
  (no run exists to carry it — nothing was billed, nothing ran). The
  STANDING condition is what matters and it renders live: the IND-vs-cap
  meter in Orkestrasi and the S4 bar naming the head of the queue.

## Ruled out by the briefs (both Part Gs)

- **Curation or synthesis agents.** DRAFTER plus the owner already is one;
  the coverage views answer the real need.
- **A second critic, judge, scorer, or any LLM-as-reviewer.** A second
  opinion has no gate that consumes it.
- **Meta-coordinators, dynamic agent selection, DAG/graph chains.** The
  chain builder's linearity is a structural termination guarantee.
- **Prompt-injection detectors / sanitisers / provenance classifiers.**
  Privilege separation already reduces injection into an extractor to the
  blast radius of an ordinary extraction error.
- **Code-execution sandboxes, containers, or remote runners.** A5 absolute:
  model specs are declarative JSON run by the hand-written evaluator.
- **Token dashboards, tamper-evident logs, secrets rotation, MLOps
  registries, ML staleness prediction.** Single user, no adversary who
  benefits; the deterministic checks are better and simpler.
- **Agent marketplace / sharing, scheduling/cron for runs, eval grading,
  node canvas, prompt diff viewer, webhooks** (the original Lab Part G).

## Operational, waiting on the owner

- **Set the provider API keys** as Edge Function secrets:
  `LAB_DEEPSEEK_API_KEY` (required for the deepseek row — no fallback
  exists), `LAB_KIMI_API_KEY` (optional — kimi resolves today through the
  `RESEARCH_MODEL_API_KEY` fallback, the same Moonshot account).
  `LAB_ANTHROPIC_API_KEY` stays UNSET by the owner's decision (2026-08-18,
  "don't use claude"): the nine internal agents are dormant until it is
  set. The data boundary is unchanged by that decision and cannot be
  relaxed — internal agents refuse every non-Anthropic provider at the
  database, so "no Anthropic key" means "internal agents do not run", never
  "internal agents run elsewhere".

## Provider pricing limitations, recorded so the numbers are understood

- **DeepSeek bills peak/off-peak; the schema stores ONE rate — the PEAK
  rate, deliberately.** Since 2026-08-16 16:00 UTC, `deepseek-v4-pro` costs
  $1.32 in / $3.96 out per Mtok during peak (01:00–04:00 and 06:00–10:00
  UTC) and half that off-peak. `cost_in_per_mtok` cannot carry a schedule,
  so runs outside peak windows are OVER-stated by up to 2× in the cost
  column — an honest over-statement beats a quiet under-statement, because
  the column feeds budget reading. Anyone tempted to "fix" the number down
  should split the schema first.
- **Kimi cache-hit input ($0.30 for k3) is not modelled** — the single
  input rate is the cache-miss $3.00, same over-state-not-under-state rule.
- **Model strings: a documented ID, never a mutable alias.** The rule 1.14
  shipped mechanically (no `latest`, must carry a digit) and it would have
  refused `deepseek-chat` — but only on edit; the alias sat grandfathered
  until the vendor retired it on 2026-07-24 and calls silently stopped
  resolving. The widened discipline: pin only IDs the vendor documents as
  models (`deepseek-v4-pro`, `kimi-k3` — both documented IDs that serve
  dated builds internally, which is the vendor's contract to keep). No
  trigger can know a vendor's catalogue; the run log's resolved-model
  column is the retrospective detector when behaviour shifts anyway.
- **The IDR display rate** lives in `src/logic/lab/labConfig.ts`
  (Rp 16.500/$, display-only; USD is the stored truth). Update as it drifts.
- **Walk one real project through Evidence** — intake first (raw ask, framed
  question, sub-questions with falsifiers), then datapoints against a real
  commitment. That remains the right first use of every agent.

## Known deferrals from the original Lab build (unchanged)

- **Executor integration smoke test** — needs the owner's passphrase and a
  live key; run the seeded `ceo-briefing-deck` agent and confirm the row.
- **Binary file attachments** — text is inlined so the run row records what
  the model saw; binary would go through the artifact path.
- **Per-run model override** — the provider row fixes the model; every knob
  on the dispatch path is another thing the boundary must be checked against.
- **Run-log pagination** — newest 500 runs; page it when that is not enough.
- **Artifact browser** — signed-URL downloads exist; no dedicated screen.

## Pre-existing repairs made in passing (recorded, not lab features)

- The local SQL replay shim lacked `auth.one_time_tokens` and the role-read
  fixture predated the text-history actor stamp — every local SQL suite had
  been red since 2026-08-09. Both repaired.
- `collaboratorLink.test.tsx` pinned a link expiry to 2026-08-10, going red
  the day after it was written. The fixture now derives from the clock.
- Stale comment on `run-research-council/index.ts` (claims it writes
  `os_research_council_sessions`; the client writes that row). Flagged in
  the Phase 0 findings, left untouched — it is a Growth-serving function.
