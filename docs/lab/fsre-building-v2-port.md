# FSRE building v2: the port into Personal OS (M2 update)

Branch `feat/fsre-building-v2`, from `origin/main` at `58f5fe3` (the v1 building, PR #108, and the
M5 live-feed draft, PR #109). Source: the GLM workspace `C:\work\glm\fsre-building` at `5b5d186`
(brief v2 WO-1 to WO-6, brief v2.1 FX-1 to FX-10), read through `git archive`; the GLM repository was
not modified. FX-11 to FX-14 of brief v2.1 are done here, one commit each. The M3 hold stays: the
Supabase transport is a stub ("Not wired yet"), Live is disabled, nothing touches Supabase.

## Where things are

| GLM (`5b5d186`) | Here |
| --- | --- |
| `src/contract/v2.ts`, `docs/contract-v2.md` | `src/data/fsreTransport/contract.ts`, `docs/lab/fsre-contract-v2.md` (verbatim, unresolved) |
| `src/contract/vocabulary.ts` | words in `src/logic/lab/fsre/statuses.ts`, glyphs and tones in `glyphs.ts` (the app's one vocabulary); stage list and roster, which are names from data, in `src/data/fsreTransport/provisional.ts` |
| `src/transport/*` (mock, clock, script, universe, controls, factory, Supabase stub) | `src/data/fsreTransport/*` |
| `src/derive/deskState.ts`, `src/live/liveReducer.ts`, `src/live/deskViews.ts` | `src/logic/lab/fsre/deskState.ts`, `liveReducer.ts`, `deskViews.ts` |
| `src/layout/floorLayout.ts` | `src/logic/lab/fsre/departmentLayout.ts` (seats), `departmentPlan.ts` (the replay on the seats) |
| `src/render/*` (a second isometric renderer, inline colours) | not ported: both modes draw with this app's `FsreFloor` and token classes; `deskScene.ts` builds the synthetic floors |
| `src/panels/*` (synthetic) | `src/views/lab/fsre/FsreOffice.tsx`, `FsreLivePanel.tsx`, `FsreComposer.tsx`, `FsreDialogs.tsx`, `FsreIndustries.tsx`, `FsreLiveMetrics.tsx`, `FsreMockClock.tsx`, `FsreModeSwitch.tsx`; their logic in `src/logic/lab/fsre/liveView.ts` |
| `src/panels/*` (replay), `src/events/reducer.ts` | not ported: the replay keeps this app's v1 engine and panels, now on the department floors (`FsreReplay.tsx`) |

## Tests: what kind each is (FX-12)

- **Unit tests** (node): contract-side mock, desk state, live reducer, desk views, department
  layout and plan, desk scene, the panels' logic, the vocabulary, the formatters, the transport
  boundary, the live store's refresh discipline, and this app's rule tests over every FSRE file.
- **Integration tests** (jsdom, fake timers): `src/views/lab/fsre/fsreOffice.integration.test.tsx`
  (GLM's flow list) and the v1 view tests in `fsreBuilding.test.tsx`. GLM called its suite "e2e"; it
  never ran in a browser. Renamed by FX-12.
- **End to end**: the flows run in a real browser (Chromium through Playwright, 1400×1000 and
  390×844). Playwright is not a dependency here (adding one needs the owner); the run is described
  below, with its screenshots.

## Corrections to GLM's report-v2 (FX-12)

GLM's `docs/report-v2.md` (at `2593bd7`, before brief v2.1) said, and the audit
(`docs/audit-v2-claude.md` in the GLM workspace) found:

- (a) "UI code talks only to FsreTransport." Not true at v2: the store constructed `MockTransport`
  and the UI imported mock modules (audit F5). True after FX-5 in GLM, and true here:
  `src/data/fsreTransport/boundary.test.ts` fails on any import of a mock module from outside the
  transport.
- (b) "Every number in synthetic mode is derived from events." Not true at v2: facts loaded was the
  last event's value, the gate metrics ignored the filter, the partner-room button read the replay's
  count (audit F6). True after FX-7 in GLM, and here (`summaryCard`, `liveView.ts`).
- (c) "11 fictitious tickers in 6 sub-industries." The intake universe has 17 tickers in 9
  sub-industries (`src/data/fsreTransport/mockUniverse.ts`).
- (d) "End-to-end tests over the real app." They were jsdom integration tests; see above.
- GLM wrote no `report-v2.1.md`: its run stopped after FX-10, with a partial FX-11 in a stash that
  this port ignores.

The contract prose (`docs/lab/fsre-contract-v2.md`) keeps its sentence "the UI talks only to the
`FsreTransport` interface; the real transport drops in with no UI changes": FX-5 made it true.

## Commits

| Commit | What |
| --- | --- |
| `63451d6` | v2 core: the contract, the mock office, desk states (no screen change) |
| `c474cb3` | refactor, no behaviour change: the floor plan carries its furniture; the context takes a plan |
| `3367c34` | v2 replaces v1: the mode switch, the replay on the department floors, the synthetic office, the industries board |
| `8746e6b` | v2.1 FX-11: leads read as leads by position; every desk reachable on a phone |
| `fc537c4` | v2.1 FX-12: honest test names and corrected claims |
| `53c2537` | v2.1 FX-13: the mock's script and seed data match brief v2 §4 |
| `02c199c` | v2.1 FX-14: small fixes in the synthetic office |
| `f34bd0a` | the independent review's findings (R1–R12) |
| `76b12b2` | the replay's wall screens stand clear of the desks' chips (R3, finished) |
| this commit | this report and its screenshots |

## FX-11 to FX-14 (brief v2.1), as done here

- **FX-11.** Each department lead sits at the head of its room, front and centre; the staff row behind
  parts in a centre aisle (companies alternate either side); on 3F the checkers sit in a row behind
  the lead, left of the gate rooms. A lead's chip stays on the lower level and is capped at 8rem, so
  even a long task never reaches the staff desks behind it. Narrow screens: the building **scrolls
  sideways inside its own section** (this app's v1 container); the page never does. Acceptance: on
  screen, `deskScene.test.ts` turns the scene's chips into the rectangles the CSS draws at the
  narrowest building width, for 1–8 staff on B1 and 2F and the checkers on 3F (with a negative
  control: an uncapped lead chip would meet a staff desk); in the browser, no lead chip overlapped
  another chip in 30 s of a two-engagement run, and the leads came into view by scrolling at 390 px.
- **FX-12.** GLM's "e2e" suite is `fsreOffice.integration.test.tsx` (jsdom), same tests before and
  after; the corrections to GLM's report-v2 are above.
- **FX-13.** SYNA's Gate 2 escalation arrives before the gate reports; two industry rows are not placed
  on the chain; instructions and questions get one related action between received and done.
- **FX-14.** "companies of 2"; the plan card shows Running after Start; ✕ or Escape withdraws an
  unstarted plan; the decline rules say "(placeholder)" and carry the tooltip; the dialogs' scrim is
  this app's `black` token (no colour value in any FSRE file).

## End to end, in a real browser

The flows ran in Chromium through Playwright against `vite preview` of the built app (the in-memory
mock repository, owner viewer), at 1400×1000 and 390×844, and once with reduced motion. Playwright
is not a dependency of this repository (decision D13 below): the run used a scratch script and a
Playwright install outside it. Last run, on the build of `76b12b2`: **41 of 41 checks passed.**

- Replay: the UNVR run opens at its end (50 of 50 events), with its source label ("Replay of
  replay-unvr.json") and the export's note on its times; Live is disabled, "Not wired yet"; the
  vacant checkers and the unstaffed count show; no chip covers a wall screen, at both widths.
- Synthetic: the banner; staff desks assigned from the start; the leads; a spare desk "Idle, no
  assignment"; nothing moves for 4 s with the clock paused; desks work and flash as events arrive;
  facts loaded 18.356 (both intakes); "No signal since HH.MM" and the floor tag's "1 no signal"; the
  escalation in full ("Passed, 1 escalation open"); the engagement waits for the owner; the partner
  room never softens the count and keeps approval locked with its reason; the bell and the partner
  room's button agree.
- Commands: a declined ask shows its rule, explanation and placeholder tooltip; the desk panel's
  composer has To fixed; a question goes Sent → Received → Done with times; the override closes the
  escalation, approval unlocks, approving publishes.
- Engagements and industries: MOCKX cannot start; a started plan reads Running and staffs new desks;
  no lead chip overlaps another chip with two engagements running; the board is grouped, has a "Not
  placed on the chain yet" group, no percentages, "companies"; the cement row is covered after
  publishing; "Open in the building" filters and dims.
- Phone: the page never scrolls sideways (scrollWidth 390 = innerWidth) in either mode or on the
  board; the building scrolls inside its section and the leads come into view.
- Reduced motion: events arrive, no chip flashes. No network call beyond the local server; no page
  error.

### Screenshots (`docs/lab/fsre-building/v2/`, build `76b12b2`)

| File | What it shows |
| --- | --- |
| `01-replay-1400.jpg` | The UNVR replay on the department floors: source label, notes, metrics, legible wall screens |
| `02-synthetic-start-1400.jpg` | The synthetic office at mock 16.00: banner, assigned desks, leads at the head of each room |
| `04-no-signal-1400.jpg` | "No signal since 16.02" on Modelling staff · SYNB, counted in 2F's floor tag |
| `06-partner-room-locked-1400.jpg` | The partner room: "G2 Passed, 1 escalation open", Approve disabled with its reason |
| `07-desk-panel-declined-1400.jpg` | A desk panel: the declined command with its rule, explanation and tooltip; the composer |
| `09-plan-blocked-1400.jpg` | The MOCKX plan: excluded, Start disabled with the reason |
| `11-after-new-engagement-1400.jpg` | Two engagements: new staff desks either side of the aisle, lead chips clear |
| `12-industries-1400.jpg` | The industries board: chain groups, stage bars, covered rows, not-placed rows |
| `13-filtered-building-1400.jpg` | The building filtered to one engagement; other desks dimmed and labelled |
| `14-replay-390.jpg`, `15-synthetic-390.jpg` | Phone width: no sideways page scroll, the banner |
| `16-synthetic-390-scrolled.jpg` | Phone width, the building scrolled inside its section: the leads in view |

## Tests

| | Files | Tests |
| --- | --- | --- |
| Whole suite on `origin/main` (`58f5fe3`) | 144 | 2.429 |
| Whole suite on this branch (`76b12b2`) | 156 | 2.600 (all pass) |
| FSRE suites on this branch | 23 | 367: 314 unit (node, incl. the rule tests), 53 integration (jsdom) |

Ported from GLM: desk state, live reducer, desk views, the mock transport, the vocabulary, the
formatters, the live store's refresh discipline, the transport boundary, and the integration flows.
New here: the department layout and plan, the desk scene with FX-11 on screen, the panels' logic,
the replay on the department floors, and the review's cases. This app's rule tests (no number in a
component, no data name as a literal, one vocabulary, colours only as tokens, one formatter, British
English) cover every new FSRE file.

Pre-existing and unrelated: under full-suite load, `src/hooks/useMutation.ts`'s success timer can fire
after jsdom teardown ("window is not defined", seen from `src/views/work/*` and
`src/views/lab/evidence/*`), and one `processReferences.test.tsx` case can fail; both on
`origin/main` before this branch, both pass alone. A separate task works on them
(`fix/test-teardown-flakes`). The final runs of this branch were clean.

## The independent review

A reviewer with fresh context (it did not write the code) checked the branch at `02c199c` against
brief v2 §0–2 and §5, every S1 and S2 of the GLM audit (F1–F14) and FX-11 to FX-14, with
screenshots at 1400×1000 and 390×844. It found **0 S1, 5 S2 and a §2 breach** (counts not always
shown in full). All were fixed in `f34bd0a` and `76b12b2`:

| Finding | Sev | Fix |
| --- | --- | --- |
| R1 FX-11 not met on screen: a lead's chip over staff chips with two engagements | S2 | Lead chips never raised, capped at 8rem; wider aisle; FX-11 tested on screen; checked in the browser |
| R2 The industries top line under-counted escalations | S2 | The larger of the rows' own counts and this session's events |
| R3 Replay: chips over the data counter and the issue board | S2 | Chips raised only for a neighbour; no spare desk in a replay; the wall screens placed clear; checked in the browser at both widths |
| R4 The port report lacked the decisions and the browser run | S2 | This document |
| R5 "No signal" needed the mock's clock | S2 | The wall clock without mock controls; tested with a clockless transport |
| R6 The owner's desk read Working, then No signal | S3 | The owner's desk waits while anything waits for the owner |
| R7 A flash replayed on coming back from the board | S3 | Only an event that arrives while the floors are shown flashes |
| R8 A second override resolved an escalation again | S3 | Resolved once; never on a cancelled engagement |
| R9 "Chain position 9 of 8" | S3 | Named by its chain group |
| R10 Re-proposing left the first plan behind | S3 | The earlier unstarted plan is withdrawn |
| R11 "Passed, 1 escalation open" without a count | S3 | FX-3's "Passed, escalation open" |
| R12 Words outside the vocabulary; a summary card speaking for no engagement | S3 | Moved into the vocabulary; "No engagement running" |
| R12 (rest) Seed rows with engagement ids the office does not list; staff chips touching each other with five or more desks | S3 | Left: mock data, and chips between staff desks are raised when they are neighbours |
| R13 The harness's reduced-motion check was vacuous | S3 | It now proves flashes occur without reduced motion first |

A second review of the fixed branch is recorded below.

## What the port changed from GLM's build, and why

1. **One renderer, this app's tokens.** GLM brought a second isometric renderer with inline colours.
   Both modes here draw through `FsreFloor` and the `index.css` token classes; the synthetic floors
   come from `deskScene.ts`. No colour value exists in any FSRE file (the rule test checks it).
2. **The replay keeps this app's engine.** GLM's replay ran its own copy of the v1 reducer, which the
   mount report had found failing three rules. Here the replay is this app's v1 replay unchanged in
   behaviour (UNVR export, source label, notes, metrics, panel, timeline, controls, search), drawn on
   the department floors through `planDepartmentFloors` (WO-2: "map its per-skill agents to the new
   desks by skill name").
3. **Names from data stay data.** The provisional stage list and the brief's roster name stages and
   skills, which this app's rule 2 keeps out of the building's view and core. They live in
   `src/data/fsreTransport/provisional.ts`; the owner is recognised by role, gates by the one gate
   predicate, never by a literal id.
4. **One derivation per desk.** GLM's desk panel derived its own state word, without the escalated
   and no-signal states, so it could say "Working" beside a "No signal" chip. The panel's badge is now
   the desk's own derived state.
5. **Legibility.** Desk chips are two lines (state and in-tray; name plate and the monitor's words),
   so back-row chips stay on their floor; the replay's wall screens keep the v1 sizes where the v2
   rooms leave the wall free; neighbouring chips alternate heights left to right.
6. **M5 stays dormant, not deleted.** The M5 live feed (`connectedLiveSource`, `liveMap.ts`,
   `src/data/fsreLiveFeed.ts`) and its approve button (`PublishControl`, `src/data/fsreApproval.ts`,
   `supabase/functions/fsre-events`, `fsre-approve`) are untouched and still tested; the building
   no longer offers them, because Live is "Not wired yet" until M3. Whether they become the
   SupabaseTransport behind the v2 contract is decision P1 below.

## The run_log.json behind replay-unvr.json

`src/data/fsre/replay-unvr.json` is written by `scripts/fsre/export-replay.py` from a checkout of
`dikagustiana/fsre-skills`: the events from `docs/dry-run-unvr/wave-2026-02/run_log.json` (run
`unvr-dry-run`, wave `wave-2026-02`; the router's own times), with `review_notes.json`,
`change_proposals.json`, `commands.json`, `calibration.json` and `manifest.json` from the same
folder. That `run_log.json` last changed in fsre-skills `91bb4b7` (30 Sep 2026, "UNVR dry run
(wave-2026-02)"). Re-running the exporter against the local fsre-skills clone (HEAD `be7defc`, read
only) into a scratch folder reproduced all three bundled files byte for byte.

## Open contract decisions (none resolved here)

GLM's own decisions are D1, D2, D5, D10 and D12; the rest GLM made implicitly in code; P1–P3 came up
in the port.

| # | Decision | GLM's choice | Recommendation |
| --- | --- | --- | --- |
| D1 | Gate verdict | In `counts.gatesFailed` (0/1); missing reads Pending since FX-4 | A typed `gate: { id, verdict, checksPassed, checksFailed }` on `gate_result`; absent means Pending |
| D2 | Escalation scope of the approval lock | Engagement-wide; escalations reach a gate only by `stageId` | Keep the stricter engagement-wide lock; add `blocksGate` so an escalation raised at a non-gate stage blocks the next gate |
| D3 | Ids | Counter strings per process (`evt-n`, `cmd-n`, `eng-<code>-n`, staff by start order) | UUIDs (or ULIDs) written by the backend; agent identity a seat row, separate from its assignment |
| D4 | `seq` and time | `seq` per stream; `at` stamped by the emitter | `seq` a DB identity with `sinceSeq` resume on `subscribeEvents`; keep `at`, add `recordedAt`, derive No signal from it |
| D5 | Heartbeats | Ignored for desk state | Accept (and they never flash a desk, FX-8) |
| D6 | Payload values | Free-form `counts` and free-text `summary` | An allowlist of count keys, non-negative integers only, checked at the transport and by a DB check; a guard on free text |
| D7 | Declined rule | Rule token inside the `command_declined` summary, parsed by the UI | A typed `declinedRule` on the event |
| D8 | Command lifecycle | sent → received → done/declined; no stream | Add `failed` and `expired`; the commands table is the source of truth and the UI subscribes to it |
| D9 | Who may approve | "Owner only" in a comment | Backend-enforced owner auth; the agents' role has no grant on approvals; preconditions as FX-1 |
| D10 | Publish signal | `task_done` on the owner agent with prose | A `version_approved` event with a typed `version` |
| D11 | Version to approve | Hard-coded `v1` | `readyVersion` on the engagement, set when it reaches `waiting_owner` |
| D12 | `waiting_owner` trigger | A `waiting` event from the owner agent | Explicit `engagement_status` events |
| D13 | Real-browser tests | jsdom only | Owner's call: add `@playwright/test` (a new devDependency, and a one-time browser download), or keep the scripted Chromium run this port used |
| D14 | Roster details | Standing review checkers; one spare unstaffed desk per per-company floor; `listCommands({agentId})` includes Cc | Keep the checkers; drop the spare desk at M3; keep the Cc filter, documented |
| P1 | Two live contracts | — (GLM did not know M5) | M5 maps the suite's `fsre_status.events` to the v1 event shape and approves through `fsre.can_approve`; v2 is `FsreTransport` with agents, commands and engagements. Choose one seam before M3. Recommendation: `FsreTransport` is the UI's seam; the M5 feed and approve function become the `SupabaseTransport` behind it |
| P2 | Stage list | `STAGES_PROVISIONAL`, a constant outside the contract | The transport serves the router's stage list (`listStages()` or a stages table); the constant goes when it does |
| P3 | Replay seating | — | Confirm the mapping: the data lead's two skills at one station, `review-manager` as the review lead, the checkers vacant in the replay, unknown skills kept on their stage-data floor |

Smaller implicit choices, best accepted unless you object: `proposeEngagement` throws on text it
cannot match; `startEngagement` starts only from `proposed`; cancel unassigns per-company staff and
deletes added staff agents; the UI reads `counts.queueDepth` and `counts.factsLoaded` as special
keys; `covered` is computed by the backend; the spanning layers are two chain groups.

## What the contract still needs before M3

1. Typed fields where the UI now parses or infers: the gate verdict (D1), the declined rule (D7), the
   approved version and the version to approve (D10, D11), engagement status changes (D12), the
   escalation's gate (D2).
2. Identity and ordering a database can keep: UUIDs, a global `seq` with resume, a recorded time
   (D3, D4).
3. A payload rule that keeps financial values out by construction (D6).
4. A complete command lifecycle with a stream (D8).
5. Approval authority in the backend, with the FX-1 preconditions (D9).
6. One seam: M5's suite feed and v2's transport reconciled (P1), and the stage list served by the
   transport (P2).
7. Then the tables, RLS and functions as versioned migrations for the owner to apply, with this
   repository's SQL suites (CLAUDE.md §2) — none written here.
