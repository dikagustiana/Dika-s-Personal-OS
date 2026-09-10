# DECISIONS

One line of reasoning each, recorded as they were made (0-B).

## Repository and toolchain

- **Location:** `bot-crossing/` inside this repository, as its own package
  with its own `pnpm-workspace.yaml`, lockfile and configs — the session can
  only push to this repository, and a nested root keeps it out of the parent
  app's install, tests and build. The parent's `vite.config.ts` gained one
  `exclude` so root vitest never sweeps these tests in.
- **Package manager:** pnpm (matches the parent repo; an npm lockfile is
  gitignored there). `npm run dev` still works after `pnpm install`.
- **Versions:** Next 14.2 + React 18.3 because the spec says React 18 and
  Next 15's App Router requires React 19. R3F 8 / drei 9 /
  @react-three/postprocessing 2 are the matching majors; three 0.170.
- **Dev runner:** `scripts/dev.mjs` spawns the Fastify server and Next
  together — no extra process-runner dependency.
- **TypeScript:** `strict`, `noUnusedLocals`, `noUnusedParameters`. No `any`.

## Hex engine

- Pointy-top axial coordinates; rows run along world X, +Z is "south" on
  screen. honeycomb-grid does point↔hex and offset↔axial; neighbour, ring,
  spiral, line and distance are inlined so hot paths allocate nothing, and
  the tests prove they agree with honeycomb-grid.
- Tile circumradius 1.15 m (≈2.0 m flat-to-flat): a desk plus chair fits one
  tile with room for an avatar to stand behind it.
- Rotation is `rotationSteps` 0..5 → yaw that faces a neighbour direction, so
  furniture always aligns with a tile edge.
- Layout rooms are written in offset (col, row) because rectangles read
  better that way; converted to axial once at build time.

## Campus

- Nine glass pods on a desert plot connected by paved paths; corridors are
  exterior so the `exterior-only` grid mode has something to show.
- Desk bays: 8×5 tiles, two rows of three workstations facing north-east
  (a real neighbour direction), aisles behind them, one door to the corridor.
  24 workstations for 20 agents; five per department is the scenario's cap.
- Meeting rooms are hex clusters: radius-2 spiral, table at the centre, six
  chairs on ring 1 facing inward, door on the west.
- Sand is not walkable; paths and floors are. Furniture blocks its tile
  except as a path destination; walls block edges. Doors are edge
  exceptions.
- **Approach tiles:** pathfinding targets the neighbour tile on the anchor's
  side (from `anchor_stand` for seats, the anchor's own side otherwise); the
  last leg is a straight walk from that tile centre to the anchor. This keeps
  avatars out of desk geometry without a physics engine.
- No @react-three/rapier. A* on the hex grid plus anchors makes colliders
  unnecessary; agents may pass through each other on shared paths (recorded
  as an accepted simplification).

## Lighting

- Keyframes: 05:30 NIGHT → 07:30 MORNING → 12:00 MIDDAY (held to 16:30) →
  18:15 DUSK → 20:00 NIGHT (held overnight). DUSK carries
  `interiorEmissiveIntensity` 0.45 so lights are visibly "coming on" at
  18:00 (Part E), reaching 1.0 at 20:00.
- Blend is a smoothstep between adjacent keyframes; continuity is tested at
  every keyframe.
- Fog distances are offsets beyond the camera's distance to the campus
  centre: the orthographic camera sits ~120 m out, so absolute distances
  would put the whole campus inside the haze (this happened; fixed).
- Tone mapping runs in the composer (ACES) when post is on and on the
  renderer when it is off, so toggling post does not change exposure.
- Ambient occlusion is N8AO at half resolution, `performance` quality, behind
  a dev toggle. Baked AO would need a texturing pass the placeholder
  geometry does not justify yet.

## HUD token set (C-7), defined before styling

- Colours: `panel` rgb(16 20 28 / .78) slate glass; `ink` #E9EEF5; `ink-muted`
  #9AA6B8; `accent` #37D2C6 (teal — the one bold place, complementary to the
  warm scene); `warn` #FFB547; `error` #FF5E6C; `ok` #62D889.
- Type: system sans (`ui-sans-serif, system-ui…`) for labels and controls;
  system mono (`ui-monospace…`) for telemetry, clocks and logs. No web-font
  download so the app works offline. Scale: 11 / 12 / 13 / 15 / 18 / 24 px.
- Radius 6 px, 1 px hairline borders at 8% white, one soft shadow on
  panels only. No cream/terracotta, no eyebrow labels, no middle-dot meta
  strings, no arrows in buttons.
- Focus rings in the accent colour; `prefers-reduced-motion` collapses
  transitions.

## Dev tooling

- Dev tools (scrubber, grid mode, perf) show in development builds and with
  `?dev=1` in production; `?dev=0` hides them.
- `window.__bcUi` (the UI store) and `window.__bcPerf` are exposed when dev
  tools are on so headless verification can drive and measure the app.
