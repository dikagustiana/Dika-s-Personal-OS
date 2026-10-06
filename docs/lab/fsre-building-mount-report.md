# FSRE building: mount report (brief 02)

**Ringkasan (buat Dika)**

1. Gedung FSRE udah kepasang di Personal OS: satu view di Lab, cuma buat owner, tanpa alamat baru.
2. Isinya replay asli dry run UNVR dari fsre-skills (50 event, 13 stage router), bukan data contoh lagi.
3. Kamu duduk di partner room (4F), router di lobby; 13 eskalasi + 2 proposal nunggu keputusanmu.
4. Approval kekunci selama masih ada eskalasi terbuka, dan tiap alasannya ditulis lengkap.
5. Tes: 141 file, 2373 tes lulus; typecheck dan build hijau.
6. Cek step 6 (keyboard, target 44px, kontras 4,5:1, lebar 390/768/1024/1440) lulus semua, setelah beberapa perbaikan.
7. Yang dibenerin: chip yang saling numpuk, teks eskalasi yang dobel, angka "Escalated notes" yang ketimpa, catatan waktu dari export yang nggak muncul.
8. Feed live belum nyambung: nunggu keputusanmu soal CP-wave-2026-02-007, backup database (PR #107), dan izin dependency `npm:postgres`.
9. Masuk ke main lewat PR, dengan rollback yang udah dites (revert ke `5594d9a`, yang sekarang live).
10. Data SAMB nggak disentuh sama sekali.

Status: **steps 0–6 done.** Step 0 (report and plan) first, then each step appended as it landed.

Source: `C:\work\glm\fsre-building` (GLM, HEAD `71b64b4`, 8 commits), read and built in a copy;
the source folder was not changed (`git -C C:/work/glm/fsre-building status --short` is empty).
Target: this repository, branch `feat/lab-fsre-building` from `main` `5594d9a`.

## 1. The source

### 1.1 Health

| Check | Command | Result |
|---|---|---|
| Lockfile | script over `package-lock.json` | 187 entries, every `resolved` on `registry.npmjs.org`, all with `integrity` |
| Install scripts | same | `esbuild@0.28.2` (postinstall, not needed: the platform binary arrives as an optional dependency) and `fsevents` (macOS only) |
| Install | `npm ci --ignore-scripts` | pass, 116 packages |
| Audit | `npm audit` | 2 moderate, dev-only (`@vitest/mocker`, via vitest 3.2.7) |
| Type-check | `npx tsc --noEmit` | pass |
| Build | `npm run build` | pass, `index.js 283.96 kB` (gzip 86.61) |
| Lint | — | no lint configuration in the source |
| Tests | `npm test` | pass, 2 files, 18 tests |
| On React 18.3 | second copy with react/react-dom 18.3.1 | `tsc` pass, build pass, 31/31 tests (with two review test files) |

No React 19-only API is used (`createRoot`, `StrictMode`, `useEffect`, `useRef`, `useMemo`,
`useState`, `useId` only). Tailwind 4 appears only in `src/index.css:1` (`@import "tailwindcss"`)
and the `@tailwindcss/vite` plugin; every colour is an inline style from `src/theme/tokens.ts`,
so moving to this repository's tokens is a mapping job, not a class rewrite.

### 1.2 The seven rules

| Rule | Verdict | Evidence |
|---|---|---|
| 1. Pure function of events | **Fail (partial)** | The reducer is pure (`reducer.ts:340-536`, `useFloorState.ts:13-16`), but four surfaces read the replay file's figures directly: B1 wall counter (`wallFeatures.tsx:121-125`), archetype board (`:103-104`), folder panel figures (`RightPanel.tsx:76-108`), "N proposals from guruh" (`RightPanel.tsx:364,397-401`). Rendered at cursor 0 (no event applied) the B1 counter already shows "10.142 Facts 209 Rows 0 Unmapped 209 Rows traced" |
| 2. No number literals; stages and roles from data | **Fail** | Literals per component file: `Floor.tsx` 45, `primitives.tsx` 39, `wallFeatures.tsx` 41 (e.g. `Floor.tsx:361 project(obj.x, obj.y, 1.75)`, `SearchBox.tsx:42 slice(0, 8)`); stage names hard-coded (`MetricsBar.tsx:46 "Gate 1 result"`, `RightPanel.tsx:134,151`); skill names hard-coded (`Floor.tsx:162 'review-manager'`, `:296 'owner'`, `reducer.ts:140,169,525`). Roles do come from `skills.json` |
| 3. Escalations never softened | **Fail (narrow)** | Chip, desk document, badge count and written lock reason all hold. But: the reviewer reads "Done" after `gate_passed_with_escalation` (`reducer.ts:429-441` never counts it); a later gate result overwrites an earlier failure (`:419-422`); the lock keeps only the latest reason (`:283-284`); one `approved` clears every company's escalations (`:503-520`) |
| 4. Colour never alone | Pass (two gaps) | Glyph + word per state (`theme/glyphs.ts`, `state/statuses.ts`); gaps: 1F stage-screen cells (`wallFeatures.tsx:83-95`) and partner-desk documents (`Floor.tsx:315-324`) show a glyph without a word |
| 5. One source per list; one tokens file | **Fail on lists**, colours pass | Colours only in `tokens.ts`. Duplicated lists: legend words (`Legend.tsx:9-12`), event-kind words (`RightPanel.tsx:22-33`), figure labels three times (`render/constants.ts:31-36`, `RightPanel.tsx:86-101,281-286`), each floor's `skills` array (`floorLayout.ts:61-119`) duplicates `skills.json` |
| 6. Placeholders as written; provisional labelled | Pass (weak) | Bracketed titles reach the screen unchanged (`reducer.ts:464,493`); one fixed provisional sentence (`NoteBar.tsx:17`) that does not say which data is provisional |
| 7. British English; one formatter | Pass (minor) | `lang="en-GB"`; one formatter (`format.ts:10-16`, 10142 → "10.142"). Defects: the header badge bypasses it (`Header.tsx:72`); no rounding control (`0.1+0.2 → 0,30000000000000004`) |

### 1.3 Supply chain and network

No runtime network call, web font or third-party domain in `src`, `index.html`, `vite.config.ts`
or the built bundle (the only `fetch(` is Vite's same-origin preload helper). System fonts only.
The polling watcher (`vite.config.ts:8-12`, `usePolling: true, interval: 300`) affects only the
dev server and vitest watch mode.

### 1.4 GLM's four deviations (`docs/report.md`)

| Deviation | Judgement | In the port |
|---|---|---|
| Partner-room items derived from events, not read from `partnerQueue` | Right: rule 1 and a live feed need it. Bug: the issue lookup ignores the ticker (`reducer.ts:265`) | Keep. Items come only from event payloads (`title`, `detail`, `raisedBy`), keyed by ticker; `partnerQueue` disappears (brief 04 drops it) |
| Extra tokens (`stateText`, plant, folder, shadow) | `stateText` is right (amber text 3,44:1 at `#C27A1E` vs 6,26:1 at `#8A5410`); `folder` duplicates `primary` | Map onto this repository's tokens; add only state, selection and chip tokens |
| B1 counter position | Position fine; content wrong (static figures, one company) | Keep the position; show run totals derived from events, or the selected company's figures |
| Polling file watcher | Dev-only, machine-specific | Drop |

### 1.5 What breaks with ten or more companies

A review test built SYN01..SYN10 (130 events sequential, 128 interleaved, and a worst case of
10 escalations plus 2 proposals) against the source reducer:

- **One folder.** `FloorState.folder` is a singleton whose ticker comes from `replay.company`
  (`reducer.ts:172-174`): it reads UNVR with zero UNVR events; whichever company last started a
  stage moves it. Folder keys, chip ids and selection are singletons (`Floor.tsx:342,409,490`,
  `store.ts:38`).
- **No per-ticker state.** Agents hold one `currentStageId`; stage and gate status, `factsLoaded`
  and the tie-out metric are overwritten by the latest event (SYN03's gate failure is invisible;
  `factsLoaded` shows 10.000, not the 55.000 sum); the escalation title lookup mixes companies
  ("SYN09, Decomposition: SYN07 own issue title"); `approved` acts on every company.
- **Search** matches only the singleton folder: "SYN05" returns nothing.
- **Partner desk:** documents sit at `x = 12,5 + i·1,1` with no wrap; with 12 items, 7 float off
  the desk; from the 18th they are drawn outside the SVG and invisible though counted.
- **Folders at one desk** would share identical coordinates (`resolveFolderAnchor`,
  `floorLayout.ts:162-215`).
- **Cost:** each step re-reduces from the start and copies every agent's event list: 38 ms for
  3.900 events, fine for replay, quadratic for a live feed.

### 1.6 The data files

| File | Shape | Provisional | Source |
|---|---|---|---|
| `stages.json` | `{provisional, source, stages[{id,name,order,skills[]}]}`, 13 stages | true | "Provisional stage list written in chat" |
| `skills.json` | `{provisional, source, skills[{name,role}]}`, 10 skills | true | "Roles written in chat … not taken from the skill files" |
| `replay-unvr.json` | `{provisional, run, company, timesRecorded:false, archetypes, figures, events[17], partnerQueue[3], note}` | true | every event: "Chat summary … Not verified against the files" |

Events use the field `kind` (`stage_started`, `stage_completed`, `gate_passed`, `issue_raised`,
`escalated`, `proposal_logged` in the data; `gate_failed`, `gate_passed_with_escalation`,
`approved`, `published` in the types). No holdout values, absolute paths or machine details
in `data/`.

## 2. The target (this repository)

| Topic | Fact |
|---|---|
| Routing | None: views are zustand state (`CLAUDE.md` §1). Lab sub-sections are `LabView` (`src/store/appStore.ts:62-63`), switched in `src/App.tsx:59-76`; nav entries in `labNav` (`src/layout/AppShell.tsx:78-96`). The only URL is `/finish-line/*` (`src/views/work/finishLineRoute.ts`). `CLAUDE.md` §11 asks before changing route paths, so the building is a `LabView` (`'fsre'`), with no new URL |
| Owner | Owner = passphrase holder (`x-app-key` → `public.os_key_valid()` in RLS). Client: `Viewer = {kind:'owner'} \| {kind:'contributor', …}` (`appStore.ts:141-142`); contributors are forced to `work/finish-line` and their nav is filtered (`AppShell.tsx:231-239,288`). `App.tsx` does not check `viewer` before rendering a Lab view |
| Owner-only precedent | Simulasi Hari-H (`72d894d`): `ownerOnly` tabs filtered by `viewer.kind` (`FinishLineArea.tsx:43-49,143`), and a contributor who reaches it gets `FinishLineSimulationOwnerOnly` ("Tab ini hanya untuk owner.", no reads); tested in `finishLineArea.test.tsx` with a contributor viewer, spies proving no repository call and no `fetch` |
| Existing Lab | registry, run, runs, chains, flow, evidence, institution, floor (`src/views/lab/*`); `src/logic/lab/iso.ts` (2D isometric SVG maths); the 3D floor is the only lazy view (`App.tsx:34-36`, D-22). Bot Crossing was folded into the floor (D-23). Nothing named fsre exists |
| Tokens | HSL triplets in `src/index.css:57-112` (light only): `--surface-1/2/3`, `--border`, `--foreground(-secondary\|-muted)`, `--primary`, `--primary-dim`, `--success`, `--destructive`, `--escalate` (amber); Tailwind maps colours only to these variables |
| Conventions | zustand stores `useXStore`; UI primitives in `src/components/ui/`; pure logic in `src/logic/`, tests beside their subject, component tests start `// @vitest-environment jsdom`; no lint (do not add); reduced motion handled globally (`index.css:414`) and by `matchMedia` in JS; no shared point-thousands formatter (`toLocaleString('id-ID')` ad hoc) |
| SAMB | SAMB process material lives under `src/logic/process/` and some migrations; this feature does not touch or read it |
| CI | `pnpm install --frozen-lockfile`, `pnpm test:run`, `pnpm build` |

## 3. The plan

### 3.1 Where each part goes

| Source | Target |
|---|---|
| `events/types.ts`, `events/reducer.ts`, `state/statuses.ts`, `theme/glyphs.ts`, `layout/projection.ts`, `layout/floorLayout.ts`, `format/format.ts`, `render/constants.ts` | `src/logic/lab/fsre/` (pure, no React): `events.ts`, `reducer.ts`, `statuses.ts`, `glyphs.ts`, `projection.ts`, `layout.ts`, `format.ts`, `geometry.ts` |
| `data/index.ts` (cast, no validation) | `src/logic/lab/fsre/data.ts`: zod validation of the fixtures (zod is already a dependency) |
| event source (none in source) | `src/logic/lab/fsre/eventSource.ts`: one interface; `replaySource` from bundled data; typed `liveSource` placeholder for M5 |
| `data/*.json` | `src/data/fsre/` (`stages.json`, `skills.json`, `replay-unvr.json`), copied unchanged in step 3 |
| `render/*`, `panels/*`, `App.tsx` | `src/views/lab/fsre/` on this repository's components and tokens |
| `state/store.ts` (zustand) | `src/views/lab/fsre/useFsreViewStore.ts` (view-only: cursor, speed, selection, filter) |
| `theme/tokens.ts` | mapped onto `src/index.css` variables; new tokens only for agent states, selection and chips, added there |
| `index.css` (Tailwind 4), polling watcher, `allowScripts` | not ported |

No new dependency. React, zustand and zod are already in `package.json`.

### 3.2 The core, fixed for many companies (step 1)

- State gets a per-ticker layer: `companies[ticker] = {ticker, name, stageId, stageStatus,
  deskKey, gates: GateResult[] (history, never overwritten), issues, escalations (open/decided),
  figures (from payloads), approved, published}`. Run totals (companies, escalations open, items
  waiting, facts loaded, tie-outs) are derived by summing companies, never overwritten.
- Agents (keyed by skill from `skills.json`) hold the set of tickers they are working on; their
  status is derived: escalated if any open escalation they raised, stalled if an open issue sits
  on a company at their stage, working if any ticker is active, done if they completed work, idle
  otherwise. A gate passed with escalation keeps the reviewer **escalated**, never done.
- Folders are grouped per desk with a count (a stack, at most three drawn, with "N folders");
  a company list with a filter, and selection by ticker (`{kind:'folder', ticker}`).
- Partner-room items come only from event payloads (`escalated`, `gate_passed_with_escalation`,
  `proposal_logged`), keyed by ticker and event id; documents stack with "+N" on the desk; the
  panel lists all of them. `approved` acts on its ticker only and only when that ticker has no
  open escalation.
- Every figure on screen comes from reducer state (no static figures).
- Floors list their skills from the stage data (stages → skills → floor), not a second list.
- Tests (ported, plus): no event changes nothing; step back then forward returns the same state;
  an escalation always yields a partner-room item and locks approval; a run with ten companies
  reduces and renders correctly (folders, counts, search, per-ticker approval).

### 3.3 The event shape the real export follows (brief 04, and M3 live events)

```ts
interface FsreEvent {
  id: string;              // unique within the run
  run: string;             // e.g. "unvr-wave-2026-02"
  ticker: string | null;   // null for run-level events (proposals)
  kind: 'stage_started' | 'stage_completed' | 'stage_returned' | 'stage_blocked'
      | 'gate_passed' | 'gate_failed' | 'gate_passed_with_escalation'
      | 'issue_raised' | 'escalated' | 'proposal_logged' | 'approved' | 'published';
  at: string | null;       // ISO time as the router recorded it; null only when not recorded
  stageId?: string;        // router stage id (selected, doc_plan, intake, gate1, …)
  skill?: string;          // the skill that ran the stage or raised the item
  payload?: {
    title?: string; detail?: string;              // escalated, issue_raised, proposal_logged
    mode?: string;                                // proposal_logged, e.g. "flag-only"
    ref?: string;                                 // note id or change id
    severity?: string; reason?: string;
    figures?: Record<string, number | { value: number; of?: number }>; // gate and stage figures
  };
  source?: string;         // repository path the event was read from
}
```

Stage ids and names come from the router's state machine
(`fs-reverse-engineering/references/state-machine.md`) via `stages.json`.

### 3.4 Owner-only (step 5)

The section is `labView = 'fsre'` with a `labNav` entry. Contributors never see Lab navigation;
`App.tsx` renders an owner-only notice (no reads, no data) when a contributor viewer reaches
`'fsre'`, mirroring `FinishLineSimulationOwnerOnly`. The view is lazy-loaded, so the replay
fixtures are not in the main bundle. Test: a contributor viewer cannot reach it (nav and direct
store state), and no fixture data renders. Note: replay data is bundled; a contributor who
fetched the lazy chunk by hand could read UNVR dry-run events. The live source (M5) is served
only through an owner-checked edge function.

### 3.5 Deviations planned

- `src/logic/lab/fsre/` and `src/views/lab/fsre/` instead of `src/features/lab/fsre/` (the
  repository's convention).
- A second isometric projection beside `src/logic/lab/iso.ts`: the source's projection and
  layout are ported as they are; merging them is a separate change.
- One more lazy view beside the 3D floor (D-22 names the floor as the only one).

## Steps 1–5

Branch `feat/lab-fsre-building`, from `40d4bb5`. Nothing pushed or merged. The GLM folder was only
read (`git -C C:/work/glm/fsre-building status --short` is still empty).

### Commits

| Hash | Subject |
|---|---|
| `27a8a8f` | feat(lab): FSRE building core, fixed for many companies (step 1) |
| `68750b2` | feat(lab): FSRE building event source (step 2) |
| `8b76fd3` | feat(lab): FSRE building replay data, unchanged (step 3) |
| `d6dbda6` | feat(lab): FSRE building UI (step 4) |
| `d4ffd37` | chore(lab): LF line endings in the FSRE files and index.css |
| `eab7ec3` | feat(lab): mount the FSRE building as an owner-only Lab view (step 5) |

`d4ffd37` was not planned: see "My deviations" below.

### What each step built

**Step 1, the core** (`src/logic/lab/fsre/`, pure TypeScript, no React).
- `events.ts`: the §3.3 contract (twelve kinds, `ticker: null` for run-level items, `payload.figures`).
- `data.ts`: zod schemas for the three files, normalised into `FsreRun`. Accepts the provisional
  shape (flat numeric payload fields read as figures; an `escalated` with no reason takes its title)
  and the export shape (router stage ids, ISO `at`, `stage_returned`, `stage_blocked`). Refuses a
  run whose events name a stage the stage data does not have, repeat an id or belong to another run.
  Drops the replay's top-level `figures`, `archetypes` and `partnerQueue`, so nothing downstream can
  read them. Keeps each file's `provisional` flag and `source`.
- `reducer.ts`: per-ticker `companies`; gate results kept as a history; run totals summed by
  `runTotals`, never stored; agents hold the tickers in their hands, with a derived status
  (escalated > stalled > working > done > idle); partner items keyed by ticker and event id;
  `approved` acts per ticker and returns the state unchanged while that ticker (or the run) has an
  open escalation; `published` per ticker. Incremental: one event copies only what it touches;
  agent histories are derived by scanning (`agentEventIndexes`), not stored; `createStateCache`
  keeps a checkpoint every 64 events, so stepping back replays at most 63.
- `layout.ts`: floors take their skills from the stage data by one rule (gates → 3F, last stage →
  4F, a skill in several segments or in none → 1F, first segment → B1, later segments → 2F). Desks,
  agent seats, folder spots and gate rooms are generated.
- `projection.ts`, `geometry.ts`, `scene.ts`: the source's projection, every render constant, and a
  floor built as finished polygons, chips, 44px hit areas and wall content. Folders are grouped per
  desk (at most 3 drawn, chip "N folders · …"); partner-desk documents pile per kind (at most 3
  sheets, chip "N escalations (+N not drawn)").
- `statuses.ts`, `glyphs.ts`, `format.ts`, `search.ts`: one word map per list, one glyph and tone map
  per list, one figure-label map, one formatter, company filter and selection by ticker.

**Step 2, the event source** (`eventSource.ts`). `FsreEventSource { id, label, kind, availability,
load(), subscribe?() }`. `load()` resolves to a result union (`ok` with a run, or `not-connected`,
`invalid-data`, `failed` with a detail), the `ReadResult` idea: "not connected" is said, never drawn
as an empty building. The cursor stays in the view; `appendEvents` (in order, duplicates dropped) and
`followCursor` (a reader at the end follows, one who stepped back stays) are the whole contract with
a live source. `liveSource` is typed and answers `not-connected`; M5 replaces its `load()` with the
first poll of an owner-checked edge function (every 5 to 10 seconds) and adds `subscribe`.

**Step 3, the data.** `stages.json`, `skills.json`, `replay-unvr.json` copied into `src/data/fsre/`
byte for byte (sha256 `66201710…1255`, `02f72329…1007`, `9cf8ab5f…dac7`; identical in the working
tree and in the committed blobs). `replaySource` reaches them through dynamic imports, so each is
its own chunk. The ported reducer tests moved from step 1's hand-written mirror to these files and
passed unchanged.

**Step 4, the UI** (`src/views/lab/fsre/`). Header (run switcher, company search combobox,
partner-room count with "⚠ N escalations" in words), metrics bar (one metric per gate stage, from
the stage data), notes, five SVG floors with HTML chips, wall screens and buttons over them, the
details panel (company list filtered by the search; folder by ticker; agent; gate room; partner room
with every item and the per-ticker lock; a desk's stack), stage timeline, replay controls. Built on
`Card`, `Button`, `Input` and the tokens. `viewModel.ts` holds the words and counts the panels show.

**Step 5, the route.** `'fsre'` in `LabView`; a `labNav` entry "FSRE building" (lucide `Building2`,
short "FSRE"); `App.tsx` renders the building through `React.lazy` + `Suspense` for the owner and
`FsreOwnerOnly` (a sentence, no import from the building) for a contributor. No URL.

### Tests and build

| | Files | Tests | Exit |
|---|---|---|---|
| Baseline, `40d4bb5` | 132 | 2207 passed | 1: one unhandled error (below) |
| Step 1 | 137 | 2297 passed | 1: the same error |
| Step 2 | 138 | 2304 passed | 0 |
| Step 3 | 138 | 2306 passed | 0 |
| Step 4 | 140 | 2335 passed | 0 |
| `d4ffd37` | 140 | 2335 passed | 0 |
| Step 5 | 141 | 2338 passed | 0 |

+9 files, +131 tests. The baseline's error is not from this work: `useMutation`'s 1500 ms success
timer fires after jsdom is torn down in `src/views/lab/flow/labFlowAcceptance.test.tsx` ("window is
not defined"); the file passes alone and the error comes and goes with load. `typecheck` and `build`
passed before every commit (one build crashed in libuv on Windows and passed on the rerun).

Build at step 5: `FsreBuilding-*.js` 74,79 kB (gzip 23,57 kB); `stages-*.js` 1,09 kB, `skills-*.js`
1,27 kB, `replay-unvr-*.js` 7,50 kB; the main chunk grew from 1.871,52 kB to 1.873,07 kB and
contains neither `unvr-dry-run` nor `ARC-PROC`.

### The seven rules

| Rule | Verdict | Evidence |
|---|---|---|
| 1. Pure function of events | **Pass** | `reducer.test.ts`: the initial state equals `reduceEvents([])`; every prefix of the ten-company run equals the cache after a step back and forward; a refused approval returns the same object. `data.test.ts`: the run carries no `figures`, `archetypes` or `partnerQueue`. `scene.test.ts`, `fsreBuilding.test.tsx`: at cursor 0 no folder, no pile, no ticker, no "10.142", "209" or "21 checks"; the counter says "No figures yet"; the metrics say so in a sentence |
| 2. No literals; stages and roles from data | **Pass** | `fsreRules.test.ts` parses every component with the TypeScript compiler: no numeric literal; no stage id, stage name, skill name or ticker as a literal in the view or the core; `layout.ts` names no skill. `layout.test.ts`: the router's stage ids with invented skill names place correctly; moving a stage moves its skill |
| 3. Escalations never softened | **Pass** | `fsreBuilding.test.tsx`: the folder chip is amber with ⚠ and "UNVR · Escalated"; a pile chip "1 escalation" on the partner desk; badge 3 and "1 escalation among them"; the lock lists the full reason; the reviewer reads Escalated after a gate passed with escalation; SYN07's lock shows its own reason only. `reducer.test.ts`: every escalation (per ticker and run-level) yields an open partner item and locks approval; SYN03's failure stays worst on record after a pass |
| 4. Colour never alone | **Pass** | Every chip, stage-screen cell and pile has a glyph and a word (`scene.test.ts`, `fsreBuilding.test.tsx`); partner-desk documents carry "⚠ N escalations" / "✎ N proposals" |
| 5. One source per list; colours as tokens | **Pass** | `fsreRules.test.ts`: no component spells a word from any word map or the figure-label map; no FSRE file carries a colour value; the only new tokens are `--fsre-working`, `-idle`, `-stalled`, `-escalated`, `-done`, `-selection`, `-chip`, `-chip-border` |
| 6. Placeholders as written; provisional labelled by file | **Pass** | `fsreBuilding.test.tsx`: "[Proposal 1: …]" and "[Proposal 2: …]" verbatim; one note per provisional file naming it and quoting its source; "Times were not recorded" only from `timesRecorded: false` (the ten-company run has times and shows no such note) |
| 7. British English; one formatter | **Pass** | `format.test.ts` (10142 → "10.142", 0.45 → "0,45", 0.1 + 0.2 → "0,3", 1.005 → "1,01"). `fsreRules.test.ts`: no `toLocaleString`, `toPrecision` or `NumberFormat`; `toFixed` only in `format.ts` and `projection.ts` (SVG coordinates); the type checker finds no number rendered as text; no American spelling in any string |

Each static check in `fsreRules.test.ts` was seen to fail on an injected violation, and the
contributor case in `App.fsre.test.tsx` was seen to fail with the owner check removed.

### GLM's deviations, and what the port did with them

| GLM deviation (`docs/report.md`) | In the port |
|---|---|
| Partner items derived from events, not `partnerQueue` | Kept, keyed by ticker and event id. `data.ts` drops `partnerQueue`; a test still checks the derived items against it in kind, count and proposal titles. The escalation is titled "UNVR, Decomposition: Archetype misfit" (that company's first open issue at the stage) |
| Extra tokens (`stateText`, plant, folder, shadow) | Mapped onto existing tokens (`--escalate` and `--success` already pass 4,5:1 as text); new tokens only for agent states, selection and chips |
| B1 counter placed | Kept on the B1 back wall, wider (x 2–15); it shows sums over the companies, or the selected company's own figures |
| Archetype board | Replaced: its list and its "current" marker came from the file, not from events. The 2F wall is now an open-issues board, from events |
| "Passed with escalation" shown as "Escalated" | The word map says "Passed with escalation" in full, with ⚠ and amber |
| `approved` cleared every escalation | Refused per ticker while one is open; `approved` with `payload.ref` decides the item it names |
| Folder on the reception desk before the first event | No folder until an event names the ticker |
| Speed labels in words | Kept |
| Two disabled runs ("VPS sandbox", "Wave 1, cement pilot") | Not ported: they are not event sources. The switcher lists the replay and the live source, "not connected" |
| Polling file watcher | Not ported |

### My deviations

1. **A seventh commit, `d4ffd37`.** Some edits went through a Windows Python that writes CRLF;
   twenty files reached steps 1–4 with CRLF, and `src/index.css` showed as a whole-file rewrite in
   step 4. `d4ffd37` restores LF (`git diff --ignore-cr-at-eol` on it is empty); from the base, the
   branch's `index.css` diff is 270 added lines. I did not rewrite the commits because CLAUDE.md
   asks first; squashing it into step 4 is the owner's call.
2. **Step order.** `replaySource`'s binding to the bundled files landed in step 3 (it cannot compile
   before the files exist); step 1's ported tests ran on a hand-written mirror of the provisional
   files until step 3 switched them to the files.
3. **Modules beyond the list:** `scene.ts`, `search.ts` and `viewModel.ts` in the core, so the
   components stay free of arithmetic and literals.
4. **`fs-normalize` sits on 2F**, not B1: by the stage data it runs after gate 1. Gates are
   recognised by their id (`/^gate[-_]?\d+$/i`), which matches both `gate-1` and `gate1`.
5. **`approved` with `payload.ref`** decides the escalation or proposal whose event id (or a
   proposal's own `ref`) it names; a ref that names nothing open changes nothing. Without this, no
   event could ever close an escalation.
6. **Run-level escalations** (`ticker: null`) lock every company's approval.
7. **A file without a `provisional` flag** is treated as provisional, and the note says the flag was
   absent.
8. **History on stage cells.** A gate failure on record shows on that gate's stage cell after a
   later pass; the folder still says where the company stands now ("In progress").
9. **Floor tags leave out idle agents**, so an untouched building shows no number.
10. **Overlay text scales with `vw`**, not with a container query: `canvasWidth.test.tsx` requires
    `.app-main` to be the only CSS container.
11. **Motion.** `index.css` calls the drawer the one animation; Lab Flow already added its own, and
    the building adds two that run only on an event (a chip flash, a folder arriving on another
    floor), both off under reduced motion.
12. **Event times are not shown** (the replay has none). The building opens at the end of the
    replay, as GLM's did.

### Open for the owner

- Squash `d4ffd37` into step 4, or keep it.
- The meaning given to `approved` + `ref` (item 5) and to run-level escalations (item 6): the
  export (brief 04) should confirm or change them.
- Whether stage cells should carry gate history (item 8).
- The pre-existing teardown error in `labFlowAcceptance.test.tsx` makes `test:run` exit 1 on some
  runs.
- As §3.4 said, the replay is bundled: a contributor who fetched the chunk by hand could read it.

## Brief 04: the real replay

Two commits. `feat(lab): seats from the skill data (the partner room is the owner's)` carries the
seat rule (layout.ts rule 0, `seat` in data.ts, two figure labels, its layout tests). The second,
`feat(lab): the real UNVR replay, exported from fsre-skills (brief 04)`, carries the data and
everything that follows from it.

### What changed

- `src/data/fsre/` now holds the real export, written by `scripts/fsre/export-replay.py`: 13 router
  stages (`selected` … `closed`), 11 skills (with `partner`, seated in the partner room, and the
  router seated in the lobby), 50 events (22 timed by the router; review notes and proposals carry
  `at: null`), and `provisional: false` in all three files.
- GLM's three provisional files are kept byte for byte as a test fixture in
  `src/logic/lab/fsre/__fixtures__/provisional/` (sha256 `66201710…`, `02f72329…`, `9cf8ab5f…`,
  identical to `C:/work/glm/fsre-building/data`).
- One reducer change, because of the real data. The export raises each escalated note as its own
  `escalated` event, and then the gate reports `gate_passed_with_escalation`. The reducer used to
  open one more item for the gate, which put 15 escalations on the desk for 13 notes. A
  `gate_passed_with_escalation` now opens its own item only when nothing is open at that gate for
  that company. On its own it still reaches the partner room and locks approval; it is no longer
  counted twice.

### Tests moved to the provisional fixture

Everything that exists to prove the provisional *shape*: the per-file provisional labels and
"times not recorded" (rule 6); bracketed placeholders shown as written; flat numeric payload
fields read as figures; a missing `provisional` flag; the static `figures`, `archetypes` and
`partnerQueue` dropped; the ported GLM reducer cases (the 17-event sequence and its partner queue);
and the stage-to-floor rule without seats.

### Tests rewritten for the real data

Expected values are read from the files where they are numbers in the files:
- 50 events, and facts loaded 45.996 (e006, the intake `stage_completed`).
- The Gate 1 tie-out: 386 checks, 371 passed, 0 failed, 15 skipped (e008).
- Gate 1 passed, and Gates 2 and 3 passed with escalation.
- The 13 escalated notes in the partner room, each keyed by its event, and the 2 run-level
  proposals with their titles.
- Approval locked with all 13 reasons written out.
- The reviewer escalated, the owner seated and idle in the partner room, the router in the lobby.
- `timesRecorded` true, with `at: null` exactly on the issue, escalation and proposal events.
- No file provisional, so no provisional note and no times note.

Counts: commit (a) 141 files / 2340 tests; this commit 141 files / 2368 tests (exit 0).

### Rule tests: one changed, and why

Rules 1, 3, 4, 5, 6 and 7 are proven as before (on the real data, the fixture or both), and
their negative controls still hold.

**Rule 2, the literal scan, cannot hold on the real data as written.** The real data names a skill
`partner`, which is also a floor zone (`FLOOR_ZONE_IDS`, and the seat that skill is given), and a
stage `closed`, which is also an issue state. Both words therefore appear as literals in the core
for reasons that have nothing to do with a skill or a stage, and a text scan cannot tell them
apart. So:

- The scan against the provisional names is unchanged and still finds nothing.
- The scan against the real names leaves out exactly the words that are also in the building's
  own declared vocabularies (zones and status lists). The test pins that set to
  `['closed', 'partner']`, so any new collision fails.
- A new behavioural test closes the gap. It renames every stage id (gates keep a gate id), every
  stage name, every skill name and the ticker in the real export, and requires the same result
  under the renaming: the same floors, agent statuses, gate results, partner items, folder desk
  and run totals. A planted `if (skill === 'partner')` branch in `agentStatus` passes the
  exempted scan but turns this test red; it is green again once the branch is removed.

The rule-3 invariant was restated precisely rather than loosened. After every `escalated` event
there is an open item keyed by that event, and the lock names it. After every
`gate_passed_with_escalation` there is an open escalation item at that gate for that company (its
own, or the notes it reports), and the lock names one. A lone gate escalation is still tested to
open its own item.

### Seen on screen (local dev server, real data)

The owner sits in the partner room (4F) and the router in the lobby (1F). Gate 1 reads Passed;
Gates 2 and 3 read "⚠ Passed with escalation". The partner desk shows "⚠ 13 escalations (+10 not
drawn)" and "✎ 2 proposals", the badge says 15, and the panel lists all 15 items and the lock with
13 reasons. Two cosmetic defects are left for a follow-up:
- the long Gate 2 and Gate 3 chips overlap each other on 3F;
- an escalation whose reason fell back to its title prints that title twice, in the panel item
  and in the lock list.

## Step 6: the checks

Done by the coordinator after the port agent's two brief-04 commits, on the built app (`pnpm build`,
`vite preview`, the mock repository, whose default viewer is the owner). Every check was measured in
the page with a script (chip boxes, focus styles, target sizes, computed colours over the composited
background) rather than judged by eye, at 1440×900, 1024×768, 768×1024 and 390×844, on the real UNVR
replay and on the ten synthetic companies. The ten-company run is a test fixture with no source in
the app, so it was shown through a harness build (the fixture added as a second replay source, built
into a scratch folder, the view file restored and checked unchanged); the harness is not committed.

| Check | Real UNVR replay | Ten synthetic companies |
|---|---|---|
| Chips covering each other | 0 at every width (17 chips) | 0 at every width (21 chips) |
| Page scrolls sideways | 0 px at every width | 0 px at every width |
| Targets under 44 px | 0 of 39 at every width | 0 at every width |
| Text under 4.5:1 | 0 words; two glyphs (✓ 4.13, ⚠ 4.41) on the stage screen, symbols beside their word, so 3:1 applies: pass | not measured separately (same styles) |
| Keyboard | 21 Tab stops from the run switcher in reading order (switcher, search, partner-room button, then the building from 4F down); every stop shows a 2 px solid outline under `:focus-visible` | — |

### Found and fixed here

1. **"Escalated notes" showed only the last gate's count** (the agent's decision 3). The folder
   merges figures with the last value winning, so Gate 3's 2 replaced Gate 2's 11. The count was a
   second copy of what the escalated events already say, so the exporter no longer sends it
   (`scripts/fsre/export-replay.py`, data regenerated: only those figure lines changed) and its
   label is gone; escalations are counted from events. Test: no event carries the figure.
2. **The export's note on its times was not shown** (decision 4). `timesNote` is kept by `data.ts`
   and shown as written under the metrics. Test.
3. **An escalation printed its words twice.** With no `reason`, `data.ts` used the title, and the
   panel printed title and reason. The fallback is now the detail, then the title; the panel item
   and the lock list show a reason only when it adds words the title does not hold (a one-sentence
   finding is the title after its check id). Test, with a negative control (the old condition turns
   it red).
4. **Chips covered each other.** Gate 2 and Gate 3 on 3F; the proposals pile over the owner's chip
   in the partner room; at tablet and phone widths a gate room's folders over its gate chip. Now:
   side-by-side gate rooms alternate chip levels; a gate room's folder chip takes the level its gate
   chip leaves free; the owner's chip stands above the two piles; the upper level lifts a whole chip
   height (it lifted 1.5em, less than a chip's 1.45em line plus border, so stacked chips touched);
   and a gate chip says "Escalated", the stage screen's word for that state, because "Passed with
   escalation" at the chips' 9 px floor ran into the next room. The chip's button label, the
   metrics and the panel keep "Passed with escalation"; glyph ⚠ and the escalated tone are
   unchanged (rule 3). Test, with a negative control.
5. **Stage-screen words under 4.5:1 on their own tint** (success 4.13, escalate 4.41). The word is
   written in the foreground colour; the glyph keeps the tone.

The agent's decisions 1 (a gate passed with escalation opens its own item only when none is open
at that gate) and 2 (the rule-2 name scan allows `partner` and `closed`, backed by the renaming
test) are kept. Decision 1 matches the suite: CP-wave-2026-02-007 amendment 2 records a gate's
notes before its result, so live events arrive in the replay's order.

### Screenshots (`docs/lab/fsre-building/`, 1440×900)

| File | What it shows |
|---|---|
| `01-final-folder-selected-1440.jpg` | End of the UNVR replay, the folder selected: where it is, its figures, gates on record |
| `02-partner-room-selected-1440.jpg` | The partner room selected: 15 items waiting, escalations first |
| `03-mid-replay-30-of-50-1440.jpg` | 30 of 50 events: Gate 2 under review, four escalations raised so far, Gate 3 pending |
| `04-ten-synthetic-companies-1440.jpg` | Ten synthetic companies (harness): seven stacks, a failed Gate 1 beside its folders, one published |

### Tests and build

| | Files | Tests | Exit |
|---|---|---|---|
| `57bf543` (seats) | 141 | 2340 passed | 0 |
| `4bafb23` (the real replay) | 141 | 2368 passed | 0 |
| Step 6 | 141 | 2373 passed | 0 |

`typecheck` and `build` pass. Build: `FsreBuilding-*.js` 75,58 kB (gzip 23,84 kB), `replay-unvr-*.js`
26,69 kB (gzip 5,17 kB), both lazy chunks, fetched only when the building opens.

### Open for the owner (step 6)

- The live feed stays "not connected" until milestone M5: the suite's status view (CP-wave-2026-02-007,
  waiting for your decision), a tested backup of this project's database (draft PR #107), and your
  OK on the edge functions' one dependency (`npm:postgres`).

## Milestone M5: the live feed and the approve button (draft, not deployed)

Branch `m5/fsre-live`, on top of the merged building. Nothing here runs until the owner has
decided: the suite's status view and approval functions (CP-wave-2026-02-007), a tested backup of
this project's database (#107), and the edge functions' one new dependency, `npm:postgres`. Until
then the live source keeps saying "not connected" and the building plays the replay.

### What it adds

- `src/logic/lab/fsre/liveMap.ts`: the suite's event rows (`fsre_status.events`) in the building's
  words, the way `scripts/fsre/export-replay.py` translates the run log, so a live run and its
  replay read alike. It is stateful on purpose: a gate passes "with escalation" while an escalated
  note of that gate is open (the suite records a gate's notes before its result, CP-007 amendment
  2), and a decision on a note becomes `approved` naming the building's own event id for that
  escalation. Every row is validated; a gap in the numbering, another wave or an unknown stage
  stops the translation instead of drawing something invented.
- `createLiveSource` in `eventSource.ts`, with the call injected from `src/data/fsreLiveFeed.ts`:
  the newest wave, page by page; then a poll every 5 seconds after news, 10 while quiet or failing.
  A feed that stops answering is said above the building (`role="status"`), and a feed whose rows
  no longer fit is not followed further: the building keeps what it had and says up to which seq.
- `package_staged` joins the building's event contract: the reducer keeps the staged version, which
  the approve button names.
- The partner room's approve button (`PublishControl`, live runs with a backend only): the database
  decides through `fsre.can_approve`; the button is enabled only when it says yes AND the building
  shows no open escalation; approving takes a second click naming the version; a refusal shows the
  database's reasons; a failed call raises the retryable toast and changes nothing. The approval
  reaches the building only as the pipeline's own `approved` event.
- `supabase/functions/fsre-events` and `fsre-approve`, with their input rules in
  `_shared/fsreInput.ts`: the owner check (`checkAppKey`) runs before the body is read or the
  database is touched; each function's only database is its own secret (`FSRE_STATUS_DB_URL`,
  `FSRE_APPROVER_DB_URL`, login roles that can do one thing each); every value is a bound
  parameter; the approver is a constant, never an input; `verify_jwt` stays on, as for every
  function here.

### Tests

141 files, 2373 tests on `main` (`a00ee7c`) → 144 files, 2429 tests here, exit 0; `typecheck` clean,
`build` green. New: `liveMap.test.ts` (the translation, polls continuing, refusals),
`liveSource.test.ts` (load, paging, every failure said, following and stopping, unsubscribe),
`src/data/fsreFunctions.test.ts` (both functions' input rules executed; their sources read: the
owner check first, one secret each, bound parameters, the approver a constant, only the status view
read), and view tests for a stopped feed and for the approve button (enabled only on the database's
yes with no open escalation, second click, cancel, refusal reasons, a check that could not run, no
button without the approval). Negative controls: the lock condition removed, and the owner check
moved after the database call, each turn a test red.

### Stage figures, live

The suite's transition events carried only a reason, so live stage cards would show no figures.
CP-wave-2026-02-007 amendment 4 (waiting for the owner's decision with the rest of CP-007) has the
router carry a stage's headline figures on its result's event (`manifest.py move --figures`) and
pins their shape to what the building reads (a number or `{value, of}`, by name); the live mapper
already passes them through. Until it is decided, live stage cards show no figures.

## v2 (M2 update)

The building was replaced by GLM's v2 (departments of desks, a synthetic office on a mock
transport, the industries board), ported in the branch `feat/fsre-building-v2`: see
`docs/lab/fsre-building-v2-port.md` (what moved where, FX-11 to FX-14, the browser run, the
independent review, the open contract decisions). The replay above keeps working on the v2
department floors; the M5 live feed and approve button stay in the code, not offered while Live is
"Not wired yet".
