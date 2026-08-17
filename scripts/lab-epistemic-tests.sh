#!/usr/bin/env bash
# ===========================================================================
# THE EPISTEMIC GATES, AGAINST A REAL POSTGRES. NOT A MOCK, NOT A PROMPT.
# ===========================================================================
#
# Stands up a throwaway Postgres, replays every migration in filename order
# (the epistemic layer included), and then works the gates from both sides:
# an OWNER with a throwaway key, and an AGENT — superuser with no key, the
# strongest stand-in for automation with the application layer bypassed.
# Deterministic gates are the design's first principle; this script is what
# makes that checkable on demand:
#
#     scripts/lab-epistemic-tests.sh
#
# Deliberately NOT part of `pnpm test` (CI has no Postgres; a suite that
# silently skips reports green for work it did not do). Flags: --keep /
# --port N, as everywhere else.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/pg-cluster.sh"
pgc_parse_flags "$@"
pgc_bootstrap "labgates"

RC=0
echo ""
run_suite "lab_epistemic_gates (G-EXTRACT/VERIFY/CLAIM/LAYER/OUTPUT/STALE, both identities)" \
  "$REPO/supabase/tests/lab_epistemic_gates.sql" || RC=1

# --- the negative control ---------------------------------------------------
# Drop the claims guard and the suite MUST go red: born-approved claims,
# agent approvals and stamp-smuggling all become possible at once, and the
# suite is decorative if it cannot see that.
echo ""
echo "==> negative control: dropping os_lab_claims_gate_guard"
psql_ "-c 'drop trigger os_lab_claims_gate_guard on public.os_lab_claims;'" >/dev/null 2>&1
if run_suite "lab_epistemic_gates WITH CLAIMS GUARD DROPPED (must FAIL)" \
     "$REPO/supabase/tests/lab_epistemic_gates.sql" >/dev/null 2>&1; then
  echo "FAIL  suite stayed green with the claims guard dropped — it does not catch the regression"
  RC=1
else
  echo "ok    suite goes red when the claims guard is dropped (it catches the regression)"
fi
psql_ "-c 'create trigger os_lab_claims_gate_guard before insert or update or delete on public.os_lab_claims for each row execute function public.os_lab_claims_gate_guard();'" >/dev/null 2>&1

echo ""
if [ $RC -eq 0 ]; then echo "PASS — the gates hold at the database layer, negative control red as required"
else echo "FAILED"; fi
exit $RC
