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
-- but it is INERT while no user has a password. A non-null
-- encrypted_password means the grant can succeed for that user — a
-- credential that does not expire, entered through no owner-provisioned
-- path.
--
-- A HIT MEANS: a user holds a password we did not issue. The app has no
-- password UI and provision-collaborator neither sets nor accepts one
-- (audited 2026-08-04) — the routes are service-role code, a live session
-- calling updateUser({password}), or the recovery flow (live: the built-in
-- mailer sends, see REVIEW.md). Respond by nulling it and finding out which
-- route set it:
--   update auth.users set encrypted_password = null where id = '<id>';
select 'password surface: user holds a password' as finding,
       id::text, created_at, email, last_sign_in_at
from auth.users
where encrypted_password is not null;
