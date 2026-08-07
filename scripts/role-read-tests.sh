#!/usr/bin/env bash
# ===========================================================================
# THE PER-ROLE READ SUITE, AGAINST A REAL POSTGRES. NOT A MOCK.
# ===========================================================================
#
# Why this exists: on 7 August every os_process_* read threw `permission
# denied for function os_member_entities` in production, and the entire vitest
# suite stayed green. It could not have caught it. Every frontend test runs
# against a repository double, so no test in this repo had ever executed a
# SELECT as `anon` or as `authenticated` — the two roles that actually reach
# the database. A policy regression is invisible to a mock by construction.
#
# So this stands up a throwaway Postgres, replays every migration in the repo
# in filename order, seeds a fixture, and then reads all nine os_process_*
# tables under four role conditions. The invariant that matters most is not a
# row count: it is ZERO THROWS. That is what broke, and that is what is
# pinned.
#
# It is deliberately NOT part of `pnpm test`. CI has no Postgres, and a suite
# that silently skips is worse than one you have to run on purpose — it
# reports green for work it did not do. Run it after any migration that
# touches a policy, a grant, or a function used by a policy:
#
#     scripts/role-read-tests.sh
#
# Flags:
#   --keep     leave the cluster running and print the connection string
#   --port N   listen on N instead of 55432
#
# Requires the postgresql-16 server binaries and a non-root account to own the
# cluster (initdb refuses to run as root). Both are present on the standard
# image; if `initdb` is missing the script says so and exits 2 rather than
# pretending to pass.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT=55432
KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [ ! -x "$PGBIN/initdb" ]; then
  echo "FATAL: $PGBIN/initdb not found. Install postgresql-16 or set PGBIN." >&2
  exit 2
fi

# The socket directory has to be SHORT: Postgres caps the unix socket path at
# 107 bytes and a scratch path blows through that on its own.
SOCK="${SOCK:-/tmp/pgs-roletest}"
WORK="$(mktemp -d)"
PGDATA="$WORK/data"
# initdb will not run as root, so the cluster is owned by the postgres system
# account when we are root, and by the current user otherwise.
if [ "$(id -u)" -eq 0 ]; then RUNAS="postgres"; else RUNAS="$(id -un)"; fi

pg() { su "$RUNAS" -c "$*" ; }
psql_() {
  su "$RUNAS" -c "$PGBIN/psql -h $SOCK -p $PORT -U postgres -d ${2:-ostest} -X -q -v ON_ERROR_STOP=1 $1"
}

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo ""
    echo "cluster kept:  psql -h $SOCK -p $PORT -U postgres -d ostest"
    echo "stop it with:  $PGBIN/pg_ctl -D $PGDATA stop"
    return
  fi
  pg "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1
  rm -rf "$WORK" "$SOCK"
}
trap cleanup EXIT

echo "==> cluster in $PGDATA (socket $SOCK, port $PORT)"
mkdir -p "$PGDATA" "$SOCK"
chown -R "$RUNAS" "$WORK" "$SOCK"
chmod 711 "$WORK"
pg "$PGBIN/initdb -D $PGDATA -U postgres --no-sync -A trust" >/dev/null 2>&1 || {
  echo "FATAL: initdb failed" >&2; exit 2; }
pg "$PGBIN/pg_ctl -D $PGDATA -o \"-k $SOCK -p $PORT -c listen_addresses=''\" -l $WORK/log start -w" >/dev/null 2>&1 || {
  echo "FATAL: server did not start; log follows" >&2; cat "$WORK/log" >&2; exit 2; }

# --- the Supabase shim ----------------------------------------------------
# Everything the migrations expect from a Supabase project and nothing more:
# three roles, the `extensions` and `auth` schemas, auth.uid() reading the
# same GUC PostgREST sets, and a stand-in auth.users carrying only the columns
# the migrations actually reference. Roles are cluster-wide, so this is
# written to survive being run twice.
cat > "$WORK/shim.sql" <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
    then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
    then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')
    then create role service_role nologin; end if;
end
$$;

-- pgcrypto goes in `extensions` and ONLY there. Creating it in public first
-- makes the second create a silent no-op, and then extensions.crypt() and
-- extensions.gen_salt() do not exist — which is how the owner's passphrase
-- path fails with a confusing "function does not exist" three steps later.
-- gen_random_uuid() is core since PG13 and needs no extension.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;
grant usage on schema extensions, auth, public to anon, authenticated, service_role;

-- PostgREST puts the verified JWT in request.jwt.claims; auth.uid() is the
-- `sub` claim. Null when there is no JWT, which is the whole anon story.
-- The doubled nullif matches GoTrue's own definition and is load-bearing: the
-- GUC is '' rather than absent once anything has set it, and ''::jsonb throws
-- a cast error that would masquerade as the permission failure this suite
-- exists to detect.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
           '')::uuid
$$;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text default '',
  last_sign_in_at    timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now()
);

-- Supabase grants the API roles table privileges and lets RLS do the gating.
-- Mirroring that matters: without it every table would deny on privilege
-- rather than on policy, and the suite would pass for the wrong reason.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL

psql_ "-c 'drop database if exists ostest;' -c 'create database ostest;'" postgres >/dev/null 2>&1
psql_ "-f $WORK/shim.sql" || { echo "FATAL: shim failed" >&2; exit 2; }
echo "==> shim applied"

# --- stand-ins for data the repo does not carry ---------------------------
# ===========================================================================
# THE REPO CANNOT REPLAY INTO AN EMPTY DATABASE ON ITS OWN. THIS IS REAL.
# ===========================================================================
# os_finish_line_items and os_finish_line_entities are CREATED by migrations
# 20260726000020 and 20260726000025 and populated by NO MIGRATION AT ALL —
# live's 55 items and 5 entities were written from outside the repo. The SAMB
# and ARBI process seeds then reference 22 of those item uuids as literals
# through the os_process_step_items foreign key, so a from-scratch replay dies
# at 20260806000051 with a FK violation.
#
# That is a genuine gap in the repo, not a quirk of this script, and it is
# reported rather than papered over: closing it means seeding os_finish_line_*
# rows, which is explicitly out of scope here. So the script generates the
# minimum scaffolding to get the process tables standing, and generates it BY
# READING THE SEEDS, so it can never drift from what they reference.
#
# These rows are stand-ins. Their text is deliberately unusable-looking so
# nobody mistakes a cluster built by this script for a faithful copy of live.
# Nothing in the suites below asserts anything about os_finish_line_* content.
STANDIN="$WORK/replay_standins.sql"
{
  echo "-- generated by scripts/role-read-tests.sh; do not commit"
  echo "insert into public.os_finish_line_entities (code, label, sort_order) values"
  echo "  ('SAMB','SAMB (stand-in)',1), ('ARBI','ARBI (stand-in)',2), ('ASI','ASI (stand-in)',3),"
  echo "  ('KNI','KNI (stand-in)',4), ('KDU','KDU (stand-in)',5)"
  echo "on conflict (code) do nothing;"
  grep -rhoE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
    "$REPO/supabase/migrations/20260806000051_samb_process_seed.sql" \
    "$REPO/supabase/migrations/20260806000053_arbi_process_seed.sql" \
    "$REPO/supabase/migrations/20260806000056_samb_bridge_18b.sql" \
  | sort -u | while read -r u; do
    # `item` and `kind` are the only NOT NULL columns without a default.
    # kind's vocabulary is section|metric|note — 20260726000021 created it as
    # block|section|line and a later migration replaced both the default and
    # the check, which is exactly the kind of drift a from-scratch replay is
    # good at finding. `metric` is the right stand-in: these rows exist only
    # to be the target of an os_process_step_items bridge pair.
    echo "insert into public.os_finish_line_items (id, area, item, target_state, kind)"
    echo "values ('$u'::uuid, 'stand-in', 'stand-in $u', 'stand-in', 'metric')"
    echo "on conflict (id) do nothing;"
  done
} > "$STANDIN"
STANDIN_ITEMS=$(grep -c "insert into public.os_finish_line_items" "$STANDIN")

# --- replay every migration, in filename order ----------------------------
# Filename order is the contract this suite is here to defend: 57 (the grant)
# must land before 58 (the policies). If someone renumbers them the other way,
# this replay is where it shows up.
COUNT=0
for f in $(ls "$REPO"/supabase/migrations/*.sql | sort); do
  # The stand-ins go in immediately before the first migration with an FK into
  # os_finish_line_items, which is the SAMB process seed.
  if [ "$(basename "$f")" = "20260806000051_samb_process_seed.sql" ]; then
    psql_ "-f $STANDIN" || { echo "FATAL: stand-in seed failed" >&2; exit 1; }
    echo "==> stand-ins: 5 finish-line entities, $STANDIN_ITEMS finish-line items"
    echo "    (populated by no migration in the repo — see the header of this script)"
  fi
  if ! out=$(psql_ "-f $f" 2>&1); then
    echo "FATAL: migration failed: $(basename "$f")" >&2
    echo "$out" | head -20 >&2
    exit 1
  fi
  COUNT=$((COUNT + 1))
done
echo "==> $COUNT migrations replayed cleanly"

# --- fixture --------------------------------------------------------------
psql_ "-f $REPO/supabase/tests/fixtures/role_read_fixture.sql" \
  || { echo "FATAL: fixture failed" >&2; exit 1; }
echo "==> fixture seeded"

# --- the suites -----------------------------------------------------------
# House convention (integrity_checks.sql, process_entity_checks.sql): a query
# returns ZERO ROWS when healthy, and any row it does return names what broke.
run_suite() {
  local name="$1" file="$2"
  local out
  out=$(su "$RUNAS" -c "$PGBIN/psql -h $SOCK -p $PORT -U postgres -d ostest -X -q -t -A -v ON_ERROR_STOP=1 -f $file" 2>&1)
  local rc=$?
  out=$(printf '%s\n' "$out" | sed '/^$/d')
  if [ $rc -ne 0 ]; then
    echo "FAIL  $name (psql error)"; printf '%s\n' "$out" | head -20; return 1
  fi
  if [ -n "$out" ]; then
    echo "FAIL  $name"; printf '%s\n' "$out" | sed 's/^/      /'; return 1
  fi
  echo "ok    $name"; return 0
}

RC=0
echo ""
run_suite "process_role_reads    (§11 four role conditions, nine tables)" \
  "$REPO/supabase/tests/process_role_reads.sql" || RC=1
run_suite "rls_function_grants   (§9.2 every policy fn, every reaching role)" \
  "$REPO/supabase/tests/rls_function_grants.sql" || RC=1
run_suite "process_entity_checks (seed counts and shape)" \
  "$REPO/supabase/tests/process_entity_checks.sql" || RC=1

# --- the negative control -------------------------------------------------
# A suite that cannot fail proves nothing. Revoke the grant that 57 records
# and the role suite MUST go red; if it stays green the suite is decorative
# and the next regression of this shape ships exactly like the last one did.
echo ""
echo "==> negative control: revoking the anon grant that 20260806000057 records"
psql_ "-c 'revoke execute on function public.os_member_entities() from anon;'" >/dev/null 2>&1
if run_suite "process_role_reads WITH GRANT REVOKED (must FAIL)" \
     "$REPO/supabase/tests/process_role_reads.sql" >/dev/null 2>&1; then
  echo "FAIL  suite stayed green with the grant revoked — it does not catch the regression"
  RC=1
else
  echo "ok    suite goes red when the grant is revoked (it catches the regression)"
fi
psql_ "-c 'grant execute on function public.os_member_entities() to anon;'" >/dev/null 2>&1

echo ""
if [ $RC -eq 0 ]; then echo "PASS — all suites green, negative control red as required"
else echo "FAILED"; fi
exit $RC
