# TODO — deferred deliberately

Things the Lab brief ruled out of v1 (Part G), plus gaps discovered while
building that were noted rather than scope-crept. Nothing here is half-built;
each item is absent on purpose.

## Ruled out by the brief (Part G)

- **Agent marketplace / sharing between users.** Lab tables carry no member
  policies — isolation by absence. Sharing would be a policy design, not a
  feature flag.
- **Scheduling / cron.** Every run is user-initiated and confirmed, the same
  rule as the research sends.
- **Eval scoring or grading.**
- **Node canvas for chains.** The builder is a linear ordered list; a canvas
  earns its place only when chains stop being sequences.
- **Prompt diff / version-compare viewer.** `os_lab_agents.version` is
  bumped by the database guard on every system_prompt edit, but no history
  table stores the previous text — adding one is the version-compare feature
  by the back door, so it waits for an explicit decision.
- **Webhooks.**

## Operational, waiting on the owner

- **Set the provider API keys** as Edge Function secrets:
  `LAB_ANTHROPIC_API_KEY` (required for the three internal agents),
  `LAB_DEEPSEEK_API_KEY` (optional). Kimi already works — it falls back to
  the existing `RESEARCH_MODEL_API_KEY`. The run screen's probe shows which
  are live, and runs against un-keyed providers refuse with the reason.
- **Verify the seeded provider rates.** `os_lab_providers` was seeded with
  list prices as of 2026-08-17; they are data, edited in the table editor.
- **The IDR display rate** lives in `src/logic/lab/labConfig.ts`
  (Rp 16.500/$, display-only; USD is the stored truth). Update as it drifts.

## Known deferrals from the build

- **Executor integration smoke test.** The DB boundary has a superuser SQL
  suite (`scripts/lab-boundary-tests.sh`) and the client has 37 unit tests,
  but a true end-to-end run of `run-lab-agent` needs the owner's passphrase
  and a live key, so it is a manual step: run the seeded
  `ceo-briefing-deck` agent (kimi is already keyed) and confirm the row,
  tokens and cost land in the log.
- **Binary file attachments.** The run screen attaches text files by
  inlining them into the input (so the run row records exactly what the
  model saw). Binary uploads would go through the artifact path instead.
- **Per-run model override.** The provider row fixes the model; a per-run
  override column is easy but was not asked for, and every extra knob on
  the dispatch path is another thing the boundary has to be checked against.
- **Run-log pagination.** The log reads the newest 500 runs. Enough for
  months at current volume; page it when it is not.
- **Artifact browser.** Artifacts are saved and downloadable via signed URL
  from the executor, and listed per run in the schema, but there is no
  dedicated artifacts screen yet — the run log is the entry point.

## Pre-existing repairs made in passing (recorded, not lab features)

- The local SQL replay shim lacked `auth.one_time_tokens` and the role-read
  fixture predated the text-history actor stamp — every local SQL suite had
  been red since 2026-08-09. Both repaired.
- `collaboratorLink.test.tsx` pinned a link expiry to 2026-08-10, going red
  the day after it was written. The fixture now derives from the clock.
- Stale comment on `run-research-council/index.ts` (claims it writes
  `os_research_council_sessions`; the client writes that row). Flagged in
  the Phase 0 findings, left untouched — it is a Growth-serving function.
