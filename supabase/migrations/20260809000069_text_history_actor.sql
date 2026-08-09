-- ===========================================================================
-- os_process_text_history LEARNS WHO. Closing a gap in its own specification.
-- ===========================================================================
-- The two other history tables in this schema both carry the same pair:
--
--   os_finish_line_cell_history   actor_kind text NOT NULL, actor uuid NULL
--   os_task_history               actor_kind text NOT NULL, actor uuid NULL
--   os_process_text_history       -- nothing at all
--
-- The third was written without them. That was an omission in the spec that
-- created it, not a decision: nothing in migration 20260806000055 argues for
-- an unattributed trail, and its own header cites os_finish_line_cell_history
-- as the precedent it is following. An audit row that cannot say who wrote it
-- answers half the question it exists to answer.
--
-- So: the SAME two columns, with the SAME types and the SAME nullability. Not
-- a third variant — `actor_kind text not null` and `actor uuid` null, matched
-- against the live definitions of both other tables rather than reconstructed
-- from memory.
--
-- ===========================================================================
-- WHY actor IS NULLABLE WHILE actor_kind IS NOT — the same reason as the other
-- two, and it is not laziness.
-- ===========================================================================
-- The owner does not authenticate with a JWT. public.os_key_valid() compares
-- the `x-app-key` request header against a bcrypt hash in private.os_app_secret;
-- there is no auth.uid() in that session and there is no row in auth.users
-- standing for "the owner". So an owner write has a KIND ('owner') and no
-- IDENTIFIER, and the honest encoding of that is exactly what the other two
-- tables already do: actor_kind not null, actor null.
--
-- ===========================================================================
-- NO BACKFILL, BECAUSE THERE IS NOTHING TO BACK FILL.
-- ===========================================================================
-- os_process_text_history holds ZERO rows live (verified before writing this).
-- That is why `set not null` can go on directly with no default and no repair
-- statement — there is no historical row that would need an invented actor.
-- Had there been one, the correct move would have been to leave the column
-- nullable rather than stamp a guess onto history.
--
-- ===========================================================================
-- THE ACTOR IS STAMPED BY A TRIGGER, NEVER SENT BY THE CLIENT. THIS IS THE
-- FINDING THAT SHAPED THIS MIGRATION.
-- ===========================================================================
-- The other two tables never had this problem: their rows are written from
-- inside SECURITY DEFINER write-guard triggers on os_finish_line_cells and
-- os_tasks, which derive the actor from the session and hand it to the insert.
-- os_process_text_history is different — its rows come from a PLAIN CLIENT
-- INSERT (appendProcessTextHistory in src/data/supabaseRepository.ts), and
-- that call site cannot know the actor:
--
--   * for the owner there is no identity to read — auth.uid() is null and the
--     only proof of who is writing is a header the database checks, not the
--     browser;
--   * anything the client DID send would be a claim, not evidence. An audit
--     column that the audited party fills in is decoration.
--
-- So the write path is left exactly as it is — it still inserts the same five
-- columns it inserts today — and a BEFORE INSERT trigger derives both values
-- server-side with the identical branch the other two guards use. A
-- client-supplied actor_kind or actor is OVERWRITTEN unconditionally, so the
-- column cannot be spoofed even if a future caller starts sending one.
--
-- The third branch RAISES rather than inventing a value. Today it is
-- unreachable — the only INSERT policy on this table requires os_key_valid()
-- — but if a member policy is ever added here, an unattributable row must fail
-- loudly instead of being recorded as somebody.
--
-- ===========================================================================
-- APPEND-ONLY IS UNCHANGED. NOTHING BELOW ADDS A POLICY.
-- ===========================================================================
-- The table keeps exactly the two policies migration 20260806000055 gave it —
-- "require app key to select" and "require app key to insert". There is no
-- UPDATE policy and no DELETE policy here, before or after this migration, and
-- with RLS enabled an absent policy is a denial. Do not add them.
--
-- APPLIED 2026-08-09 via the Supabase apply_migration tool (ledger name
-- `text_history_actor`, live version 20260809131539). NEVER apply with
-- `supabase db push`, `migration up`, `db reset`, or `db remote commit` —
-- this repo's filenames and the live ledger's versions are different
-- numbering schemes, and any of those replays history from 0001 against
-- production data.
--
-- Verified live after applying, against a table that still holds zero rows:
--   * all three history tables now read actor_kind text NOT NULL + actor uuid
--     NULL, checked in information_schema side by side;
--   * an insert with neither app key nor JWT was REFUSED by the raise branch
--     rather than recorded with an invented actor;
--   * an insert carrying a deliberately spoofed actor_kind='owner' and a fake
--     uuid came back stamped 'contributor' with the real auth.uid() — the
--     client's claim did not survive. (Probed inside a rolled-back
--     transaction, so the table is still empty.)
--
-- The frontend ships BEFORE this runs and must survive the gap. The two
-- not-yet states are DIFFERENT conditions and are handled separately:
--   42P01  the table is absent          -> the activity section does not render
--   42703  the table is there, these
--          columns are not              -> rows are read WITHOUT the actor pair
--                                         and shown as unattributed
-- One guard must never be widened to swallow the other; see
-- src/data/missingRelation.ts.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260809000069_text_history_actor_down.sql

-- 1. The columns, nullable first so the trigger below exists before NOT NULL
--    is asserted.
alter table public.os_process_text_history
  add column if not exists actor_kind text,
  add column if not exists actor      uuid;

comment on column public.os_process_text_history.actor_kind is
  'owner | contributor. Stamped by os_process_text_history_stamp_actor, never accepted from the client. Same type and nullability as os_finish_line_cell_history.actor_kind and os_task_history.actor_kind.';
comment on column public.os_process_text_history.actor is
  'auth.uid() for a contributor; NULL for the owner, who authenticates with the app-key header and has no auth.users row. Deliberately NO foreign key: an audit row must outlive the account it names, exactly as os_finish_line_cell_history.actor does.';

-- 2. The stamp. Same derivation as os_finish_line_cells_write_guard and the
--    os_tasks guard, so all three tables agree on what 'owner' means.
create or replace function public.os_process_text_history_stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.os_key_valid() then
    -- Owner: a kind, and no identifier to go with it.
    new.actor_kind := 'owner';
    new.actor := null;
  elsif (select auth.uid()) is not null then
    new.actor_kind := 'contributor';
    new.actor := (select auth.uid());
  else
    -- Unreachable through the current policy set, and deliberately fatal
    -- rather than fabricated if that ever changes.
    raise exception 'os_process_text_history: refusing to record an edit with no identifiable actor';
  end if;
  return new;
end;
$$;

revoke all on function public.os_process_text_history_stamp_actor() from public;
revoke all on function public.os_process_text_history_stamp_actor() from anon;
revoke all on function public.os_process_text_history_stamp_actor() from authenticated;

drop trigger if exists os_process_text_history_stamp_actor
  on public.os_process_text_history;
create trigger os_process_text_history_stamp_actor
  before insert on public.os_process_text_history
  for each row execute function public.os_process_text_history_stamp_actor();

-- 3. NOT NULL last. A BEFORE ROW trigger runs before the constraint is
--    checked, so every insert that reaches the table already carries a kind.
--    Zero existing rows, so this cannot fail on history.
alter table public.os_process_text_history
  alter column actor_kind set not null;

-- 4. The same value domain the other two tables constrain.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'os_process_text_history_actor_kind_chk') then
    alter table public.os_process_text_history
      add constraint os_process_text_history_actor_kind_chk
      check (actor_kind in ('owner', 'contributor'));
  end if;
end
$$;

-- 5. Reading one person's trail is the query this pair exists to serve.
create index if not exists os_process_text_history_actor_idx
  on public.os_process_text_history (actor, changed_at desc);
