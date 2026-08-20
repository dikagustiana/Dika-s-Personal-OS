-- Down-migration for 20260820000088_kgr_trading_seed.
-- Empties the trading chain only: its needs (through the steps), its ten
-- steps, and its five TRADING-scoped phases. DESTROYS HAND-ENTERED
-- requested_on DATES and any status edits on the trading needs — export
-- os_process_needs first if the register has been worked. The 38-step
-- slaughter chain, the RPA/TRADING vocabulary and the default ribbon are
-- untouched; unwinding those is 20260820000087's down.

delete from public.os_process_needs
 where step_id in (
   select id from public.os_process_steps
   where entity_code = 'KGR' and track = 'TRADING'
 );

delete from public.os_process_steps
 where entity_code = 'KGR' and track = 'TRADING';

delete from public.os_process_phases
 where entity_code = 'KGR' and track = 'TRADING';
