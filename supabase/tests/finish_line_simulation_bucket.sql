-- ===========================================================================
-- THE FINISH LINE SIMULATION BUCKET: PRIVATE, CAPPED, AND POLICY-FREE.
-- ===========================================================================
--
-- Same contract as every suite here: ZERO ROWS when healthy; any row it
-- returns names what broke.
--
-- LIVE ONLY. Run it against production after applying 20260928000108:
--
--     psql "$DATABASE_URL" -f supabase/tests/finish_line_simulation_bucket.sql
--
-- or paste it into the SQL editor. The local replay cluster has no storage
-- schema, so there it returns exactly one row, "LIVE ONLY", on purpose: a
-- check that cannot see what it checks must not read as healthy.
--
-- Catalog-only and read-only. It reads storage.buckets and pg_policies and
-- never an object; it runs in a transaction that ends in ROLLBACK.
--
-- What it asserts, and why each matters:
--   * the bucket exists                  — else the tab reads bucket-missing
--   * public = false                     — a public bucket serves the build to
--                                          anyone holding a URL, no key needed
--   * file_size_limit = 3145728          — the same line the SIM-SIZE guard draws
--   * allowed_mime_types = the two types — text/html + application/json only
--   * NO policy names the bucket         — the owner has no auth.uid(); any
--                                          policy here serves someone else
--   * NO storage.objects policy ignores bucket_id — a policy with no bucket
--                                          condition reaches EVERY bucket,
--                                          this one included, without naming it
--   * RLS is on for storage.objects      — without it no policy is needed at all
--
-- Known limit: a policy that DOES mention bucket_id without naming this bucket
-- (`bucket_id <> 'x'`) still reaches it. The check does not parse predicates;
-- it catches the two shapes that have to be caught by eye otherwise.

begin;

create temp table sim_bucket_findings (finding text);

do $$
declare
  v_public boolean;
  v_limit bigint;
  v_mimes text[];
  v_rls boolean;
  v_rows int;
  r record;
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    insert into sim_bucket_findings values
      ('LIVE ONLY: no storage schema here (the local replay has none). Run this file against production.');
    return;
  end if;

  -- AUDIT INERT: the policy catalog must be visible to this role. The app's
  -- own tables carry RLS policies in schema public; if pg_policies shows none
  -- there, "no policy names the bucket" below would be true of a blind query.
  if not exists (select 1 from pg_policies where schemaname = 'public') then
    insert into sim_bucket_findings values
      ('AUDIT INERT: pg_policies shows no policy in schema public — this role cannot see the policy catalog, so the policy checks below prove nothing.');
  end if;

  -- Dynamic so the block never names storage.buckets statically. EXECUTE
  -- does NOT set FOUND — only ROW_COUNT tells whether the row came back. This
  -- check read a present bucket as missing until that line existed; the
  -- scratch harness that drove it both ways is what caught it.
  execute 'select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1'
    into v_public, v_limit, v_mimes
    using 'finish-line-simulation';
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    insert into sim_bucket_findings values
      ('BUCKET MISSING: storage.buckets has no finish-line-simulation row. Apply 20260928000108.');
  else
    if v_public is distinct from false then
      insert into sim_bucket_findings values
        ('BUCKET PUBLIC: finish-line-simulation has public = true. Anyone with an object URL can read the build without a key.');
    end if;
    if v_limit is distinct from 3145728 then
      insert into sim_bucket_findings values (format(
        'SIZE LIMIT: file_size_limit is %s, expected 3145728 (the SIM-SIZE line).', coalesce(v_limit::text, 'null')));
    end if;
    if (select array_agg(m order by m) from unnest(v_mimes) as m)
         is distinct from array['application/json', 'text/html'] then
      insert into sim_bucket_findings values (format(
        'MIME TYPES: allowed_mime_types is %s, expected exactly {application/json,text/html}.', coalesce(v_mimes::text, 'null')));
    end if;
  end if;

  for r in
    select tablename, policyname
      from pg_policies
     where schemaname = 'storage'
       and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%finish-line-simulation%'
  loop
    insert into sim_bucket_findings values (format(
      'POLICY NAMES THE BUCKET: storage.%s policy %L mentions finish-line-simulation. The bucket must carry no policy.',
      r.tablename, r.policyname));
  end loop;

  for r in
    select policyname
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not ilike '%bucket_id%'
  loop
    insert into sim_bucket_findings values (format(
      'POLICY REACHES EVERY BUCKET: storage.objects policy %L has no bucket_id condition, so it applies to finish-line-simulation too.',
      r.policyname));
  end loop;

  select relrowsecurity into v_rls from pg_class where oid = to_regclass('storage.objects');
  if v_rls is distinct from true then
    insert into sim_bucket_findings values
      ('RLS OFF: row level security is disabled on storage.objects — every bucket is readable without any policy.');
  end if;
end $$;

select finding from sim_bucket_findings order by finding;

rollback;
