-- =============================================================================
-- LAB SCOUT CURATION: candidate sources without judgement columns, publisher
-- tiers from an allowlist the payload can never touch, and snapshot recheck
-- that flags change without ever demoting evidence.
-- =============================================================================
--
-- APPLIED 2026-08-17 via the Supabase apply_migration tool (ledger name
-- `lab_scout_curation`). Verified live after applying, in a rolled-back
-- probe under a throwaway key: a keyless candidate insert landed at
-- status=candidate with the trigger-computed tier even when the payload
-- claimed tier 1; keyless promotion refused; owner promotion without a
-- snapshot-backed source document refused naming the candidate; the recheck
-- branch accepts only the flag columns. Never `supabase db push` /
-- `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260817000081_lab_scout_curation_down.sql.
--
-- WHAT THIS LAYER FIXES (review, phase 3): source discovery was invisible —
-- documents appeared in os_lab_source_documents fully formed, and nothing
-- recorded what was considered and rejected, or how trustworthy a publisher
-- is. The design rules:
--
--   * NO JUDGEMENT COLUMNS, EVER. os_lab_candidate_sources carries title,
--     publisher, url, claimed date — and structurally CANNOT carry notes,
--     summaries, assessments or relevance scores, because a column that
--     exists will eventually be filled by an agent and read as judgement.
--     The scout transcribes listings; it does not rate them.
--   * TIER COMES FROM THE ALLOWLIST, NEVER THE PAYLOAD. The trigger
--     recomputes it from os_lab_publisher_tiers on every write; a payload
--     tier is overwritten silently for everyone, agent and owner alike.
--     Unknown publisher = tier 3, and tier 3 renders degraded with a
--     cannot-support-layer-A note in the UI.
--   * PROMOTION IS THE OWNER'S, AND REQUIRES THE SNAPSHOT. A candidate
--     becomes usable evidence only by pointing at an os_lab_source_documents
--     row — whose local_snapshot_path is mandatory by column constraint —
--     so nothing enters the evidence base as a live URL.
--   * RECHECK FLAGS, NEVER DEMOTES. The keyless recheck may set exactly the
--     recheck columns on a source document; it cannot touch substance and
--     it cannot touch datapoints. The flag means "the page changed", NOT
--     "the figure changed" — the UI says so in those words, and the human
--     decides what follows.

-- ---------------------------------------------------------------------------
-- publisher tiers — the allowlist
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_publisher_tiers (
  id uuid primary key default gen_random_uuid(),
  -- Matched case-insensitively by the trigger.
  publisher text not null unique check (char_length(publisher) > 0),
  tier int not null check (tier in (1, 2)),
  created_at timestamptz not null default now()
);

-- Tier 1: primary statistical and multilateral institutions. Tier 2 rows
-- are added by the owner as the portfolio needs them; ABSENCE means tier 3.
insert into public.os_lab_publisher_tiers (publisher, tier) values
  ('BPS', 1),
  ('Bank Indonesia', 1),
  ('OJK', 1),
  ('Kemenperin', 1),
  ('Kemenkeu', 1),
  ('Kemenhub', 1),
  ('BKPM', 1),
  ('World Bank', 1),
  ('ADB', 1),
  ('IEA', 1),
  ('IMF', 1)
on conflict (publisher) do nothing;

-- ---------------------------------------------------------------------------
-- candidate sources — deliberately WITHOUT judgement columns
-- ---------------------------------------------------------------------------
create table if not exists public.os_lab_candidate_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.os_lab_projects(id),
  title text not null check (char_length(title) > 0),
  publisher text not null default '',
  url text not null default '',
  claimed_date date,
  -- Guard-computed from the allowlist on every write. Never the payload's.
  tier int not null default 3 check (tier in (1, 2, 3)),
  status text not null default 'candidate' check (status in ('candidate', 'promoted', 'dismissed')),
  promoted_source_document_id uuid references public.os_lab_source_documents(id),
  created_by_run_id uuid references public.os_lab_runs(id),
  created_at timestamptz not null default now()
);

create index if not exists os_lab_candidate_sources_project_idx
  on public.os_lab_candidate_sources (project_id);
create index if not exists os_lab_candidate_sources_status_idx
  on public.os_lab_candidate_sources (status);

-- ---------------------------------------------------------------------------
-- recheck columns on source documents — the flag, and only the flag
-- ---------------------------------------------------------------------------
alter table public.os_lab_source_documents
  add column if not exists last_rechecked_at timestamptz,
  add column if not exists content_changed_at timestamptz;

-- ---------------------------------------------------------------------------
-- RLS on the two new tables
-- ---------------------------------------------------------------------------
alter table public.os_lab_publisher_tiers   enable row level security;
alter table public.os_lab_candidate_sources enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['os_lab_publisher_tiers', 'os_lab_candidate_sources'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl
                   and policyname = 'require app key to select') then
      execute format(
        'create policy "require app key to select" on public.%I
           for select using ((select public.os_key_valid()))', tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl
                   and policyname = 'require app key to insert') then
      execute format(
        'create policy "require app key to insert" on public.%I
           for insert with check ((select public.os_key_valid()))', tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl
                   and policyname = 'require app key to update') then
      execute format(
        'create policy "require app key to update" on public.%I
           for update using ((select public.os_key_valid()))
           with check ((select public.os_key_valid()))', tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = tbl
                   and policyname = 'require app key to delete') then
      execute format(
        'create policy "require app key to delete" on public.%I
           for delete using ((select public.os_key_valid()))', tbl);
    end if;
  end loop;
end
$$;

do $$
declare
  tbl text;
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'os_read_key_valid'
  ) then
    foreach tbl in array array['os_lab_publisher_tiers', 'os_lab_candidate_sources'] loop
      if exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = tbl
          and policyname = 'require app key to select'
          and qual not ilike '%os_read_key_valid%'
      ) then
        execute format(
          'alter policy "require app key to select" on public.%I
             using ((select public.os_key_valid()) or (select public.os_read_key_valid()))',
          tbl);
      end if;
    end loop;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- publisher tiers guard: the allowlist is the owner's judgement, recorded
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_publisher_tiers_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.os_key_valid() then
    raise exception 'os_lab_publisher_tiers: the allowlist is the owner''s judgement — agents inherit tiers from it, they never write it.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_publisher_tiers_gate_guard() from public;
revoke all on function public.os_lab_publisher_tiers_gate_guard() from anon;
revoke all on function public.os_lab_publisher_tiers_gate_guard() from authenticated;

drop trigger if exists os_lab_publisher_tiers_gate_guard on public.os_lab_publisher_tiers;
create trigger os_lab_publisher_tiers_gate_guard
  before insert or update or delete on public.os_lab_publisher_tiers
  for each row execute function public.os_lab_publisher_tiers_gate_guard();

-- ---------------------------------------------------------------------------
-- candidate sources guard: the SCOUT's entire write scope is the keyless
-- INSERT branch here — candidate-only, tier recomputed, no promotion fields.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_candidate_sources_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
  allow_tier int;
  doc_snapshot text;
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_candidate_sources: only the owner deletes a candidate.';
    end if;
    return old;
  end if;

  -- THE TIER IS NEVER THE PAYLOAD'S. Recomputed from the allowlist on every
  -- write, for everyone — a scout claiming tier 1 for a blog is overwritten
  -- here, silently, because the lie is not the interesting part.
  select t.tier into allow_tier
    from public.os_lab_publisher_tiers t
   where lower(t.publisher) = lower(new.publisher)
   limit 1;
  new.tier := coalesce(allow_tier, 3);

  if tg_op = 'INSERT' then
    if not is_owner then
      -- The scout records that a source EXISTS. Nothing else.
      if new.status <> 'candidate' then
        raise exception 'G-SCOUT: an agent records candidates as candidate — % was refused. Promotion and dismissal are the owner''s judgement.', new.status;
      end if;
      if new.promoted_source_document_id is not null then
        raise exception 'G-SCOUT: an agent cannot attach a promoted source document to a candidate.';
      end if;
    end if;
    if new.status = 'promoted' then
      raise exception 'G-SCOUT: a candidate is born candidate — promotion is a separate, gated act.';
    end if;
    return new;
  end if;

  -- UPDATE ----------------------------------------------------------------
  if not is_owner then
    raise exception 'G-SCOUT: without the app key candidates are read-only after insert — curation is the owner''s judgement.';
  end if;

  if new.status = 'promoted' then
    if new.promoted_source_document_id is null then
      raise exception 'G-SCOUT: candidate % cannot be promoted without its source document — ingest the document (with its mandatory snapshot) first, then point the candidate at it.', old.id;
    end if;
    select sd.local_snapshot_path into doc_snapshot
      from public.os_lab_source_documents sd
     where sd.id = new.promoted_source_document_id;
    if doc_snapshot is null then
      raise exception 'G-SCOUT: candidate % names a source document that does not exist.', old.id;
    end if;
    -- Belt over the column constraint's braces: the snapshot is the
    -- citable artifact, and promotion is where that rule pays.
    if char_length(doc_snapshot) = 0 then
      raise exception 'G-SCOUT: candidate % cannot be promoted — the source document has no local snapshot.', old.id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.os_lab_candidate_sources_gate_guard() from public;
revoke all on function public.os_lab_candidate_sources_gate_guard() from anon;
revoke all on function public.os_lab_candidate_sources_gate_guard() from authenticated;

drop trigger if exists os_lab_candidate_sources_gate_guard on public.os_lab_candidate_sources;
create trigger os_lab_candidate_sources_gate_guard
  before insert or update or delete on public.os_lab_candidate_sources
  for each row execute function public.os_lab_candidate_sources_gate_guard();

-- ---------------------------------------------------------------------------
-- source documents guard: replaces the generic owner guard with one that
-- adds EXACTLY ONE keyless shape — the recheck writing its flag columns.
-- The flag says the PAGE changed; it never says the figure did, and it
-- touches no datapoint.
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_source_documents_gate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_owner boolean := public.os_key_valid();
begin
  if tg_op = 'DELETE' then
    if not is_owner then
      raise exception 'os_lab_source_documents: only the owner deletes a source document.';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if not is_owner then
      raise exception 'os_lab_source_documents: only the owner ingests a source — agents propose candidates, never documents.';
    end if;
    return new;
  end if;
  if not is_owner then
    -- The recheck: substance untouched, only the flag columns move.
    if new.title = old.title
       and new.publisher = old.publisher
       and new.publication_date is not distinct from old.publication_date
       and new.doc_type = old.doc_type
       and new.url = old.url
       and new.local_snapshot_path = old.local_snapshot_path
       and new.snapshot_hash = old.snapshot_hash
       and new.retrieved_at = old.retrieved_at then
      return new;
    end if;
    raise exception 'os_lab_source_documents: without the app key the only permitted write is the recheck flag (last_rechecked_at / content_changed_at) — the recheck detects that the page changed, never that the figure did, and it demotes nothing.';
  end if;
  return new;
end;
$$;

revoke all on function public.os_lab_source_documents_gate_guard() from public;
revoke all on function public.os_lab_source_documents_gate_guard() from anon;
revoke all on function public.os_lab_source_documents_gate_guard() from authenticated;

-- The 077 generic owner guard made source documents owner-only in all three
-- operations; this guard preserves that everywhere except the one recheck
-- shape, so the old trigger comes off.
drop trigger if exists os_lab_source_documents_owner_guard on public.os_lab_source_documents;
drop trigger if exists os_lab_source_documents_gate_guard on public.os_lab_source_documents;
create trigger os_lab_source_documents_gate_guard
  before insert or update or delete on public.os_lab_source_documents
  for each row execute function public.os_lab_source_documents_gate_guard();

-- ---------------------------------------------------------------------------
-- the SCOUT, seeded. PUBLIC data class, like evidence-literature: it
-- structures PASTED search listings (public by nature — no live search is
-- wired, deliberately) into candidate rows. Its writes go through the
-- keyless INSERT branch above: candidate-only, allowlist tier, no judgement
-- columns to fill because none exist.
-- ---------------------------------------------------------------------------
insert into public.os_lab_agents
  (slug, name, description, system_prompt, data_class, default_provider_id)
values
  (
    'evidence-scout',
    'Evidence Scout',
    'Structures pasted search listings into candidate source records: title, publisher, URL, claimed date — nothing else. No relevance scores, no summaries: the table has no columns for judgement, and the tier comes from the owner''s allowlist in the database, never from the scout.',
    $prompt$You structure pasted search-result listings into candidate source records. You work from exactly what is pasted: you never invent a source, never complete a half-remembered title, never guess a URL.

Respond with ONLY a JSON object:
{"candidates": [{"title": "<as given>", "publisher": "<the PUBLISHING INSTITUTION as given, or empty — not the aggregator>", "url": "<as given or empty>", "claimedDate": "<YYYY-MM-DD as given, or null>"}]}

Rules: one record per distinct source; deduplicate obvious repeats within the paste; skip entries too fragmentary to identify a real source rather than padding them; report ONLY the four fields — you do not assess relevance, quality or trustworthiness, and any such text you emit is discarded by code. The publisher tier is assigned by the database from the owner's allowlist; it is never yours to claim.$prompt$,
    'public',
    (select id from public.os_lab_providers where name = 'kimi')
  )
on conflict (slug) do nothing;
