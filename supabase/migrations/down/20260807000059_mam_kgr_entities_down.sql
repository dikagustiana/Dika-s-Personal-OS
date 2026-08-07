-- Down-migration for 20260807000059_mam_kgr_entities.
-- Removes the MAM and KGR columns and their cells.
--
-- REFUSES to run unless both columns are still virgin, and "virgin" means
-- more than untouched cells:
--
--   * cells       — a state past `undefined` or a note is somebody's
--                   judgement; deleting it silently is the defect this repo
--                   keeps refusing to ship.
--   * memberships — os_entity_members.entity_code cascades on entity delete
--                   (20260804000037), so dropping the entity would silently
--                   revoke manually-provisioned access. Caught in review of
--                   this PR; the grant must be revoked deliberately, through
--                   the panel that logs it, never as a side effect.
--   * accounts    — os_finish_line_accounts.entity_code carries NO foreign
--                   key, so entity deletion would orphan account rows
--                   silently rather than fail.
--   * process     — the five os_process_* tables reference the entity with
--                   NO ACTION, so a seeded chain would abort this file
--                   anyway; checked here so the refusal names the reason
--                   instead of surfacing as a bare FK violation.
do $$
declare
  worked_cells integer;
  memberships  integer;
  accounts     integer;
  process_rows integer;
begin
  select count(*) into worked_cells
    from public.os_finish_line_cells
   where entity_code in ('MAM', 'KGR')
     and (state <> 'undefined' or note is not null);

  select count(*) into memberships
    from public.os_entity_members
   where entity_code in ('MAM', 'KGR');

  select count(*) into accounts
    from public.os_finish_line_accounts
   where entity_code in ('MAM', 'KGR');

  select count(*) into process_rows from (
    select 1 from public.os_process_tracks where entity_code in ('MAM', 'KGR')
    union all
    select 1 from public.os_process_lanes  where entity_code in ('MAM', 'KGR')
    union all
    select 1 from public.os_process_gates  where entity_code in ('MAM', 'KGR')
    union all
    select 1 from public.os_process_phases where entity_code in ('MAM', 'KGR')
    union all
    select 1 from public.os_process_steps  where entity_code in ('MAM', 'KGR')
  ) as p;

  if worked_cells > 0 or memberships > 0 or accounts > 0 or process_rows > 0 then
    raise exception
      'Kolom MAM/KGR sudah dirujuk: % sel tersentuh, % keanggotaan (akan ikut terhapus CASCADE), % akun (akan yatim — tanpa FK), % baris proses. Menghapus entitasnya sekarang membuang atau meyatimkan data itu diam-diam — bereskan dulu satu per satu, dengan sengaja.',
      worked_cells, memberships, accounts, process_rows;
  end if;
end
$$;

delete from public.os_finish_line_cells
 where entity_code in ('MAM', 'KGR');

delete from public.os_finish_line_entities
 where code in ('MAM', 'KGR');
