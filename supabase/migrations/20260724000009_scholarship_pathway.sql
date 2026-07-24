-- v4 Part C: enrich the four existing scholarship GROWTH projects (Chevening,
-- IELTS, LPDP, Uni Applications) with start/deadline dates and a full
-- milestone pathway. Updates existing rows by id — never creates duplicates.
--
-- Date rule: only the IELTS test date (2026-09-20) is firm. Every other date
-- is a PLACEHOLDER; those milestones carry "(TBC)" in their note because the
-- bodies have not published final 2027 dates. Placeholder project deadlines
-- are set so the GROWTH Gantt can still draw a comparable bar per initiative.
--
-- Idempotent + non-clobbering: each UPDATE is guarded by NOT EXISTS on that
-- pathway's sentinel milestone id, so a re-run (or a project the owner has
-- since edited by hand) is skipped rather than overwritten.

-- IELTS (id ...002) — test date firm.
update public.os_projects
set start_date = '2026-06-28',
    deadline = '2026-09-20',
    milestones = '[
      {"id": "18000000-0000-4000-8000-000000000001", "text": "IELTS preparation", "done": false, "status": "in-progress", "escalateTo": "none"},
      {"id": "18000000-0000-4000-8000-000000000002", "text": "IELTS test", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-09-20", "note": "Firm date"},
      {"id": "18000000-0000-4000-8000-000000000003", "text": "IELTS results released", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC) ~2 weeks after the test"}
    ]'::jsonb
where id = '10000000-0000-4000-8000-000000000002'
  and not exists (
    select 1 from jsonb_array_elements(milestones) m
    where m ->> 'id' = '18000000-0000-4000-8000-000000000001'
  );

-- LPDP (id ...007) — Tahap 1, all dates TBC.
update public.os_projects
set start_date = '2026-08-01',
    deadline = '2026-11-30',
    milestones = '[
      {"id": "19000000-0000-4000-8000-000000000001", "text": "Biodata diri", "done": false, "status": "not-started", "escalateTo": "none", "note": "Tahap 1, dates TBC"},
      {"id": "19000000-0000-4000-8000-000000000002", "text": "KTP", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-000000000003", "text": "Scan ijazah S1 (+ sworn translation)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-000000000004", "text": "Scan transkrip", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-000000000005", "text": "Sertifikat IELTS", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-000000000006", "text": "Surat rekomendasi (Ilya / Ersa / Syaiful)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-000000000007", "text": "Surat pernyataan", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-000000000008", "text": "Profil diri", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-000000000009", "text": "Personal statement", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-00000000000a", "text": "Esai Komitmen / Kontribusi", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-00000000000b", "text": "Publikasi / prestasi / organisasi", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "19000000-0000-4000-8000-00000000000c", "text": "LoA Unconditional (optional)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC) optional"},
      {"id": "19000000-0000-4000-8000-00000000000d", "text": "Submit before deadline", "done": false, "status": "not-started", "escalateTo": "none", "note": "Tahap 1, dates TBC"}
    ]'::jsonb
where id = '10000000-0000-4000-8000-000000000007'
  and not exists (
    select 1 from jsonb_array_elements(milestones) m
    where m ->> 'id' = '19000000-0000-4000-8000-000000000001'
  );

-- Chevening 2027-28 (id ...001) — dates ~ placeholders.
update public.os_projects
set start_date = '2026-08-01',
    deadline = '2026-10-06',
    milestones = '[
      {"id": "1a000000-0000-4000-8000-000000000001", "text": "Online application (ASAMS)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-000000000002", "text": "Work history — 2,800 hrs", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-000000000003", "text": "Three UK course choices", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-000000000004", "text": "Essay 1 — Leadership & influence", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-000000000005", "text": "Essay 2 — Networking", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-000000000006", "text": "Essay 3 — Studying in the UK", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-000000000007", "text": "Essay 4 — Career plan", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-000000000008", "text": "Two referees", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-000000000009", "text": "Reference letters (if shortlisted)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-00000000000a", "text": "Passport / ID (if shortlisted)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-00000000000b", "text": "Degree certificate (if shortlisted)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1a000000-0000-4000-8000-00000000000c", "text": "Unconditional UK offer", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"}
    ]'::jsonb
where id = '10000000-0000-4000-8000-000000000001'
  and not exists (
    select 1 from jsonb_array_elements(milestones) m
    where m ->> 'id' = '1a000000-0000-4000-8000-000000000001'
  );

-- Uni Applications (id ...006) — Imperial + Edinburgh + Foundation (single-
-- owner docs live here only). Dates ~ placeholders.
update public.os_projects
set start_date = '2026-08-01',
    deadline = '2026-10-15',
    milestones = '[
      {"id": "1b000000-0000-4000-8000-000000000001", "text": "Imperial: essays (career / why / values + quant statement)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-000000000002", "text": "Imperial: assemble application (CV, transcript)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-000000000003", "text": "Imperial: submit — Round 1", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-09-28", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-000000000004", "text": "Imperial: video interview (async)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-000000000005", "text": "Imperial: decision R1", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-11-26", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-000000000006", "text": "Imperial: convert + deposit / defer", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-000000000007", "text": "Edinburgh: personal statement (~500w, 3 prompts)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-000000000008", "text": "Edinburgh: submit — Round 1 (EUCLID)", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-10-15", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-000000000009", "text": "Edinburgh: decision R1", "done": false, "status": "not-started", "escalateTo": "none", "dueDate": "2026-12-04", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-00000000000a", "text": "Edinburgh: meet conditions + deposit / defer", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC)"},
      {"id": "1b000000-0000-4000-8000-00000000000b", "text": "Foundation: gather degree certificate & transcript", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC) shared docs — live here only"},
      {"id": "1b000000-0000-4000-8000-00000000000c", "text": "Foundation: sworn English translation", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC) shared docs — live here only"},
      {"id": "1b000000-0000-4000-8000-00000000000d", "text": "Foundation: update CV (+ Imperial template)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC) shared docs — live here only"},
      {"id": "1b000000-0000-4000-8000-00000000000e", "text": "Foundation: confirm & brief 3 referees (Ilya / Ersa / Syaiful)", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC) shared docs — live here only"},
      {"id": "1b000000-0000-4000-8000-00000000000f", "text": "Foundation: draft core study-plan / contribution narrative", "done": false, "status": "not-started", "escalateTo": "none", "note": "(TBC) shared docs — live here only"}
    ]'::jsonb
where id = '10000000-0000-4000-8000-000000000006'
  and not exists (
    select 1 from jsonb_array_elements(milestones) m
    where m ->> 'id' = '1b000000-0000-4000-8000-000000000001'
  );
