-- ===========================================================================
-- A READ-ONLY CREDENTIAL: SATISFIES SELECT, FAILS EVERY WRITE.
-- ===========================================================================
-- Splitting the FOR ALL policies into 84 made the read/write distinction
-- expressible. It enforced nothing: all four commands carried an identical
-- predicate, so one key still granted read AND write, and sharing the
-- passphrase would have let the recipient delete milestones.
--
-- This adds a SECOND credential that satisfies reads and fails writes.
--
-- os_key_valid() IS DELIBERATELY UNTOUCHED — same body, same volatility, same
-- security context, same definition fingerprint. The read-only key gets its
-- OWN function rather than widening the existing one: widening it would mean
-- the write path silently starts accepting the read key the moment anyone
-- reuses the function, which is exactly the kind of change that looks like a
-- refactor and is a permission grant.
--
-- SELECT accepts either key. INSERT / UPDATE / DELETE keep the owner-only
-- predicate, unchanged. Every predicate stays subquery-wrapped, WITH CHECK
-- included — dropping that reintroduces per-row bcrypt on writes, the defect
-- that produced a live 500, showing up as a slow save instead of an error.
--
-- The hash lives in the same private schema and the same shape as the owner
-- key: not a public table, not a VITE_ variable, never retrievable.

-- 1. Storage for the second hash -----------------------------------------
create table if not exists private.os_read_key (
  id boolean primary key default true check (id), -- at most one row
  key_hash text not null
);

-- 'unset' means no read-only key is issued yet, and os_read_key_valid()
-- returns false for every candidate until one is. The owner sets it with:
--   update private.os_read_key
--      set key_hash = extensions.crypt('the-passphrase', extensions.gen_salt('bf'));
insert into private.os_read_key (key_hash)
values ('unset')
on conflict (id) do nothing;

-- 2. The read-only key's own check ---------------------------------------
-- Same shape as os_key_valid: SECURITY DEFINER to read the private table,
-- STABLE so a policy that wraps it in a scalar subquery evaluates it once per
-- statement rather than once per row.
create or replace function public.os_read_key_valid()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate text;
  stored text;
begin
  candidate := coalesce(
    current_setting('request.headers', true)::json ->> 'x-app-key',
    ''
  );
  select key_hash into stored from private.os_read_key;
  if candidate = '' or stored is null or stored = 'unset' then
    return false;
  end if;
  return extensions.crypt(candidate, stored) = stored;
end;
$$;

revoke all on function public.os_read_key_valid() from public;
grant execute on function public.os_read_key_valid() to anon, authenticated;

-- 3. SELECT accepts either key; writes stay owner-only --------------------
-- Only the SELECT policies are rewritten. The three write policies are not
-- touched at all, so there is no way for this migration to widen a write.
-- Enumerated from pg_policy at execution time rather than hardcoded, so a
-- table added since this file was written is covered too, and re-running is a
-- no-op (a rewritten SELECT predicate already names os_read_key_valid).
do $$
declare
  pol record;
begin
  for pol in
    select n.nspname as schema_name, c.relname as table_name, p.polname as policy_name
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and p.polcmd = 'r'                                             -- SELECT only
      and pg_get_expr(p.polqual, p.polrelid) ilike '%os_key_valid%'
      and pg_get_expr(p.polqual, p.polrelid) not ilike '%os_read_key_valid%'
  loop
    execute format(
      'alter policy %I on %I.%I using
         ((select public.os_key_valid()) or (select public.os_read_key_valid()))',
      pol.policy_name, pol.schema_name, pol.table_name);
    raise notice 'select policy now accepts either key on %.%',
      pol.schema_name, pol.table_name;
  end loop;
end $$;
