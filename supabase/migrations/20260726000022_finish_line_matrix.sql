-- Finish line v3: the entity matrix.
--
-- The axis changes. Where the pack build had Function → Nature → Account with
-- one status per row, this has SECTION → LINE ITEM down and CONSOLIDATION
-- ENTITIES across, and the grain is the CELL: one (line item × entity) pair,
-- carrying a STATE, never a value.
--
-- THE NUMBERS NEVER ENTER THE APP. They live in the Excel pack. A cell that
-- has a number is recorded as the state `figure` and renders as the literal
-- `xxx`. There is not a single financial figure in this file, and none may be
-- added to it, to seed data, to fixtures, to tests, or to comments.
--
-- `figure` means A NUMBER EXISTS. It does NOT mean verified, agreed or
-- trusted. Nothing in this feature may claim verification — model output
-- cannot verify anything. There is deliberately NO sixth state for "a figure
-- exists but the methodology behind it is unreliable"; that is deferred, and
-- inventing one here would put a judgement in the schema that nobody has made.
--
-- The account level is GONE. There is no 529/441-account list any more.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`. This repo's filenames and the live ledger's versions are
-- different numbering schemes, so any of those replays the entire history from
-- 0001_schema.sql against live production data. Apply the statements below
-- through the Supabase apply_migration tool, and CHECK THE DATABASE afterwards
-- — committed is not applied.
--
-- NOT YET APPLIED AS OF THIS COMMIT. The session that wrote it had no Supabase
-- MCP tool and no database credentials attached, so it could not run anything
-- and does not claim to have. Replace this paragraph with the APPLIED line the
-- other migrations carry once it has actually run.
--
-- Idempotent throughout EXCEPT the backup-and-delete in section 4 and the seed
-- in section 5, which are guarded so a re-run cannot double-seed or destroy a
-- second time. Read those guards before re-running.

-- ---------------------------------------------------------------------------
-- 1. Row table — reuse os_finish_line_items
--
-- The pack-era columns (area, target_state, current_state, interim, status)
-- stay in place, nullable and unused. Dropping them is deferred cleanup, not
-- part of this change: a drop is irreversible and the backup in section 4 is
-- worth more while this shape is still settling.
-- ---------------------------------------------------------------------------

alter table public.os_finish_line_items
  add column if not exists unit  text,
  add column if not exists dp    smallint,
  add column if not exists agg   text,
  add column if not exists style text,
  add column if not exists flag  text,
  -- NOT in the brief's column list, and added deliberately: §6 requires the
  -- section header to render a tag ('butuh input' / 'terkunci' / 'akhir
  -- bulan') beside its title, and no existing column can hold it without
  -- overloading a pack-era field with a second meaning.
  add column if not exists tag   text;

-- Pack-era columns become genuinely optional. Without this, `status` keeps its
-- NOT NULL and every matrix row would have to carry a trust word that this
-- model no longer has an opinion about.
alter table public.os_finish_line_items alter column area   drop not null;
alter table public.os_finish_line_items alter column status drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_finish_line_items'::regclass
      and conname = 'os_finish_line_items_agg_check'
  ) then
    alter table public.os_finish_line_items
      add constraint os_finish_line_items_agg_check
      check (agg is null or agg in ('sum', 'weighted', 'recompute'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_finish_line_items'::regclass
      and conname = 'os_finish_line_items_style_check'
  ) then
    alter table public.os_finish_line_items
      add constraint os_finish_line_items_style_check
      check (style is null or style in ('det', 'sub', 'tot', 'lock', 'plain'));
  end if;
end
$$;

-- The `kind` check constraint is DISCOVERED BY NAME, never guessed. Migration
-- 20260726000021 created it inline, so its name is whatever Postgres chose;
-- reading pg_constraint is the only correct way to find it. Same pattern that
-- migration used for the primary key.
do $$
declare
  kind_con text;
begin
  select con.conname into kind_con
  from pg_constraint con
  where con.conrelid = 'public.os_finish_line_items'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%kind%';

  if kind_con is not null then
    execute format(
      'alter table public.os_finish_line_items drop constraint %I', kind_con
    );
  end if;

  -- EXTENDED, not replaced. 'block' and 'line' stay legal so the backup table
  -- in section 4 remains restorable into this table — a constraint that
  -- rejects the rows you backed up makes the backup decorative.
  alter table public.os_finish_line_items
    add constraint os_finish_line_items_kind_check
    check (kind in ('block', 'section', 'line', 'metric', 'note'));
end
$$;

comment on column public.os_finish_line_items.unit is
  'Display unit for the row (Rp jt, %, CBM, hari, ...). Never a value.';
comment on column public.os_finish_line_items.agg is
  'How a future aggregate column would compute: sum, weighted, or recompute. Nothing computes it today.';
comment on column public.os_finish_line_items.style is
  'Visual weight only: det = indented detail, sub = subtotal, tot = total with rules, lock = derived row, plain = normal.';
comment on column public.os_finish_line_items.flag is
  'Short code for a row-level anomaly, e.g. credit-balance-in-expense. Not a state.';
comment on column public.os_finish_line_items.tag is
  'Muted qualifier beside a section title (butuh input / terkunci / akhir bulan).';

-- ---------------------------------------------------------------------------
-- 2. Entities — the columns, as DATA
--
-- Never hardcoded in the frontend. The five below are the current
-- consolidation set; the column set grows to the wider entity universe later,
-- and when it does this table is the only thing that changes.
-- ---------------------------------------------------------------------------

create table if not exists public.os_finish_line_entities (
  code       text primary key,
  label      text not null,
  sort_order integer not null
);

comment on table public.os_finish_line_entities is
  'The matrix columns. The frontend reads this ordered by sort_order and never hardcodes a code — the entity set is expected to grow.';

-- ---------------------------------------------------------------------------
-- 3. Cells — the grain
-- ---------------------------------------------------------------------------

create table if not exists public.os_finish_line_cells (
  item_id     uuid not null references public.os_finish_line_items(id) on delete cascade,
  entity_code text not null references public.os_finish_line_entities(code),
  -- EXACTLY FIVE. figure = a number exists in Excel (NOT verified, NOT
  -- agreed); zero = reported nil / not applicable; undefined = mathematically
  -- undefined, zero divisor; input = needs an input that does not exist yet;
  -- locked = derived, will compute once its inputs land.
  state       text not null check (state in ('figure', 'zero', 'undefined', 'input', 'locked')),
  -- One line saying what is missing FOR THIS ENTITY. Payroll % is a figure for
  -- one entity and an input for two others for different reasons; without a
  -- per-cell note that difference has nowhere to live.
  note        text,
  updated_at  timestamptz not null default now(),
  primary key (item_id, entity_code)
);

create index if not exists os_finish_line_cells_entity_idx
  on public.os_finish_line_cells (entity_code);

comment on table public.os_finish_line_cells is
  'One cell = one (line item x entity) pair, carrying a STATE and never a value. The figures live in the Excel pack; a cell holding a number is recorded as `figure` and renders as the literal xxx.';
comment on column public.os_finish_line_cells.state is
  'figure means A NUMBER EXISTS — not verified, not agreed, not trusted. There is deliberately no state for "figure exists but methodology is unreliable".';

-- ---------------------------------------------------------------------------
-- 4. Bidirectional wiring — links can be cell-level
-- ---------------------------------------------------------------------------

alter table public.os_finish_line_item_projects
  add column if not exists entity_code text
    references public.os_finish_line_entities(code);

comment on column public.os_finish_line_item_projects.entity_code is
  'Null = the link is row-level (closes the line item for every entity). Set = the link closes one specific cell.';

-- ---------------------------------------------------------------------------
-- 5. RLS — the app-key policy every other table carries, copied verbatim
-- ---------------------------------------------------------------------------

alter table public.os_finish_line_entities enable row level security;
alter table public.os_finish_line_cells    enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'os_finish_line_entities'
      and policyname = 'require app key'
  ) then
    create policy "require app key" on public.os_finish_line_entities
      for all to anon, authenticated
      using (public.os_key_valid())
      with check (public.os_key_valid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'os_finish_line_cells'
      and policyname = 'require app key'
  ) then
    create policy "require app key" on public.os_finish_line_cells
      for all to anon, authenticated
      using (public.os_key_valid())
      with check (public.os_key_valid());
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Back up, then delete the pack rows
--
-- The backup is taken ONCE. If the table already exists this block does
-- nothing rather than overwriting a good backup with an already-emptied one —
-- re-running a destructive migration must not destroy the evidence of the
-- first run.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'private' and tablename = 'os_finish_line_items_backup_pack'
  ) then
    create table private.os_finish_line_items_backup_pack as
      select * from public.os_finish_line_items;
    revoke all on table private.os_finish_line_items_backup_pack
      from public, anon, authenticated;
  end if;
end
$$;

-- Link rows first. The FK cascades, but naming the delete makes the intent
-- explicit and leaves a row count in the output.
delete from public.os_finish_line_item_projects
where item_id in (
  select id from public.os_finish_line_items
  where kind in ('block', 'section', 'line')
);

delete from public.os_finish_line_items
where kind in ('block', 'section', 'line');

-- Hard stop. If anything pack-era survived, the seed below would land in a
-- half-old table and the matrix would render rows nobody can explain.
do $$
declare
  leftover integer;
begin
  select count(*) into leftover
  from public.os_finish_line_items
  where kind in ('block', 'section', 'line');
  if leftover <> 0 then
    raise exception 'Pack rows still present (%). Refusing to seed.', leftover;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Seed
--
-- Guarded: seeds only when the matrix is empty, so a second run is a no-op
-- rather than a duplicate matrix.
-- ---------------------------------------------------------------------------

insert into public.os_finish_line_entities (code, label, sort_order) values
  ('SAMB', 'SAMB', 1),
  ('ASI',  'ASI',  2),
  ('ARBI', 'ARBI', 3),
  ('KNI',  'KNI',  4),
  ('KDU',  'KDU',  5)
on conflict (code) do nothing;

do $$
begin
  if exists (select 1 from public.os_finish_line_items where kind = 'metric') then
    raise notice 'Matrix already seeded; skipping section 7.';
    return;
  end if;

  -- Sections -----------------------------------------------------------------
  insert into public.os_finish_line_items (item, kind, sort_order, tag) values
    ('Laba rugi',                       'section', 1, null),
    ('Margin layering & cost-to-serve', 'section', 2, null),
    ('Volume & capacity',               'section', 3, 'butuh input'),
    ('Unit economics',                  'section', 4, 'terkunci'),
    ('Working capital & liquidity',     'section', 5, 'akhir bulan');

  -- Metric rows --------------------------------------------------------------
  insert into public.os_finish_line_items
    (parent_id, item, kind, sort_order, unit, dp, agg, style, flag)
  select s.id, m.item, 'metric', m.ord, m.unit, m.dp, m.agg, m.style, m.flag
  from (values
    -- Section 1 — Laba rugi. unit Rp jt, dp 0, agg sum throughout.
    ('Laba rugi','Sales — B2B',                'det',  'Rp jt',0,'sum',      null, 1),
    ('Laba rugi','Sales — B2C',                'det',  'Rp jt',0,'sum',      null, 2),
    ('Laba rugi','Sales — Logistic provider',  'det',  'Rp jt',0,'sum',      null, 3),
    ('Laba rugi','Sales',                      'sub',  'Rp jt',0,'sum',      null, 4),
    ('Laba rugi','COGS — B2B',                 'det',  'Rp jt',0,'sum',      null, 5),
    ('Laba rugi','COGS — B2C',                 'det',  'Rp jt',0,'sum',      null, 6),
    ('Laba rugi','COGS — Logistic provider',   'det',  'Rp jt',0,'sum',      null, 7),
    ('Laba rugi','Cost of goods sold',         'sub',  'Rp jt',0,'sum',      null, 8),
    ('Laba rugi','Gross profit',               'tot',  'Rp jt',0,'sum',      null, 9),
    ('Laba rugi','Storing cost',               'sub',  'Rp jt',0,'sum',      null,10),
    ('Laba rugi','Distribution cost',          'sub',  'Rp jt',0,'sum',      null,11),
    ('Laba rugi','Commercials and support',    'sub',  'Rp jt',0,'sum','credit-balance-in-expense',12),
    ('Laba rugi','GA expenses',                'plain','Rp jt',0,'sum',      null,13),
    ('Laba rugi','Operating profit',           'tot',  'Rp jt',0,'sum',      null,14),
    ('Laba rugi','Finance income',             'plain','Rp jt',0,'sum',      null,15),
    ('Laba rugi','Finance expenses',           'plain','Rp jt',0,'sum',      null,16),
    ('Laba rugi','Other income',               'plain','Rp jt',0,'sum',      null,17),
    ('Laba rugi','Other expense',              'plain','Rp jt',0,'sum',      null,18),
    ('Laba rugi','Profit before tax',          'tot',  'Rp jt',0,'sum',      null,19),
    ('Laba rugi','Income tax expense',         'plain','Rp jt',0,'sum',      null,20),
    ('Laba rugi','Net profit for the year',    'tot',  'Rp jt',0,'sum',      null,21),

    -- Section 2 — Margin layering & cost-to-serve. unit %, dp 1, agg recompute.
    ('Margin layering & cost-to-serve','GP margin',                       'plain','%',1,'recompute',null, 1),
    ('Margin layering & cost-to-serve','Storing cost',                    'plain','%',1,'recompute',null, 2),
    ('Margin layering & cost-to-serve','Distribution cost',               'plain','%',1,'recompute',null, 3),
    ('Margin layering & cost-to-serve','Cost-to-serve',                   'sub',  '%',1,'recompute',null, 4),
    ('Margin layering & cost-to-serve','Layer-1 contribution',            'sub',  '%',1,'recompute',null, 5),
    ('Margin layering & cost-to-serve','Payroll',                         'plain','%',1,'recompute',null, 6),
    ('Margin layering & cost-to-serve','Commercials and support',         'plain','%',1,'recompute','credit-balance-in-expense', 7),
    ('Margin layering & cost-to-serve','G&A excl. payroll',               'plain','%',1,'recompute',null, 8),
    ('Margin layering & cost-to-serve','OP margin',                       'tot',  '%',1,'recompute',null, 9),
    ('Margin layering & cost-to-serve','NPAT margin',                     'plain','%',1,'recompute',null,10),
    ('Margin layering & cost-to-serve','Share of consolidated net sales', 'tot',  '%',1,'recompute',null,11),

    -- Section 3 — Volume & capacity.
    ('Volume & capacity','Volume delivered',      'plain','CBM',  null,'sum',     null,1),
    ('Volume & capacity','Cartons delivered',     'plain','unit', null,'sum',     null,2),
    ('Volume & capacity','Delivery trips',        'plain','count',null,'sum',     null,3),
    ('Volume & capacity','Pallet positions used', 'plain','avg',  null,'weighted',null,4),

    -- Section 4 — Unit economics. Whole rows derived.
    ('Unit economics','Revenue / CBM',      'lock','IDR k',null,'recompute',null,1),
    ('Unit economics','Layer-1 / CBM',      'lock','IDR k',null,'recompute',null,2),
    ('Unit economics','Pallet utilisation', 'lock','%',    null,'recompute',null,3),

    -- Section 5 — Working capital & liquidity.
    -- `Cash conversion cycle` is style 'tot': the brief wrote "lock tot" but
    -- style holds one value, and its cells already carry `locked`, so the
    -- derived-ness is not lost by taking the total rules.
    ('Working capital & liquidity','Trade receivable',      'plain','Rp jt',null,'sum',      null,1),
    ('Working capital & liquidity','Inventories',           'plain','Rp jt',null,'sum',      null,2),
    ('Working capital & liquidity','Trade payable',         'plain','Rp jt',null,'sum',      null,3),
    ('Working capital & liquidity','DSO',                   'lock', 'hari', null,'recompute',null,4),
    ('Working capital & liquidity','DIO',                   'lock', 'hari', null,'recompute',null,5),
    ('Working capital & liquidity','DPO',                   'lock', 'hari', null,'recompute',null,6),
    ('Working capital & liquidity','Cash conversion cycle', 'tot',  'hari', null,'recompute',null,7),
    ('Working capital & liquidity','Cash & equivalents',    'plain','Rp jt',null,'sum',      null,8)
  ) as m(section, item, style, unit, dp, agg, flag, ord)
  join public.os_finish_line_items s
    on s.kind = 'section' and s.item = m.section;

  -- The note row in Section 4 — no cells, by design.
  insert into public.os_finish_line_items (parent_id, item, kind, sort_order)
  select s.id, '+ 9 metrik lain menunggu isi per karton per SKU', 'note', 99
  from public.os_finish_line_items s
  where s.kind = 'section' and s.item = 'Unit economics';

  -- Cells, sections 1, 2 and 5 -----------------------------------------------
  -- Written one row per line item and unpivoted across the five entities, so
  -- the states read in the same column order as the source table.
  insert into public.os_finish_line_cells (item_id, entity_code, state)
  select i.id, e.code, e.state
  from (values
    ('Laba rugi','Sales — B2B',               'figure','figure','zero',  'zero',  'zero'),
    ('Laba rugi','Sales — B2C',               'zero',  'zero',  'figure','zero',  'zero'),
    ('Laba rugi','Sales — Logistic provider', 'figure','figure','figure','zero',  'zero'),
    ('Laba rugi','Sales',                     'figure','figure','figure','zero',  'zero'),
    ('Laba rugi','COGS — B2B',                'figure','figure','zero',  'zero',  'zero'),
    ('Laba rugi','COGS — B2C',                'zero',  'figure','figure','zero',  'zero'),
    ('Laba rugi','COGS — Logistic provider',  'zero',  'figure','figure','zero',  'zero'),
    ('Laba rugi','Cost of goods sold',        'figure','figure','figure','zero',  'zero'),
    ('Laba rugi','Gross profit',              'figure','figure','figure','zero',  'zero'),
    ('Laba rugi','Storing cost',              'figure','figure','figure','figure','zero'),
    ('Laba rugi','Distribution cost',         'figure','figure','figure','figure','zero'),
    ('Laba rugi','Commercials and support',   'figure','figure','figure','figure','zero'),
    ('Laba rugi','GA expenses',               'figure','figure','figure','figure','zero'),
    ('Laba rugi','Operating profit',          'figure','figure','figure','figure','zero'),
    ('Laba rugi','Finance income',            'figure','figure','figure','zero',  'zero'),
    ('Laba rugi','Finance expenses',          'figure','figure','figure','zero',  'zero'),
    ('Laba rugi','Other income',              'figure','figure','figure','zero',  'zero'),
    ('Laba rugi','Other expense',             'figure','figure','figure','zero',  'zero'),
    ('Laba rugi','Profit before tax',         'figure','figure','figure','figure','zero'),
    ('Laba rugi','Income tax expense',        'figure','figure','zero',  'zero',  'zero'),
    ('Laba rugi','Net profit for the year',   'figure','figure','figure','figure','zero'),

    ('Margin layering & cost-to-serve','GP margin',                      'figure','figure','figure','undefined','undefined'),
    ('Margin layering & cost-to-serve','Storing cost',                   'figure','figure','figure','undefined','undefined'),
    ('Margin layering & cost-to-serve','Distribution cost',              'figure','figure','figure','undefined','undefined'),
    ('Margin layering & cost-to-serve','Cost-to-serve',                  'figure','figure','figure','undefined','undefined'),
    ('Margin layering & cost-to-serve','Layer-1 contribution',           'figure','figure','figure','undefined','undefined'),
    ('Margin layering & cost-to-serve','Payroll',                        'figure','input', 'input', 'undefined','undefined'),
    ('Margin layering & cost-to-serve','Commercials and support',        'figure','figure','figure','undefined','undefined'),
    ('Margin layering & cost-to-serve','G&A excl. payroll',              'figure','input', 'input', 'undefined','undefined'),
    ('Margin layering & cost-to-serve','OP margin',                      'figure','figure','figure','undefined','undefined'),
    ('Margin layering & cost-to-serve','NPAT margin',                    'figure','figure','figure','undefined','undefined'),
    ('Margin layering & cost-to-serve','Share of consolidated net sales','figure','figure','figure','zero',     'zero'),

    ('Working capital & liquidity','Trade receivable',      'input', 'input', 'input', 'input',    'input'),
    ('Working capital & liquidity','Inventories',           'input', 'input', 'input', 'input',    'input'),
    ('Working capital & liquidity','Trade payable',         'input', 'input', 'input', 'input',    'input'),
    ('Working capital & liquidity','DSO',                   'locked','locked','locked','undefined','undefined'),
    ('Working capital & liquidity','DIO',                   'locked','locked','locked','undefined','undefined'),
    ('Working capital & liquidity','DPO',                   'locked','locked','locked','undefined','undefined'),
    ('Working capital & liquidity','Cash conversion cycle', 'locked','locked','locked','undefined','undefined'),
    ('Working capital & liquidity','Cash & equivalents',    'input', 'input', 'input', 'input',    'input')
  ) as m(section, item, samb, asi, arbi, kni, kdu)
  join public.os_finish_line_items s on s.kind = 'section' and s.item = m.section
  join public.os_finish_line_items i on i.parent_id = s.id and i.item = m.item
  cross join lateral (values
    ('SAMB', m.samb), ('ASI', m.asi), ('ARBI', m.arbi), ('KNI', m.kni), ('KDU', m.kdu)
  ) as e(code, state);

  -- Cells, sections 3 and 4 — uniform state across every entity.
  insert into public.os_finish_line_cells (item_id, entity_code, state)
  select i.id, en.code,
         case when s.item = 'Volume & capacity' then 'input' else 'locked' end
  from public.os_finish_line_items s
  join public.os_finish_line_items i on i.parent_id = s.id and i.kind = 'metric'
  cross join public.os_finish_line_entities en
  where s.kind = 'section' and s.item in ('Volume & capacity', 'Unit economics');

  -- The three per-cell notes. These are the REASON the state is what it is,
  -- and they are the only free text in the seed.
  update public.os_finish_line_cells c
  set note = n.note
  from (values
    ('Laba rugi','COGS — Logistic provider','SAMB',
     'Sales-LP ada, COGS-LP nil — cost belum dipisah dari Distribution cost, atau belum dicost sama sekali.'),
    ('Laba rugi','Income tax expense','ARBI',
     'PBT positif, provisi nil. Sejalan dengan pola BMG: angsuran dibukukan sebagai aset tanpa provisi.'),
    ('Laba rugi','Storing cost','ARBI',
     'Rasio terhadap sales tidak kredibel — cost-category gap ASI/ARBI, bukan efisiensi.')
  ) as n(section, item, entity, note)
  join public.os_finish_line_items s on s.kind = 'section' and s.item = n.section
  join public.os_finish_line_items i on i.parent_id = s.id and i.item = n.item
  where c.item_id = i.id and c.entity_code = n.entity;
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Verification — run these after applying and read the numbers.
--
--   select count(*) from public.os_finish_line_items where kind in ('block','section','line');
--     -> 0        (the pack rows are gone)
--   select count(*) from public.os_finish_line_items where kind = 'section';
--     -> 5
--   select count(*) from public.os_finish_line_items where kind = 'metric';
--     -> 47
--   select count(*) from public.os_finish_line_cells;
--     -> 235      (47 metric rows x 5 entities; the note row has no cells)
--   select state, count(*) from public.os_finish_line_cells group by state;
--     -> only figure / zero / undefined / input / locked
--   select count(*) from private.os_finish_line_items_backup_pack;
--     -> 60       (8 blocks + 52 sections, as they were before the delete)
--
-- A metric row silently missing an entity shows up as a cell count below 235.
-- ---------------------------------------------------------------------------
