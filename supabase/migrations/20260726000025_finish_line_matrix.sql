-- Finish line: entity matrix + connection layer.
-- Replaces the never-applied original contents of this file.

-- 1. Back up the pack-era rows before deleting them
create table if not exists private.os_finish_line_items_backup_pack as
  select * from public.os_finish_line_items;

delete from public.os_finish_line_item_projects;
delete from public.os_finish_line_items;

-- 2. Release the pack-era NOT NULLs so matrix rows can be inserted.
--    These columns become genuinely unused; dropping them is deferred cleanup.
alter table public.os_finish_line_items
  alter column area   drop not null,
  alter column status drop not null,
  alter column status drop default;

-- 3. Row-level columns for the matrix
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

-- 4. kind: drop the pack-era check and the 'line' default before the new check lands,
--    so no insert can ever satisfy the old default under the new constraint.
alter table public.os_finish_line_items
  drop constraint os_finish_line_items_kind_check;

alter table public.os_finish_line_items
  alter column kind drop default;

alter table public.os_finish_line_items
  add constraint os_finish_line_items_kind_check
    check (kind in ('section','metric','note'));

-- 5. Entities as data. Never hardcoded in the frontend.
create table if not exists public.os_finish_line_entities (
  code       text primary key,
  label      text not null,
  sort_order integer not null
);

-- 6. Cells
create table if not exists public.os_finish_line_cells (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.os_finish_line_items(id) on delete cascade,
  entity_code text not null references public.os_finish_line_entities(code),
  state       text not null check (state in ('figure','zero','undefined','input','locked')),
  note        text,
  updated_at  timestamptz not null default now(),
  unique (item_id, entity_code)
);

-- 7. Derivation edges: a locked cell's inputs, within the same entity column
create table if not exists public.os_finish_line_deps (
  cell_id  uuid not null references public.os_finish_line_cells(id) on delete cascade,
  input_id uuid not null references public.os_finish_line_cells(id) on delete cascade,
  primary key (cell_id, input_id),
  check (cell_id <> input_id)
);

-- 8. The road: which milestone closes which cell.
--    item_id loses its NOT NULL because a cell-grain edge has no row-grain meaning.
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

-- 9. RLS, copied from the two existing finish-line tables
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

-- 10. Views. security_invoker is mandatory: without it these run as owner and
--     bypass every policy above.
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
