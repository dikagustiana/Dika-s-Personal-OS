#!/usr/bin/env bash
# ===========================================================================
# THE LAB DATA BOUNDARY, AGAINST A REAL POSTGRES. NOT A MOCK.
# ===========================================================================
#
# Stands up a throwaway Postgres, replays every migration in the repo in
# filename order (the three lab migrations included), and then attacks the
# boundary as a SUPERUSER — no application layer, no RLS, nothing but the
# triggers. Part B of the lab brief says the task is not done unless this
# proof exists and passes; this script is that proof, runnable on demand:
#
#     scripts/lab-boundary-tests.sh
#
# Deliberately NOT part of `pnpm test`, for the same reason as the other
# SQL suites: CI has no Postgres, and a suite that silently skips reports
# green for work it did not do (see scripts/role-read-tests.sh).
#
# Flags: --keep / --port N, as everywhere else.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/pg-cluster.sh"
pgc_parse_flags "$@"
pgc_bootstrap "labboundary"

RC=0
echo ""
run_suite "lab_boundary (internal data reaches Anthropic only, app layer bypassed)" \
  "$REPO/supabase/tests/lab_boundary.sql" || RC=1

# --- the negative control ---------------------------------------------------
# A suite that cannot fail proves nothing. Drop the runs trigger and the
# suite MUST go red; if it stays green it is decorative and the boundary
# could regress exactly the way it is sworn not to.
echo ""
echo "==> negative control: dropping os_lab_runs_boundary_guard"
psql_ "-c 'drop trigger os_lab_runs_boundary_guard on public.os_lab_runs;'" >/dev/null 2>&1
if run_suite "lab_boundary WITH TRIGGER DROPPED (must FAIL)" \
     "$REPO/supabase/tests/lab_boundary.sql" >/dev/null 2>&1; then
  echo "FAIL  suite stayed green with the runs trigger dropped — it does not catch the regression"
  RC=1
else
  echo "ok    suite goes red when the runs trigger is dropped (it catches the regression)"
fi
psql_ "-c 'create trigger os_lab_runs_boundary_guard before insert or update on public.os_lab_runs for each row execute function public.os_lab_runs_boundary_guard();'" >/dev/null 2>&1

echo ""
if [ $RC -eq 0 ]; then echo "PASS — boundary holds at the database layer, negative control red as required"
else echo "FAILED"; fi
exit $RC
