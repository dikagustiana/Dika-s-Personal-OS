# PLACEHOLDERS

Everything that is stubbed, deferred or intentionally empty, with what
replaces it and when. If it is not listed here it is meant to be finished.

| # | Placeholder | Why it exists | Replaced by |
| --- | --- | --- | --- |
| P-01 | 8 lead seats with no agent row (`framing-lead`, `methodology-lead`, `evidence-lead`, `data-engineering-lead`, `quant-lead`, `synthesis-lead`, `verification-lead`, `editorial-lead`) | D-03: the Program Office authors them at run time, public by B-3 | Phase 4 |
| P-02 | 4 phantom seats with no agent row (`consolidation-reporting`, `financial-modeling`, `verify-financial-model`, `deck-narrative-drafter`) | Named in the spec as phantoms; authored by their leads | Phase 4 (rows), Phase 7 (phantom desks on the floor) |
| P-03 | `editorial-committee` seat with no agent row | D-11: the prompt is human-owned and seeded in Phase 5 | Phase 5 |
| P-04 | `os_inst_egress_blocks` has no writer | B-4's egress check lives in the tool layer | Phase 2 |
| P-05 | `os_inst_corpus.kind = 'execution'` has no producer | B-7 sandbox not built | Phase 2 |
| P-06 | `os_inst_briefs.cost_estimate_usd` / `tokens_estimate` never set | Weight classes and estimation are Program Office logic | Phase 4 |
| P-07 | `os_inst_agent_versions.triggered_by_review_id`, `os_inst_reviews.subject_submission_id`, `os_inst_corpus.assignment_id` carry no FK | Cross-references between tables created in one migration; kept as plain uuids so a review or submission can be deleted with its brief without a cascade through versions, which are immutable | Stays; documented, not a bug |
| P-08 | `LabRegistry.tsx` still issues a direct prompt `UPDATE` | D-07: B-1 blocks it at the database; the UI replacement is Phase 6 | Phase 6 |
| P-09 | Realtime publication includes institution tables but nothing subscribes | The floor's projector is Phase 7 | Phase 7 |
| P-10 | `ASSETS.md` lists nothing | No binary asset enters the host tree until the floor migrates | Phase 7 |
| P-11 | No search API key; the default backend is DuckDuckGo's keyless HTML endpoint | The institution has no search contract (D-13). A 403 or 429 is archived with its status, never returned as "no results" | Director sets `INSTITUTION_SEARCH_URL` / `INSTITUTION_SEARCH_API_KEY` as function secrets |
| P-12 | The sandbox library is 41 functions, not a statistics package | B-7 needs reproducible execution, not SciPy. Regression, forecast, Monte Carlo, scenario, sensitivity, NPV/IRR and descriptive statistics are implemented; anything else is a script over them | Extended per brief, in `sandbox/stdlib.ts`, with a test |
| P-13 | `methodology_research` archives a note the agent wrote; it does not itself search | Search and fetch are separate tools the agent calls first; the note cites what they archived | Stays: one tool, one job |

## Phase 7 — the floor

Carried in from `bot-crossing/PLACEHOLDERS.md` when that root was deleted,
corrected where the migration changed the facts. Everything here is
code-authored primitive geometry or a code-driven animation overlay. The
dev panel's **Show placeholders in grey** toggle renders all the furniture
in neutral grey so the stub status is unmistakable (B-6).

| # | Placeholder | Stands in for | Replaced by |
| --- | --- | --- | --- |
| P-14 | `sit_typing` = the rig's real `Sitting_Idle_Loop` plus a code-driven forearm/hand oscillation (`AnimationController.applyTyping`) | A seated typing clip | A `Sit_Typing_Loop` on the same skeleton, dropped into the GLB and mapped in `rig.ts` |
| P-15 | `carry_walk` = the rig's real `Walk_Loop` plus a code-driven arm pose and a document mesh parented to `hand_r` | A carry-walk clip | A `Carry_Walk_Loop` on the same skeleton |
| P-16 | Document / folder mesh — a box with an emissive strip | A modelled folder or tablet | A small GLTF prop |
| P-17 | Avatar body colour per department — flat colour, and only four of them for ten rooms | Department identity on the avatar itself | Textured or accessorised rig variants. Until then the name plate and the bay are what identify a department; the tint is a grouping hint and `palette.ts` says so |
| P-18 | Name plates, zone signs and badges — canvas-texture sprites | Designed plates and signage | The same mechanism with final typography |
| P-19 | Faceted low-poly dune spheres around the campus (`DesertGround.tsx`) | Sculpted terrain or a skyline backdrop | A terrain mesh or a matte-painted skybox band with a licence |
| P-20 | Flat hex prisms with per-tile colour for floors and paving | Textured floor materials | Baked albedo/AO textures per tile kind |
| P-21 | All nine furniture kinds — `workstation`, `meetingTable`, `meetingChair`, `loungeSofa`, `coffeeBar`, `outputTerminal`, `archiveShelf`, `managerDesk`, `plant` — are primitive geometry authored in `scene/furniture/catalog.ts` at the dimensions in `logic/floor/layout/furnitureSpecs.ts` | Modelled props | Low-poly GLTFs carrying `anchor_sit` / `anchor_stand` / `anchor_deliver` empties; the loader already prefers an asset's own anchor nodes |
| P-22 | Glass wall panels, posts, rails, canopy, LED strips and ceiling spots (`Architecture.tsx`) — boxes, cylinders and emissive prisms | Modelled façades and light fittings | Modelled geometry, still emissive rather than real light objects |
| P-23 | `coffeeBar` is in the catalog and the spec table but the institution floorplan places none | Nothing — the institution has no lounge; the kind survived the campus rewrite unplaced | Delete the kind, or place one. **Proposed for deletion, not deleted** (CLAUDE.md §11) |
| P-24 | Progress percentage on an avatar's hologram and in the inspector | Measured progress | Nothing: the executor writes tokens once, at completion, so there is nothing to measure. It is derived from the assignment's STATUS and is labelled an estimate at every surface (D-05) |
| P-25 | The token graph — a sparkline of `tokensUsed` as received | Prompt/completion split and cost per sample | A richer usage contract from the executor |
