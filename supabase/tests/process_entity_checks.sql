-- Standing checks for the entity-aware process schema (52, plus the form and
-- phase-track columns of 86) and the seeds: 51 SAMB, 53 ARBI, 61 KGR v0.2
-- (which replaced 60's v0.1), retracked to sourcing mode by 87 and joined by
-- the trading chain of 88. Same contract as integrity_checks.sql: every query
-- returns ZERO ROWS when healthy; a hit names what drifted. Read-only; no
-- secret needed beyond a connection that can select the os_process_* tables.
--
-- Run after applying 52 and any seed, and again any time a seed is re-run.

-- 1. Per-entity counts pinned by the seeds. A row here means a seed was
--    partially applied or hand-edited — find out which before re-running
--    anything.
select 'count drift: ' || entity_code || ' ' || what as problem
from (
  select 'SAMB' as entity_code, 'lanes'  as what, (select count(*) from public.os_process_lanes  where entity_code = 'SAMB') as n, 6  as expected
  union all select 'SAMB', 'phases', (select count(*) from public.os_process_phases where entity_code = 'SAMB'), 7
  union all select 'SAMB', 'gates',  (select count(*) from public.os_process_gates  where entity_code = 'SAMB'), 15
  union all select 'SAMB', 'steps',  (select count(*) from public.os_process_steps  where entity_code = 'SAMB'), 30
  union all select 'SAMB', 'needs',  (select count(*) from public.os_process_needs n join public.os_process_steps s on s.id = n.step_id where s.entity_code = 'SAMB'), 118
  -- 46, not the seed's 45: migration 20260806000056 records the SAMB 18b →
  -- `Sales — Logistic provider` pair that was applied live from another
  -- session. A cluster with the seed but without 56 reports 45 here, and that
  -- is a real drift worth a row — it means the replay is incomplete.
  union all select 'SAMB', 'bridge', (select count(*) from public.os_process_step_items i join public.os_process_steps s on s.id = i.step_id where s.entity_code = 'SAMB'), 46
  union all select 'ARBI', 'lanes',  (select count(*) from public.os_process_lanes  where entity_code = 'ARBI'), 6
  union all select 'ARBI', 'phases', (select count(*) from public.os_process_phases where entity_code = 'ARBI'), 7
  union all select 'ARBI', 'gates',  (select count(*) from public.os_process_gates  where entity_code = 'ARBI'), 12
  union all select 'ARBI', 'steps',  (select count(*) from public.os_process_steps  where entity_code = 'ARBI'), 23
  union all select 'ARBI', 'needs',  (select count(*) from public.os_process_needs n join public.os_process_steps s on s.id = n.step_id where s.entity_code = 'ARBI'), 112
  union all select 'ARBI', 'bridge', (select count(*) from public.os_process_step_items i join public.os_process_steps s on s.id = i.step_id where s.entity_code = 'ARBI'), 37
  union all select 'KGR',  'lanes',  (select count(*) from public.os_process_lanes  where entity_code = 'KGR'), 9
  -- Ten default-ribbon phases (track null) and five TRADING-scoped ones (88).
  union all select 'KGR',  'phases (default)', (select count(*) from public.os_process_phases where entity_code = 'KGR' and track is null), 10
  union all select 'KGR',  'phases (TRADING)', (select count(*) from public.os_process_phases where entity_code = 'KGR' and track = 'TRADING'), 5
  union all select 'KGR',  'gates',  (select count(*) from public.os_process_gates  where entity_code = 'KGR'), 42
  -- 48 = the 38-step slaughter chain (RPA 25 + KEDUANYA 13 since the 87
  -- retrack) + the 10-step trading chain of 88.
  union all select 'KGR',  'steps',  (select count(*) from public.os_process_steps  where entity_code = 'KGR'), 48
  union all select 'KGR',  'steps RPA',      (select count(*) from public.os_process_steps where entity_code = 'KGR' and track = 'RPA'), 25
  union all select 'KGR',  'steps TRADING',  (select count(*) from public.os_process_steps where entity_code = 'KGR' and track = 'TRADING'), 10
  union all select 'KGR',  'steps KEDUANYA', (select count(*) from public.os_process_steps where entity_code = 'KGR' and track = 'KEDUANYA'), 13
  -- The four excursion steps keep KARKAS/OLAHAN as FORM chips since 87.
  union all select 'KGR',  'forms vocabulary', (select count(*) from public.os_process_forms where entity_code = 'KGR'), 2
  union all select 'KGR',  'steps with form',  (select count(*) from public.os_process_steps  where entity_code = 'KGR' and form is not null), 4
  -- 130 = the v0.2 seed's 117 + the trading chain's 13. LIVE reads 135: the
  -- five decision needs of kgr_decision_needs exist only in the live ledger,
  -- so against live this line reports a drift of exactly five — known, named
  -- here, and not a defect of either side.
  union all select 'KGR',  'needs',  (select count(*) from public.os_process_needs n join public.os_process_steps s on s.id = n.step_id where s.entity_code = 'KGR'), 130
  -- 0 is a pin, not a placeholder: KGR's bridge is deliberately absent until
  -- the poultry rows exist (Kelompok 2 of the reconciliation). A non-zero
  -- here before that decision means someone authored edges out of order.
  union all select 'KGR',  'bridge', (select count(*) from public.os_process_step_items i join public.os_process_steps s on s.id = i.step_id where s.entity_code = 'KGR'), 0
) t
where n <> expected;

-- 2. The per-entity label unique must exist and the global one must not.
--    A hit on the first line means 52 was not applied (ARBI cannot seed);
--    a hit on the second means someone restored the pre-52 shape while two
--    entities' rows were present — which should be impossible, so find out
--    how before touching anything.
select 'unique (entity_code, label) missing' as problem
where not exists (
  select 1 from pg_constraint c
  where c.conrelid = 'public.os_process_steps'::regclass and c.contype = 'u'
    and (select array_agg(a.attname::text order by k.ord)
         from unnest(c.conkey) with ordinality as k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
        = array['entity_code', 'label']
);
select 'global unique (label) still present' as problem
where exists (
  select 1 from pg_constraint c
  where c.conrelid = 'public.os_process_steps'::regclass and c.contype = 'u'
    and (select array_agg(a.attname::text order by k.ord)
         from unnest(c.conkey) with ordinality as k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
        = array['label']
);

-- 3. No duplicate label inside one entity. The constraint makes this
--    impossible; a hit means the constraint itself is gone.
select 'duplicate label in ' || entity_code || ': ' || label as problem
from public.os_process_steps
group by entity_code, label
having count(*) > 1;

-- 4. Every step's track belongs to its own entity's vocabulary, and every
--    entity with steps has exactly one shared track. The FK enforces the
--    first; the second is convention the frontend leans on (the shared
--    track joins every walk).
select 'track outside vocabulary: ' || s.entity_code || ' ' || s.label as problem
from public.os_process_steps s
left join public.os_process_tracks t
  on t.entity_code = s.entity_code and t.code = s.track
where t.code is null;
-- Same guarantee for the second axis: a step's form, when it carries one,
-- belongs to its own entity's form vocabulary (FK-enforced; a hit means the
-- constraint is gone).
select 'form outside vocabulary: ' || s.entity_code || ' ' || s.label as problem
from public.os_process_steps s
left join public.os_process_forms f
  on f.entity_code = s.entity_code and f.code = s.form
where s.form is not null and f.code is null;
select 'shared-track count for ' || entity_code || ' is ' || n as problem
from (
  select s.entity_code, count(*) filter (where t.is_shared) as n
  from (select distinct entity_code from public.os_process_steps) s
  join public.os_process_tracks t on t.entity_code = s.entity_code
  group by s.entity_code
) t
where n <> 1;

-- 5. Two ribbon invariants since 86 split them. DEFAULT (track null) phases
--    tile 1..max(slot) exactly once per entity: total covered slots equals
--    max slot, no overlaps, min starts at 1.
select 'phase tiling broken for ' || entity_code as problem
from (
  select p.entity_code,
         sum(p.slot_to - p.slot_from + 1) as covered,
         min(p.slot_from) as first_slot,
         (select max(s.slot) from public.os_process_steps s
          where s.entity_code = p.entity_code) as highest
  from public.os_process_phases p
  where p.track is null
  group by p.entity_code
) t
where covered <> highest or first_slot <> 1;
select 'phase overlap in ' || a.entity_code || ': ' || a.name || ' × ' || b.name as problem
from public.os_process_phases a
join public.os_process_phases b
  on a.entity_code = b.entity_code and a.id < b.id
 and a.track is null and b.track is null
 and a.slot_from <= b.slot_to and b.slot_from <= a.slot_to;

-- 5b. TRACK-SCOPED phases must not overlap each other WITHIN their track,
--     and must cover every slot that carries a step reachable on that track
--     (the track's own steps plus the shared spine). They need not tile —
--     a gap over unreachable slots is a true statement that the walk jumps.
select 'scoped phase overlap in ' || a.entity_code || ' ' || a.track || ': ' || a.name || ' × ' || b.name as problem
from public.os_process_phases a
join public.os_process_phases b
  on a.entity_code = b.entity_code and a.track = b.track and a.id < b.id
 and a.slot_from <= b.slot_to and b.slot_from <= a.slot_to
where a.track is not null;
select 'scoped ribbon misses reachable slot: ' || t.entity_code || ' ' || t.track || ' slot ' || t.slot as problem
from (
  select distinct p.entity_code, p.track, s.slot
  from public.os_process_phases p
  join public.os_process_steps s
    on s.entity_code = p.entity_code
   and (s.track = p.track
        or s.track in (select code from public.os_process_tracks v
                       where v.entity_code = p.entity_code and v.is_shared))
  where p.track is not null
) t
where not exists (
  select 1 from public.os_process_phases p
  where p.entity_code = t.entity_code and p.track = t.track
    and t.slot between p.slot_from and p.slot_to
);

-- 6. Needs and bridge edges reach their steps (cascade makes orphans
--    impossible; a hit means the FK is gone).
select 'orphan need: ' || n.id as problem
from public.os_process_needs n
left join public.os_process_steps s on s.id = n.step_id
where s.id is null;
select 'orphan bridge edge: ' || i.step_id || ' → ' || i.item_id as problem
from public.os_process_step_items i
left join public.os_process_steps s on s.id = i.step_id
where s.id is null;
