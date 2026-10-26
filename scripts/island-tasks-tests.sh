#!/usr/bin/env bash
# ===========================================================================
# THE ISLAND'S RPCs REACH WORK TASKS AND NOTHING ELSE. PROVEN ON A REPLAY.
# ===========================================================================
#
# Runs supabase/tests/island_tasks.sql against a throwaway cluster with every
# migration replayed (lib/pg-cluster.sh). That file is one DO block that always
# raises — 'island_tasks PASS (n checks)' or 'island_tasks FAIL …' — so its
# writes roll back on its own; the same file is run against production through
# MCP execute_sql / the SQL editor, which is how 20261026000109 was verified
# when it shipped (no local Postgres on the owner's PC at the time).
#
# Negative control: drop the domain filter from the patch RPC (re-create it
# without `domain = 'work'`) and the suite MUST go red on C6 (GROWTH id
# patched). A suite that cannot fail proves nothing.
#
# Deliberately NOT part of `pnpm test`: CI has no Postgres.
#
#     scripts/island-tasks-tests.sh [--keep] [--port N]
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/pg-cluster.sh"
pgc_parse_flags "$@"
pgc_bootstrap "islandtasks"

SUITE="$REPO/supabase/tests/island_tasks.sql"
RC=0

run_island() {
  psql_capture "-f $SUITE" | grep -o 'island_tasks [A-Z]*.*' | head -1
}

echo ""
OUT="$(run_island)"
echo "$OUT"
case "$OUT" in
  "island_tasks PASS"*) echo "ok    island_tasks" ;;
  *) echo "FAIL  island_tasks"; RC=1 ;;
esac

echo ""
echo "==> negative control: patch RPC without its WORK filter"
psql_ "-c \"create or replace function public.os_island_task_patch(p_id uuid, p_expected_updated_at timestamptz, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as \\\$f\\\$ declare r jsonb; begin perform private.os_island_token_check('write'); update public.os_entries set payload = payload || jsonb_build_object('done', true) where id = p_id returning private.os_island_task_row(os_entries.*) into r; return r; end \\\$f\\\$;\"" >/dev/null 2>&1
OUT="$(run_island)"
case "$OUT" in
  "island_tasks FAIL"*) echo "ok    suite goes red without the WORK filter" ;;
  *) echo "FAIL  suite stayed green with the WORK filter removed: $OUT"; RC=1 ;;
esac

echo ""
if [ $RC -eq 0 ]; then echo "PASS — island RPCs scoped to WORK tasks, negative control red as required"
else echo "FAILED"; fi
exit $RC
