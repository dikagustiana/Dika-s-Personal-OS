-- ===========================================================================
-- KGR RETRACKED: THE FILTER AXIS BECOMES SOURCING MODE. DATA ONLY, KGR ONLY.
-- ===========================================================================
-- The chain documented today is the RPHU line: buy live bird → slaughter →
-- split-off → joint costing → sell. The business running today is TRADING —
-- buy the finished good when an order needs it. Trading shares 13 of 38
-- steps and skips 24, including the entire costing block; the old branch
-- axis (KARKAS/OLAHAN) separates 4 of 38. The axis that partitions the
-- chain takes the filter; the axis that touches four boxes becomes the form
-- chip that 20260820000086 created the vocabulary for.
--
-- STEP ASSIGNMENT IS THE OWNER'S, taken verbatim from the sourcing-split
-- brief:
--   KEDUANYA (13): slots 6, 18, 25, 26, 27, 28, 32, 33, 34, 35, 36, 37, 38
--     — AP/accrual · daily stock movement & FIFO · order intake through
--     invoice · AR through collection · three-way match and payment ·
--     cut-off, reconciliation, reporting.
--   RPA (25): slots 1–5, 7–17, 19–24, 29–31.
--   form on exactly four, which also move to RPA: 14 OLAHAN · 15 OLAHAN ·
--     17 KARKAS · 21 OLAHAN.
--
-- JUDGEMENT CALLS FLAGGED IN THE PR, NOT BURIED HERE: slots 29–31 (EOD
-- fresh count, blast-freeze decision, blast freeze + applied Pool B) are RPA
-- on the reading that bought goods arrive already in their final state — if
-- traded stock is ever blast-frozen, 31 becomes shared and the Pool B
-- denominator question goes live. Slot 6 stays shared: AP for live bird and
-- AP for finished goods are the same treatment off different source
-- documents, so trading gets no AP step of its own.
--
-- TEXT FIDELITY: track and form are STRUCTURAL columns, not seed text. The
-- PR body states the canonical md5 over every text field (excluding
-- track/form) before and after this file — they must be identical — and
-- re-baselines the full hash that includes track/form, old and new values
-- both stated. A silently updated fidelity hash is worse than no hash.
--
-- One-shot by nature (the guard refuses any state but the expected
-- pre-state), applied to live via apply_migration as kgr_retrack_sourcing;
-- this file records it. NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit`.
--
-- Down-migration:
-- supabase/migrations/down/20260820000087_kgr_retrack_sourcing_down.sql

-- 0. Guard: exactly the v0.2 pre-state, or refuse. -----------------------------
do $$
declare
  n_steps integer;
  n_karkas integer;
  n_olahan integer;
  n_trading integer;
begin
  select count(*) into n_steps from public.os_process_steps where entity_code = 'KGR';
  select count(*) into n_karkas from public.os_process_steps where entity_code = 'KGR' and track = 'KARKAS';
  select count(*) into n_olahan from public.os_process_steps where entity_code = 'KGR' and track = 'OLAHAN';
  select count(*) into n_trading from public.os_process_steps where entity_code = 'KGR' and track = 'TRADING';
  if n_steps <> 38 or n_karkas <> 1 or n_olahan <> 3 or n_trading <> 0 then
    raise exception
      'Retrack menolak jalan: KGR tidak pada pra-state v0.2 yang diharapkan (38 step, KARKAS 1, OLAHAN 3, TRADING 0) — ditemukan % step, KARKAS %, OLAHAN %, TRADING %. Periksa dulu apa yang berubah.',
      n_steps, n_karkas, n_olahan, n_trading;
  end if;
end
$$;

-- 1. The new vocabulary lands beside the old (no unique on ordinal, so the
--    overlap during the swap is legal).
insert into public.os_process_tracks (entity_code, code, label, ordinal, is_shared) values
  ('KGR', 'RPA', 'RPA', 1, false),
  ('KGR', 'TRADING', 'TRADING', 2, false)
on conflict (entity_code, code) do nothing;

-- 2. Form first, while the old track values still say which step is which.
update public.os_process_steps
   set form = 'OLAHAN'
 where entity_code = 'KGR' and slot in (14, 15, 21);

update public.os_process_steps
   set form = 'KARKAS'
 where entity_code = 'KGR' and slot = 17;

-- 3. The sourcing assignment. RPA by explicit slot list (the owner's), which
--    also moves the four form-carrying excursions off KARKAS/OLAHAN; the 13
--    shared slots are already KEDUANYA and stay put.
update public.os_process_steps
   set track = 'RPA'
 where entity_code = 'KGR'
   and slot in (1,2,3,4,5, 7,8,9,10,11,12,13,14,15,16,17, 19,20,21,22,23,24, 29,30,31);

-- 4. The old branch vocabulary goes, its meaning already living in
--    os_process_forms. The FK on steps makes a missed reassignment a loud
--    constraint violation here, not a silent leftover.
delete from public.os_process_tracks
 where entity_code = 'KGR' and code in ('KARKAS', 'OLAHAN');

-- 5. Post-conditions, asserted — the numbers G1 checks, refused in-transaction
--    rather than discovered later.
do $$
declare
  n_rpa integer;
  n_shared integer;
  n_form integer;
  n_tracks integer;
begin
  select count(*) into n_rpa from public.os_process_steps where entity_code = 'KGR' and track = 'RPA';
  select count(*) into n_shared from public.os_process_steps where entity_code = 'KGR' and track = 'KEDUANYA';
  select count(*) into n_form from public.os_process_steps where entity_code = 'KGR' and form is not null;
  select count(*) into n_tracks from public.os_process_tracks where entity_code = 'KGR';
  if n_rpa <> 25 or n_shared <> 13 or n_form <> 4 or n_tracks <> 3 then
    raise exception
      'Retrack gagal post-condition: RPA % (harus 25), KEDUANYA % (harus 13), form % (harus 4), track KGR % (harus 3 — RPA, TRADING, KEDUANYA).',
      n_rpa, n_shared, n_form, n_tracks;
  end if;
end
$$;
