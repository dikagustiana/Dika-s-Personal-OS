-- v4 Part C: enrich the four existing scholarship GROWTH projects (Chevening,
-- IELTS, LPDP, Uni Applications) with start/deadline dates and a full
-- milestone pathway. Updates existing rows by id — never creates duplicates.
--
-- MERGE, NEVER REPLACE.
-- The first version of this migration assigned a whole new `milestones` array,
-- guarded only by a NOT EXISTS check on one sentinel id. Any milestone the
-- owner had already edited — its status, its note, its due date — was silently
-- discarded the first time this ran. Milestones are now merged one at a time
-- by their stable id: an id that is already present is left exactly as the
-- owner left it, and only genuinely new ids are appended. The scalar date
-- columns are likewise only filled in while they are still null.
--
-- This rule applies to every future migration: never assign a live JSON
-- aggregate wholesale. Merge by stable id, or leave the row alone.
--
-- Date rule: no date here is firm. Every milestone carries
-- "dateConfidence": "estimated" so the UI renders it as ~/TBC and never in
-- overdue red. The IELTS test date is the one date expected to become firm,
-- but the two handover sources disagree (20 Sep vs 30 Sep 2026), so it stays
-- `estimated` until the owner confirms it from the booking itself.

-- ---------------------------------------------------------------------------
-- Merge helper. Appends only those incoming milestones whose id is not already
-- present, preserving both the existing order and any owner edits. Repeated in
-- the following migration so that each migration stands alone.
-- ---------------------------------------------------------------------------
create or replace function public.os_merge_milestones(existing jsonb, incoming jsonb)
returns jsonb
language sql
immutable
set search_path to ''
as $$
  select coalesce(existing, '[]'::jsonb) || coalesce(
    (
      select jsonb_agg(candidate order by position)
      from jsonb_array_elements(coalesce(incoming, '[]'::jsonb))
           with ordinality as incoming_milestone(candidate, position)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(existing, '[]'::jsonb)) as kept(milestone)
        where kept.milestone ->> 'id' = candidate ->> 'id'
      )
    ),
    '[]'::jsonb
  );
$$;

-- IELTS (id ...002).
update public.os_projects p
set start_date = coalesce(p.start_date, date '2026-06-28'),
    deadline = coalesce(p.deadline, date '2026-09-20'),
    milestones = public.os_merge_milestones(p.milestones, '[
      {"id": "18000000-0000-4000-8000-000000000001", "text": "IELTS preparation", "done": false, "status": "in-progress", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "18000000-0000-4000-8000-000000000002", "text": "IELTS test", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-09-20", "dateConfidence": "estimated", "note": "Sources disagree (20 vs 30 Sep) — confirm from the booking, then mark confirmed"},
      {"id": "18000000-0000-4000-8000-000000000003", "text": "IELTS results released", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated", "note": "~2 weeks after the test"}
    ]'::jsonb)
where p.id = '10000000-0000-4000-8000-000000000002';

-- LPDP (id ...007) — Tahap 1.
update public.os_projects p
set start_date = coalesce(p.start_date, date '2026-08-01'),
    deadline = coalesce(p.deadline, date '2026-11-30'),
    milestones = public.os_merge_milestones(p.milestones, '[
      {"id": "19000000-0000-4000-8000-000000000001", "text": "Biodata diri", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated", "note": "Tahap 1"},
      {"id": "19000000-0000-4000-8000-000000000002", "text": "KTP", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-000000000003", "text": "Scan ijazah S1 (+ sworn translation)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-000000000004", "text": "Scan transkrip", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-000000000005", "text": "Sertifikat IELTS", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-000000000006", "text": "Surat rekomendasi (Ilya / Ersa / Syaiful)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-000000000007", "text": "Surat pernyataan", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-000000000008", "text": "Profil diri", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-000000000009", "text": "Personal statement", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-00000000000a", "text": "Esai Komitmen / Kontribusi", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-00000000000b", "text": "Publikasi / prestasi / organisasi", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "19000000-0000-4000-8000-00000000000c", "text": "LoA Unconditional (optional)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated", "note": "Optional"},
      {"id": "19000000-0000-4000-8000-00000000000d", "text": "Submit before deadline", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated", "note": "Tahap 1"}
    ]'::jsonb)
where p.id = '10000000-0000-4000-8000-000000000007';

-- Chevening 2027-28 (id ...001).
update public.os_projects p
set start_date = coalesce(p.start_date, date '2026-08-01'),
    deadline = coalesce(p.deadline, date '2026-10-06'),
    milestones = public.os_merge_milestones(p.milestones, '[
      {"id": "1a000000-0000-4000-8000-000000000001", "text": "Online application (ASAMS)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-000000000002", "text": "Work history — 2,800 hrs", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-000000000003", "text": "Three UK course choices", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-000000000004", "text": "Essay 1 — Leadership & influence", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-000000000005", "text": "Essay 2 — Networking", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-000000000006", "text": "Essay 3 — Studying in the UK", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-000000000007", "text": "Essay 4 — Career plan", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-000000000008", "text": "Two referees", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-000000000009", "text": "Reference letters (if shortlisted)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-00000000000a", "text": "Passport / ID (if shortlisted)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-00000000000b", "text": "Degree certificate (if shortlisted)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1a000000-0000-4000-8000-00000000000c", "text": "Unconditional UK offer", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"}
    ]'::jsonb)
where p.id = '10000000-0000-4000-8000-000000000001';

-- Uni Applications (id ...006) — Imperial + Edinburgh + Foundation (single-
-- owner docs live here only).
update public.os_projects p
set start_date = coalesce(p.start_date, date '2026-08-01'),
    deadline = coalesce(p.deadline, date '2026-10-15'),
    milestones = public.os_merge_milestones(p.milestones, '[
      {"id": "1b000000-0000-4000-8000-000000000001", "text": "Imperial: essays (career / why / values + quant statement)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-000000000002", "text": "Imperial: assemble application (CV, transcript)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-000000000003", "text": "Imperial: submit — Round 1", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-09-28", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-000000000004", "text": "Imperial: video interview (async)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-000000000005", "text": "Imperial: decision R1", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-11-26", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-000000000006", "text": "Imperial: convert + deposit / defer", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-000000000007", "text": "Edinburgh: personal statement (~500w, 3 prompts)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-000000000008", "text": "Edinburgh: submit — Round 1 (EUCLID)", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-10-15", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-000000000009", "text": "Edinburgh: decision R1", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-12-04", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-00000000000a", "text": "Edinburgh: meet conditions + deposit / defer", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated"},
      {"id": "1b000000-0000-4000-8000-00000000000b", "text": "Foundation: gather degree certificate & transcript", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated", "note": "Shared docs — live here only"},
      {"id": "1b000000-0000-4000-8000-00000000000c", "text": "Foundation: sworn English translation", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated", "note": "Shared docs — live here only"},
      {"id": "1b000000-0000-4000-8000-00000000000d", "text": "Foundation: update CV (+ Imperial template)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated", "note": "Shared docs — live here only"},
      {"id": "1b000000-0000-4000-8000-00000000000e", "text": "Foundation: confirm & brief 3 referees (Ilya / Ersa / Syaiful)", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated", "note": "Shared docs — live here only"},
      {"id": "1b000000-0000-4000-8000-00000000000f", "text": "Foundation: draft core study-plan / contribution narrative", "done": false, "status": "not-started", "escalateTo": "none", "dateConfidence": "estimated", "note": "Shared docs — live here only"}
    ]'::jsonb)
where p.id = '10000000-0000-4000-8000-000000000006';
