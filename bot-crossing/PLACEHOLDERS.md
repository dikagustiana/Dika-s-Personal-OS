# PLACEHOLDERS

Everything that stands in for something real. Each entry says what it
replaces and what would replace it. Nothing here is disguised as finished
(B-6).

| Placeholder | Stands in for | What replaces it |
| --- | --- | --- |
| Faceted low-poly dune spheres around the campus (`DesertGround.tsx`) | Sculpted desert terrain / Dubai-inspired skyline backdrop | A modelled terrain mesh or a matte-painted skybox band with proper licence |
| Flat hex prisms with per-tile colour for floors and paving | Textured floor materials (concrete, stone paving) | Baked albedo/AO textures per tile kind |

## Furniture and fittings (Phase 2) — all code-authored primitives

Every entry below is flat-coloured, untextured primitive geometry authored in
`src/scene/furniture/catalog.ts` at the dimensions in
`src/core/layout/furnitureSpecs.ts`, in the same local frame as the anchors.
Each would be replaced by a low-poly GLTF carrying `anchor_sit`,
`anchor_stand` and `anchor_deliver` empties (the loader would then prefer the
asset's own nodes). The dev panel's **Show placeholders in grey** toggle
renders all of them in neutral grey to make the stub status unmistakable.

| Placeholder | Stands in for |
| --- | --- |
| `workstation` — desk slab, four legs, monitor with emissive face, keyboard, desk lamp with emissive bulb, under-desk LED strip, task chair | A modelled agent workstation |
| `meetingTable` — round top, pedestal, emissive hologram puck | A meeting table with hologram projector |
| `meetingChair` — seat, back, post, base | A meeting chair |
| `loungeSofa` — base, back, arms, two cushions | A lounge sofa |
| `coffeeBar` — counter, top, machine with emissive display, two mugs | A coffee bar |
| `outputTerminal` — kiosk body, emissive screen, emissive intake slot, status light | The archive / output terminal |
| `archiveShelf` — uprights, back panel, four shelves, coloured folder blocks | Archive shelving |
| `managerDesk` — walnut desk, side panels, modesty panel, monitor, lamp, nameplate, chair | The executive desk |
| `plant` — pot, soil, trunk, three foliage balls | A potted plant |
| Glass wall panels, posts, rails (`Architecture.tsx`) — boxes and cylinders | Modelled glass pod façades |
| Canopy — thin translucent hex prisms over interior tiles | A modelled glass roof |
| LED floor strips and ceiling spots — emissive boxes / pucks | Modelled light fittings (still emissive, never light objects) |
| Zone signage — canvas-texture sprites | Modelled signage |
