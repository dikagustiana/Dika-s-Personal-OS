-- Down-migration for 20260820000087_kgr_retrack_sourcing.
-- Restores the KARKAS/OLAHAN branch axis from the form column, which is
-- where the retrack preserved it: slots 14, 15, 21 return to OLAHAN and 17
-- to KARKAS, everything else RPA carried returns to KEDUANYA, and the
-- RPA/TRADING vocabulary goes. REFUSES while trading steps exist — run
-- 20260820000088's down first, or the vocabulary delete below would fail on
-- the FK anyway; refusing by name beats a bare constraint error.
do $$
begin
  if exists (select 1 from public.os_process_steps where entity_code = 'KGR' and track = 'TRADING') then
    raise exception
      'Rantai TRADING masih terseed (down 20260820000088 belum jalan). Urutan pembongkaran: 88 dulu, baru 87.';
  end if;
end
$$;

insert into public.os_process_tracks (entity_code, code, label, ordinal, is_shared) values
  ('KGR', 'KARKAS', 'KARKAS', 1, false),
  ('KGR', 'OLAHAN', 'OLAHAN', 2, false)
on conflict (entity_code, code) do nothing;

update public.os_process_steps
   set track = form
 where entity_code = 'KGR' and form is not null;

update public.os_process_steps
   set track = 'KEDUANYA'
 where entity_code = 'KGR' and track = 'RPA';

update public.os_process_steps
   set form = null
 where entity_code = 'KGR';

delete from public.os_process_tracks
 where entity_code = 'KGR' and code in ('RPA', 'TRADING');

do $$
declare
  n_karkas integer;
  n_olahan integer;
  n_shared integer;
begin
  select count(*) into n_karkas from public.os_process_steps where entity_code = 'KGR' and track = 'KARKAS';
  select count(*) into n_olahan from public.os_process_steps where entity_code = 'KGR' and track = 'OLAHAN';
  select count(*) into n_shared from public.os_process_steps where entity_code = 'KGR' and track = 'KEDUANYA';
  if n_karkas <> 1 or n_olahan <> 3 or n_shared <> 34 then
    raise exception
      'Pemulihan v0.2 gagal: KARKAS % (harus 1), OLAHAN % (harus 3), KEDUANYA % (harus 34).',
      n_karkas, n_olahan, n_shared;
  end if;
end
$$;
