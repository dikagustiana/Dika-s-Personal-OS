# PROGRESS

Resume protocol for a fresh session: read this file and DECISIONS.md, run
`pnpm install && pnpm typecheck && pnpm test:run && pnpm build` from
`bot-crossing/`, then continue from **Next action**. Do not restart a phase
marked done.

## Where the build is

| Phase | Status |
| --- | --- |
| 1 — Floorplan and hex engine | **done** |
| 2 — Furniture and spatial layout | not started |
| 3 — Mock event source | not started |
| 4 — Avatars and pathfinding | not started (A* itself already exists in core, tested) |
| 5 — State machine and live events | not started |
| 6 — HUD and inspector | not started |

## Next action

Phase 2: author placeholder furniture (grey boxes at spec dimensions) as
per-type InstancedMesh from `CAMPUS.furniture`, glass walls from
`CAMPUS.walls`, zone signage sprites, interior emissive materials driven by
`runtime.lighting.interiorEmissiveIntensity`, then verify the three grid modes
still render and lamps come on across DUSK → NIGHT.

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
