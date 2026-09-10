# ASSETS

Every external asset, its source and its licence. Attribution requirements
are stated explicitly.

## Avatar rig and animation clips

| File | `public/models/ual-mannequin.glb` (2.3 MB) |
| --- | --- |
| Source | Quaternius, **Universal Animation Library** v3.0 (16 June 2026), "Standard" download, `Unreal-Godot/UAL1_Standard.glb` (root motion disabled) |
| URL | https://quaternius.com/packs/universalanimationlibrary.html (download via https://quaternius.itch.io/universal-animation-library) |
| Licence | **CC0 1.0 Universal (public domain dedication)** — stated on the pack page, on itch.io ("Asset license: Creative Commons Zero v1.0 Universal") and in the `License.txt` inside the zip |
| Attribution | **Not required** by CC0. Credit given anyway: "Models by @Quaternius", https://www.patreon.com/quaternius |
| Modification | Trimmed with `@gltf-transform` from 43 clips to the 10 used, nothing else changed. The mesh is the pack's "Mannequin" (two primitives, ~8.5k vertices, 65 joints, 1.83 m tall) |
| Clips kept | `A_TPose`, `Idle_Loop`, `Walk_Loop`, `Sitting_Idle_Loop`, `Sitting_Talking_Loop`, `Idle_Talking_Loop`, `Interact`, `PickUp_Table`, `Sitting_Enter`, `Sitting_Exit` |

All five clips A-3 requires come from this single rig source, so there is no
retargeting step at all:

| Required (A-3) | Served by |
| --- | --- |
| idle | `Idle_Loop` |
| walk | `Walk_Loop` |
| sit_typing | `Sitting_Idle_Loop` + **code-driven** forearm/hand oscillation (no typing clip exists in the pack; see PLACEHOLDERS.md) |
| talk | `Idle_Talking_Loop` (standing) and `Sitting_Talking_Loop` (seated at a meeting table) |
| carry_walk | `Walk_Loop` + **code-driven** arm pose holding a document (no carry clip exists in the pack; see PLACEHOLDERS.md) |

Extra clips used: `Interact` for the delivery hand-over, `PickUp_Table`,
`Sitting_Enter` / `Sitting_Exit` available for transitions.

Materials in the file are colour-only (`M_Main`, `M_Joints`); the app
recolours `M_Main` per department at load time.

## Everything else

No other external assets. All furniture, architecture, terrain, sky and
labels are authored in code in this repository.

## Fonts

System font stacks only (`ui-sans-serif`, `ui-monospace`). No font files are
shipped or downloaded.

## Libraries (npm, for completeness)

three (MIT), @react-three/fiber (MIT), @react-three/drei (MIT),
@react-three/postprocessing (MIT), postprocessing (Zlib), n8ao (MIT),
honeycomb-grid (MIT), zustand (MIT), @tanstack/react-query (MIT), zod (MIT),
fastify (MIT), @fastify/websocket (MIT), @fastify/cors (MIT), ws (MIT),
next (MIT), react (MIT), tailwindcss (MIT). Build-time only:
@gltf-transform/core and /functions (MIT) were used once, outside the repo, to
trim the GLB.
