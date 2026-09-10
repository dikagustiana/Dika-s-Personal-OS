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

## Furniture and architecture (Phase 2)

- Furniture is code-authored primitives merged into one geometry per type
  and drawn as one InstancedMesh per type: nine draw calls for all
  furniture, and every piece is in the anchor frame so a GLTF swap is
  geometry-only.
- One shared interior material with per-vertex emissive colour and a
  per-vertex "base" fraction: screens stay faintly on by day; lamps, strips
  and spots are fully clock-driven. One uniform, one place to tune.
- Pods are roofed with a faint translucent canopy so ceiling spots have
  something to hang from and the pods read as glass; the canopy casts no
  shadow, deliberately, so interiors stay sunlit.
- Walls are derived from zone perimeters, doors are exception edges;
  posts are deduplicated corners. Changing the floorplan needs no scene edit.
- Desert dunes stay as low-poly spheres (placeholder, listed).

## Events and transport (Phase 3)

- `currentTaskId` is `string | null`: the contract example shows a string,
  but an idle agent has no task and a sentinel id would be a lie in the data.
  Every other field is exactly as written; objects are strict.
- Adapters emit *semantic* events (agent, state, task, progress, tokens,
  group). A server-side positioner owns hex coordinates, derives WALKING /
  DELIVERING legs from real A* path lengths and delays the destination
  state by the walk time. The renderer still only renders what the stream
  says; the physical layer lives on the server where the layout is known.
- Wire frames are the bare canonical object, one per WebSocket text frame.
  No envelope, so the contract is the whole protocol. Snapshot-on-connect is
  the latest event per agent sent as ordinary frames; clients dedupe by
  eventId.
- Out-of-order handling: an event older than the agent's latest by timestamp
  is dropped and logged; equal timestamps apply in arrival order; a repeated
  eventId is a duplicate.
- The mock injects two malformed frames per loop via an explicit
  `publishRaw` (never stored) so the client boundary is exercised end to end.
  `MOCK_INCLUDE_MALFORMED=0` turns them off. An unknown state
  (`OFFICE_DANCING`) is also scripted; `MOCK_INCLUDE_UNKNOWN_STATE=0` turns
  it off.
- Walking speed 1.7 m/s, shared by server scheduling and client
  interpolation (`src/core/movement/movement.ts`).
- A mock meeting lasts its scripted duration *after the last arrival*: the
  walk from a far desk to the meeting room is ~40 s, longer than the first
  version of the meeting itself, so agents arrived as it ended.
- Server is a separate Fastify process on :4000 (not a Next custom server);
  `pnpm dev` runs both.

## Avatars (Phase 4)

- Rig: Quaternius Universal Animation Library mannequin (CC0). One skeleton,
  every clip already on it — no retargeting. Downloaded through itch.io's
  free-download flow because Chromium's tunnel to itch.io was reset by the
  egress; curl/urllib worked. Trimmed to 10 clips (2.3 MB).
- Seat anchors sit at the chair pan (`SEAT_HEIGHT` 0.49 m); the rig module
  knows its seated clip puts the hips 0.49 m up and 0.33 m behind the origin,
  so `sitAt` places the origin accordingly. Anchors describe furniture; rig
  constants describe the rig; neither knows about the other.
- Furniture is instanced, so there is no scene-graph node per piece to parent
  an avatar to. "Parenting to the anchor" (A-4) is implemented as resolving
  the anchor to a world pose and holding the avatar there; furniture is
  static, so the result is identical.
- Walk routes end on the approach tile and then a final leg to the
  stand/deliver anchor; sitting snaps from the stand anchor to the seat pose.
- Frame delta is capped at 0.25 s: a stalled tab must not teleport avatars,
  but a slow software-GL frame rate must still show motion.
- Talk/idle loops start at a per-agent phase offset (hash of agentId) so
  agents around a table never gesture in lockstep (B-3).
- The Phase 4 test drive is a dev toggle, labelled "SCRIPTED — NOT STREAM
  DATA" in the scene, and never mounts unless switched on (B-1).

## Reconciliation (Phase 5)

- `reconcile.ts` runs once per applied event, never per frame. The event's
  location is the truth; the avatar either continues a walk already heading
  there, finishes the remaining leg briskly (speed ≥1.6×), catches up with a
  short sped-up walk when within 6 tiles (≤1.2 s, speed capped at 3×), or
  snaps when farther. A long invented walk would misreport where the agent is.
- A progress update mid-walk with the same target never restarts the walk.
  A mid-walk retarget re-plans from the avatar's current position.
- Arrival without a confirming event leaves the avatar standing at the stand
  anchor in a `waiting` activity (idle clip). Nothing seats it, hands over a
  document, or clears an error except the stream.
- An error or unknown state at a desk keeps the seated pose (typing stops);
  the badge carries the message or the raw state name. Errors never stand an
  agent up — that would be motion the stream did not report.
- DELIVERING with a target walks carrying the document; DELIVERING with no
  target at a deliverable tile plays the hand-over once per task id, then the
  avatar stands empty-handed until the next event.
- Staleness is a badge, not a state: after 3 s without a socket every avatar
  shows `STALE · last seen HH:MM:SS` and keeps doing exactly what it was
  doing. On reconnect the server's snapshot re-syncs; duplicates are dropped by
  eventId and newer events are reconciled with the same rules.
- Mutual look-at: seated collaborators face the table because the chairs do;
  standing collaborators turn toward the centroid of their group each frame.
  Talk/idle loops start at a per-agent phase.
- Holograms above working/collaborating/errored agents are canvas sprites
  rebuilt only when title or rounded progress changes; never drei/Html.

## HUD and inspector (Phase 6)

- Exactly one drei/Html: the inspector, anchored above the selected avatar
  and following it. It renders into its own React root, so it mounts its own
  QueryClientProvider around the same shared QueryClient.
- Selecting an agent (click on its avatar or its desk) sets follow + zoom in
  one store action; closing restores the zoom the camera had. Camera focus is
  an exponential ease toward a goal, so a second click simply changes the
  goal — nothing queues. A user gesture on the orbit controls releases follow
  and zoom so the camera is never fought over.
- Picking: avatars carry an invisible capsule; skinned meshes and sprites opt
  out of raycasting, so hover never runs per-triangle skinned intersections.
  Furniture picking uses InstancedMesh instanceId; a clicked desk opens its
  occupant, or focuses the desk if empty.
- The output document is a DOM modal outside the canvas; markdown is parsed
  to a block tree and rendered as React nodes — never innerHTML — because live
  adapters may post untrusted text.
- Clicking empty ground closes the inspector, but only for a click that did
  not drag more than 6 px, so orbiting never closes it. Esc closes the
  document first, then the inspector.
- Reduced motion: camera eases become immediate when the OS asks for reduced
  motion; CSS transitions are collapsed globally.
- Telemetry that is not on the stream (output documents, history) goes through
  TanStack Query against the server's REST endpoints; a 404 for output is a
  normal "not yet", not an error.

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
