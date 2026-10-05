# FSRE building: mount report (brief 02)

Status: **step 0 (report and plan, no code).** Steps 1–6 are appended below as they land.

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
