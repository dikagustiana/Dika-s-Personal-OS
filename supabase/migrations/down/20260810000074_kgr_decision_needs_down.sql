-- Down-migration for 20260810000074_kgr_decision_needs.
--
-- Removes exactly the five needs that file added, matched on (step label,
-- item) and scoped to KGR. Nothing else in os_process_needs is reachable from
-- here: the delete joins through os_process_steps on entity_code = 'KGR', so
-- SAMB and ARBI needs cannot be touched even if an item string collided.
--
-- MATCHES ON TEXT, WHICH IS THE RISK. `item` is app-editable. If someone has
-- reworded one of these five, its delete silently matches nothing and the row
-- survives — the same weakness the seed's own needs guard carries, and for the
-- same reason: there is no stable natural key on a need beyond its text.
-- Check the five items still read as below before relying on this file.
--
-- After running this, KGR is back to 117 needs (ADA 9 · SEBAGIAN 34 ·
-- BELUM 74). The COA that migration 73 added to step 27 is NOT removed here —
-- that is 73's text and belongs to 73's down-migration.

delete from public.os_process_needs n
using public.os_process_steps s
where n.step_id = s.id
  and s.entity_code = 'KGR'
  and (s.label, n.item) in (
    ('20', 'Back-test harga referensi terhadap harga jual terealisasi per SKU per periode'),
    ('20', 'Ambang penyimpangan harga referensi vs terealisasi yang wajib revisi'),
    ('27', 'Biaya angkut keluar per pengiriman — armada sendiri atau jasa pihak ketiga/entity grup'),
    ('27', 'Syarat penyerahan per pelanggan — franco gudang pembeli atau ambil sendiri'),
    ('30', 'Estimasi biaya simpan cold storage per satuan waktu — input keputusan disposisi, bukan biaya persediaan')
  );
