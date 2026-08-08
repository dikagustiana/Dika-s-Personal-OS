#!/usr/bin/env bash
# ===========================================================================
# THE SEED GUARDS ACTUALLY REFUSE. PROVEN BY RUNNING THEM, NOT BY READING THEM.
# ===========================================================================
#
# Migration 20260806000056's sibling work made both process seed files
# one-shot: a `raise exception` at the top of each aborts the whole migration
# if that entity already has steps. The reason is specific and it is not
# tidiness — two sections of those files are guarded by `where not exists`
# matching on TEXT COLUMNS THAT ARE NOW EDITABLE FROM THE APP:
#
#   os_process_phases  matched on name        (name is editable)
#   os_process_needs   matched on item        (item is editable)
#
# So the failure mode is silent duplication: edit a need's text in the app,
# re-run the ARBI seed, and 112 becomes 113 with no error and no notice. The
# SAMB seed cannot run any more for an unrelated reason (migration 52 made
# entity_code NOT NULL and the old file does not supply it), but the ARBI seed
# supplies entity_code and remained perfectly runnable.
#
# A guard that has never been executed is a comment. This runs it:
#
#   1. Replay everything, so both entities are seeded.
#   2. Re-run each seed → MUST abort, with the guard's own message, and MUST
#      NOT duplicate a single row.
#   3. Run the down-seed, then the seed again → MUST succeed and restore the
#      exact counts. A guard that cannot be got past would make a legitimate
#      reseed impossible, which is a different bug.
#
# Requires the postgresql-16 server binaries. Run after touching either seed
# file or either down-seed:
#
#     scripts/seed-guard-tests.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/pg-cluster.sh"
pgc_parse_flags "$@"
pgc_bootstrap "seedguard"

MIG="$REPO/supabase/migrations"
DOWN="$REPO/supabase/migrations/down"
RC=0

count() {
  su "$RUNAS" -c "$PGBIN/psql -h $SOCK -p $PORT -U postgres -d ostest -X -q -t -A -c \"$1\"" 2>/dev/null | tr -d '[:space:]'
}

steps_of()  { count "select count(*) from public.os_process_steps where entity_code='$1'"; }
needs_of()  { count "select count(*) from public.os_process_needs n join public.os_process_steps s on s.id=n.step_id where s.entity_code='$1'"; }
phases_of() { count "select count(*) from public.os_process_phases where entity_code='$1'"; }
lanes_of()  { count "select count(*) from public.os_process_lanes where entity_code='$1'"; }
gates_of()  { count "select count(*) from public.os_process_gates where entity_code='$1'"; }

echo ""
echo "==> baseline after a clean replay"
printf "    SAMB  steps=%s needs=%s phases=%s lanes=%s gates=%s\n" \
  "$(steps_of SAMB)" "$(needs_of SAMB)" "$(phases_of SAMB)" "$(lanes_of SAMB)" "$(gates_of SAMB)"
printf "    ARBI  steps=%s needs=%s phases=%s lanes=%s gates=%s\n" \
  "$(steps_of ARBI)" "$(needs_of ARBI)" "$(phases_of ARBI)" "$(lanes_of ARBI)" "$(gates_of ARBI)"

# The counts the seeds are pinned to. A drift here means the seed text changed.
expect() {
  local what="$1" got="$2" want="$3"
  if [ "$got" != "$want" ]; then
    echo "FAIL  $what = $got, expected $want"; RC=1; return 1
  fi
  return 0
}
expect "SAMB steps"  "$(steps_of SAMB)"  30 && \
expect "SAMB needs"  "$(needs_of SAMB)"  118 && \
expect "SAMB phases" "$(phases_of SAMB)" 7 && \
expect "SAMB lanes"  "$(lanes_of SAMB)"  6 && \
expect "SAMB gates"  "$(gates_of SAMB)"  15 && \
expect "ARBI steps"  "$(steps_of ARBI)"  23 && \
expect "ARBI needs"  "$(needs_of ARBI)"  112 && \
expect "ARBI phases" "$(phases_of ARBI)" 7 && \
expect "ARBI lanes"  "$(lanes_of ARBI)"  6 && \
expect "ARBI gates"  "$(gates_of ARBI)"  12 && \
echo "ok    baseline counts match the seeds (30/118 SAMB, 23/112 ARBI)"

# ---------------------------------------------------------------------------
# 1. RE-RUNNING A SEED MUST ABORT, AND MUST NOT DUPLICATE ANYTHING.
# ---------------------------------------------------------------------------
guard_refuses() {
  local entity="$1" file="$2"
  local before_steps before_needs before_phases out
  before_steps="$(steps_of "$entity")"
  before_needs="$(needs_of "$entity")"
  before_phases="$(phases_of "$entity")"

  out=$(psql_capture "-f $file")
  if [ -z "$(printf '%s' "$out" | grep -i 'ERROR')" ]; then
    echo "FAIL  re-running the $entity seed did NOT abort — the guard is not firing"
    RC=1
  elif [ -z "$(printf '%s' "$out" | grep -i 'sekali pakai')" ]; then
    echo "FAIL  the $entity seed aborted, but not with the guard's message:"
    printf '%s\n' "$out" | head -4 | sed 's/^/      /'
    RC=1
  else
    echo "ok    re-running the $entity seed aborts with the guard's own message"
    printf '      %s\n' "$(printf '%s' "$out" | grep -io 'Rantai proses .* sudah terseed[^"]*' | head -1 | cut -c1-96)…"
  fi

  # The whole point. An abort that still left rows behind would be worse than
  # no guard, because the counts would drift while the message said "refused".
  if [ "$(steps_of "$entity")" = "$before_steps" ] &&
     [ "$(needs_of "$entity")" = "$before_needs" ] &&
     [ "$(phases_of "$entity")" = "$before_phases" ]; then
    echo "ok    $entity unchanged: steps=$before_steps needs=$before_needs phases=$before_phases"
  else
    echo "FAIL  $entity DUPLICATED despite the guard: steps $before_steps→$(steps_of "$entity"), needs $before_needs→$(needs_of "$entity"), phases $before_phases→$(phases_of "$entity")"
    RC=1
  fi
}

echo ""
echo "==> re-running each seed against an already-seeded database"
guard_refuses ARBI "$MIG/20260806000053_arbi_process_seed.sql"
guard_refuses SAMB "$MIG/20260806000051_samb_process_seed.sql"

# ---------------------------------------------------------------------------
# 2. THE GUARD IS A GATE, NOT A WALL: down-seed then reseed must work.
# ---------------------------------------------------------------------------
# ARBI only. The SAMB seed predates migration 52 making entity_code NOT NULL
# and does not supply it, so it cannot be re-applied even from empty — which
# is exactly why its guard says so explicitly rather than relying on that.
echo ""
echo "==> down-seed ARBI, then seed it again"
if ! out=$(psql_capture "-f $DOWN/20260806000053_arbi_process_seed_down.sql"); then
  echo "FAIL  the ARBI down-seed did not run"; printf '%s\n' "$out" | head -6 | sed 's/^/      /'; RC=1
else
  after_down="$(steps_of ARBI)"
  if [ "$after_down" = "0" ]; then
    echo "ok    down-seed removed every ARBI step (steps=0)"
  else
    echo "FAIL  down-seed left $after_down ARBI steps behind"; RC=1
  fi
  # And it must not have touched the other entity.
  if [ "$(steps_of SAMB)" = "30" ]; then
    echo "ok    SAMB untouched by the ARBI down-seed (steps=30)"
  else
    echo "FAIL  the ARBI down-seed changed SAMB: steps=$(steps_of SAMB)"; RC=1
  fi

  if ! out=$(psql_capture "-f $MIG/20260806000053_arbi_process_seed.sql"); then
    echo "FAIL  reseeding ARBI after the down-seed did NOT work — the guard is a wall:"
    printf '%s\n' "$out" | head -6 | sed 's/^/      /'
    RC=1
  else
    if [ "$(steps_of ARBI)" = "23" ] && [ "$(needs_of ARBI)" = "112" ] &&
       [ "$(phases_of ARBI)" = "7" ] && [ "$(gates_of ARBI)" = "12" ]; then
      echo "ok    reseed restored ARBI exactly: steps=23 needs=112 phases=7 gates=12"
    else
      echo "FAIL  reseed did not restore ARBI: steps=$(steps_of ARBI) needs=$(needs_of ARBI) phases=$(phases_of ARBI) gates=$(gates_of ARBI)"
      RC=1
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 3. THE PHASES GUARD KEYS ON COLUMNS THE APP CANNOT EDIT.
# ---------------------------------------------------------------------------
# `name` is editable from the step panel; slot_from and slot_to are not. If
# the guard still matched on name, renaming a phase and reseeding would insert
# a duplicate. Rather than trust the file, rename one and re-run the section.
echo ""
echo "==> the phases guard survives a renamed phase"
psql_ "-c \"update public.os_process_phases set name = name || ' (diedit)' where entity_code='ARBI'\"" >/dev/null 2>&1
before_phases="$(phases_of ARBI)"
# Drop the ARBI steps so the one-shot guard lets the file run, leaving the
# phases rows in place — which is precisely the state that used to duplicate.
psql_ "-c \"delete from public.os_process_steps where entity_code='ARBI'\"" >/dev/null 2>&1
out=$(psql_capture "-f $MIG/20260806000053_arbi_process_seed.sql")
after_phases="$(phases_of ARBI)"
if [ "$after_phases" = "$before_phases" ]; then
  echo "ok    renamed phases did not duplicate on reseed ($before_phases → $after_phases)"
else
  echo "FAIL  renamed phases DUPLICATED on reseed ($before_phases → $after_phases) — the guard still keys on name"
  RC=1
fi

echo ""
if [ $RC -eq 0 ]; then echo "PASS — the seed guards refuse, do not duplicate, and can be got past legitimately"
else echo "FAILED"; fi
exit $RC
