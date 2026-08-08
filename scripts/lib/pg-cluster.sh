#!/usr/bin/env bash
# ===========================================================================
# A THROWAWAY POSTGRES WITH EVERY MIGRATION REPLAYED INTO IT.
# ===========================================================================
#
# Sourced by scripts/role-read-tests.sh and scripts/seed-guard-tests.sh. Both
# need the identical thing — a cluster that looks enough like a Supabase
# project for the migrations to apply — and the second one existing is the
# reason this is a file rather than a copy.
#
# Usage from a caller:
#
#     source "$(dirname "${BASH_SOURCE[0]}")/lib/pg-cluster.sh"
#     pgc_parse_flags "$@"
#     pgc_bootstrap "my-suite-name"     # names the socket dir, so two suites
#                                       # can run at once without colliding
#     psql_ "-f some.sql"
#
# Provides: REPO PGBIN PORT KEEP SOCK WORK PGDATA RUNAS, the pg()/psql_()
# helpers, and an EXIT trap that stops the cluster and removes it.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT=55432
KEEP=0

pgc_parse_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --keep) KEEP=1; shift ;;
      --port) PORT="$2"; shift 2 ;;
      *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
  done
}

pg() { su "$RUNAS" -c "$*" ; }
psql_() {
  su "$RUNAS" -c "$PGBIN/psql -h $SOCK -p $PORT -U postgres -d ${2:-ostest} -X -q -v ON_ERROR_STOP=1 $1"
}

# Runs a script and CAPTURES failure instead of aborting — the seed-guard
# suite needs the error text of a migration that is SUPPOSED to fail.
psql_capture() {
  su "$RUNAS" -c "$PGBIN/psql -h $SOCK -p $PORT -U postgres -d ostest -X -q -v ON_ERROR_STOP=1 $1" 2>&1
}

pgc_cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo ""
    echo "cluster kept:  psql -h $SOCK -p $PORT -U postgres -d ostest"
    echo "stop it with:  $PGBIN/pg_ctl -D $PGDATA stop"
    return
  fi
  pg "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1
  rm -rf "$WORK" "$SOCK"
}

pgc_bootstrap() {
  local suite="${1:-pgtest}"
  if [ ! -x "$PGBIN/initdb" ]; then
    echo "FATAL: $PGBIN/initdb not found. Install postgresql-16 or set PGBIN." >&2
    exit 2
  fi

  # The socket directory has to be SHORT: Postgres caps the unix socket path
  # at 107 bytes and a scratch path blows through that on its own.
  SOCK="${SOCK:-/tmp/pgs-$suite}"
  WORK="$(mktemp -d)"
  PGDATA="$WORK/data"
  # initdb will not run as root, so the cluster is owned by the postgres
  # system account when we are root, and by the current user otherwise.
  if [ "$(id -u)" -eq 0 ]; then RUNAS="postgres"; else RUNAS="$(id -un)"; fi
  trap pgc_cleanup EXIT

  echo "==> cluster in $PGDATA (socket $SOCK, port $PORT)"
  mkdir -p "$PGDATA" "$SOCK"
  chown -R "$RUNAS" "$WORK" "$SOCK"
  chmod 711 "$WORK"
  pg "$PGBIN/initdb -D $PGDATA -U postgres --no-sync -A trust" >/dev/null 2>&1 || {
    echo "FATAL: initdb failed" >&2; exit 2; }
  pg "$PGBIN/pg_ctl -D $PGDATA -o \"-k $SOCK -p $PORT -c listen_addresses=''\" -l $WORK/log start -w" >/dev/null 2>&1 || {
    echo "FATAL: server did not start; log follows" >&2; cat "$WORK/log" >&2; exit 2; }

  pgc_shim
  pgc_standins
  pgc_replay
}

# --- the Supabase shim ------------------------------------------------------
# Everything the migrations expect from a Supabase project and nothing more:
# three roles, the `extensions` and `auth` schemas, auth.uid() reading the
# same GUC PostgREST sets, and a stand-in auth.users carrying only the columns
# the migrations actually reference. Roles are cluster-wide, so this is
# written to survive being run twice.
pgc_shim() {
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
-- a cast error that would masquerade as a permission failure.
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
-- rather than on policy, and a suite would pass for the wrong reason.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL

  psql_ "-c 'drop database if exists ostest;' -c 'create database ostest;'" postgres >/dev/null 2>&1
  psql_ "-f $WORK/shim.sql" || { echo "FATAL: shim failed" >&2; exit 2; }
  echo "==> shim applied"
}

# --- stand-ins for data the repo does not carry -----------------------------
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
# rows, which is a separate decision. So the minimum scaffolding is generated
# BY READING THE SEEDS, so it can never drift from what they reference.
#
# These rows are stand-ins. Their text is deliberately unusable-looking so
# nobody mistakes a cluster built by this script for a faithful copy of live.
pgc_standins() {
  STANDIN="$WORK/replay_standins.sql"
  {
    echo "-- generated by scripts/lib/pg-cluster.sh; do not commit"
    echo "insert into public.os_finish_line_entities (code, label, sort_order) values"
    echo "  ('SAMB','SAMB (stand-in)',1), ('ARBI','ARBI (stand-in)',2), ('ASI','ASI (stand-in)',3),"
    echo "  ('KNI','KNI (stand-in)',4), ('KDU','KDU (stand-in)',5)"
    echo "on conflict (code) do nothing;"
    # EVERY migration is scanned, not a named list of three. The list was
    # 51/53/56 until KGR arrived in 20260807000060 — that seed happens to
    # carry no bridge pairs, so nothing broke, but the next entity that does
    # would have failed the replay with a foreign key error pointing at a
    # file this generator had never heard of. Over-generating stand-ins is
    # free; missing one costs a confusing replay failure.
    grep -rhoE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
      "$REPO"/supabase/migrations/*.sql \
    | sort -u | while read -r u; do
      # `item` and `kind` are the only NOT NULL columns without a default.
      # kind's vocabulary is section|metric|note — 20260726000021 created it
      # as block|section|line and a later migration replaced both the default
      # and the check, which is the kind of drift a from-scratch replay is
      # good at finding.
      echo "insert into public.os_finish_line_items (id, area, item, target_state, kind)"
      echo "values ('$u'::uuid, 'stand-in', 'stand-in $u', 'stand-in', 'metric')"
      echo "on conflict (id) do nothing;"
    done
  } > "$STANDIN"
  STANDIN_ITEMS=$(grep -c "insert into public.os_finish_line_items" "$STANDIN")
}

# --- replay every migration, in filename order ------------------------------
# Filename order is a contract these suites defend: 57 (the grant) must land
# before 58 (the policies). If someone renumbers them the other way, this
# replay is where it shows up.
pgc_replay() {
  local count=0 f out
  for f in $(ls "$REPO"/supabase/migrations/*.sql | sort); do
    # The stand-ins go in immediately before the first migration with an FK
    # into os_finish_line_items, which is the SAMB process seed.
    if [ "$(basename "$f")" = "20260806000051_samb_process_seed.sql" ]; then
      psql_ "-f $STANDIN" || { echo "FATAL: stand-in seed failed" >&2; exit 1; }
      echo "==> stand-ins: 5 finish-line entities, $STANDIN_ITEMS finish-line items"
      echo "    (populated by no migration in the repo — see lib/pg-cluster.sh)"
    fi
    if ! out=$(psql_ "-f $f" 2>&1); then
      echo "FATAL: migration failed: $(basename "$f")" >&2
      echo "$out" | head -20 >&2
      exit 1
    fi
    count=$((count + 1))
  done
  echo "==> $count migrations replayed cleanly"
}

# House convention (integrity_checks.sql, process_entity_checks.sql): a query
# returns ZERO ROWS when healthy, and any row it returns names what broke.
run_suite() {
  local name="$1" file="$2" out rc
  out=$(su "$RUNAS" -c "$PGBIN/psql -h $SOCK -p $PORT -U postgres -d ostest -X -q -t -A -v ON_ERROR_STOP=1 -f $file" 2>&1)
  rc=$?
  out=$(printf '%s\n' "$out" | sed '/^$/d')
  if [ $rc -ne 0 ]; then
    echo "FAIL  $name (psql error)"; printf '%s\n' "$out" | head -20; return 1
  fi
  if [ -n "$out" ]; then
    echo "FAIL  $name"; printf '%s\n' "$out" | sed 's/^/      /'; return 1
  fi
  echo "ok    $name"; return 0
}
