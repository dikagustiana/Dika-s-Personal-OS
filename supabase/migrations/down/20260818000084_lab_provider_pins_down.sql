-- Down-migration for 20260818000084_lab_provider_pins.
--
-- Restores the prior model strings and rates. The deepseek restore needs
-- the pin guard stepped around: the old value `deepseek-chat` is exactly
-- the digit-less alias the guard refuses on any model change — correctly.
-- A down-migration restores history, and history contained the alias, so
-- the trigger is disabled for that one statement and re-enabled at once.
-- NOTE what rolling back means here: deepseek-chat was retired by the
-- vendor on 2026-07-24, so the restored row is a dead pointer — this down
-- exists for ledger symmetry, not because the old state ever works again.

alter table public.os_lab_providers disable trigger os_lab_providers_pin_guard;

update public.os_lab_providers
   set model = 'deepseek-chat',
       cost_in_per_mtok = 0.27,
       cost_out_per_mtok = 1.10
 where name = 'deepseek';

alter table public.os_lab_providers enable trigger os_lab_providers_pin_guard;

-- kimi-k2-0905-preview carries digits; the guard passes it unaided.
update public.os_lab_providers
   set model = 'kimi-k2-0905-preview',
       cost_in_per_mtok = 0.60,
       cost_out_per_mtok = 2.50
 where name = 'kimi';
