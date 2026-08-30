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
run_suite "anon_definer_gates    (every anon-callable SECURITY DEFINER fn gates)" \
  "$REPO/supabase/tests/anon_definer_gates.sql" || RC=1
run_suite "anon_definer_gate_behaviour (…and the gates actually FIRE when called)" \
  "$REPO/supabase/tests/anon_definer_gate_behaviour.sql" || RC=1
run_suite "lab_public_lane      (the wall between the two lanes, called not read)" \
  "$REPO/supabase/tests/lab_public_lane.sql" || RC=1
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

# Same posture for the definer-gate suite, and it runs the REAL migration
# files in both directions — so this doubles as the proof that 89's
# down-migration restores exactly the body 89 replaced. Applying the down
# migration reopens the hole on purpose; the suite must see it.
echo ""
echo "==> negative control: applying 89's down-migration (ungates os_lab_stale_sweep)"
psql_ "-f $REPO/supabase/migrations/down/20260827000089_lab_stale_sweep_owner_gate_down.sql" >/dev/null 2>&1
if run_suite "anon_definer_gates WITH THE SWEEP UNGATED (must FAIL)" \
     "$REPO/supabase/tests/anon_definer_gates.sql" >/dev/null 2>&1; then
  echo "FAIL  suite stayed green with os_lab_stale_sweep ungated — it does not catch the regression"
  RC=1
else
  echo "ok    suite goes red when the sweep is ungated (it catches the regression)"
fi
psql_ "-f $REPO/supabase/migrations/20260827000089_lab_stale_sweep_owner_gate.sql" >/dev/null 2>&1
psql_ "-f $REPO/supabase/migrations/20260827000091_lab_stale_sweep_gate_fix_definer_context.sql" >/dev/null 2>&1

# --- the negative control that matters most -------------------------------
# 89 shipped a gate reading current_user inside a SECURITY DEFINER body, where
# it is the definer and never the caller. The catalog suite passed it, because
# the body still contained the string `os_key_valid`. It reached production.
#
# So this control restores exactly that body (91's down-migration) and asserts
# the two suites disagree: the catalog one STAYS GREEN — that is its structural
# blind spot, demonstrated rather than described — while the behavioural one
# goes RED. If they ever agree here, the behavioural suite has stopped earning
# its place.
echo ""
echo "==> negative control: restoring 89's never-firing gate (91's down-migration)"
psql_ "-f $REPO/supabase/migrations/down/20260827000091_lab_stale_sweep_gate_fix_definer_context_down.sql" >/dev/null 2>&1
if run_suite "anon_definer_gates WITH A DECORATIVE GATE (expected: stays GREEN — its blind spot)" \
     "$REPO/supabase/tests/anon_definer_gates.sql" >/dev/null 2>&1; then
  echo "ok    catalog suite stays green on a gate that never fires (known blind spot, why the next one exists)"
else
  echo "note  catalog suite went red on the decorative gate — it got stronger; revisit this control"
fi
if run_suite "anon_definer_gate_behaviour WITH A DECORATIVE GATE (must FAIL)" \
     "$REPO/supabase/tests/anon_definer_gate_behaviour.sql" >/dev/null 2>&1; then
  echo "FAIL  behavioural suite stayed green on a gate that never fires — it does not catch the regression"
  RC=1
else
  echo "ok    behavioural suite goes red on a gate that never fires (it catches what the catalog cannot)"
fi
psql_ "-f $REPO/supabase/migrations/20260827000091_lab_stale_sweep_gate_fix_definer_context.sql" >/dev/null 2>&1

# --- the lane wall, both halves -------------------------------------------
# 092 exists because data_class was editable and the anthropic base_url was
# not pinned. Drop each guard in turn and the lane suite MUST go red; a wall
# that cannot be observed falling down is not a wall.
echo ""
echo "==> negative control: dropping the data_class freeze"
psql_ "-c 'drop trigger os_lab_agents_class_freeze_guard on public.os_lab_agents;'" >/dev/null 2>&1
if run_suite "lab_public_lane WITH CLASS FREEZE DROPPED (must FAIL)" \
     "$REPO/supabase/tests/lab_public_lane.sql" >/dev/null 2>&1; then
  echo "FAIL  lane suite stayed green with data_class editable — laundering is undetected"
  RC=1
else
  echo "ok    lane suite goes red when data_class is editable (it catches laundering)"
fi
psql_ "-c 'create trigger os_lab_agents_class_freeze_guard before update on public.os_lab_agents for each row execute function public.os_lab_agents_class_freeze_guard();'" >/dev/null 2>&1

echo ""
echo "==> negative control: dropping the anthropic endpoint pin"
psql_ "-c 'drop trigger os_lab_providers_endpoint_pin_guard on public.os_lab_providers;'" >/dev/null 2>&1
if run_suite "lab_public_lane WITH ENDPOINT PIN DROPPED (must FAIL)" \
     "$REPO/supabase/tests/lab_public_lane.sql" >/dev/null 2>&1; then
  echo "FAIL  lane suite stayed green with the anthropic endpoint repointable"
  RC=1
else
  echo "ok    lane suite goes red when the anthropic endpoint is repointable"
fi
psql_ "-c 'create trigger os_lab_providers_endpoint_pin_guard before insert or update on public.os_lab_providers for each row execute function public.os_lab_providers_endpoint_pin_guard();'" >/dev/null 2>&1

echo ""
if [ $RC -eq 0 ]; then echo "PASS — all suites green, negative control red as required"
else echo "FAILED"; fi
exit $RC
