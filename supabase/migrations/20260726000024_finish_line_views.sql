-- Finish line: the three views the connection layer is actually for.
--
-- APPLY AFTER 20260726000023_finish_line_matrix.sql — every view here reads
-- tables that migration creates.
--
-- NOT APPLIED. The session that wrote this had no database access.
--
-- NEVER apply with `supabase db push`, `migration up`, `db reset`, or
-- `db remote commit` — see the header of 20260726000022 for why.
--
-- All three are `security_invoker`, so RLS on the underlying tables still
-- applies to whoever selects from them. A view that bypassed the app-key
-- policy would be a hole cut straight through the thing that guards this data.

-- ---------------------------------------------------------------------------
-- 1. Dangling links — the referential gap we ACCEPT rather than solve
--
-- `milestone_id` is text pointing into a jsonb array inside os_projects, so
-- there is no foreign key and there cannot be one. Delete a milestone from the
-- array and the edge dangles. This view names those edges; the UI surfaces the
-- count. NOTHING AUTO-DELETES THEM — an edge that vanishes silently is worse
-- than one that says it is broken.
-- ---------------------------------------------------------------------------

create or replace view public.os_finish_line_dangling_links
with (security_invoker = true) as
select
  l.id,
  l.item_id,
  l.cell_id,
  l.project_id,
  l.milestone_id,
  p.title as project_title
from public.os_finish_line_item_projects l
left join public.os_projects p on p.id = l.project_id
where l.milestone_id is not null
  and not exists (
    select 1
    from public.os_projects pr
    cross join lateral jsonb_array_elements(coalesce(pr.milestones, '[]'::jsonb)) as m(value)
    where pr.id = l.project_id
      and m.value ->> 'id' = l.milestone_id
  );

comment on view public.os_finish_line_dangling_links is
  'Edges whose milestone_id no longer exists in os_projects.milestones. Surfaced as a count in the UI; never auto-deleted.';

-- ---------------------------------------------------------------------------
-- 2. Unplanned — every `input` cell with no edge. Holes in the plan.
--
-- `input` is the ONLY state a milestone can close, so it is the only state
-- that can be unplanned. A `locked` cell with no edge is not a hole — it is
-- waiting on its inputs — and an `undefined` cell is arithmetic, not work.
-- ---------------------------------------------------------------------------

create or replace view public.os_finish_line_unplanned
with (security_invoker = true) as
select
  c.id as cell_id,
  c.item_id,
  c.entity_code,
  i.item as line_item,
  s.item as section,
  i.unit
from public.os_finish_line_cells c
join public.os_finish_line_items i on i.id = c.item_id
left join public.os_finish_line_items s on s.id = i.parent_id
where c.state = 'input'
  and not exists (
    select 1 from public.os_finish_line_item_projects l where l.cell_id = c.id
  );

comment on view public.os_finish_line_unplanned is
  'Input cells with no edge — holes in the plan. Only `input` can be unplanned: `locked` is waiting on its inputs and `undefined` is arithmetic, not work outstanding.';

-- ---------------------------------------------------------------------------
-- 3. Orphan milestones — every milestone that closes nothing.
--
-- Of 458 milestones, how many make no pack line trustworthy. This is meant to
-- be uncomfortable. It is not softened, not hidden behind a toggle, and the UI
-- carries no explanatory apology beside it.
-- ---------------------------------------------------------------------------

create or replace view public.os_finish_line_orphan_milestones
with (security_invoker = true) as
select
  p.id   as project_id,
  p.title as project_title,
  p.domain,
  m.value ->> 'id'     as milestone_id,
  m.value ->> 'text'   as milestone_text,
  m.value ->> 'status' as milestone_status,
  (m.value ->> 'done')::boolean as done
from public.os_projects p
cross join lateral jsonb_array_elements(coalesce(p.milestones, '[]'::jsonb)) as m(value)
where not exists (
  select 1
  from public.os_finish_line_item_projects l
  where l.project_id = p.id
    and l.milestone_id = m.value ->> 'id'
);

comment on view public.os_finish_line_orphan_milestones is
  'Milestones with no edge to any cell — work that makes no pack line trustworthy. Deliberately not softened.';
