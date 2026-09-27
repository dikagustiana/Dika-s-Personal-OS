-- DRAFT PHASE 5: aktifkan hanya setelah proxy reservation+daily tests lulus.
begin;
update lab_private.settings set enforce_daily=true,daily_limit_usd=20 where singleton;
-- $20/hari UTC ialah default desain, bukan prediksi tagihan; owner dapat ubah melalui RPC config.
-- Resume tidak me-reset usage ledger; unsettled reservations hari sebelumnya tetap dihitung.
commit;
