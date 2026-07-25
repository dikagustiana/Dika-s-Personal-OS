-- v5 C2: date confidence.
--
-- Almost every 2027 scholarship date in this database is a placeholder, but the
-- UI rendered exact countdowns and overdue-red against all of them equally.
-- `dateConfidence` records how much a date can be trusted, so the UI can show
-- ~/TBC and reserve urgency styling for dates that are actually confirmed.
--
-- confirmed = from the source (a booking, a published deadline)
-- estimated  = a placeholder or an informed guess
-- unknown    = genuinely no date; render nothing, never a countdown
--
-- A NULL column / absent key means `confirmed`. That keeps every real WORK
-- deadline (monthly-close cycles, whose month-end dates are real) behaving
-- exactly as before; only rows explicitly marked otherwise soften.

alter table public.os_projects
  add column if not exists date_confidence text
  check (
    date_confidence is null
    or date_confidence in ('confirmed', 'estimated', 'unknown')
  );

-- ---------------------------------------------------------------------------
-- Merge helper, repeated from the previous migration so this one stands alone
-- on databases that already ran the original (replace-wholesale) version.
-- ---------------------------------------------------------------------------
create or replace function public.os_merge_milestones(existing jsonb, incoming jsonb)
returns jsonb
language sql
immutable
set search_path to ''
as $$
  select coalesce(existing, '[]'::jsonb) || coalesce(
    (
      select jsonb_agg(candidate order by position)
      from jsonb_array_elements(coalesce(incoming, '[]'::jsonb))
           with ordinality as incoming_milestone(candidate, position)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(existing, '[]'::jsonb)) as kept(milestone)
        where kept.milestone ->> 'id' = candidate ->> 'id'
      )
    ),
    '[]'::jsonb
  );
$$;

-- ---------------------------------------------------------------------------
-- Backfill the four scholarship GROWTH projects: Chevening, IELTS, LPDP, Uni
-- Applications. Every seeded scholarship date is a placeholder, so each is
-- marked `estimated`.
--
-- The IELTS test date is the one date expected to become firm, but the two
-- handover sources disagree (20 Sep vs 30 Sep 2026). It stays `estimated`
-- until the owner confirms it from the booking itself — guessing here is
-- exactly the failure mode this field exists to prevent.
--
-- Per-key merge, not an aggregate replacement: a milestone that already
-- carries a dateConfidence keeps the owner's value untouched, and nothing else
-- on the milestone is rewritten.
-- ---------------------------------------------------------------------------
update public.os_projects p
set date_confidence = coalesce(p.date_confidence, 'estimated'),
    milestones = (
      select jsonb_agg(
               case
                 when milestone ->> 'dateConfidence' is not null then milestone
                 else milestone || '{"dateConfidence": "estimated"}'::jsonb
               end
               order by position
             )
      from jsonb_array_elements(p.milestones)
           with ordinality as existing_milestone(milestone, position)
    )
where p.id in (
    '10000000-0000-4000-8000-000000000001', -- Chevening
    '10000000-0000-4000-8000-000000000002', -- IELTS
    '10000000-0000-4000-8000-000000000006', -- Uni Applications
    '10000000-0000-4000-8000-000000000007'  -- LPDP
  )
  and jsonb_array_length(p.milestones) > 0;
