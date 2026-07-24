-- Milestone enrichment: the Milestone shape inside os_projects.milestones
-- (jsonb) gains `status` ('not-started' | 'in-progress' | 'blocked' | 'done'),
-- optional `note`, and `escalateTo` ('none' | 'pak-jo-bu-lenny' | 'mbak-muti'
-- | 'pak-teddy' | 'other'). No column, table, or security changes.
--
-- Backfill for existing rows: status derives from the legacy done flag
-- (done -> 'done', otherwise 'not-started'); escalateTo defaults to 'none'.
-- Idempotent: coalesce keeps any already-present status/escalateTo, so
-- re-running never overwrites values written by the app.

update public.os_projects
set milestones = (
  select coalesce(
    jsonb_agg(
      m || jsonb_build_object(
        'status',
        coalesce(
          m ->> 'status',
          case when (m ->> 'done')::boolean then 'done' else 'not-started' end
        ),
        'escalateTo',
        coalesce(m ->> 'escalateTo', 'none')
      )
      order by ord
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(milestones) with ordinality as t(m, ord)
)
where milestones <> '[]'::jsonb;
