-- Down-migration for 20260820000086_process_forms_and_phase_tracks.
-- Removes the second axis: the form column, the phase track scope, and the
-- vocabulary table. REFUSES while anything still uses either column — a
-- step carrying a form or a phase carrying a track is somebody's authored
-- structure, and dropping the column would destroy it silently. Run the
-- retrack and trading-seed downs (88 then 87) first; they clear the users.
do $$
declare
  n_forms integer;
  n_tracked integer;
begin
  select count(*) into n_forms from public.os_process_steps where form is not null;
  select count(*) into n_tracked from public.os_process_phases where track is not null;
  if n_forms > 0 or n_tracked > 0 then
    raise exception
      'Sumbu kedua masih dipakai: % step ber-form, % fase ber-track. Jalankan down 88 lalu 87 dulu — menghapus kolomnya sekarang membuang struktur yang sudah ditulis.',
      n_forms, n_tracked;
  end if;
end
$$;

alter table public.os_process_phases drop constraint if exists os_process_phases_track_fk;
alter table public.os_process_phases drop column if exists track;

alter table public.os_process_steps drop constraint if exists os_process_steps_form_fk;
alter table public.os_process_steps drop column if exists form;

drop policy if exists "require app key to select" on public.os_process_forms;
drop policy if exists "require app key to insert" on public.os_process_forms;
drop policy if exists "require app key to update" on public.os_process_forms;
drop policy if exists "require app key to delete" on public.os_process_forms;
drop policy if exists "member reads own-entity rows" on public.os_process_forms;
drop table if exists public.os_process_forms;

comment on table public.os_process_phases is
  'The ribbon above the diagram, per entity. Phases must tile slot 1..max(slot) exactly once PER ENTITY — asserted in frontend logic tests, not enforceable here.';
