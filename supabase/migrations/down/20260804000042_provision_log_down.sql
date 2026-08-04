-- Down-migration for 20260804000042_provision_log.
-- Destroys the provisioning audit trail — that is what removing an audit
-- table means; export it first if it must survive. The provision-collaborator
-- Edge Function must be retired before this runs, or its logging calls will
-- fail loudly (which is the correct failure: an unlogged provisioning action
-- must not succeed silently).

drop function if exists public.os_provision_record(text, text, text[]);
drop table if exists private.os_provision_log;
