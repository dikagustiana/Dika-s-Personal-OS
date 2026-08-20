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
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/pg-cluster.sh"
pgc_parse_flags "$@"
pgc_bootstrap "roletest"

psql_ "-f $REPO/supabase/tests/fixtures/role_read_fixture.sql" \
  || { echo "FATAL: fixture failed" >&2; exit 1; }
echo "==> fixture seeded"

RC=0
echo ""
run_suite "process_role_reads    (§11 four role conditions, ten tables)" \
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
