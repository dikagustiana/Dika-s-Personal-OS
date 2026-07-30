-- ===========================================================================
-- WHICH MODEL RUNS WHICH TASK. Data, not a constant in code.
-- ===========================================================================
-- The per-seat `model?` override in src/logic/research/council/personas.ts and
-- the optional `model` field on the run-research-prompt body have existed since
-- the integration landed, and nothing has ever set either. RESEARCH_MODEL_DEFAULT
-- was therefore the only model any task could use, which is one global answer to
-- a question whose right answer differs sharply per task: a scoping sweep and a
-- citation check do not need the same accuracy, and paying for the strongest
-- model on every card is how a US$5 balance disappears in an afternoon.
--
-- THIS IS A TABLE AND NOT A CONSTANT because the owner will change it as he
-- learns which model handles what, and a redeploy per experiment is the friction
-- that stops the experiment. Same reasoning as os_finish_line_account_map: the
-- mapping is authored data, so it lives where data lives. Edit it in the
-- Supabase table editor; the next page load picks it up.
--
-- ABSENCE MEANS "USE THE DEFAULT", NEVER "DO NOT SEND". A task with no row —
-- and a row whose model is blank — falls back to RESEARCH_MODEL_DEFAULT. That
-- direction is deliberate and load-bearing: the opposite would silently disable
-- a prompt card the moment a new prompt kind is added, and the card would
-- disappear with no error to trace.
--
-- ROUTING CANNOT OVERRIDE THE BROWSING GATE. Nothing here can: the gate is
-- keyed on the task, is enforced in the Edge Function before the model name is
-- read (run-research-prompt REQUIRES_BROWSING, run-research-council
-- MODES_REQUIRING_BROWSING), and this table has no column the gate consults.
-- A row naming the strongest browsing-capable model for prData still leaves
-- prData copy-paste-only while RESEARCH_MODEL_BROWSING is false, because the
-- server does not believe the client about web access — it would fabricate
-- confirmations, and a fabricated all-clear retires a check that never ran.
--
-- The task vocabulary is NOT a CHECK constraint. A constraint would mean a
-- prompt kind added later cannot be routed until someone writes a migration,
-- which is the deploy this table exists to avoid. Typos are surfaced instead:
-- the Prompts tab lists any row whose task it does not recognise, so a row for
-- 'prBreif' reads as a visible mistake rather than a setting that does nothing.
--
-- APPLIED 2026-07-30 via the Supabase apply_migration tool, recorded in the
-- ledger as `model_routing`, and verified live afterwards rather than trusted
-- from the tool's return. Applied BEFORE the PR was opened: this project has
-- shipped a frontend against an unapplied migration twice.
--
-- Idempotent throughout — create if not exists, seed with on conflict do
-- nothing, policies created only when absent. Safe to re-run.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`. This repo's filenames and the live ledger's versions are
-- different numbering schemes, so any of those replays the entire history from
-- 0001_schema.sql against live production data.

create table if not exists public.os_model_routing (
  -- The task, spelled exactly as the code names it: a prompt kind (prBrief,
  -- prData, …) or a council mode (method, scope, contra).
  task text primary key,
  -- Blank is a first-class value and means the same as no row: use the
  -- function's RESEARCH_MODEL_DEFAULT. The seed below relies on it, so every
  -- routable task is listed and editable without anyone having to remember
  -- the vocabulary.
  model text not null default '' check (char_length(model) <= 120),
  note text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.os_model_routing is
  'Task -> model routing for the research prompts and councils. Editable data, no deploy. A missing row or a blank model means use RESEARCH_MODEL_DEFAULT; it never means do not send. Nothing here can override the browsing gate, which is keyed on the task and enforced in the Edge Function before the model name is read.';

comment on column public.os_model_routing.task is
  'A prompt kind (prBrief, prBatch, prAllBatch, prData, prCite, prMethod, prLit, prContra, prHand, prDigest, prScope) or a council mode (method, scope, contra). Not constrained on purpose: a prompt kind added later must be routable without a migration.';

comment on column public.os_model_routing.model is
  'The provider model id, verbatim, as the provider spells it. Blank = use RESEARCH_MODEL_DEFAULT. A wrong id fails loudly at send time with the provider status, which is the intended feedback.';

-- Every routable task, seeded blank. The rows exist so the table editor shows
-- the whole vocabulary; they change nothing until a model is typed in.
insert into public.os_model_routing (task, note) values
  ('prBrief',   'Brief — the whole project stated once.'),
  ('prBatch',   'Batch verification of indeterminate register items.'),
  ('prAllBatch','Batch verification across the whole portfolio.'),
  ('prData',    'Data review — re-opens sources. Browsing-gated.'),
  ('prCite',    'Citation review. Browsing-gated.'),
  ('prMethod',  'Method review — cheapest useful send, no browsing needed.'),
  ('prLit',     'Literature sweep. Browsing-gated.'),
  ('prContra',  'Contradiction — the case against the claims. Browsing-gated.'),
  ('prHand',    'Handover pack.'),
  ('prDigest',  'Portfolio digest.'),
  ('prScope',   'Scoping sweep on a raw question. Browsing-gated.'),
  ('method',    'Method council — 5 seats, 11 completions.'),
  ('scope',     'Scoping council — 5 seats, 11 completions.'),
  ('contra',    'Contra council — 4 seats, 9 completions. Browsing-gated.')
on conflict (task) do nothing;

alter table public.os_model_routing enable row level security;

-- The four-policy shape every os_ table carries since 20260728000032: one
-- policy per command, every predicate wrapped in a scalar subquery so the
-- bcrypt comparison inside the key check runs once per statement instead of
-- once per row. WITH CHECK included — dropping the wrapping there is what
-- turns a save slow rather than failing, which is harder to notice.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'os_model_routing'
      and policyname = 'require app key to select'
  ) then
    create policy "require app key to select" on public.os_model_routing
      for select using ((select public.os_key_valid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'os_model_routing'
      and policyname = 'require app key to insert'
  ) then
    create policy "require app key to insert" on public.os_model_routing
      for insert with check ((select public.os_key_valid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'os_model_routing'
      and policyname = 'require app key to update'
  ) then
    create policy "require app key to update" on public.os_model_routing
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'os_model_routing'
      and policyname = 'require app key to delete'
  ) then
    create policy "require app key to delete" on public.os_model_routing
      for delete using ((select public.os_key_valid()));
  end if;
end $$;

-- The read-only credential accepts SELECT on every other table, and this one
-- must not be the single exception that makes a shared read fail with an empty
-- routing list — which would render as "nothing is routed" rather than as an
-- error. Conditional because os_read_key_valid() arrives in its own migration:
-- on a fresh replay where that has not run yet, the owner-only SELECT policy
-- above stands and this block is a no-op. Re-running after it exists widens
-- SELECT only, never a write.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'os_read_key_valid'
  ) and exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'os_model_routing'
      and policyname = 'require app key to select'
      and qual not ilike '%os_read_key_valid%'
  ) then
    alter policy "require app key to select" on public.os_model_routing
      using ((select public.os_key_valid()) or (select public.os_read_key_valid()));
    raise notice 'select policy on os_model_routing now accepts either key';
  end if;
end $$;
