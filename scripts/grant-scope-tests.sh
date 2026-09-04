#!/usr/bin/env bash
# ===========================================================================
# THE GRANT MODEL, PROVEN AGAINST A REAL POSTGRES — INCLUDING THE BACKFILL.
# ===========================================================================
#
# 20260904000095 turns collaborator access from (user, entity) into
# (user, entity, section, capability). Three things about it can only be
# shown by running it, and this script runs all three:
#
#   1. THE BACKFILL, MEASURED. The cluster is replayed to the end (so 095 is
#      already in), the fixtures are seeded, and then 095's DOWN migration is
#      applied to put the membership model back. Each contributor's readable
#      cells are counted AS THAT CONTRIBUTOR, through RLS. 095 is applied
#      again, its NOTICE lines captured, and the counts taken once more. The
#      assertion is the one the migration header makes: after = before minus
#      the cells of parentless metrics (D4), for every member, and that
#      difference is not zero — otherwise D4 was never exercised.
#
#   2. THE SUITE. fixtures/grant_scope_scenario.sql narrows the backfilled
#      grants into the shapes the backfill cannot produce (a read-only
#      section, a revoked section, an enrolment with no grant), and
#      supabase/tests/finish_line_grants.sql pins the resulting numbers per
#      identity, the write paths, the accounts, the guard and the cascade.
#      The two catalog suites and the behavioural gate suite run beside it.
#
#   3. THE NEGATIVE CONTROLS. A suite that cannot fail proves nothing: the
#      guard trigger is dropped, a lookup's EXECUTE is revoked, and the old
#      entity-wide policy from 040 is re-added — each must turn the suite red,
#      each is restored, and the suite must be green again afterwards.
#
# Then collab_rls.sql — the 40-case live suite the owner is told to run after
# applying — is run here first, against the same cluster, with the projects
# and the KNI cell it reaches for seeded by fixtures/collab_rls_fixture.sql.
#
# NOT part of `pnpm test`: CI has no Postgres. Run it after touching the grant
# migration, any of the three fixtures, or any policy on cells or accounts:
#
#     scripts/grant-scope-tests.sh
#
# Flags: --keep (leave the cluster up), --port N. Requires postgresql-16.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/pg-cluster.sh"
pgc_parse_flags "$@"
pgc_bootstrap "grantscope"

MIG="$REPO/supabase/migrations"
DOWN="$REPO/supabase/migrations/down"
FIX="$REPO/supabase/tests/fixtures"
TESTS="$REPO/supabase/tests"
GRANTS_UP="$MIG/20260904000095_finish_line_grants.sql"
GRANTS_DOWN="$DOWN/20260904000095_finish_line_grants_down.sql"
RC=0

UID_A=11111111-1111-4111-8111-111111111111
UID_B=22222222-2222-4222-8222-222222222222
UID_C=33333333-3333-4333-8333-333333333333

psql_ "-f $FIX/role_read_fixture.sql" \
  || { echo "FATAL: role fixture failed" >&2; exit 1; }
psql_ "-f $FIX/grant_scope_fixture.sql" \
  || { echo "FATAL: grant-scope fixture failed" >&2; exit 1; }
echo "==> fixtures seeded: A (SAMB ASI ARBI KNI KDU), B (ARBI), C (SAMB); 2 sections, 4 metrics, 12 cells, 10 accounts"

# One scalar, as postgres.
scalar() {
  su "$RUNAS" -c "$PGBIN/psql -h $SOCK -p $PORT -U postgres -d ostest -X -q -t -A -v ON_ERROR_STOP=1 -c \"$1\"" 2>/dev/null \
    | tr -d '[:space:]'
}

# The cells one contributor can read, AS THAT CONTRIBUTOR, under whatever
# policies are in force at the moment of the call — a real JWT claim, the
# authenticated role, no owner header. This is the number a browser gets.
readable_as() {
  cat > "$WORK/readable.sql" <<SQL
begin;
do \$\$ begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '$1', 'role', 'authenticated')::text, true);
end \$\$;
set local role authenticated;
select count(*) from public.os_finish_line_cells;
rollback;
SQL
  su "$RUNAS" -c "$PGBIN/psql -h $SOCK -p $PORT -U postgres -d ostest -X -q -t -A -v ON_ERROR_STOP=1 -f $WORK/readable.sql" 2>/dev/null \
    | tr -d '[:space:]'
}

# Cells of the contributor's entities whose metric has no parent section —
# exactly the set D4 moves to owner-only. Computed as postgres, from the
# structure, independently of any grant or policy.
parentless_of() {
  scalar "select count(*) from public.os_finish_line_cells c
            join public.os_finish_line_items i on i.id = c.item_id
            join public.os_entity_members m on m.user_id = '$1' and m.entity_code = c.entity_code
           where i.parent_id is null"
}

# Runs a script that ends in a result row rather than in zero rows —
# collab_rls.sql raises on any failed assertion, so exit status is the verdict.
run_script() {
  local name="$1" file="$2" out rc
  out=$(su "$RUNAS" -c "$PGBIN/psql -h $SOCK -p $PORT -U postgres -d ostest -X -q -t -A -v ON_ERROR_STOP=1 -f $file" 2>&1)
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "FAIL  $name"; printf '%s\n' "$out" | grep -v '^$' | tail -25 | sed 's/^/      /'; return 1
  fi
  echo "ok    $name"
  printf '%s\n' "$out" | grep -v '^$' | grep -v 'NOTICE' | tail -1 | sed 's/^/      /'
  return 0
}

# ---------------------------------------------------------------------------
# 1. THE BACKFILL, MEASURED
# ---------------------------------------------------------------------------
echo ""
echo "==> the backfill, measured: 095 down (membership model), count, 095 up, count"
psql_ "-f $GRANTS_DOWN" >/dev/null \
  || { echo "FATAL: 095 down-migration failed" >&2; exit 1; }
if [ "$(scalar "select to_regclass('public.os_finish_line_grants') is null")" != "t" ]; then
  echo "FATAL: the down-migration left os_finish_line_grants in place" >&2; exit 1
fi
BEFORE_A=$(readable_as $UID_A); BEFORE_B=$(readable_as $UID_B); BEFORE_C=$(readable_as $UID_C)

if ! UP_OUT=$(psql_ "-f $GRANTS_UP" 2>&1); then
  echo "FATAL: 095 failed to re-apply over live-shaped memberships:" >&2
  printf '%s\n' "$UP_OUT" | tail -20 >&2; exit 1
fi
echo "    the migration's own NOTICE lines:"
printf '%s\n' "$UP_OUT" | grep -o 'finish_line_grants: .*' | sed 's/^/      /'

AFTER_A=$(readable_as $UID_A); AFTER_B=$(readable_as $UID_B); AFTER_C=$(readable_as $UID_C)
ORPHAN_A=$(parentless_of $UID_A); ORPHAN_B=$(parentless_of $UID_B); ORPHAN_C=$(parentless_of $UID_C)
GRANT_ROWS=$(scalar "select count(*) from public.os_finish_line_grants")

echo ""
echo "    contributor   before   after   parentless (D4)   verdict"
for row in "A $BEFORE_A $AFTER_A $ORPHAN_A" "B $BEFORE_B $AFTER_B $ORPHAN_B" "C $BEFORE_C $AFTER_C $ORPHAN_C"; do
  set -- $row
  if [ -z "$2" ] || [ -z "$3" ] || [ -z "$4" ]; then
    printf '    %-13s %-8s %-7s %-17s %s\n' "$1" "$2" "$3" "$4" "FAIL  a count came back empty (a read threw)"; RC=1
  elif [ "$4" -eq 0 ]; then
    printf '    %-13s %-8s %-7s %-17s %s\n' "$1" "$2" "$3" "$4" "FAIL  no parentless cells — D4 was never exercised"; RC=1
  elif [ "$3" -eq $(( $2 - $4 )) ]; then
    printf '    %-13s %-8s %-7s %-17s %s\n' "$1" "$2" "$3" "$4" "ok    after = before - parentless"
  else
    printf '    %-13s %-8s %-7s %-17s %s\n' "$1" "$2" "$3" "$4" "FAIL  expected $(( $2 - $4 ))"; RC=1
  fi
done
echo "    grant rows after backfill: $GRANT_ROWS (expected 14: A 5 entities x 2 sections, B 2, C 2)"
[ "$GRANT_ROWS" = "14" ] || { echo "FAIL  backfill produced $GRANT_ROWS grant rows"; RC=1; }

# ---------------------------------------------------------------------------
# 2. THE SCENARIO AND THE SUITES
# ---------------------------------------------------------------------------
psql_ "-f $FIX/grant_scope_scenario.sql" \
  || { echo "FATAL: scenario failed" >&2; exit 1; }
echo ""
echo "==> scenario applied: A (SAMB,S2) -> read, A (ASI,S2) revoked, C stripped of every grant"
echo ""
run_suite "finish_line_grants     (catalog, per-identity scope, writes, accounts, guard, cascade)" \
  "$TESTS/finish_line_grants.sql" || RC=1
run_suite "rls_function_grants    (§9.2 every policy fn, every reaching role)" \
  "$TESTS/rls_function_grants.sql" || RC=1
run_suite "anon_definer_gates     (every anon-callable SECURITY DEFINER fn gates)" \
  "$TESTS/anon_definer_gates.sql" || RC=1
run_suite "anon_definer_gate_behaviour (…and the gates actually FIRE when called)" \
  "$TESTS/anon_definer_gate_behaviour.sql" || RC=1

# ---------------------------------------------------------------------------
# 3. THE NEGATIVE CONTROLS
# ---------------------------------------------------------------------------
echo ""
echo "==> negative control: dropping the section guard trigger"
psql_ "-c 'drop trigger os_finish_line_grants_section_guard on public.os_finish_line_grants;'" >/dev/null 2>&1
if run_suite "finish_line_grants WITH THE GUARD DROPPED (must FAIL)" \
     "$TESTS/finish_line_grants.sql" >/dev/null 2>&1; then
  echo "FAIL  suite stayed green with the guard dropped — a grant on a metric goes unnoticed"; RC=1
else
  echo "ok    suite goes red when the guard is dropped"
fi
psql_ "-c 'create trigger os_finish_line_grants_section_guard before insert or update of section_id on public.os_finish_line_grants for each row execute function public.os_finish_line_grants_section_guard();'" >/dev/null 2>&1

echo ""
echo "==> negative control: revoking authenticated's EXECUTE on os_member_readable_cells()"
psql_ "-c 'revoke execute on function public.os_member_readable_cells() from authenticated;'" >/dev/null 2>&1
if run_suite "rls_function_grants WITH THE GRANT REVOKED (must FAIL)" \
     "$TESTS/rls_function_grants.sql" >/dev/null 2>&1; then
  echo "FAIL  catalog suite stayed green with the grant revoked — the 7 August shape goes unnoticed"; RC=1
else
  echo "ok    catalog suite goes red when the grant is revoked"
fi
if run_suite "finish_line_grants WITH THE GRANT REVOKED (must FAIL)" \
     "$TESTS/finish_line_grants.sql" >/dev/null 2>&1; then
  echo "FAIL  behavioural suite stayed green with the grant revoked"; RC=1
else
  echo "ok    behavioural suite goes red too (every member read of cells throws)"
fi
psql_ "-c 'grant execute on function public.os_member_readable_cells() to authenticated;'" >/dev/null 2>&1

echo ""
echo "==> negative control: re-adding 040's entity-wide read policy beside the grant one"
psql_ "-c 'create policy \"member reads own-entity cells\" on public.os_finish_line_cells for select to authenticated using (entity_code = any ((select public.os_member_entities())::text[]));'" >/dev/null 2>&1
if run_suite "finish_line_grants WITH THE ENTITY-WIDE POLICY BACK (must FAIL)" \
     "$TESTS/finish_line_grants.sql" >/dev/null 2>&1; then
  echo "FAIL  suite stayed green with entity-wide reads restored — the scope model is decorative"; RC=1
else
  echo "ok    suite goes red when entity-wide reads come back (parentless and revoked cells reappear)"
fi
psql_ "-c 'drop policy \"member reads own-entity cells\" on public.os_finish_line_cells;'" >/dev/null 2>&1

echo ""
run_suite "finish_line_grants     (green again after every control was restored)" \
  "$TESTS/finish_line_grants.sql" || RC=1

# ---------------------------------------------------------------------------
# 4. THE LIVE SUITE, HERE FIRST
# ---------------------------------------------------------------------------
# collab_rls.sql is what the owner runs against live after applying. Its
# fixture goes in only now: the KNI cell it adds is readable by A (who holds
# KNI), so it would have moved the numbers finish_line_grants.sql pins.
echo ""
echo "==> collab_rls.sql against the grant model (projects + a KNI cell seeded for it)"
psql_ "-f $FIX/collab_rls_fixture.sql" \
  || { echo "FATAL: collab_rls fixture failed" >&2; exit 1; }
run_script "collab_rls             (every block, as the roles, all rolled back)" \
  "$TESTS/collab_rls.sql" || RC=1

echo ""
if [ $RC -eq 0 ]; then echo "PASS — backfill preserves every sectioned cell, suites green, negative controls red as required"
else echo "FAILED"; fi
exit $RC
