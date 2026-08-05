-- Down-migration for 20260804000043_history_note_contents.
-- Drops note capture and restores the 20260804000039 trigger body verbatim.
-- Note values recorded while G was live are DESTROYED with the columns —
-- export first if they must survive.

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
      (cell_id, from_state, to_state, note_changed, actor_kind, actor, changed_at)
    values
      (new.id, old.state, new.state,
       new.note is distinct from old.note,
       new.actor_kind, new.actor, new.changed_at);
  end if;

  return new;
end;
$$;

revoke all on function public.os_finish_line_cells_write_guard() from public;
revoke all on function public.os_finish_line_cells_write_guard() from anon;
revoke all on function public.os_finish_line_cells_write_guard() from authenticated;

alter table public.os_finish_line_cell_history drop column if exists from_note;
alter table public.os_finish_line_cell_history drop column if exists to_note;
