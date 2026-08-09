-- Down-migration for 20260809000069_text_history_actor.
-- Removes the actor pair from os_process_text_history and the trigger that
-- stamps it. The rows themselves survive; what is lost is the attribution on
-- every edit recorded while the columns existed, and that loss is NOT
-- recoverable — no other table records who edited process text.
--
-- Order matters: the trigger goes first, because dropping actor_kind while a
-- BEFORE INSERT trigger still assigns to it would leave every subsequent
-- insert raising on a missing field.
--
-- The two policies from 20260806000055 are deliberately untouched. This
-- migration never added, altered, or removed a policy, so its reversal has no
-- policy to restore — the table was append-only before and stays append-only
-- after.

drop trigger if exists os_process_text_history_stamp_actor
  on public.os_process_text_history;
drop function if exists public.os_process_text_history_stamp_actor();

drop index if exists public.os_process_text_history_actor_idx;

alter table public.os_process_text_history
  drop constraint if exists os_process_text_history_actor_kind_chk;

alter table public.os_process_text_history
  drop column if exists actor_kind,
  drop column if exists actor;
