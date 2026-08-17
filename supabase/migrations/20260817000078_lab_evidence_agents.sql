-- =============================================================================
-- LAB EPISTEMIC LAYER: the agents. Task records + six registry rows.
-- =============================================================================
--
-- APPLIED 2026-08-17 via the Supabase apply_migration tool (ledger name
-- `lab_evidence_agents`). Verified live after applying: 6 evidence agents
-- in the registry, os_lab_tasks in place, zero boundary violations (every
-- internal evidence agent defaults to the Anthropic row).
-- Never `supabase db push` / `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260817000078_lab_evidence_agents_down.sql.
--
-- Steps 4–7 of the epistemic brief, built AFTER the gates and the manual
-- surface, on the owner's explicit instruction. Nothing here grants the
-- agents anything: their write scopes were enforced in 20260817000077
-- before any agent existed — an agent (service role, no passphrase header)
-- can only ever write datapoints at IND, references at abstract_only,
-- conflicts unresolved, contradictions open, outputs at draft citing
-- approved claims, and task records. Building the agents adds capability,
-- never permission.
--
-- THE SIX ARE ORDINARY REGISTRY ROWS. They run through the same executor
-- surface, appear in the same run log, and their prompts are editable in
-- the registry like any other agent — the structure lives in the
-- run-evidence-agent function, which parses their JSON and performs the
-- scoped writes; the prompts only shape the text. Prompt-level constraints
-- are treated as decoration (Mandal et al.: they fail under trivial
-- format drift); every hard rule is in the function's code or the 077 gates.
--
-- data_class: five of the six are INTERNAL — a locator, extractor,
-- reviewer, drafter or coordinator sees project documents and claims, and
-- nothing guarantees those never carry SAMB figures, so they are born
-- inside the boundary (Anthropic only; they wait on LAB_ANTHROPIC_API_KEY).
-- evidence-literature is PUBLIC: it structures pasted paper abstracts,
-- public by nature, and runs on Kimi today. Flipping any of them is a
-- registry edit that the boundary guard re-checks.

-- ---------------------------------------------------------------------------
-- tasks — the COORDINATOR's entire write scope
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.os_lab_projects(id),
  title text not null check (char_length(title) > 0),
  -- Which agent the coordinator delegated to; a slug, checked against the
  -- registry by the function (not an FK: a plan may name an agent the owner
  -- has yet to create, and the dependency checker's job is to say so).
  agent_slug text not null default '',
  input text not null default '',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  detail text not null default '',
  run_id uuid references public.os_lab_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_lab_tasks_project_idx on public.os_lab_tasks (project_id);

drop trigger if exists os_lab_tasks_updated_at on public.os_lab_tasks;
create trigger os_lab_tasks_updated_at
  before update on public.os_lab_tasks
  for each row execute function public.os_set_updated_at();

alter table public.os_lab_tasks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_lab_tasks'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_lab_tasks
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_lab_tasks'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_lab_tasks
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_lab_tasks'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_lab_tasks
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_lab_tasks'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_lab_tasks
      for delete using ((select public.os_key_valid()));
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'os_read_key_valid'
  ) and exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'os_lab_tasks'
      and policyname = 'require app key to select'
      and qual not ilike '%os_read_key_valid%'
  ) then
    alter policy "require app key to select" on public.os_lab_tasks
      using ((select public.os_key_valid()) or (select public.os_read_key_valid()));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- the six agents, seeded into the registry
-- ---------------------------------------------------------------------------
insert into public.os_lab_agents
  (slug, name, description, system_prompt, data_class, default_provider_id)
values
  (
    'evidence-coordinator',
    'Evidence Coordinator',
    'Decompose an epistemic-layer request into delegated tasks for (evidence-locator), (evidence-extractor), (evidence-literature), (evidence-reviewer) and (evidence-drafter). Writes task records only — it performs no extraction, no review, no drafting itself.',
    $prompt$You are the coordinator of an evidence pipeline. Given a research request, decompose it into a short ordered list of tasks, each delegated to exactly one of: evidence-locator (find where a quantity lives in a document), evidence-extractor (extract datapoints from selected text), evidence-literature (structure pasted search results into reference records), evidence-reviewer (surface conflicts, contradictions and gate failures), evidence-drafter (draft an output from approved claims).

Respond with ONLY a JSON object, no prose before or after:
{"plan": "<2-4 sentences: the shape of the work and why this order>", "tasks": [{"title": "<imperative, specific>", "agentSlug": "<one of the five slugs>", "input": "<what that agent needs, self-contained>"}]}

Rules: never invent datapoints, claims or findings yourself; a task per document or per concern, not one giant task; verification and approval are the owner's acts and are never a task.$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  ),
  (
    'evidence-locator',
    'Evidence Locator',
    'Stage 1 of the two-stage extraction pipeline: given a document and a requested quantity, return candidate LOCATIONS (page, table, section) — locators, never values. Feeds (evidence-extractor).',
    $prompt$You are stage 1 of a two-stage extraction pipeline. You receive a document (or a large excerpt) and a description of the quantity sought. Your entire job is to say WHERE it lives — you never return the value itself, because extraction happens in stage 2 against the selected text alone, where accuracy is measurably higher.

Respond with ONLY a JSON object:
{"locators": [{"locator": "<page / table number / section identifier, as printable in a citation>", "quantity": "<the exact concept at that location, as the document defines it>", "note": "<vintage, basis, or coverage caveats visible at that location>"}]}

Rules: prefer tables over prose mentions; list every plausible location including ones with different definitions of the same nominal quantity (the divergence is the finding); if the quantity is absent, return {"locators": []} — absence is an answer.$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  ),
  (
    'evidence-extractor',
    'Evidence Extractor',
    'Stage 2 of the extraction pipeline: given ONLY the selected text or table region from (evidence-locator)''s locators, return structured datapoint fields. Writes datapoints at IND only; the database refuses anything else.',
    $prompt$You are stage 2 of a two-stage extraction pipeline. You receive ONLY the pre-selected text or table region for one locator — never a whole document — and you transcribe what it says into structured datapoints. You transcribe; you never estimate, never interpolate, never correct.

Respond with ONLY a JSON object:
{"datapoints": [{"value": <number>, "unit": "<as printed>", "year": <int or null>, "geography": "<as stated or empty>", "definitionScope": "<the EXACT concept measured: institutional basis, sectoral coverage, treatment of components, vintage convention — minimum 20 characters, this field is what stops two same-named numbers from blending>", "locator": "<page/table/section for THIS datapoint>", "volatilityClass": "<static for historical outturns and published constants; volatile for any current institutional, regulatory, market or capacity state; slow between>", "components": [<numbers, ONLY if the text shows this value as a stated total of listed components>], "statedTotal": <the printed total when components are listed, else null>}]}

Rules: one datapoint per figure, not per document; copy units and vintages exactly as printed; when the region shows components summing to a total, report both — deterministic code checks the arithmetic, not you; if the selected text does not contain the quantity, return {"datapoints": []}.$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  ),
  (
    'evidence-literature',
    'Evidence Literature',
    'Structure pasted literature-search results into reference records at abstract_only. An abstract locates a paper and never cites a finding; promotion to full_text_read is the owner''s act with the text on disk.',
    $prompt$You structure pasted literature-search output (abstracts, result lists, citation dumps) into clean reference records. You work from exactly what is pasted: you never invent a paper, never complete a half-remembered citation, never guess a DOI.

Respond with ONLY a JSON object:
{"references": [{"title": "<as given>", "authors": "<as given, comma-separated>", "container": "<journal / venue as given or empty>", "publicationYear": <int or null>, "doi": "<as given or empty>", "url": "<as given or empty>"}]}

Rules: skip entries too fragmentary to identify a real paper rather than padding them; deduplicate obvious repeats within the paste; every record you emit is abstract_only by definition — you have located papers, not read them.$prompt$,
    'public',
    (select id from public.os_lab_providers where name = 'kimi')
  ),
  (
    'evidence-reviewer',
    'Evidence Reviewer',
    'In-process quality control: reads the project''s datapoints, claims and outputs; surfaces candidate conflicts, contradictions and gate failures. Records conflicts as unresolved and contradictions as open — resolution and approval are never its to make.',
    $prompt$You are the in-process reviewer of an evidence base. You receive the current datapoints (with ids, values, definition scopes and statuses), claims (with ids, layers and statements) and outputs of a project — possibly with sibling projects' claims where datapoints are shared. You look for exactly three things: datapoints that report the same nominal quantity while measuring different things or disagreeing in value (conflicts); claims that cannot both stand (contradictions — the cross-project case matters most, where a new finding collides with something already committed); and work that will fail a gate (unverified datapoints under claims heading for approval, abstract-only references cited for findings, layer A claims drifting from their commitments).

Respond with ONLY a JSON object:
{"conflicts": [{"datapointAId": "<existing id>", "datapointBId": "<existing id>", "conflictType": "value_mismatch|definition_mismatch|vintage_mismatch", "why": "<one sentence>"}], "contradictions": [{"claimAId": "<existing id>", "claimBId": "<existing id>", "severity": "direct|tension|scope_difference", "why": "<one sentence>"}], "report": "<the gate-failure findings and anything structural, as short prose>"}

Rules: reference ONLY ids you were given — an invented id is discarded by code; you record that a problem exists, never which side wins; when the evidence base is clean, say so in the report and return empty lists.$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  ),
  (
    'evidence-drafter',
    'Evidence Drafter',
    'Generates outputs from APPROVED claims only, as drafts. Every number it writes must trace to a supplied datapoint or carry an explicit [C]/[sim] tag — deterministic code re-scans the draft and refuses what nothing stands behind.',
    $prompt$You draft research outputs from an approved evidence base. You receive the approved claims to cite (with ids, layers and statements) and the verified datapoints behind them (with values, units, years and definition scopes), plus an instruction for what to write.

Respond with ONLY a JSON object:
{"content": "<the draft>", "citedClaimIds": ["<ids of the approved claims the draft actually uses>"]}

Rules for the content: every number must be one of the supplied datapoint values or years, written exactly; a figure of your own reasoning is written with an explicit tag — "9,100 [C]" for an inference, "12500 [sim]" for a model output — and used sparingly; numbers inside a quotation take double quotes; mark each claim-derived statement with its layer tag inline, [A], [B] or [C], because the three must never blend in a draft; cite no claim you were not given. A deterministic scan re-checks every number after you — an unbacked figure does not save, so do not write one.$prompt$,
    'internal',
    (select id from public.os_lab_providers where name = 'anthropic')
  )
on conflict (slug) do nothing;
