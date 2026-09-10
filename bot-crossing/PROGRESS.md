# PROGRESS

Resume protocol for a fresh session: read this file and DECISIONS.md, run
`pnpm install && pnpm typecheck && pnpm test:run && pnpm build` from
`bot-crossing/`, then continue from **Next action**. Do not restart a phase
marked done.

## Where the build is

| Phase | Status |
| --- | --- |
| 1 — Floorplan and hex engine | **done** |
| 2 — Furniture and spatial layout | **done** |
| 3 — Mock event source | **done** |
| 4 — Avatars and pathfinding | **done** |
| 5 — State machine and live events | **done** |
| 6 — HUD and inspector | not started |

## Next action

Phase 6: HUD and inspector. Files already written but not yet imported:
`src/core/text/markdown.ts` (+test), `src/hud/api.ts`,
`src/hud/inspector/{TokenGraph,Console,OutputPreview}.tsx`,
`src/hud/OutputModal.tsx`. To do: the single drei `<Html>` inspector anchored
to the selected avatar (`src/scene/inspector/`), QueryClientProvider in
`OfficeApp`, selection ring, click-to-focus on avatars and workstations
(instanced picking), fleet summary in the top bar, Esc to close, then verify:
click focuses + telemetry, logs stream, token graph updates, second click
mid-transition retargets, exactly one `.bc-html-root` in the DOM.

## Phase 5 — what landed

- `src/scene/avatars/avatarRuntime.ts` — pose (`stand | sit | walk`), activity
  (`idle | typing | talking | delivering | waiting`), `carrying`, `alert`;
  motion helpers never change state on their own; arrival without a
  confirming event → `waiting`.
- `src/scene/avatars/reconcile.ts` — the stream→motion rules (see DECISIONS.md
  "Reconciliation"): continue / brisk finish / short catch-up (≤6 tiles,
  ≤1.2 s, ≤3× speed) / snap; same-target updates never restart a walk;
  errors keep the seated pose; hand-over once per task; unknown states shown
  as unknown. 11 tests, including "a silent agent never changes".
- `src/scene/avatars/AvatarsLayer.tsx` — one `Avatar` per agent record,
  reconciled synchronously on each applied event; badges (ERROR with message,
  UNKNOWN_STATE with raw name, NO DESK AT TILE, NO ROUTE, STALE with last-seen
  time, 💬 discussing), holograms with title + progress bar above working /
  collaborating / errored agents, mutual look-at for standing collaborators,
  staleness after 3 s without a socket.
- Server snapshot-on-connect + client dedupe give reconnect recovery without
  invented state.

## Phase 5 — verification (headless Chromium, software GL, server restarted at t=0)

- `pnpm test:run` — 12 files, 92 tests pass. Typecheck clean.
- Mock scenario end to end with 20 agents, 20 avatars: agents left the lounge
  and walked to desks in their own departments (name plates + department
  colours), sat and typed with progress holograms; `agent-backend-2` showed
  the ERROR badge with "Unit tests failed: 3 assertions…" while staying
  seated; `agent-frontend` and `agent-forecaster` carried documents
  (DELIVERING) toward the terminal / manager desk; the unknown state
  `OFFICE_DANCING` was applied and counted (`unknownState: 1`). Two malformed
  frames per loop were dropped at the boundary with no page errors.
- **Three-agent meeting** (separate run, polling the runtimes): `agent-senior-dev`,
  `agent-researcher` and `agent-designer` converged on Meeting Room A by
  `collaborationGroupId` `collab-1-auth-review`, sat on three distinct chairs
  around the table facing it, all in the `talking` activity with 💬 badges,
  still there 8 s later; screenshot inspected. `agent-video` showed the
  `UNKNOWN_STATE · OFFICE_DANCING` badge while staying seated and idle.
- Mock fix found by this check: a meeting now lasts its scripted duration
  after the last arrival (far desks take ~40 s to walk to the room).
- **Kill and restart the socket mid-scenario:** with the server killed, the
  connection went `reconnecting`, all 20 avatars carried the STALE badge and
  kept exactly their last state (16 WORKING, 2 DELIVERING, 2 WALKING —
  unchanged). After restart the client reconnected on its own, the fresh
  snapshot applied (the restarted mock begins in the lounge, so avatars
  snapped to the new truth), 4 invalid frames total were dropped, 0 stale,
  and the page had no errors — only the expected `ERR_CONNECTION_REFUSED`
  console lines while the server was down.
- **Frame rate at 20 agents:** 0.7 fps with the composer on and 0.7–3.4 fps
  with it off at 1400×900 on **SwiftShader software WebGL** (4-core Xeon
  container, no GPU). Not a hardware number; the acceptance figure cannot be
  measured in this environment. Hardware-independent budget at 20 agents:
  **178 draw calls (composer on) / 158 (off), 693k triangles** per frame,
  of which the 20 skinned mannequins are ~550k (13.7k triangles each, drawn
  twice: shadow pass + main). One shadow-casting light, zero interior lights,
  one terrain InstancedMesh, one InstancedMesh per furniture type.
- Rendering lag note: at ~1 fps the frame step is capped at 0.25 s, so the
  simulation ran at a quarter of real time and avatars were frequently in a
  catch-up walk behind the server schedule; the reconciler handled it
  without snapping unless a location was more than six tiles away. At 60 fps
  the walks keep pace with the schedule.

## Phase 4 — what landed

- Asset: Quaternius Universal Animation Library mannequin (CC0), trimmed to
  10 clips → `public/models/ual-mannequin.glb` (2.3 MB). See ASSETS.md.
- `src/core/movement/pathFollow.ts` — pure waypoint following (constant speed
  across corners, turn rate, final yaw) and `planTrip` (A* route to the
  approach tile plus a final leg to the stand/deliver anchor; unreachable is
  flagged, never silent). Tested, including the server/client walk-time
  agreement.
- `src/scene/avatars/` — `rig.ts` (measured rig constants, clip map, required-
  clip table), `AnimationController.ts` (mixer, cross-fades, one-shots that
  cannot override a newer state, axis-agnostic aim solver for the typing and
  carry overlays), `avatarRuntime.ts` (per-avatar position/pose state outside
  React; `walkTo`, `sitAt`, `standAtAnchor`, `advanceAvatar`), `Avatar.tsx`
  (skeleton clone per agent, department colour, name plate sprite, chest-
  socketed document, MISSING badge for absent clips), `AvatarTestDrive.tsx`
  (dev-only scripted walk, labelled as such), `AvatarsLayer.tsx`.
- Camera: follow-an-agent easing and a zoom override (used by the inspector
  in Phase 6) plus a scripted orbit hook for verification.
- Seat pans raised to 0.49 m to match the rig's seated clip.

## Phase 4 — verification

- `pnpm test:run` — 10 files, 81 tests pass (A* incl. unreachable target;
  trip planning ends at anchors, not tile centres). Typecheck clean.
- Headless scripted test drive (`?dev=1`, toggle on): the avatar walked
  lounge → Engineering workstation, sat aligned in the chair facing the
  monitor with hands at the keyboard (close-ups from side, front and top),
  walked to Meeting Room A, stood and played the talk loop, sat and played the
  seated talk loop, carried a document to the output terminal (arms forward,
  document at chest) and played the hand-over, then walked back. No page
  errors. No clip is missing from the GLB, so no MISSING badge appears.
- Cross-fades are 0.25 s via `AnimationAction.crossFadeTo`; still frames
  cannot prove the absence of pops, so this is verified by construction only.
- Budget with one avatar: 41–47 draw calls, ~170k triangles (post off).
  Software-GL fps 1.7–2.9 (same caveat as before).

## Phase 3 — what landed

- `src/core/events/schema.ts` — the A-2 contract as strict Zod; `parseCanonicalEvent`
  never throws. `reducer.ts` — pure agent reducer: duplicate and out-of-order
  drops, unknown-state flag, bounded logs and token history.
- `src/core/scenario/` — semantic events (what an adapter knows), deterministic
  `Seating` (desk by department, lounge spots, meeting chairs by group),
  and the `Positioner`, which turns "agent X is working" into WALKING now +
  the arrival state at `walkDurationSeconds(path)` later, re-sending WALKING
  from the interpolated position on mid-walk updates without restarting the
  walk. `roster.ts` — the twenty agents and their task catalogue.
- `server/` — Fastify 5: `EventBus` (validate, latest-per-agent, history,
  outputs, one JSON frame per event, snapshot on connect), `EmissionScheduler`,
  `MockEventSource` (per-agent task loops + a 180 s specials loop: three-agent
  and two-agent collaborations, an error, an unknown state, two malformed
  frames), `LiveEventSource` (POST `/ingest/{langgraph|crewai|autogen|custom}`,
  `/ingest/canonical`, `/ingest/output`, optional upstream SSE reader), the
  four adapters (pure, tested), REST (`/api/agents`, `/api/agents/:id/history`,
  `/api/tasks/:id/output`, `/api/stats`, `/health`), `/events` WebSocket.
  `EVENT_SOURCE=mock|live` picks the source in one line.
- Client: `WebSocketEventSource` (backoff reconnect), `agentStore` (validates
  at the boundary, applies through the reducer, logs drops to the console
  with the raw payload), `StreamInspector` in the dev panel, `scripts/probe-stream.ts`
  (`pnpm probe 30`) as a console inspector.

## Phase 3 — verification

- `pnpm test:run` — 9 files, 76 tests pass (schema, reducer, positioner,
  adapters). Typecheck clean.
- `pnpm probe 100` against the mock: 324 frames, 20 agents, states seen:
  WORKING 257, WALKING 30, IDLE 26, COLLABORATING 5, ERROR 1, DELIVERING 4,
  plus `OFFICE_DANCING` 1 (unknown-state exercise); every WALKING frame carried
  a target; `collab-1-auth-review` had exactly the three scripted agents.
- Fresh server + browser for 22 s: connection `open`, 20 agents, 35 applied,
  **2 invalid frames dropped** (missing fields; not JSON) with the reason and
  raw payload on the console and in the inspector; zero page errors. The
  Node probe saw the same two invalid frames.

## Phase 2 — what landed

- `src/scene/furniture/catalog.ts` — nine furniture types authored from
  primitives at spec dimensions, in the anchor frame; merged into one geometry
  per type; `FurnitureLayer.tsx` renders each type as one InstancedMesh.
- `src/scene/materials/interiorMaterial.ts` — one MeshStandardMaterial patched
  via onBeforeCompile: per-vertex diffuse, per-vertex emissive colour and a
  per-vertex "base" (screens stay faintly on by day); a single uniform carries
  `interiorEmissiveIntensity`. A grey-placeholder uniform is behind a dev
  toggle so stubs can be made unmistakable.
- `src/scene/architecture/Architecture.tsx` — glass panels on every wall edge
  (doors are edges without a panel), corner posts, top rails, LED floor strips
  inside each wall, translucent canopy per interior tile, ceiling spots on a
  sparse tile pattern. Six InstancedMeshes total.
- `src/scene/labels/textSprite.ts` + `ZoneSigns.tsx` — canvas-texture sprites
  for the nine zone names (no drei/Html).
- Zero light objects indoors; all interior light is emissive + bloom.

## Phase 2 — verification

- `pnpm test:run` — 46 tests pass (shared-edge helper added). Typecheck
  clean, build succeeds.
- Headless render at 13:00: all four desk bays, both meeting hex clusters,
  lounge, executive office and output terminal are identifiable by label and
  furniture. At 19:12 and 21:00: desk lamps, LED strips and ceiling spots are
  on; at 13:00 they are off (screens faintly lit). All three grid modes
  rendered (`always` draws outlines across interiors, `exterior-only` only on
  sand and paving, `never` none).
- Budget: **77 draw calls, 144k triangles** per frame with the composer on
  (54 draws without). Software-GL fps ~0.9 (same SwiftShader caveat as
  Phase 1; not a hardware number).

## Phase 1 — what landed

- `src/core/hex/hex.ts` — axial pointy-top hex math, honeycomb-grid for
  point↔hex and offset↔axial; own neighbour/ring/spiral/line/distance
  cross-checked against honeycomb-grid in tests.
- `src/core/layout/` — data-driven campus (`campus.ts`): 33×23 tiles,
  9 zones (4 desk bays, 2 meeting hex clusters, lounge, executive, output),
  paved paths, glass-wall edges with doors, furniture placements with
  60°-snapped rotation, per-type anchors (`furnitureSpecs.ts`), world
  resolution + approach tiles (`resolve.ts`).
- `src/core/pathfinding/astar.ts` — A* over the hex graph (blocked tiles,
  walled edges, destination-may-be-blocked). Tests include an unreachable
  target. `campus.test.ts` proves every seat/deliver anchor is reachable from
  the lounge.
- `src/core/lighting/presets.ts` — MORNING/MIDDAY/DUSK/NIGHT presets,
  keyframe track, smoothstep blend, `interiorEmissiveIntensity` scalar.
- `src/core/time/clock.ts` — hour-in-time-zone, formatting.
- Scene: orthographic isometric camera with bounded orbit, one shadow-casting
  sun (frustum bounded to the campus), hemisphere ambient, camera-relative
  fog, gradient sky dome with sun glow and night stars, one InstancedMesh of
  759 hex tiles with zone tints, grid outline in three modes, desert ground
  and dunes, Bloom + N8AO + ACES tone mapping, perf meter.
- HUD: top bar (clock, preset), dev panel (24 h scrubber + sweep, clock
  source, time zone, grid mode, post toggles, fps/draws/tris).

## Phase 1 — verification

- `pnpm test:run` — 5 files, 45 tests, all pass.
- `pnpm typecheck` — clean. `pnpm build` — succeeds.
- Headless Chromium (Playwright) loaded `/?dev=1`, scrubbed 9:00, 13:00,
  17:30, 18:17, 19:12, 21:00, 02:00 and cycled all three grid modes with no
  console errors or page errors. Screenshots were inspected: midday warm
  sand + pale floors, dusk low orange sun with long shadows, night dark blue
  with stars. DUSK → NIGHT transition visible.
- Frame rate (0 agents): **~1 fps with post, ~3.4 fps without**, at
  1400×900 — measured on **SwiftShader software WebGL** (headless Chromium
  141, 4-core Intel Xeon 2.8 GHz container, no GPU). This is a software
  rasteriser number and says nothing about the 60 fps target; no GPU is
  available in this environment. Hardware-independent budget figures:
  **40 draw calls, 39k triangles** per frame with the composer on (1 sun
  shadow pass, 1 instanced terrain draw, composer passes).

## Known broken / caveats

- No hardware GPU in the build environment, so the B-4 acceptance number
  (60 fps @ 20 agents) cannot be measured here. Draw-call and triangle
  budgets are recorded instead; see the final report.
- Dunes are faceted low-poly spheres; deliberate stylisation, tune later if
  time allows.
