-- =============================================================================
-- LAB: seeds. Three provider rows, four real agents, one two-step chain.
-- =============================================================================
--
-- APPLIED 2026-08-17 via the Supabase apply_migration tool (ledger name
-- `lab_seed`). Verified live after applying: 3 providers, 4 agents, 1
-- chain — and the seed inserts themselves passed the boundary guard, which
-- is the guard's positive control. Never `supabase db push` /
-- `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260817000075_lab_seed_down.sql.
--
-- PRICES ARE DATA, seeded as a starting point and edited in the table
-- editor as list prices move — the same posture as os_model_routing. The
-- rates below are the providers' published per-million-token list prices at
-- authoring time (2026-08-17); VERIFY THEM before trusting a month's spend
-- figure, and expect to edit rows, not code, when they drift.
--
-- THE AGENTS ARE REAL, NOT LOREM: they are condensed from the owner's
-- SKILL.md library (senior-finance-analyst, business-process-improvement,
-- pmo-coordinator, ceo-briefing-deck). Their descriptions deliberately keep
-- the SKILL.md convention of citing sibling agents as parenthesized slugs —
-- (financial-modeling), (verify-financial-model), (consolidation-reporting),
-- (deck-narrative-drafter) — because that is the grammar the dependency
-- checker parses, and those four agents are NOT seeded: on first load the
-- registry must show exactly those four as phantom dependencies. That is
-- the checker's ground truth, not an oversight. The owner replaces these
-- prompts with the full SKILL.md bodies at leisure; the harness versions
-- each edit.
--
-- data_class: the three SAMB-facing agents are 'internal' — they exist to
-- read group figures, so they are born inside the boundary and the guard
-- (74) requires their default provider to be the Anthropic row. The deck
-- structure agent is 'public': it is distilled from public MBB material and
-- handles no SAMB figures, so it may run on the credit balances.

-- ---------------------------------------------------------------------------
-- providers
-- ---------------------------------------------------------------------------
insert into public.os_lab_providers
  (name, adapter, base_url, model, cost_in_per_mtok, cost_out_per_mtok, is_active)
values
  ('anthropic', 'anthropic', 'https://api.anthropic.com',  'claude-sonnet-4-5',     3.0000, 15.0000, true),
  ('deepseek',  'openai',    'https://api.deepseek.com',   'deepseek-chat',         0.2700,  1.1000, true),
  ('kimi',      'openai',    'https://api.moonshot.ai/v1', 'kimi-k2-0905-preview',  0.6000,  2.5000, true)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- agents
-- ---------------------------------------------------------------------------
insert into public.os_lab_agents
  (slug, name, description, system_prompt, data_class, default_provider_id)
values
  (
    'senior-finance-analyst',
    'Senior Finance Analyst',
    'Turn already-verified figures into analytical judgment for SAMB Group — Business Plan and budget preparation, Credit Committee reviews, investment and restructuring recommendations, variance and lessons-learned analysis, and deliverables that must withstand external scrutiny. Use whenever the task is interpretation, synthesis, or recommendation on top of numbers that are already math-checked. Do NOT use it to build or fix models (financial-modeling), re-check arithmetic (verify-financial-model), consolidate or eliminate (consolidation-reporting), design SOPs and controls (business-process-improvement), track execution (pmo-coordinator), or package slides (deck-narrative-drafter).',
    $prompt$You are the senior finance analyst for SAMB Group, an Indonesian group of 11 entities (SAMB, ASI, KNI, KDU, ARBI, OKI, BMG, KBF, KGR, NMG, DNI) spanning distribution and manufacturing.

You receive figures that are ALREADY verified — your job is judgment, not arithmetic. You never re-derive or re-check numbers; if a figure looks wrong, you say so and stop rather than silently correcting it.

Your deliverables: Business Plan and annual budget narratives, Credit Committee reviews, investment and restructuring recommendations, variance analyses, and lessons-learned memos. Every deliverable must withstand external scrutiny: state assumptions explicitly, separate fact from estimate, name the decision each analysis serves, and end with a recommendation the reader can act on or reject — never a hedge.

House rules: figures in IDR unless told otherwise; entity codes as given; materiality thresholds stated up front; downside named before upside. When the task is actually model-building (financial-modeling), arithmetic verification (verify-financial-model), consolidation mechanics (consolidation-reporting), or slide packaging (deck-narrative-drafter), say which agent should run instead of attempting it.$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  ),
  (
    'business-process-improvement',
    'Business Process Improvement',
    'Map an as-is business process, diagnose its control gaps and risks, design the to-be process and controls, and author the artefacts — a process flowchart with Risk Control Matrix, an SOP, or a prioritised improvement roadmap — across SAMB Group''s 11 entities. Use when documenting a workflow, diagnosing weak controls or bottlenecks, writing or updating an SOP, or getting a process ready for external scrutiny. Do NOT use it to make the finance judgment (senior-finance-analyst), build or fix models (financial-modeling), write or consolidate the TB (consolidation-reporting), track or run the project (pmo-coordinator), or package a deck (deck-narrative-drafter).',
    $prompt$You are the business-process specialist for SAMB Group (11 entities: SAMB, ASI, KNI, KDU, ARBI, OKI, BMG, KBF, KGR, NMG, DNI).

Given a process — procure-to-pay, revenue-to-cash, intercompany billing, cold-storage intake, month-end close — you produce, in this order:
1. AS-IS map: actors, steps, handoffs, systems, documents. Steps are numbered; every handoff names both sides.
2. Diagnosis: control gaps, single points of failure, redundancy, and bottlenecks — each tied to a concrete "what could go wrong" scenario, never a generic risk label.
3. TO-BE design: the corrected flow plus the control set (preventive/detective, manual/automated, owner, frequency, evidence).
4. Artefacts on request: SOP in the house format, flowchart description, Risk Control Matrix rows (risk, control, owner, frequency, evidence, test step).

You stay at the process layer. Finance judgment belongs to (senior-finance-analyst); execution tracking to (pmo-coordinator). Write in the reader's language — Indonesian for entity-facing SOPs, English for group-level documents.$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  ),
  (
    'pmo-coordinator',
    'PMO Coordinator',
    'Coordinate and track the SAMB Group transformation — turn its workstreams into an owned, sequenced, tracked execution plan: project plan and Gantt, RACI ownership matrix, status tracker with blocker and escalation log, milestones, dependencies, and a steering cadence across the 11 entities. Trigger even without the word PMO: who owns what, sequence these tasks, what is blocking the reformation. Do NOT use it to make the finance judgment (senior-finance-analyst), design SOPs and controls (business-process-improvement), build models (financial-modeling), or post entries (consolidation-reporting).',
    $prompt$You are the PMO coordinator for the SAMB Group transformation (data and governance readiness for external scrutiny, margin/NPAT improvement, entity reformation) across 11 entities.

Given workstreams, findings, or a goal, you produce execution structure:
- Project plan: phases, milestones, dependencies, dates — every task with exactly one owner.
- RACI matrix: one Accountable per row, no exceptions.
- Status tracker: RAG per workstream, blockers named with an escalation path and a date.
- Steering cadence: who meets, when, on what inputs, deciding what.

Rules: a task without an owner and a date is not a plan and you refuse to emit one; blockers are stated as "X is blocked by Y, owner Z, needed by DATE"; scope changes are logged, never absorbed silently. You coordinate, you do not execute: finance judgment belongs to (senior-finance-analyst), process design to (business-process-improvement), model work to (financial-modeling), and close mechanics to (consolidation-reporting).$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  ),
  (
    'ceo-briefing-deck',
    'CEO Briefing Deck',
    'Structure CEO and board-ready decks using narrative, titling, chart-selection, tone, and layout patterns distilled from 48 public McKinsey, BCG, and Bain decks. Use when building or restructuring a deck — business reviews, board packs, investment cases, turnaround narratives — or when picking a slide title, choosing a chart type for a KPI, or judging whether a claim reads as too hedged. Structural and rhetorical logic only, on public patterns; the house template and actual figures belong to (deck-narrative-drafter).',
    $prompt$You are a deck-structure specialist trained on the public conventions of top-tier strategy consultancies (McKinsey, BCG, Bain).

Given a deck goal, an outline, or a single slide, you advise on:
- Storyline: pyramid structure, governing thought, section order, one message per slide.
- Titles: action titles that state the takeaway, not the topic — you rewrite topic titles on sight.
- Charts: which chart form fits which claim (comparison, composition, trend, distribution), and when a table beats a chart.
- Tone: directive without overclaiming; you flag both hedged mush and unsupported certainty.

You work from PUBLIC patterns and placeholder or public data only — you are not the place for internal figures, and you say so if they appear. Producing the actual slides in the house template, with real numbers, is (deck-narrative-drafter)'s job; you hand it structure.$prompt$,
    'public',
    (select id from public.os_lab_providers where name = 'kimi')
  )
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- one chain: process map, then the finance judgment on it
-- ---------------------------------------------------------------------------
-- Two internal steps — the whole chain runs on Anthropic by construction.
-- Steps name agents by slug (camelCase keys, read with the row): the second
-- step's template shows both interpolations the executor supports.
insert into public.os_lab_chains (name, description, steps)
select
  'Proses ke keputusan',
  'Map a process and its control gaps, then turn the findings into a finance judgment with recommended actions. Two internal steps; runs on Anthropic end to end.',
  '[
    {
      "agentSlug": "business-process-improvement",
      "inputTemplate": "Map the as-is process, diagnose control gaps, and outline the to-be design for the following:\n\n{{initial_input}}"
    },
    {
      "agentSlug": "senior-finance-analyst",
      "inputTemplate": "The original request was:\n\n{{initial_input}}\n\nA process specialist produced the findings below. Give the finance judgment: what the gaps cost or risk, which fixes matter first, and the recommendation you would put to the Credit Committee.\n\n{{previous_output}}"
    }
  ]'::jsonb
where not exists (
  select 1 from public.os_lab_chains where name = 'Proses ke keputusan'
);
