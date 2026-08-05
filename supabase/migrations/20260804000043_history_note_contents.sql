-- ===========================================================================
-- HISTORY STORES NOTE CONTENTS — a boolean cannot answer "what did it say".
-- ===========================================================================
-- os_finish_line_cell_history recorded note_changed as a flag, so a note's
-- previous value was unrecoverable, not merely unrecorded. That already cost
-- one value during live verification (Sales — General Trade › ASI, the
-- note_changed row at 2026-08-04 16:54). For a matrix whose output faces
-- external scrutiny, the note is arguably more load-bearing than the state:
-- the state says a number exists, the note says what is wrong with it.
--
-- BOTH SIDES ARE STORED, deliberately redundant: to_note of row N must equal
-- from_note of row N+1, and the final to_note must equal the live cell note.
-- Every row is self-contained AND the chain is a gap detector — a break means
-- something wrote to a cell outside the trigger. The standing integrity query
-- lives in REVIEW.md.
--
-- NULL MEANS "NOT RECORDED", AND ONLY THAT. The trigger writes
-- coalesce(note, ''), so an empty note is '' and never null; the rows that
-- predate this migration keep null; the column comments pin the meaning. A
-- null in these columns is therefore unambiguous evidence of a pre-migration
-- row.
--
-- note_changed is KEPT exactly as it is — it has callers, and to_note IS
-- DISTINCT FROM from_note is not its drop-in replacement on pre-migration
-- rows (their notes are null).
--
-- Idempotent throughout. Down-migration lives in the repo:
-- supabase/migrations/down/20260804000043_history_note_contents_down.sql

alter table public.os_finish_line_cell_history
  add column if not exists from_note text,
  add column if not exists to_note text;

-- The 3 rows written before this migration keep null: their note values were
-- never captured and null is the honest record of that.

comment on column public.os_finish_line_cell_history.from_note is
  'The cell note before this write; '''' when the note was empty. NULL occurs only in rows written before migration 20260804000043, when note contents were not captured.';
comment on column public.os_finish_line_cell_history.to_note is
  'The cell note after this write; '''' when the note was empty. NULL occurs only in rows written before migration 20260804000043, when note contents were not captured. to_note of row N equals from_note of row N+1 and the final to_note equals the live cell note — see the chain check in REVIEW.md.';

-- The write guard, with note capture in the ONE history insert both branches
-- share. Everything else — owner pass-through, contributor membership check,
-- column-allowlist diff, input → figure rule, actor stamping — is unchanged
-- from 20260804000039.
create or replace function public.os_finish_line_cells_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_entities text[];
  offending text[];
begin
  if public.os_key_valid() then
    -- Owner branch: no transition restriction whatsoever. Stamped, logged,
    -- through.
    new.actor_kind := 'owner';
    new.actor := null;
  else
    if auth.uid() is null then
      raise exception 'finish line cells: writes require the owner key or an authenticated contributor';
    end if;

    member_entities := public.os_member_entities();
    if not (old.entity_code = any (member_entities)) then
      raise exception 'finish line cells: % is not one of your entities', old.entity_code;
    end if;

    select array_agg(d.key order by d.key) into offending
    from (
      select coalesce(o.key, n.key) as key, o.value as ov, n.value as nv
      from jsonb_each(to_jsonb(old)) as o(key, value)
      full join jsonb_each(to_jsonb(new)) as n(key, value) on n.key = o.key
    ) as d
    where d.ov is distinct from d.nv
      and d.key not in ('state', 'note', 'updated_at', 'actor', 'actor_kind', 'changed_at');
    if offending is not null then
      raise exception 'finish line cells: contributors may only change state and note (blocked: %)',
        array_to_string(offending, ', ');
    end if;

    if new.state is distinct from old.state
       and not (old.state = 'input' and new.state = 'figure') then
      raise exception 'finish line cells: a contributor may only move a cell forward from input to figure (attempted % -> %)',
        old.state, new.state;
    end if;

    new.actor_kind := 'contributor';
    new.actor := (select auth.uid());
  end if;

  new.changed_at := now();
  new.updated_at := now();

  if new.state is distinct from old.state or new.note is distinct from old.note then
    insert into public.os_finish_line_cell_history
      (cell_id, from_state, to_state, note_changed, from_note, to_note,
       actor_kind, actor, changed_at)
    values
      (new.id, old.state, new.state,
       new.note is distinct from old.note,
       coalesce(old.note, ''), coalesce(new.note, ''),
       new.actor_kind, new.actor, new.changed_at);
  end if;

  return new;
end;
$$;

revoke all on function public.os_finish_line_cells_write_guard() from public;
revoke all on function public.os_finish_line_cells_write_guard() from anon;
revoke all on function public.os_finish_line_cells_write_guard() from authenticated;
