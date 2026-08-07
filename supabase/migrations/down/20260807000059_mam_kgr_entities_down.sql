-- Down-migration for 20260807000059_mam_kgr_entities.
-- Removes the MAM and KGR columns and their cells.
--
-- REFUSES to run if either column has been worked: a cell that has left
-- `undefined` or carries a note is a record of someone's judgement, and a
-- down-migration that silently destroys judgement is the same defect as a
-- seed that silently duplicates. Clear the cells deliberately first if the
-- columns really must go.
do $$
begin
  if exists (
    select 1 from public.os_finish_line_cells
    where entity_code in ('MAM', 'KGR')
      and (state <> 'undefined' or note is not null)
  ) then
    raise exception
      'Sel MAM/KGR sudah disentuh (ada state di luar undefined atau catatan). Menghapus kolomnya sekarang membuang penilaian orang — kosongkan dulu dengan sengaja kalau memang mau.';
  end if;
end
$$;

delete from public.os_finish_line_cells
 where entity_code in ('MAM', 'KGR');

delete from public.os_finish_line_entities
 where code in ('MAM', 'KGR');
