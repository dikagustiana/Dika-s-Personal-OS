-- ===========================================================================
-- A PRIVATE BUCKET FOR THE FINISH LINE SIMULATION. NO POLICY, BY DESIGN.
-- ===========================================================================
--
-- The Finish line's fourth tab shows one offline HTML simulation that is built
-- in a separate repository. This repository only stores and serves the build
-- — it never builds, edits or copies the simulation's source — and the build
-- lives in Storage rather than in the tree because this repository is public.
--
-- ZERO storage.objects POLICIES FOR THIS BUCKET. The owner authenticates with
-- the passphrase (anon + x-app-key, 20260724000002) and so has no auth.uid();
-- every policy Storage can evaluate is keyed on a JWT subject, which means a
-- policy here could only ever serve somebody who is not the owner. Deny-by-
-- default IS the access model: the finish-line-simulation Edge Function is the
-- only door, under the service role, behind checkAppKey — the posture
-- lab-artifacts already has (20260817000073).
--
-- Limits: 3 MiB (3,145,728 bytes; the build is ~1.5 MB, and the function's
-- SIM-SIZE guard uses the same number, so both refuse at the same line) and
-- two MIME types — text/html for versions/*.html, application/json for
-- current.json. Anything else is refused by Storage itself, before the
-- function's own guards are ever consulted.
--
-- ON CONFLICT UPDATES rather than doing nothing. A bucket created by hand
-- under this name with public = true would otherwise survive this migration
-- untouched and read as applied. The three columns below are the contract,
-- and applying the migration makes them true.
--
-- Guarded like 073: the local replay cluster (scripts/lib/pg-cluster.sh) has
-- no storage schema, so there the block raises a notice and changes nothing.
--
-- Down-migration:
--   supabase/migrations/down/20260928000108_finish_line_simulation_bucket_down.sql
-- Standing check (live only — the replay has no storage schema):
--   supabase/tests/finish_line_simulation_bucket.sql

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'finish-line-simulation',
      'finish-line-simulation',
      false,
      3145728,
      array['text/html', 'application/json']
    )
    on conflict (id) do update
      set public             = excluded.public,
          file_size_limit    = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  else
    raise notice 'storage schema absent (local replay) — create the finish-line-simulation bucket live';
  end if;
end
$$;
