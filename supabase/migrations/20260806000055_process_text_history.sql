-- ===========================================================================
-- PROCESS TEXT BECOMES EDITABLE, SO IT GETS A HISTORY. Append-only.
-- ===========================================================================
-- The process feature was read-only except os_process_needs.requested_on.
-- That is over: the map is a written artefact and will keep being revised,
-- and changing one word in a note should not require a migration. Text is
-- now editable from the app; STRUCTURE still is not (slot, lane_key, track,
-- label, entity_code, and every id stay migration-only, because they decide
-- the diagram's topology and breaking them is silent).
--
-- This table is the safety net that makes that trade acceptable. The prose in
-- these fields is expensive to reproduce — a note like "TIDAK ADA GRN DAN
-- TIDAK ADA GR/IR" is a conclusion someone reached, not a form field — and
-- one bad edit without a record is unrecoverable. The loss is asymmetric, so
-- the log is cheap insurance. Precedent and shape: os_finish_line_cell_history.
--
-- ===========================================================================
-- row_id IS text WITH NO FOREIGN KEY, AND THAT IS DELIBERATE.
-- ===========================================================================
-- This is one audit log across FIVE tables whose keys are not even the same
-- type (os_process_steps.id is uuid, os_process_gates.id is text, and
-- os_process_lanes is keyed by a pair). A polymorphic FK cannot express that,
-- and the alternatives — five parallel history tables, or a nullable FK per
-- table — are worse than no FK here: five tables means five places to forget,
-- and five nullable FKs means five columns that are null on every row but one.
-- So: no FK, and this comment so the absence reads as a decision rather than
-- an oversight. The cost is that a deleted row leaves orphaned history, which
-- is exactly what an audit log should do anyway.
--
-- APPEND-ONLY IS ENFORCED BY THE POLICY SET, NOT BY CONVENTION: there is an
-- INSERT policy and a SELECT policy, and there is NO update policy and NO
-- delete policy. With RLS enabled, an absent policy is a denial — so a row,
-- once written, cannot be changed or removed through the app's key at all.
-- Do not add the missing two "for symmetry"; the asymmetry is the feature.
--
-- One row per FIELD that changed, not one per save: a save that edits three
-- fields writes three rows, so "what changed" is answerable without diffing
-- two snapshots.
--
-- NOT APPLIED. This session has no database access. Apply via the Supabase
-- apply_migration tool per the APPLY BEFORE DEPLOY block in the PR that
-- introduced this file. NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit` — this repo's filenames and the live
-- ledger's versions are different numbering schemes, so any of those replays
-- the entire history from 0001_schema.sql against production data.
--
-- The frontend ships BEFORE this runs, and a save must NOT fail because the
-- log is missing: the app writes the edit first, then appends history, and
-- treats a missing history relation (42P01 / PGRST205) as "skip the log".
-- Losing the audit line is bad; losing the edit because the audit line could
-- not be written would be worse.
--
-- Idempotent: create if not exists, policies created only when absent.
--
-- Down-migration:
-- supabase/migrations/down/20260806000055_process_text_history_down.sql

create table if not exists public.os_process_text_history (
  id         uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id     text not null,
  field      text not null,
  old_value  text,
  new_value  text,
  changed_at timestamptz not null default now()
);

comment on table public.os_process_text_history is
  'Append-only audit of every process TEXT edit made from the app. One row per changed field, not per save. APPEND-ONLY BY POLICY SET: insert and select exist, update and delete deliberately do not — with RLS on, an absent policy is a denial. Precedent: os_finish_line_cell_history.';
comment on column public.os_process_text_history.row_id is
  'The edited row''s key, as text. NO FOREIGN KEY ON PURPOSE: this one log spans five tables whose keys differ in type (steps uuid, gates text, lanes a pair), and a polymorphic FK cannot express that. The alternatives — five history tables, or five nullable FKs — are worse. Orphaned history after a delete is correct behaviour for an audit log, not a leak.';
comment on column public.os_process_text_history.table_name is
  'os_process_steps | os_process_needs | os_process_gates | os_process_lanes | os_process_phases.';

create index if not exists os_process_text_history_row_idx
  on public.os_process_text_history (table_name, row_id, changed_at desc);

alter table public.os_process_text_history enable row level security;

-- INSERT and SELECT only. The absence of update/delete policies IS the
-- append-only guarantee — see the header before adding anything here.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_text_history'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_process_text_history
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_text_history'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_process_text_history
      for insert with check ((select public.os_key_valid()));
  end if;
end
$$;
