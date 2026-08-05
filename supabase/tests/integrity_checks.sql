-- ===========================================================================
-- STANDING INTEGRITY CHECKS — runnable, committed, zero rows = healthy.
-- ===========================================================================
-- Prose does not get run; this file does. Paste the whole thing into the
-- Supabase SQL editor (as postgres). EVERY check is written so that ZERO ROWS
-- RETURNED MEANS HEALTHY — any row is a finding, and each check's comment
-- says what a hit means and what to do about it.
--
-- Companion, same set: scripts/probe-password-grant.sh (anon key only) probes
-- whether the email/password grant surface is enabled at the platform level.
-- Current recorded state: enabled, and not disableable independently of the
-- email provider that #collab_token verification depends on — which is why
-- check 2 below is the control that actually matters.
--
-- No secret lives in this file and none is needed to run it.

-- ---------------------------------------------------------------------------
-- CHECK 1: the history note chain.
-- ---------------------------------------------------------------------------
-- Since migration 20260804000043 every cell-history row stores note contents
-- on both sides ('' = empty; NULL only in the 3 rows older than the
-- migration). to_note of row N must equal from_note of row N+1, and the
-- final to_note must equal the live cell note.
--
-- A HIT MEANS: something wrote to os_finish_line_cells outside the
-- write-guard trigger (or history was tampered with, which no policy
-- permits). Find the write path and close it; do not repair the chain by
-- editing history — it is append-only evidence.
with ordered as (
  select h.cell_id, h.changed_at, h.from_note, h.to_note,
         lead(h.from_note) over (partition by h.cell_id order by h.changed_at) as next_from
  from public.os_finish_line_cell_history h
  where h.from_note is not null   -- pre-migration rows never captured notes
)
select 'note chain: mid-chain break' as finding, cell_id, changed_at,
       to_note, next_from as expected_next_from
from ordered
where next_from is not null and to_note is distinct from next_from
union all
select 'note chain: tip disagrees with live cell', o.cell_id, o.changed_at,
       o.to_note, coalesce(c.note, '')
from ordered o
join public.os_finish_line_cells c on c.id = o.cell_id
where o.next_from is null and o.to_note is distinct from coalesce(c.note, '');

-- ---------------------------------------------------------------------------
-- CHECK 2: the password grant surface.
-- ---------------------------------------------------------------------------
-- grant_type=password is enabled at the project level (see the probe script)
-- but it is INERT while no user has a usable password. The convention since
-- migration 20260804000049 is '' — never NULL (GoTrue's Go scanner has
-- 500'd on NULL string columns in this very project) — and a BEFORE INSERT
-- trigger forces '' at birth, because GoTrue's admin createUser GENERATES a
-- random hash when none is supplied (caught live 2026-08-05: both
-- provision-created users were born with one; the hand-inserted user was
-- not). A real hash therefore means a POST-BIRTH set.
--
-- A HIT MEANS: a user holds a usable password. The app has no password UI
-- and provision-collaborator neither sets nor accepts one (audited
-- 2026-08-04) — the routes are service-role code, a live session calling
-- updateUser({password}), or the recovery flow (live: the built-in mailer
-- sends, see REVIEW.md). Respond by emptying it and finding out which route
-- set it:
--   update auth.users set encrypted_password = '' where id = '<id>';
select 'password surface: user holds a password' as finding,
       id::text, created_at, email, last_sign_in_at
from auth.users
where encrypted_password is not null and encrypted_password <> '';

-- ---------------------------------------------------------------------------
-- CHECK 3: the task history chain (slice 1).
-- ---------------------------------------------------------------------------
-- os_tasks and os_task_history were created TOGETHER (20260804000046), so
-- unlike the cell note columns there is no pre-migration null case — the
-- value columns are NOT NULL by constraint, and the trigger writes birth
-- rows from '' for all five content fields on INSERT. That buys a stronger
-- invariant than the cell chain: every field of every live task must have
-- an unbroken chain from '' to the live value. Four ways it can break, four
-- arms below.
--
-- A HIT MEANS: something wrote to os_tasks outside the write-guard trigger
-- (or history was tampered with, which no policy permits). Find the write
-- path and close it; do not repair the chain by editing history — it is
-- append-only evidence. History rows whose task no longer exists are NOT
-- findings: the owner may delete tasks and history outlives the row.
with rendered as (
  select t.id as task_id, f.field,
         case f.field
           when 'title'    then t.title
           when 'detail'   then t.detail
           when 'status'   then t.status
           when 'due_date' then coalesce(t.due_date::text, '')
           when 'assignee' then coalesce(t.assignee::text, '')
         end as live_value
  from public.os_tasks t
  cross join (values ('title'), ('detail'), ('status'), ('due_date'), ('assignee')) as f(field)
),
ordered as (
  select h.task_id, h.field, h.changed_at, h.from_value, h.to_value,
         row_number() over w as rn,
         lead(h.from_value) over w as next_from
  from public.os_task_history h
  window w as (partition by h.task_id, h.field order by h.changed_at)
)
select 'task chain: live field has no history at all' as finding,
       r.task_id, r.field, null::timestamptz as changed_at,
       r.live_value as to_value, null as expected
from rendered r
where not exists (select 1 from ordered o
                  where o.task_id = r.task_id and o.field = r.field)
union all
select 'task chain: first row does not start from empty',
       o.task_id, o.field, o.changed_at, o.from_value, ''
from ordered o
where o.rn = 1 and o.from_value <> ''
union all
select 'task chain: mid-chain break',
       o.task_id, o.field, o.changed_at, o.to_value, o.next_from
from ordered o
where o.next_from is not null and o.to_value is distinct from o.next_from
union all
select 'task chain: tip disagrees with live row',
       o.task_id, o.field, o.changed_at, o.to_value, r.live_value
from ordered o
join rendered r on r.task_id = o.task_id and r.field = o.field
where o.next_from is null and o.to_value is distinct from r.live_value;

-- ---------------------------------------------------------------------------
-- CHECK 4: the project-membership domain boundary.
-- ---------------------------------------------------------------------------
-- Since migration 20260804000047 only WORK projects are grantable — a
-- trigger refuses everything else, the owner path included, and
-- os_member_projects() filters by domain so a wrong row would be inert
-- anyway. This check watches for the case the trigger cannot see: a
-- membership row whose project's domain was CHANGED after the grant (or a
-- row written past the trigger).
--
-- A HIT MEANS: a grant points at a non-WORK project. It grants nothing
-- (layers two and three filter it), but it should not exist. Delete the
-- row; if the project's domain was flipped on purpose, decide whether its
-- grants should have survived the flip — they deliberately do not.
select 'project membership: grant on a non-WORK project' as finding,
       m.user_id::text, m.project_id::text as project_id, m.created_at,
       coalesce(p.domain, 'no such project') as domain
from public.os_project_members m
left join public.os_projects p on p.id = m.project_id
where p.domain is distinct from 'work';
