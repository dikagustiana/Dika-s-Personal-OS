drop view if exists public.os_finish_line_unplanned;

-- unplanned: a cell is a gap when its state asserts something about the pack that
-- work must stand behind. 'figure' is NOT terminal — a number with no project behind
-- it has no evidence its method is sound. 'zero' is deferred, deliberately.
-- An edge whose milestone no longer exists is not an edge.
create view public.os_finish_line_unplanned
  with (security_invoker = true) as
select c.id as cell_id, c.item_id, c.entity_code, c.state, i.item, i.sort_order
from public.os_finish_line_cells c
join public.os_finish_line_items i on i.id = c.item_id
where c.state in ('figure','input')
  and not exists (
    select 1
    from public.os_finish_line_item_projects l
    where l.cell_id = c.id
      and (
        l.milestone_id is null
        or exists (
          select 1
          from public.os_projects p,
               lateral jsonb_array_elements(coalesce(p.milestones, '[]'::jsonb)) m
          where p.id = l.project_id
            and m->>'id' = l.milestone_id
        )
      )
  );

-- orphans: WORK only, monthly close excluded (Accounting Manager cadence, outside
-- the transformation hierarchy by decision). Tightens from 121 to the pack-tributary
-- set once the project restructure encodes it.
create or replace view public.os_finish_line_orphan_milestones
  with (security_invoker = true) as
select p.id as project_id, p.title as project_title,
       m->>'id' as milestone_id, m->>'text' as milestone_text, m->>'status' as status
from public.os_projects p,
     lateral jsonb_array_elements(coalesce(p.milestones, '[]'::jsonb)) m
where p.domain = 'work'
  and coalesce(p.recurring, '') <> 'monthly'
  and not exists (
    select 1 from public.os_finish_line_item_projects l
    where l.project_id = p.id and l.milestone_id = m->>'id'
  );
