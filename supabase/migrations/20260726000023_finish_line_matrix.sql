-- Finish line: the entity matrix.
--
-- Section → line item down, consolidation entities across. The grain is the
-- CELL: one (line item x entity) pair, carrying a STATE and never a value.
--
-- THE NUMBERS NEVER ENTER THE APP. They live in the Excel pack. A cell that
-- has a number is recorded as `figure` and renders as the literal `xxx`. There
-- is not one financial figure in this file and none may be added.
--
-- `figure` means A NUMBER EXISTS. It does NOT mean verified, agreed or
-- trusted. Nothing in this feature may claim verification.
--
-- A CELL'S STATE MAY ONLY EVER CHANGE THROUGH A DIRECT HUMAN EDIT. No
-- inference, no rollup, no linked-milestone completion writes it — see
-- src/data/finishLineGuards.ts, which enforces that in the mutation path
-- rather than in the UI. Where the rollup thinks a state is wrong it raises a
-- `contradiction` for a human and stops.
--
-- The account level is gone. There is no 529- or 441-account list any more.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`. This repo's filenames and the live ledger's versions are
-- different numbering schemes, so any of those replays the entire history from
-- 0001_schema.sql against live production data.
--
-- NOT APPLIED. The session that wrote this had full repo access and NO
-- database access, so it could not run anything and does not claim to have.
-- Apply this file FIRST, then 20260726000024_finish_line_views.sql.
--
-- THIS REPLACES 20260726000022_finish_line_matrix.sql, which landed on main
-- from the superseded v3 build and was never applied. That file is DELETED in
-- the same change rather than left beside this one: both create the matrix,
-- and applying 22 first would leave a cells table with no `id` column, no
-- derivation-edge table, and a seed guard that would then make this file skip
-- its own seed. If 22 HAS somehow been applied to your database, stop and say
-- so before running this — the reconciliation is different.
--
-- Idempotent except the backup-and-delete in section 6 and the seed in section
-- 7, both of which are guarded so a re-run cannot double-seed or destroy
-- twice. Read those guards before re-running.

-- ---------------------------------------------------------------------------
-- 1. Row table — reuse os_finish_line_items
--
-- The pack-era columns (area, target_state, current_state, interim, status)
-- stay in place, nullable and unused. Dropping them is deferred cleanup.
-- ---------------------------------------------------------------------------

alter table public.os_finish_line_items
  add column if not exists unit  text,
  add column if not exists dp    smallint,
  add column if not exists agg   text,
  add column if not exists style text,
  add column if not exists flag  text,
  -- Not in the brief's column list, added deliberately: the section header
  -- renders a tag ('butuh input' / 'terkunci' / 'akhir bulan') beside its
  -- title, and no existing column can hold it without overloading a pack-era
  -- field with a second meaning.
  add column if not exists tag   text;

-- Pack-era columns become genuinely optional. Without this, `status` keeps its
-- NOT NULL and every matrix row would carry a trust word this model has no
-- opinion about.
alter table public.os_finish_line_items alter column area   drop not null;
alter table public.os_finish_line_items alter column status drop not null;

-- THE `kind` CONSTRAINT NAME IS READ FROM THE MIGRATION FILES, NOT GUESSED.
-- 20260726000021_finish_line_pack.sql adds it as an inline, unnamed column
-- check:
--     add column if not exists kind text not null default 'line'
--       check (kind in ('block', 'section', 'line'));
-- An unnamed check on column `kind` of table `os_finish_line_items` is named
-- by Postgres as <table>_<column>_check, i.e. os_finish_line_items_kind_check.
-- The `drop ... if exists` below therefore names it directly; the catalog
-- sweep after it is belt and braces for a database where an earlier hand-edit
-- left the constraint under a different name.
alter table public.os_finish_line_items
  drop constraint if exists os_finish_line_items_kind_check;

do $$
declare
  leftover text;
begin
  for leftover in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.os_finish_line_items'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format(
      'alter table public.os_finish_line_items drop constraint %I', leftover
    );
  end loop;
end
$$;

-- EXTENDED, not replaced. 'block' and 'line' stay legal so the backup table in
-- section 6 remains restorable into this table — a constraint that rejects the
-- rows you backed up makes the backup decorative.
alter table public.os_finish_line_items
  add constraint os_finish_line_items_kind_check
  check (kind in ('block', 'section', 'line', 'metric', 'note'));

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

comment on column public.os_finish_line_items.unit is
  'Display unit (Rp jt, %, CBM, hari). Never a value.';
comment on column public.os_finish_line_items.agg is
  'How a future aggregate column would compute. Nothing computes it today.';
comment on column public.os_finish_line_items.style is
  'Visual weight only: det/sub/tot/lock/plain.';
comment on column public.os_finish_line_items.flag is
  'Short code for a row-level anomaly, e.g. credit-balance-in-expense. Not a state.';

-- ---------------------------------------------------------------------------
-- 2. Entities — the columns, as DATA
-- ---------------------------------------------------------------------------

create table if not exists public.os_finish_line_entities (
  code       text primary key,
  label      text not null,
  sort_order integer not null
);

comment on table public.os_finish_line_entities is
  'The matrix columns. The frontend reads this ordered by sort_order and never hardcodes a code — the entity set is expected to grow. Six entities (BMG, KGR, NMG, OKI, KBF, DNI) have projects but no column yet, and MAM is undecided.';

-- ---------------------------------------------------------------------------
-- 3. Cells — the grain
-- ---------------------------------------------------------------------------

create table if not exists public.os_finish_line_cells (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.os_finish_line_items(id) on delete cascade,
  entity_code text not null references public.os_finish_line_entities(code),
  -- EXACTLY FIVE, and there is deliberately no sixth for "a figure exists but
  -- the method behind it is unreliable" — that is deferred, not forgotten.
  state       text not null check (state in ('figure', 'zero', 'undefined', 'input', 'locked')),
  note        text,
  updated_at  timestamptz not null default now(),
  unique (item_id, entity_code)
);

create index if not exists os_finish_line_cells_item_idx
  on public.os_finish_line_cells (item_id);
create index if not exists os_finish_line_cells_entity_idx
  on public.os_finish_line_cells (entity_code);

comment on table public.os_finish_line_cells is
  'One cell = one (line item x entity) pair, carrying a STATE and never a value. state changes ONLY by direct human edit — no inference, no rollup, no milestone completion may write it.';

-- ---------------------------------------------------------------------------
-- 4. Derivation edges — a locked cell's inputs, within one entity column
-- ---------------------------------------------------------------------------

create table if not exists public.os_finish_line_deps (
  cell_id  uuid not null references public.os_finish_line_cells(id) on delete cascade,
  input_id uuid not null references public.os_finish_line_cells(id) on delete cascade,
  primary key (cell_id, input_id),
  check (cell_id <> input_id)
);

comment on table public.os_finish_line_deps is
  'Cell-to-cell derivation, same entity column. Cash conversion cycle depends on DSO/DIO/DPO which are themselves locked, so the rollup that reads this must be RECURSIVE with cycle protection. The self-edge check stops the trivial cycle only; longer ones are the reader''s problem.';

-- ---------------------------------------------------------------------------
-- 5. The road — which milestone closes which cell
-- ---------------------------------------------------------------------------

alter table public.os_finish_line_item_projects
  add column if not exists cell_id uuid
    references public.os_finish_line_cells(id) on delete cascade;

create index if not exists os_finish_line_item_projects_cell_idx
  on public.os_finish_line_item_projects (cell_id);

comment on column public.os_finish_line_item_projects.cell_id is
  'New edges write this. item_id stays for backwards compatibility. milestone_id remains nullable — a project-level link is allowed and sharpened later.';

-- RLS: the same app-key policy the finish-line tables already carry.
alter table public.os_finish_line_entities enable row level security;
alter table public.os_finish_line_cells    enable row level security;
alter table public.os_finish_line_deps     enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'os_finish_line_entities', 'os_finish_line_cells', 'os_finish_line_deps'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'require app key'
    ) then
      execute format(
        'create policy "require app key" on public.%I for all to anon, authenticated '
        'using (public.os_key_valid()) with check (public.os_key_valid())', t
      );
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Back up, then delete the 60 pack rows
--
-- The backup is taken ONCE. If the table exists this block does nothing rather
-- than overwriting a good backup with an already-emptied one.
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

delete from public.os_finish_line_item_projects
where item_id in (
  select id from public.os_finish_line_items where kind in ('block', 'section', 'line')
);

delete from public.os_finish_line_items where kind in ('block', 'section', 'line');

do $$
declare
  leftover integer;
begin
  select count(*) into leftover
  from public.os_finish_line_items where kind in ('block', 'section', 'line');
  if leftover <> 0 then
    raise exception 'Pack rows still present (%). Refusing to seed.', leftover;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Seed — guarded, so a second run is a no-op
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
    raise notice 'Matrix already seeded; skipping the seed.';
    return;
  end if;

  insert into public.os_finish_line_items (item, kind, sort_order, tag) values
    ('Laba rugi',                       'section', 1, null),
    ('Margin layering & cost-to-serve', 'section', 2, null),
    ('Volume & capacity',               'section', 3, 'butuh input'),
    ('Unit economics',                  'section', 4, 'terkunci'),
    ('Working capital & liquidity',     'section', 5, 'akhir bulan');

  insert into public.os_finish_line_items
    (parent_id, item, kind, sort_order, unit, dp, agg, style, flag)
  select s.id, m.item, 'metric', m.ord, m.unit, m.dp, m.agg, m.style, m.flag
  from (values
    ('Laba rugi','Sales — B2B',               'det',  'Rp jt',0,'sum',null, 1),
    ('Laba rugi','Sales — B2C',               'det',  'Rp jt',0,'sum',null, 2),
    ('Laba rugi','Sales — Logistic provider', 'det',  'Rp jt',0,'sum',null, 3),
    ('Laba rugi','Sales',                     'sub',  'Rp jt',0,'sum',null, 4),
    ('Laba rugi','COGS — B2B',                'det',  'Rp jt',0,'sum',null, 5),
    ('Laba rugi','COGS — B2C',                'det',  'Rp jt',0,'sum',null, 6),
    ('Laba rugi','COGS — Logistic provider',  'det',  'Rp jt',0,'sum',null, 7),
    ('Laba rugi','Cost of goods sold',        'sub',  'Rp jt',0,'sum',null, 8),
    ('Laba rugi','Gross profit',              'tot',  'Rp jt',0,'sum',null, 9),
    ('Laba rugi','Storing cost',              'sub',  'Rp jt',0,'sum',null,10),
    ('Laba rugi','Distribution cost',         'sub',  'Rp jt',0,'sum',null,11),
    ('Laba rugi','Commercials and support',   'sub',  'Rp jt',0,'sum','credit-balance-in-expense',12),
    ('Laba rugi','GA expenses',               'plain','Rp jt',0,'sum',null,13),
    ('Laba rugi','Operating profit',          'tot',  'Rp jt',0,'sum',null,14),
    ('Laba rugi','Finance income',            'plain','Rp jt',0,'sum',null,15),
    ('Laba rugi','Finance expenses',          'plain','Rp jt',0,'sum',null,16),
    ('Laba rugi','Other income',              'plain','Rp jt',0,'sum',null,17),
    ('Laba rugi','Other expense',             'plain','Rp jt',0,'sum',null,18),
    ('Laba rugi','Profit before tax',         'tot',  'Rp jt',0,'sum',null,19),
    ('Laba rugi','Income tax expense',        'plain','Rp jt',0,'sum',null,20),
    ('Laba rugi','Net profit for the year',   'tot',  'Rp jt',0,'sum',null,21),

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

    ('Volume & capacity','Volume delivered',      'plain','CBM',  null,'sum',     null,1),
    ('Volume & capacity','Cartons delivered',     'plain','unit', null,'sum',     null,2),
    ('Volume & capacity','Delivery trips',        'plain','count',null,'sum',     null,3),
    ('Volume & capacity','Pallet positions used', 'plain','avg',  null,'weighted',null,4),

    ('Unit economics','Revenue / CBM',      'lock','IDR k',null,'recompute',null,1),
    ('Unit economics','Layer-1 / CBM',      'lock','IDR k',null,'recompute',null,2),
    ('Unit economics','Pallet utilisation', 'lock','%',    null,'recompute',null,3),

    ('Working capital & liquidity','Trade receivable',      'plain','Rp jt',null,'sum',      null,1),
    ('Working capital & liquidity','Inventories',           'plain','Rp jt',null,'sum',      null,2),
    ('Working capital & liquidity','Trade payable',         'plain','Rp jt',null,'sum',      null,3),
    ('Working capital & liquidity','DSO',                   'lock', 'hari', null,'recompute',null,4),
    ('Working capital & liquidity','DIO',                   'lock', 'hari', null,'recompute',null,5),
    ('Working capital & liquidity','DPO',                   'lock', 'hari', null,'recompute',null,6),
    ('Working capital & liquidity','Cash conversion cycle', 'lock', 'hari', null,'recompute',null,7),
    ('Working capital & liquidity','Cash & equivalents',    'plain','Rp jt',null,'sum',      null,8)
  ) as m(section, item, style, unit, dp, agg, flag, ord)
  join public.os_finish_line_items s on s.kind = 'section' and s.item = m.section;

  -- The note row in Unit economics — no cells, by design.
  insert into public.os_finish_line_items (parent_id, item, kind, sort_order)
  select s.id, '+ 9 metrik lain menunggu isi per karton per SKU', 'note', 99
  from public.os_finish_line_items s
  where s.kind = 'section' and s.item = 'Unit economics';

  -- Cells for sections 1, 2 and 5: one row per line item, unpivoted across the
  -- five entities so the states read in the same column order as the source.
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

  -- Sections 3 and 4 — one uniform state across every entity.
  insert into public.os_finish_line_cells (item_id, entity_code, state)
  select i.id, en.code,
         case when s.item = 'Volume & capacity' then 'input' else 'locked' end
  from public.os_finish_line_items s
  join public.os_finish_line_items i on i.parent_id = s.id and i.kind = 'metric'
  cross join public.os_finish_line_entities en
  where s.kind = 'section' and s.item in ('Volume & capacity', 'Unit economics');

  -- The three per-cell notes. The only free text in the seed.
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

  -- Derivation edges, within one entity column, only where BOTH cells exist.
  --
  -- `Storing cost` and `Distribution cost` exist in both Laba rugi (Rp jt) and
  -- Margin layering (%). Layer-1 / CBM is an IDR k amount, so it takes the
  -- Laba rugi amounts — resolved by unit consistency, and flagged in the PR
  -- rather than left silent.
  insert into public.os_finish_line_deps (cell_id, input_id)
  select target.id, source.id
  from (values
    ('Unit economics','Revenue / CBM',                  'Laba rugi',                   'Sales'),
    ('Unit economics','Revenue / CBM',                  'Volume & capacity',           'Volume delivered'),
    ('Unit economics','Layer-1 / CBM',                  'Laba rugi',                   'Gross profit'),
    ('Unit economics','Layer-1 / CBM',                  'Laba rugi',                   'Storing cost'),
    ('Unit economics','Layer-1 / CBM',                  'Laba rugi',                   'Distribution cost'),
    ('Unit economics','Layer-1 / CBM',                  'Volume & capacity',           'Volume delivered'),
    ('Unit economics','Pallet utilisation',             'Volume & capacity',           'Pallet positions used'),
    ('Working capital & liquidity','DSO',               'Working capital & liquidity', 'Trade receivable'),
    ('Working capital & liquidity','DSO',               'Laba rugi',                   'Sales'),
    ('Working capital & liquidity','DIO',               'Working capital & liquidity', 'Inventories'),
    ('Working capital & liquidity','DIO',               'Laba rugi',                   'Cost of goods sold'),
    ('Working capital & liquidity','DPO',               'Working capital & liquidity', 'Trade payable'),
    ('Working capital & liquidity','DPO',               'Laba rugi',                   'Cost of goods sold'),
    ('Working capital & liquidity','Cash conversion cycle','Working capital & liquidity','DSO'),
    ('Working capital & liquidity','Cash conversion cycle','Working capital & liquidity','DIO'),
    ('Working capital & liquidity','Cash conversion cycle','Working capital & liquidity','DPO')
  ) as d(tsec, titem, ssec, sitem)
  join public.os_finish_line_items ts on ts.kind = 'section' and ts.item = d.tsec
  join public.os_finish_line_items ti on ti.parent_id = ts.id and ti.item = d.titem
  join public.os_finish_line_items ss on ss.kind = 'section' and ss.item = d.ssec
  join public.os_finish_line_items si on si.parent_id = ss.id and si.item = d.sitem
  join public.os_finish_line_cells target on target.item_id = ti.id
  -- SAME ENTITY COLUMN, and only where both cells exist.
  join public.os_finish_line_cells source
    on source.item_id = si.id and source.entity_code = target.entity_code
  on conflict do nothing;
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Assertions — §10.2. Not eyeballed: the migration fails loudly if the seed
--     is short a cell.
-- ---------------------------------------------------------------------------

do $$
declare
  sections integer;
  metrics  integer;
  cells    integer;
  ragged   integer;
  entities integer;
  bad      integer;
begin
  select count(*) into sections from public.os_finish_line_items where kind = 'section';
  select count(*) into metrics  from public.os_finish_line_items where kind = 'metric';
  select count(*) into cells    from public.os_finish_line_cells;
  select count(*) into entities from public.os_finish_line_entities;

  -- Every metric row must carry exactly one cell per entity. A row silently
  -- missing an entity is the failure this catches.
  select count(*) into ragged from (
    select i.id
    from public.os_finish_line_items i
    left join public.os_finish_line_cells c on c.item_id = i.id
    where i.kind = 'metric'
    group by i.id
    having count(c.id) <> entities
  ) as r;

  select count(*) into bad from public.os_finish_line_cells
  where state not in ('figure', 'zero', 'undefined', 'input', 'locked');

  if sections <> 5 then
    raise exception 'Expected 5 sections, found %.', sections;
  end if;
  if metrics <> 47 then
    raise exception 'Expected 47 metric rows, found %.', metrics;
  end if;
  if cells <> metrics * entities then
    raise exception 'Expected % cells (% metric rows x % entities), found %.',
      metrics * entities, metrics, entities, cells;
  end if;
  if ragged <> 0 then
    raise exception '% metric row(s) missing at least one entity cell.', ragged;
  end if;
  if bad <> 0 then
    raise exception '% cell(s) carry a state outside the five.', bad;
  end if;

  raise notice 'Matrix seeded: % sections, % metric rows, % cells across % entities.',
    sections, metrics, cells, entities;
end
$$;
