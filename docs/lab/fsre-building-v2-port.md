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
  below with its screenshots.

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
