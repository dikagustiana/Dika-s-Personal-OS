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
| P-12 | The sandbox library is 40 functions, not a statistics package | B-7 needs reproducible execution, not SciPy. Regression, forecast, Monte Carlo, scenario, sensitivity, NPV/IRR and descriptive statistics are implemented; anything else is a script over them | Extended per brief, in `sandbox/stdlib.ts`, with a test |
| P-13 | `methodology_research` archives a note the agent wrote; it does not itself search | Search and fetch are separate tools the agent calls first; the note cites what they archived | Stays: one tool, one job |
