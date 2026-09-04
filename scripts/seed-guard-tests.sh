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

# ---------------------------------------------------------------------------
# EVERY SEEDED ENTITY, DRIVEN BY A TABLE.
# ---------------------------------------------------------------------------
# One row per entity: code, the seed file that CURRENTLY defines it, then the
# counts it is pinned to (steps needs phases lanes gates). KGR arrived from
# another session and its guard had never been executed either — a hardcoded
# SAMB/ARBI pair would have quietly stayed green while a third seed went
# untested. Adding the next entity is one line.
#
# KGR points at 88, the last file that shaped its live chain — not at 60 (v0.1,
# replaced in place by 61) and no longer at 61 either: v0.2 was retracked to
# RPA/TRADING by 87 and joined by the ten-step trading chain of 88, so a full
# replay leaves 48 steps, 130 needs and 15 phases, and 61's own guard
# (`count = 38`) does not fire against that shape any more. 88 refuses cleanly
# whenever a KGR TRADING step exists, which is the refusal this section can
# still prove; what 61 does against the live shape is exercised BY NAME in
# section 1b, because hiding it would be worse than a red. Whenever a seed is
# superseded, this row moves to the file that defines the live shape.
#
# SAMB's counts are what a FULL replay leaves behind, not what its seed file
# inserts: 20260806000051 still seeds 30/118/15 and still refuses on re-run,
# and 20260903000094 (v0.4) then raises the chain to 33 steps, 131 needs and
# 20 gates in place. The v0.4 file is not a seed and is exercised separately
# in section 4 below.
ENTITIES=(
  "SAMB 20260806000051_samb_process_seed 33 131 7 6 20"
  "ARBI 20260806000053_arbi_process_seed 23 112 7 6 12"
  "KGR  20260820000088_kgr_trading_seed 48 130 15 9 42"
)

echo ""
echo "==> baseline after a clean replay"
expect() {
  local what="$1" got="$2" want="$3"
  if [ "$got" != "$want" ]; then
    echo "FAIL  $what = $got, expected $want"; RC=1; return 1
  fi
  return 0
}

for row in "${ENTITIES[@]}"; do
  read -r code _file want_steps want_needs want_phases want_lanes want_gates <<<"$row"
  printf "    %-5s steps=%s needs=%s phases=%s lanes=%s gates=%s\n" \
    "$code" "$(steps_of "$code")" "$(needs_of "$code")" "$(phases_of "$code")" \
    "$(lanes_of "$code")" "$(gates_of "$code")"
  expect "$code steps"  "$(steps_of "$code")"  "$want_steps"
  expect "$code needs"  "$(needs_of "$code")"  "$want_needs"
  expect "$code phases" "$(phases_of "$code")" "$want_phases"
  expect "$code lanes"  "$(lanes_of "$code")"  "$want_lanes"
  expect "$code gates"  "$(gates_of "$code")"  "$want_gates"
done
[ $RC -eq 0 ] && echo "ok    baseline counts match every seed"

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
    printf '      %s\n' "$(printf '%s' "$out" | grep -io 'Rantai [^"]* sudah terseed[^"]*' | head -1 | cut -c1-96)…"
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
for row in "${ENTITIES[@]}"; do
  read -r code file _rest <<<"$row"
  guard_refuses "$code" "$MIG/$file.sql"
done

# ---------------------------------------------------------------------------
# 1b. THE v0.2 SEED (61) NO LONGER REFUSES AGAINST THE LIVE SHAPE. NAMED, NOT HIDDEN.
# ---------------------------------------------------------------------------
# 61 guards on `count = 38` — exactly the v0.2 shape it seeds. Since 87/88 a
# full replay leaves 48 KGR steps, so re-running 61 passes its own guard,
# deletes every KGR row and reseeds v0.2: the trading chain and the sourcing
# retrack vanish with no error. A RESET rather than a duplicate, and a real
# hazard for anyone who re-runs an applied file against live. 61 is an applied
# one-shot and is never edited retroactively, so this harness cannot make it
# refuse; it can only keep the fact visible. This runs 61 against the live
# shape and reports what happened as a `note` — not a FAIL, the file is
# history and behaves exactly as written — then re-applies 87 and 88 so every
# later section sees the real replay again, which doubles as proof that 87
# and 88 can be re-applied from the v0.2 state. The day 61 is retired or
# regains a guard that fires, the note flips to `ok` and this section can go.
echo ""
echo "==> re-running the KGR v0.2 seed (61) against the live 87/88 shape"
out=$(psql_capture "-f $MIG/20260807000061_kgr_process_seed_v2.sql")
if [ -n "$(printf '%s' "$out" | grep -i 'sekali pakai')" ]; then
  echo "ok    61 refuses against the live shape — its guard fires again; revisit section 1b"
else
  echo "note  61 does NOT refuse against the live shape: KGR reset to steps=$(steps_of KGR) needs=$(needs_of KGR) phases=$(phases_of KGR) — known since 87/88; never re-run an applied file against live"
  if ! out=$(psql_capture "-f $MIG/20260820000087_kgr_retrack_sourcing.sql"); then
    echo "FAIL  87 did not re-apply from the v0.2 shape:"; printf '%s\n' "$out" | head -6 | sed 's/^/      /'; RC=1
  elif ! out=$(psql_capture "-f $MIG/20260820000088_kgr_trading_seed.sql"); then
    echo "FAIL  88 did not re-apply after 87:"; printf '%s\n' "$out" | head -6 | sed 's/^/      /'; RC=1
  elif [ "$(steps_of KGR)" = "48" ] && [ "$(needs_of KGR)" = "130" ] && [ "$(phases_of KGR)" = "15" ]; then
    echo "ok    87 + 88 restored the live KGR shape: steps=48 needs=130 phases=15"
  else
    echo "FAIL  87 + 88 did not restore the live shape: steps=$(steps_of KGR) needs=$(needs_of KGR) phases=$(phases_of KGR)"; RC=1
  fi
fi

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
  if [ "$(steps_of SAMB)" = "33" ]; then
    echo "ok    SAMB untouched by the ARBI down-seed (steps=33)"
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

# ---------------------------------------------------------------------------
# 4. THE v0.4 RAISE (20260903000094) IS ONE-SHOT TOO, AND ITS DOWN RESTORES v0.3.
# ---------------------------------------------------------------------------
# 94 is not a seed, but it inserts needs and bridge rows by step LABEL, so a
# re-run against a database that already carries it would duplicate them with
# no error — which is why its guard refuses the moment G16 exists. The replay
# above applied it once. This re-runs it (must abort with its own message and
# move no row), runs its down (SAMB back to the seed's 30/118/15 while ARBI
# is untouched), then applies it again (33/131/20 restored). A guard that
# cannot be got past legitimately is a wall, not a gate — the same bar the
# ARBI seed is held to in section 2.
V04="$MIG/20260903000094_samb_process_v04.sql"
V04_DOWN="$DOWN/20260903000094_samb_process_v04_down.sql"

echo ""
echo "==> re-running the SAMB v0.4 raise (94) against a database that already carries it"
before_v04="steps=$(steps_of SAMB) needs=$(needs_of SAMB) gates=$(gates_of SAMB)"
out=$(psql_capture "-f $V04")
if [ -z "$(printf '%s' "$out" | grep -i 'ERROR')" ]; then
  echo "FAIL  re-running 94 did NOT abort — its guard is not firing"; RC=1
elif [ -z "$(printf '%s' "$out" | grep -i 'menolak jalan')" ]; then
  echo "FAIL  94 aborted, but not with its guard's message:"
  printf '%s\n' "$out" | head -4 | sed 's/^/      /'; RC=1
else
  echo "ok    re-running 94 aborts with its guard's own message"
  printf '      %s\n' "$(printf '%s' "$out" | grep -io 'samb_process_v04 menolak jalan[^"]*' | head -1 | cut -c1-96)…"
fi
after_v04="steps=$(steps_of SAMB) needs=$(needs_of SAMB) gates=$(gates_of SAMB)"
if [ "$before_v04" = "$after_v04" ]; then
  echo "ok    SAMB unchanged by the refused re-run ($after_v04)"
else
  echo "FAIL  SAMB moved despite the refusal: $before_v04 → $after_v04"; RC=1
fi

echo ""
echo "==> down 94 (SAMB back to v0.3 + 56), then 94 again"
if ! out=$(psql_capture "-f $V04_DOWN"); then
  echo "FAIL  94's down-migration did not run"; printf '%s\n' "$out" | head -6 | sed 's/^/      /'; RC=1
else
  if [ "$(steps_of SAMB)" = "30" ] && [ "$(needs_of SAMB)" = "118" ] && [ "$(gates_of SAMB)" = "15" ]; then
    echo "ok    94's down restored the seed exactly: steps=30 needs=118 gates=15"
  else
    echo "FAIL  94's down did not restore v0.3: steps=$(steps_of SAMB) needs=$(needs_of SAMB) gates=$(gates_of SAMB)"; RC=1
  fi
  if [ "$(steps_of ARBI)" = "23" ]; then
    echo "ok    ARBI untouched by 94's down (steps=23)"
  else
    echo "FAIL  94's down changed ARBI: steps=$(steps_of ARBI)"; RC=1
  fi
  if ! out=$(psql_capture "-f $V04"); then
    echo "FAIL  re-applying 94 after its down did NOT work — the guard is a wall:"
    printf '%s\n' "$out" | head -6 | sed 's/^/      /'; RC=1
  else
    if [ "$(steps_of SAMB)" = "33" ] && [ "$(needs_of SAMB)" = "131" ] && [ "$(gates_of SAMB)" = "20" ]; then
      echo "ok    94 re-applied cleanly: steps=33 needs=131 gates=20"
    else
      echo "FAIL  94 did not restore v0.4: steps=$(steps_of SAMB) needs=$(needs_of SAMB) gates=$(gates_of SAMB)"; RC=1
    fi
  fi
fi

echo ""
if [ $RC -eq 0 ]; then echo "PASS — the seed guards refuse, do not duplicate, and can be got past legitimately"
else echo "FAILED"; fi
exit $RC
