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
| 3 — Mock event source | not started |
| 4 — Avatars and pathfinding | not started (A* itself already exists in core, tested) |
| 5 — State machine and live events | not started |
| 6 — HUD and inspector | not started |

## Next action

Phase 3: the mock event source. Zod schema for the A-2 contract in
`src/core/events/schema.ts`; pure reducer (out-of-order / duplicate drop,
unknown-state flag); Fastify server under `server/` with a WebSocket
`/events` endpoint, snapshot-on-connect, REST for history/output; an
`EventSource` interface with `MockEventSource` (scripted 20-agent looping
scenario, all six states, a three-agent collaboration, an error, one
deliberately malformed frame) and `LiveEventSource` (webhook + SSE adapters
for LangGraph, CrewAI, AutoGen, custom); client `WebSocketEventSource` that
validates at the boundary and feeds `agentStore`; a stream inspector in the
dev panel.

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
