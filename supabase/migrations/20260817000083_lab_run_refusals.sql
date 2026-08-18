-- =============================================================================
-- LAB RUN REFUSALS: the skipped/blocked lines persist on the run row (5.6).
-- =============================================================================
--
-- APPLIED 2026-08-18 via the Supabase apply_migration tool (ledger name
-- `lab_run_refusals`). Verified live after applying: information_schema
-- shows os_lab_runs.refusals jsonb, not null, default '[]'::jsonb; a
-- service-role UPDATE writing a two-element array to a probe row read back
-- intact and was rolled back; an anon PATCH against the column stayed
-- refused (no UPDATE policy exists on os_lab_runs — runs are read-only from
-- the client, as 20260817000073 established). Never `supabase db push` /
-- `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260817000083_lab_run_refusals_down.sql.
--
-- WHY A COLUMN, NOT A TABLE. The hardening pass (079 + the executor half)
-- built four new classes of refusal — the echo check, the WIP cap, the tag
-- and quote rejections, G-EXTRACT's malformed-field skips — and every one
-- of them was returned in the HTTP response body and then lost. A console
-- cannot show history that was never stored. The run row is already the
-- record of what happened in a run, so the refusals it produced belong ON
-- it; a second table would be a second source of truth about the same
-- event. The WIP-cap refusal is the one class that stays response-only BY
-- CONSTRUCTION: it fires before any run row exists (nothing was billed, so
-- nothing ran), and its standing condition — the IND count against the cap
-- — is derivable live, which is where the Flow surface shows it.
--
-- The executor (run-evidence-agent) writes the array at run completion,
-- service-role. Clients cannot: os_lab_runs has SELECT-only RLS and no
-- write policies, so a run log the client could edit stays impossible —
-- including this column.

alter table public.os_lab_runs
  add column if not exists refusals jsonb not null default '[]'::jsonb;

comment on column public.os_lab_runs.refusals is
  'What this run''s handler refused, line by line, written by the executor '
  'at run completion. A refusal is the system working correctly — the '
  'console renders these as quiet monospace, never as errors. []: nothing '
  'was refused. The WIP-cap refusal never appears here: it fires before a '
  'run row exists, and its condition (IND count vs cap) is derived live.';
