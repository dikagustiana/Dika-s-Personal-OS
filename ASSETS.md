# ASSETS

Binary and generated assets in this tree, with origin and licence.

Phases 1–6 add none: the institution is SQL, Deno and TypeScript. Phase 7
migrated the floor in from the standalone `bot-crossing/` build, which is
deleted; this file absorbed that build's asset list, corrected where the
migration changed the facts.

## Avatar rig and animation clips

| File | `public/models/ual-mannequin.glb` (2,293,804 bytes) |
| --- | --- |
| Source | Quaternius, **Universal Animation Library** v3.0 (16 June 2026), "Standard" download, `Unreal-Godot/UAL1_Standard.glb` (root motion disabled) |
| URL | https://quaternius.com/packs/universalanimationlibrary.html (download via https://quaternius.itch.io/universal-animation-library) |
| Licence | **CC0 1.0 Universal (public domain dedication)** — stated on the pack page, on itch.io ("Asset license: Creative Commons Zero v1.0 Universal") and in the `License.txt` inside the zip |
| Attribution | **Not required** by CC0. Credit given anyway: "Models by @Quaternius", https://www.patreon.com/quaternius |
| Modification | Trimmed with `@gltf-transform` from 43 clips to the 10 used, nothing else changed. The mesh is the pack's "Mannequin" (two primitives, ~8.5k vertices, 65 joints, 1.83 m tall) |
| Clips kept | `A_TPose`, `Idle_Loop`, `Walk_Loop`, `Sitting_Idle_Loop`, `Sitting_Talking_Loop`, `Idle_Talking_Loop`, `Interact`, `PickUp_Table`, `Sitting_Enter`, `Sitting_Exit` |
| Loaded by | `src/views/lab/floor/scene/avatars/rig.ts` (`RIG_URL = '/models/ual-mannequin.glb'`) |

It is served as a static file from `public/`, so it is **not** in the
JavaScript bundle and is fetched only when `/lab/floor` mounts — which is
also true of three.js itself (B-11). A visitor who never opens the floor
downloads none of it.

Every animation the floor needs comes from this one rig, so there is no
retargeting step:

| Required | Served by |
| --- | --- |
| idle | `Idle_Loop` |
| walk | `Walk_Loop` |
| sit_typing | `Sitting_Idle_Loop` + **code-driven** forearm/hand oscillation (no typing clip exists in the pack; see PLACEHOLDERS.md) |
| talk | `Idle_Talking_Loop` (standing) and `Sitting_Talking_Loop` (seated at a meeting table) |
| carry_walk | `Walk_Loop` + **code-driven** arm pose holding a document (no carry clip exists in the pack; see PLACEHOLDERS.md) |

Extra clips used: `Interact` for the delivery hand-over, `PickUp_Table`,
`Sitting_Enter` / `Sitting_Exit` available for transitions.

Materials in the file are colour-only (`M_Main`, `M_Joints`); the app
recolours `M_Main` per department at load time, from the host ramp
(`src/logic/floor/theme/palette.ts`).

## Everything else on the floor

No other external assets. All furniture, architecture, terrain, sky and
labels are authored in code in this repository.

## Fonts

Two families, both self-hosted under `src/assets/fonts/` and both OFL:
Plus Jakarta Sans (body, all numerals) and Playfair Display (headings).
No CDN, no font files added by the floor — the floor's canvas labels are
drawn with the browser's `ui-sans-serif` stack rather than shipping a third
family for texture text.

## Libraries added to the host by the floor

three (MIT), @react-three/fiber (MIT), @react-three/drei (MIT),
@react-three/postprocessing (MIT), postprocessing (Zlib),
honeycomb-grid (MIT), @types/three (MIT, dev).

`honeycomb-grid` is the one that looks unnecessary and is not: the hex
maths in `src/logic/floor/hex/hex.ts` is written out by hand so the hot
paths allocate nothing, and `hex.test.ts` checks every formula against the
package's own answers. It is a **test oracle**. Removing it would not
shrink the bundle (it is tree-shaken out of the app path already) and would
delete the only independent check on that file.

Deliberately NOT carried over from the standalone build: `next`,
`fastify`, `@fastify/websocket`, `@fastify/cors`, `ws` (the server is
deleted, B-11), `@tanstack/react-query` (the host has no query layer,
D-21) and `n8ao` (the ambient-occlusion pass; the floor uses the
postprocessing package's own effects).

Build-time only, and outside this repo: `@gltf-transform/core` and
`/functions` (MIT), used once to trim the GLB.
