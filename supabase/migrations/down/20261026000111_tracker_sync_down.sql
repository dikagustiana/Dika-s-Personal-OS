-- Down-migration for 20261026000111_tracker_sync.sql
--
-- Stops the sync and drops its functions. The WORK tasks it created stay:
-- they are ordinary tasks now, some already ticked by the owner. To remove
-- the open ones too, run the commented delete at the end (review first:
--   select id, payload ->> 'title' from public.os_entries where payload ? 'tracker';).
-- Vault secrets tracker_sync_url / tracker_sync_token are removed. pg_net
-- stays installed (harmless; other features may come to use it).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'tracker-sync') then
    perform cron.unschedule('tracker-sync');
  end if;
end
$$;

drop function if exists private.os_tracker_sync_invoke();
drop function if exists public.os_tracker_sync_token_ok(text);
drop function if exists public.os_tracker_sync(jsonb);
drop function if exists private.os_tracker_task_payload(jsonb, text);

delete from vault.secrets where name in ('tracker_sync_url', 'tracker_sync_token');

-- delete from public.os_entries
--  where payload ? 'tracker' and coalesce(payload -> 'done' = 'true'::jsonb, false) = false;
