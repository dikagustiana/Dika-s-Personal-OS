-- ============================================================
-- Finish line: entity matrix + connection layer
-- ============================================================
--
-- THIS FILE IS THE RECORD OF WHAT THE DB SESSION APPLIES. It is committed by
-- the repo session, which has no database access and applies nothing. §5 and
-- §6 of the brief are reproduced here without reformatting, reordering or
-- improvement, so the repo cannot drift from production — that drift is how
-- this project shipped a frontend against a non-existent schema twice.
--
-- One addition to §5.3, agreed rather than assumed: `tag text`. §6.3 assigns
-- a tag to three sections and §8.1 renders it beside the section title, and no
-- applied migration (20260726000020, 20260726000021) carries the column.
--
-- ⚠️  APPLY-ORDER DEFECT — READ BEFORE RUNNING §5.4 BELOW.
--     §5.4 adds `check (kind in ('section','metric','note'))` while the table
--     still holds the 60 pack-era rows: 8 of them are kind='block', which the
--     new check rejects, so ADD CONSTRAINT fails with 23514 and the migration
--     stops there. §6.1's delete has to run BEFORE §5.4.
--     Not reordered here, because the brief says copy §5 without reordering
--     and to raise a disagreement rather than edit it. This is the raise.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit`: repo filenames and the live ledger use different
-- numbering, and any of those replays history from 0001_schema.sql against
-- live production data.
--
-- SUPERSEDES 20260726000023 and 20260726000024, which are deleted in the same
-- change. They were merged but never applied, and all three create the same
-- tables with different shapes.

-- 5.1 Back up the pack-era rows before deleting them
create table if not exists private.os_finish_line_items_backup_pack as
  select * from public.os_finish_line_items;

-- 5.2 Release the pack-era NOT NULLs so matrix rows can be inserted.
--     These columns become genuinely unused; dropping them is deferred cleanup.
alter table public.os_finish_line_items
  alter column area   drop not null,
  alter column status drop not null,
  alter column status drop default;

-- 5.3 Row-level columns for the matrix
alter table public.os_finish_line_items
  add column if not exists unit  text,
  add column if not exists dp    smallint,
  add column if not exists agg   text,
  add column if not exists style text,
  add column if not exists flag  text,
  add column if not exists tag   text;

alter table public.os_finish_line_items
  add constraint os_finish_line_items_agg_check
    check (agg is null or agg in ('sum','weighted','recompute')),
  add constraint os_finish_line_items_style_check
    check (style is null or style in ('det','sub','tot','lock','plain'));

-- 5.4 kind: replace the pack-era check and remove the 'line' default in the same
--     statement group, so no insert can ever satisfy the old default under the new check.
alter table public.os_finish_line_items
  drop constraint os_finish_line_items_kind_check;
alter table public.os_finish_line_items
  alter column kind drop default;
alter table public.os_finish_line_items
  add constraint os_finish_line_items_kind_check
    check (kind in ('section','metric','note'));

-- 5.5 Entities as data. Never hardcoded in the frontend.
create table if not exists public.os_finish_line_entities (
  code       text primary key,
  label      text not null,
  sort_order integer not null
);

-- 5.6 Cells
create table if not exists public.os_finish_line_cells (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.os_finish_line_items(id) on delete cascade,
  entity_code text not null references public.os_finish_line_entities(code),
  state       text not null check (state in ('figure','zero','undefined','input','locked')),
  note        text,
  updated_at  timestamptz not null default now(),
  unique (item_id, entity_code)
);

-- 5.7 Derivation edges: a locked cell's inputs, within the same entity column
create table if not exists public.os_finish_line_deps (
  cell_id  uuid not null references public.os_finish_line_cells(id) on delete cascade,
  input_id uuid not null references public.os_finish_line_cells(id) on delete cascade,
  primary key (cell_id, input_id),
  check (cell_id <> input_id)
);

-- 5.8 The road: which milestone closes which cell.
--     item_id loses its NOT NULL because a cell-grain edge has no row-grain meaning.
alter table public.os_finish_line_item_projects
  add column if not exists cell_id uuid references public.os_finish_line_cells(id) on delete cascade,
  alter column item_id drop not null;

alter table public.os_finish_line_item_projects
  add constraint os_finish_line_item_projects_grain_check
    check (cell_id is not null or item_id is not null);

-- nulls not distinct: a project-level edge has milestone_id null, and two of those
-- against the same cell are the same edge. Postgres 17, so this is available.
alter table public.os_finish_line_item_projects
  add constraint os_finish_line_item_projects_uniq
    unique nulls not distinct (cell_id, project_id, milestone_id);

-- 5.9 RLS, copied from the two existing finish-line tables
alter table public.os_finish_line_entities enable row level security;
alter table public.os_finish_line_cells    enable row level security;
alter table public.os_finish_line_deps     enable row level security;

create policy "require app key" on public.os_finish_line_entities
  for all to anon, authenticated
  using (public.os_key_valid()) with check (public.os_key_valid());
create policy "require app key" on public.os_finish_line_cells
  for all to anon, authenticated
  using (public.os_key_valid()) with check (public.os_key_valid());
create policy "require app key" on public.os_finish_line_deps
  for all to anon, authenticated
  using (public.os_key_valid()) with check (public.os_key_valid());

-- 5.10 Views. security_invoker is mandatory: without it these run as owner and
--      bypass every policy above.
create or replace view public.os_finish_line_dangling_links
  with (security_invoker = true) as
select l.id, l.cell_id, l.project_id, l.milestone_id
from public.os_finish_line_item_projects l
where l.milestone_id is not null
  and not exists (
    select 1
    from public.os_projects p,
         lateral jsonb_array_elements(coalesce(p.milestones, '[]'::jsonb)) m
    where p.id = l.project_id
      and m->>'id' = l.milestone_id
  );

create or replace view public.os_finish_line_unplanned
  with (security_invoker = true) as
select c.id as cell_id, c.item_id, c.entity_code, i.item, i.sort_order
from public.os_finish_line_cells c
join public.os_finish_line_items i on i.id = c.item_id
where c.state = 'input'
  and not exists (
    select 1 from public.os_finish_line_item_projects l where l.cell_id = c.id
  );

create or replace view public.os_finish_line_orphan_milestones
  with (security_invoker = true) as
select p.id as project_id, p.title as project_title,
       m->>'id' as milestone_id, m->>'text' as milestone_text, m->>'status' as status
from public.os_projects p,
     lateral jsonb_array_elements(coalesce(p.milestones, '[]'::jsonb)) m
where not exists (
  select 1 from public.os_finish_line_item_projects l
  where l.project_id = p.id and l.milestone_id = m->>'id'
);

-- ============================================================
-- 6. Seed
-- ============================================================

-- 6.1 Delete the pack-era rows. Explicit, so the diff shows it, even though
--     the link table's on delete cascade would also clear the edges.
delete from public.os_finish_line_item_projects
where item_id in (select id from public.os_finish_line_items);

delete from public.os_finish_line_items;

-- 6.2 Entities
insert into public.os_finish_line_entities (code, label, sort_order) values
  ('SAMB', 'SAMB', 1),
  ('ASI', 'ASI', 2),
  ('ARBI', 'ARBI', 3),
  ('KNI', 'KNI', 4),
  ('KDU', 'KDU', 5);

-- 6.3 Rows. EXPLICIT IDS: every cell and every dependency edge below
--     resolves by row id. Section 1 and Section 2 share three labels
--     ('Storing cost', 'Distribution cost', 'Commercials and support'),
--     so a label lookup would silently pick the wrong row.
insert into public.os_finish_line_items
  (id, item, kind, sort_order, unit, dp, agg, style, flag, tag, parent_id) values
  ('f1000001-0000-4000-8000-000000000000', 'Laba rugi', 'section', 1, null, null, null, null, null, null, null),
  ('f1000001-0000-4000-8000-000000000001', 'Sales — B2B', 'metric', 1, 'Rp jt', 0, 'sum', 'det', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000002', 'Sales — B2C', 'metric', 2, 'Rp jt', 0, 'sum', 'det', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000003', 'Sales — Logistic provider', 'metric', 3, 'Rp jt', 0, 'sum', 'det', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000004', 'Sales', 'metric', 4, 'Rp jt', 0, 'sum', 'sub', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000005', 'COGS — B2B', 'metric', 5, 'Rp jt', 0, 'sum', 'det', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000006', 'COGS — B2C', 'metric', 6, 'Rp jt', 0, 'sum', 'det', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000007', 'COGS — Logistic provider', 'metric', 7, 'Rp jt', 0, 'sum', 'det', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000008', 'Cost of goods sold', 'metric', 8, 'Rp jt', 0, 'sum', 'sub', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000009', 'Gross profit', 'metric', 9, 'Rp jt', 0, 'sum', 'tot', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000010', 'Storing cost', 'metric', 10, 'Rp jt', 0, 'sum', 'sub', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000011', 'Distribution cost', 'metric', 11, 'Rp jt', 0, 'sum', 'sub', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000012', 'Commercials and support', 'metric', 12, 'Rp jt', 0, 'sum', 'sub', 'credit-balance-in-expense', null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000013', 'GA expenses', 'metric', 13, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000014', 'Operating profit', 'metric', 14, 'Rp jt', 0, 'sum', 'tot', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000015', 'Finance income', 'metric', 15, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000016', 'Finance expenses', 'metric', 16, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000017', 'Other income', 'metric', 17, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000018', 'Other expense', 'metric', 18, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000019', 'Profit before tax', 'metric', 19, 'Rp jt', 0, 'sum', 'tot', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000020', 'Income tax expense', 'metric', 20, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000001-0000-4000-8000-000000000021', 'Net profit for the year', 'metric', 21, 'Rp jt', 0, 'sum', 'tot', null, null, 'f1000001-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000000', 'Margin layering & cost-to-serve', 'section', 2, null, null, null, null, null, null, null),
  ('f1000002-0000-4000-8000-000000000001', 'GP margin', 'metric', 1, '%', 1, 'recompute', 'plain', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000002', 'Storing cost', 'metric', 2, '%', 1, 'recompute', 'plain', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000003', 'Distribution cost', 'metric', 3, '%', 1, 'recompute', 'plain', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000004', 'Cost-to-serve', 'metric', 4, '%', 1, 'recompute', 'sub', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000005', 'Layer-1 contribution', 'metric', 5, '%', 1, 'recompute', 'sub', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000006', 'Payroll', 'metric', 6, '%', 1, 'recompute', 'plain', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000007', 'Commercials and support', 'metric', 7, '%', 1, 'recompute', 'plain', 'credit-balance-in-expense', null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000008', 'G&A excl. payroll', 'metric', 8, '%', 1, 'recompute', 'plain', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000009', 'OP margin', 'metric', 9, '%', 1, 'recompute', 'tot', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000010', 'NPAT margin', 'metric', 10, '%', 1, 'recompute', 'plain', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000002-0000-4000-8000-000000000011', 'Share of consolidated net sales', 'metric', 11, '%', 1, 'recompute', 'tot', null, null, 'f1000002-0000-4000-8000-000000000000'),
  ('f1000003-0000-4000-8000-000000000000', 'Volume & capacity', 'section', 3, null, null, null, null, null, 'butuh input', null),
  ('f1000003-0000-4000-8000-000000000001', 'Volume delivered', 'metric', 1, 'CBM', 0, 'sum', 'plain', null, null, 'f1000003-0000-4000-8000-000000000000'),
  ('f1000003-0000-4000-8000-000000000002', 'Cartons delivered', 'metric', 2, 'unit', 0, 'sum', 'plain', null, null, 'f1000003-0000-4000-8000-000000000000'),
  ('f1000003-0000-4000-8000-000000000003', 'Delivery trips', 'metric', 3, 'count', 0, 'sum', 'plain', null, null, 'f1000003-0000-4000-8000-000000000000'),
  ('f1000003-0000-4000-8000-000000000004', 'Pallet positions used', 'metric', 4, 'avg', 0, 'weighted', 'plain', null, null, 'f1000003-0000-4000-8000-000000000000'),
  ('f1000004-0000-4000-8000-000000000000', 'Unit economics', 'section', 4, null, null, null, null, null, 'terkunci', null),
  ('f1000004-0000-4000-8000-000000000001', 'Revenue / CBM', 'metric', 1, 'IDR k', 1, 'recompute', 'lock', null, null, 'f1000004-0000-4000-8000-000000000000'),
  ('f1000004-0000-4000-8000-000000000002', 'Layer-1 / CBM', 'metric', 2, 'IDR k', 1, 'recompute', 'lock', null, null, 'f1000004-0000-4000-8000-000000000000'),
  ('f1000004-0000-4000-8000-000000000003', 'Pallet utilisation', 'metric', 3, '%', 1, 'recompute', 'lock', null, null, 'f1000004-0000-4000-8000-000000000000'),
  ('f1000005-0000-4000-8000-000000000000', 'Working capital & liquidity', 'section', 5, null, null, null, null, null, 'akhir bulan', null),
  ('f1000005-0000-4000-8000-000000000001', 'Trade receivable', 'metric', 1, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000005-0000-4000-8000-000000000000'),
  ('f1000005-0000-4000-8000-000000000002', 'Inventories', 'metric', 2, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000005-0000-4000-8000-000000000000'),
  ('f1000005-0000-4000-8000-000000000003', 'Trade payable', 'metric', 3, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000005-0000-4000-8000-000000000000'),
  ('f1000005-0000-4000-8000-000000000004', 'DSO', 'metric', 4, 'hari', 0, 'recompute', 'lock', null, null, 'f1000005-0000-4000-8000-000000000000'),
  ('f1000005-0000-4000-8000-000000000005', 'DIO', 'metric', 5, 'hari', 0, 'recompute', 'lock', null, null, 'f1000005-0000-4000-8000-000000000000'),
  ('f1000005-0000-4000-8000-000000000006', 'DPO', 'metric', 6, 'hari', 0, 'recompute', 'lock', null, null, 'f1000005-0000-4000-8000-000000000000'),
  ('f1000005-0000-4000-8000-000000000007', 'Cash conversion cycle', 'metric', 7, 'hari', 0, 'recompute', 'lock', null, null, 'f1000005-0000-4000-8000-000000000000'),
  ('f1000005-0000-4000-8000-000000000008', 'Cash & equivalents', 'metric', 8, 'Rp jt', 0, 'sum', 'plain', null, null, 'f1000005-0000-4000-8000-000000000000'),
  ('f1000004-0000-4000-8000-000000000099', '+ 9 metrik lain menunggu isi per karton per SKU', 'note', 99, null, null, null, null, null, null, 'f1000004-0000-4000-8000-000000000000');

-- 6.3 Cells, by row id and entity code.
insert into public.os_finish_line_cells (item_id, entity_code, state) values
  ('f1000001-0000-4000-8000-000000000001', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000001', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000001', 'ARBI', 'zero'),
  ('f1000001-0000-4000-8000-000000000001', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000001', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000002', 'SAMB', 'zero'),
  ('f1000001-0000-4000-8000-000000000002', 'ASI', 'zero'),
  ('f1000001-0000-4000-8000-000000000002', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000002', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000002', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000003', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000003', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000003', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000003', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000003', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000004', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000004', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000004', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000004', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000004', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000005', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000005', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000005', 'ARBI', 'zero'),
  ('f1000001-0000-4000-8000-000000000005', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000005', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000006', 'SAMB', 'zero'),
  ('f1000001-0000-4000-8000-000000000006', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000006', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000006', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000006', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000007', 'SAMB', 'zero'),
  ('f1000001-0000-4000-8000-000000000007', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000007', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000007', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000007', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000008', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000008', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000008', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000008', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000008', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000009', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000009', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000009', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000009', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000009', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000010', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000010', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000010', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000010', 'KNI', 'figure'),
  ('f1000001-0000-4000-8000-000000000010', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000011', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000011', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000011', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000011', 'KNI', 'figure'),
  ('f1000001-0000-4000-8000-000000000011', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000012', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000012', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000012', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000012', 'KNI', 'figure'),
  ('f1000001-0000-4000-8000-000000000012', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000013', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000013', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000013', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000013', 'KNI', 'figure'),
  ('f1000001-0000-4000-8000-000000000013', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000014', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000014', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000014', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000014', 'KNI', 'figure'),
  ('f1000001-0000-4000-8000-000000000014', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000015', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000015', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000015', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000015', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000015', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000016', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000016', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000016', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000016', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000016', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000017', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000017', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000017', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000017', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000017', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000018', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000018', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000018', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000018', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000018', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000019', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000019', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000019', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000019', 'KNI', 'figure'),
  ('f1000001-0000-4000-8000-000000000019', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000020', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000020', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000020', 'ARBI', 'zero'),
  ('f1000001-0000-4000-8000-000000000020', 'KNI', 'zero'),
  ('f1000001-0000-4000-8000-000000000020', 'KDU', 'zero'),
  ('f1000001-0000-4000-8000-000000000021', 'SAMB', 'figure'),
  ('f1000001-0000-4000-8000-000000000021', 'ASI', 'figure'),
  ('f1000001-0000-4000-8000-000000000021', 'ARBI', 'figure'),
  ('f1000001-0000-4000-8000-000000000021', 'KNI', 'figure'),
  ('f1000001-0000-4000-8000-000000000021', 'KDU', 'zero'),
  ('f1000002-0000-4000-8000-000000000001', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000001', 'ASI', 'figure'),
  ('f1000002-0000-4000-8000-000000000001', 'ARBI', 'figure'),
  ('f1000002-0000-4000-8000-000000000001', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000001', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000002', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000002', 'ASI', 'figure'),
  ('f1000002-0000-4000-8000-000000000002', 'ARBI', 'figure'),
  ('f1000002-0000-4000-8000-000000000002', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000002', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000003', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000003', 'ASI', 'figure'),
  ('f1000002-0000-4000-8000-000000000003', 'ARBI', 'figure'),
  ('f1000002-0000-4000-8000-000000000003', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000003', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000004', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000004', 'ASI', 'figure'),
  ('f1000002-0000-4000-8000-000000000004', 'ARBI', 'figure'),
  ('f1000002-0000-4000-8000-000000000004', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000004', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000005', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000005', 'ASI', 'figure'),
  ('f1000002-0000-4000-8000-000000000005', 'ARBI', 'figure'),
  ('f1000002-0000-4000-8000-000000000005', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000005', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000006', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000006', 'ASI', 'input'),
  ('f1000002-0000-4000-8000-000000000006', 'ARBI', 'input'),
  ('f1000002-0000-4000-8000-000000000006', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000006', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000007', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000007', 'ASI', 'figure'),
  ('f1000002-0000-4000-8000-000000000007', 'ARBI', 'figure'),
  ('f1000002-0000-4000-8000-000000000007', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000007', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000008', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000008', 'ASI', 'input'),
  ('f1000002-0000-4000-8000-000000000008', 'ARBI', 'input'),
  ('f1000002-0000-4000-8000-000000000008', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000008', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000009', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000009', 'ASI', 'figure'),
  ('f1000002-0000-4000-8000-000000000009', 'ARBI', 'figure'),
  ('f1000002-0000-4000-8000-000000000009', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000009', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000010', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000010', 'ASI', 'figure'),
  ('f1000002-0000-4000-8000-000000000010', 'ARBI', 'figure'),
  ('f1000002-0000-4000-8000-000000000010', 'KNI', 'undefined'),
  ('f1000002-0000-4000-8000-000000000010', 'KDU', 'undefined'),
  ('f1000002-0000-4000-8000-000000000011', 'SAMB', 'figure'),
  ('f1000002-0000-4000-8000-000000000011', 'ASI', 'figure'),
  ('f1000002-0000-4000-8000-000000000011', 'ARBI', 'figure'),
  ('f1000002-0000-4000-8000-000000000011', 'KNI', 'zero'),
  ('f1000002-0000-4000-8000-000000000011', 'KDU', 'zero'),
  ('f1000003-0000-4000-8000-000000000001', 'SAMB', 'input'),
  ('f1000003-0000-4000-8000-000000000001', 'ASI', 'input'),
  ('f1000003-0000-4000-8000-000000000001', 'ARBI', 'input'),
  ('f1000003-0000-4000-8000-000000000001', 'KNI', 'input'),
  ('f1000003-0000-4000-8000-000000000001', 'KDU', 'input'),
  ('f1000003-0000-4000-8000-000000000002', 'SAMB', 'input'),
  ('f1000003-0000-4000-8000-000000000002', 'ASI', 'input'),
  ('f1000003-0000-4000-8000-000000000002', 'ARBI', 'input'),
  ('f1000003-0000-4000-8000-000000000002', 'KNI', 'input'),
  ('f1000003-0000-4000-8000-000000000002', 'KDU', 'input'),
  ('f1000003-0000-4000-8000-000000000003', 'SAMB', 'input'),
  ('f1000003-0000-4000-8000-000000000003', 'ASI', 'input'),
  ('f1000003-0000-4000-8000-000000000003', 'ARBI', 'input'),
  ('f1000003-0000-4000-8000-000000000003', 'KNI', 'input'),
  ('f1000003-0000-4000-8000-000000000003', 'KDU', 'input'),
  ('f1000003-0000-4000-8000-000000000004', 'SAMB', 'input'),
  ('f1000003-0000-4000-8000-000000000004', 'ASI', 'input'),
  ('f1000003-0000-4000-8000-000000000004', 'ARBI', 'input'),
  ('f1000003-0000-4000-8000-000000000004', 'KNI', 'input'),
  ('f1000003-0000-4000-8000-000000000004', 'KDU', 'input'),
  ('f1000004-0000-4000-8000-000000000001', 'SAMB', 'locked'),
  ('f1000004-0000-4000-8000-000000000001', 'ASI', 'locked'),
  ('f1000004-0000-4000-8000-000000000001', 'ARBI', 'locked'),
  ('f1000004-0000-4000-8000-000000000001', 'KNI', 'locked'),
  ('f1000004-0000-4000-8000-000000000001', 'KDU', 'locked'),
  ('f1000004-0000-4000-8000-000000000002', 'SAMB', 'locked'),
  ('f1000004-0000-4000-8000-000000000002', 'ASI', 'locked'),
  ('f1000004-0000-4000-8000-000000000002', 'ARBI', 'locked'),
  ('f1000004-0000-4000-8000-000000000002', 'KNI', 'locked'),
  ('f1000004-0000-4000-8000-000000000002', 'KDU', 'locked'),
  ('f1000004-0000-4000-8000-000000000003', 'SAMB', 'locked'),
  ('f1000004-0000-4000-8000-000000000003', 'ASI', 'locked'),
  ('f1000004-0000-4000-8000-000000000003', 'ARBI', 'locked'),
  ('f1000004-0000-4000-8000-000000000003', 'KNI', 'locked'),
  ('f1000004-0000-4000-8000-000000000003', 'KDU', 'locked'),
  ('f1000005-0000-4000-8000-000000000001', 'SAMB', 'input'),
  ('f1000005-0000-4000-8000-000000000001', 'ASI', 'input'),
  ('f1000005-0000-4000-8000-000000000001', 'ARBI', 'input'),
  ('f1000005-0000-4000-8000-000000000001', 'KNI', 'input'),
  ('f1000005-0000-4000-8000-000000000001', 'KDU', 'input'),
  ('f1000005-0000-4000-8000-000000000002', 'SAMB', 'input'),
  ('f1000005-0000-4000-8000-000000000002', 'ASI', 'input'),
  ('f1000005-0000-4000-8000-000000000002', 'ARBI', 'input'),
  ('f1000005-0000-4000-8000-000000000002', 'KNI', 'input'),
  ('f1000005-0000-4000-8000-000000000002', 'KDU', 'input'),
  ('f1000005-0000-4000-8000-000000000003', 'SAMB', 'input'),
  ('f1000005-0000-4000-8000-000000000003', 'ASI', 'input'),
  ('f1000005-0000-4000-8000-000000000003', 'ARBI', 'input'),
  ('f1000005-0000-4000-8000-000000000003', 'KNI', 'input'),
  ('f1000005-0000-4000-8000-000000000003', 'KDU', 'input'),
  ('f1000005-0000-4000-8000-000000000004', 'SAMB', 'locked'),
  ('f1000005-0000-4000-8000-000000000004', 'ASI', 'locked'),
  ('f1000005-0000-4000-8000-000000000004', 'ARBI', 'locked'),
  ('f1000005-0000-4000-8000-000000000004', 'KNI', 'undefined'),
  ('f1000005-0000-4000-8000-000000000004', 'KDU', 'undefined'),
  ('f1000005-0000-4000-8000-000000000005', 'SAMB', 'locked'),
  ('f1000005-0000-4000-8000-000000000005', 'ASI', 'locked'),
  ('f1000005-0000-4000-8000-000000000005', 'ARBI', 'locked'),
  ('f1000005-0000-4000-8000-000000000005', 'KNI', 'undefined'),
  ('f1000005-0000-4000-8000-000000000005', 'KDU', 'undefined'),
  ('f1000005-0000-4000-8000-000000000006', 'SAMB', 'locked'),
  ('f1000005-0000-4000-8000-000000000006', 'ASI', 'locked'),
  ('f1000005-0000-4000-8000-000000000006', 'ARBI', 'locked'),
  ('f1000005-0000-4000-8000-000000000006', 'KNI', 'undefined'),
  ('f1000005-0000-4000-8000-000000000006', 'KDU', 'undefined'),
  ('f1000005-0000-4000-8000-000000000007', 'SAMB', 'locked'),
  ('f1000005-0000-4000-8000-000000000007', 'ASI', 'locked'),
  ('f1000005-0000-4000-8000-000000000007', 'ARBI', 'locked'),
  ('f1000005-0000-4000-8000-000000000007', 'KNI', 'undefined'),
  ('f1000005-0000-4000-8000-000000000007', 'KDU', 'undefined'),
  ('f1000005-0000-4000-8000-000000000008', 'SAMB', 'input'),
  ('f1000005-0000-4000-8000-000000000008', 'ASI', 'input'),
  ('f1000005-0000-4000-8000-000000000008', 'ARBI', 'input'),
  ('f1000005-0000-4000-8000-000000000008', 'KNI', 'input'),
  ('f1000005-0000-4000-8000-000000000008', 'KDU', 'input');

-- 6.3.1 The three seeded cell notes, addressed by row id + entity.
update public.os_finish_line_cells set note = 'Sales-LP ada, COGS-LP nil — cost belum dipisah dari Distribution cost, atau belum dicost sama sekali.'
  where item_id = 'f1000001-0000-4000-8000-000000000007' and entity_code = 'SAMB';
update public.os_finish_line_cells set note = 'PBT positif, provisi nil. Sejalan dengan pola BMG: angsuran dibukukan sebagai aset tanpa provisi.'
  where item_id = 'f1000001-0000-4000-8000-000000000020' and entity_code = 'ARBI';
update public.os_finish_line_cells set note = 'Rasio terhadap sales tidak kredibel — cost-category gap ASI/ARBI, bukan efisiensi.'
  where item_id = 'f1000001-0000-4000-8000-000000000010' and entity_code = 'ARBI';

-- 6.4 Derivation edges: 16 per entity x 5 entities = 80. Same entity
--     column on both sides, matched on row id.
insert into public.os_finish_line_deps (cell_id, input_id)
select tc.id, sc.id
from (values
  ('f1000004-0000-4000-8000-000000000001', 'f1000001-0000-4000-8000-000000000004'),
  ('f1000004-0000-4000-8000-000000000001', 'f1000003-0000-4000-8000-000000000001'),
  ('f1000004-0000-4000-8000-000000000002', 'f1000001-0000-4000-8000-000000000009'),
  ('f1000004-0000-4000-8000-000000000002', 'f1000001-0000-4000-8000-000000000010'),
  ('f1000004-0000-4000-8000-000000000002', 'f1000001-0000-4000-8000-000000000011'),
  ('f1000004-0000-4000-8000-000000000002', 'f1000003-0000-4000-8000-000000000001'),
  ('f1000004-0000-4000-8000-000000000003', 'f1000003-0000-4000-8000-000000000004'),
  ('f1000005-0000-4000-8000-000000000004', 'f1000005-0000-4000-8000-000000000001'),
  ('f1000005-0000-4000-8000-000000000004', 'f1000001-0000-4000-8000-000000000004'),
  ('f1000005-0000-4000-8000-000000000005', 'f1000005-0000-4000-8000-000000000002'),
  ('f1000005-0000-4000-8000-000000000005', 'f1000001-0000-4000-8000-000000000008'),
  ('f1000005-0000-4000-8000-000000000006', 'f1000005-0000-4000-8000-000000000003'),
  ('f1000005-0000-4000-8000-000000000006', 'f1000001-0000-4000-8000-000000000008'),
  ('f1000005-0000-4000-8000-000000000007', 'f1000005-0000-4000-8000-000000000004'),
  ('f1000005-0000-4000-8000-000000000007', 'f1000005-0000-4000-8000-000000000005'),
  ('f1000005-0000-4000-8000-000000000007', 'f1000005-0000-4000-8000-000000000006')
) as d(target_item, input_item)
join public.os_finish_line_cells tc on tc.item_id = d.target_item::uuid
join public.os_finish_line_cells sc
  on sc.item_id = d.input_item::uuid and sc.entity_code = tc.entity_code;

-- 6.3.6 Locked counts — asserted, not eyeballed.
do $$
declare
  sections integer; metrics integer; notes integer; items integer;
  cells integer; deps integer;
begin
  select count(*) into sections from public.os_finish_line_items where kind = 'section';
  select count(*) into metrics  from public.os_finish_line_items where kind = 'metric';
  select count(*) into notes    from public.os_finish_line_items where kind = 'note';
  select count(*) into items    from public.os_finish_line_items;
  select count(*) into cells    from public.os_finish_line_cells;
  select count(*) into deps     from public.os_finish_line_deps;

  if sections <> 5  then raise exception 'sections: expected 5, got %', sections; end if;
  if metrics  <> 47 then raise exception 'metric rows: expected 47, got %', metrics; end if;
  if notes    <> 1  then raise exception 'note rows: expected 1, got %', notes; end if;
  if items    <> 53 then raise exception 'items: expected 53, got %', items; end if;
  if cells    <> 235 then raise exception 'cells: expected 235, got %', cells; end if;
  if deps     <> 80 then raise exception 'deps: expected 80, got %', deps; end if;

  raise notice 'Finish line matrix seeded: % items, % cells, % deps.', items, cells, deps;
end
$$;
