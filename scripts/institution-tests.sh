#!/usr/bin/env bash
# ===========================================================================
# THE INSTITUTION'S ENFORCEMENT, AGAINST A REAL POSTGRES.
# ===========================================================================
#
# Replays every migration into a throwaway cluster and then ATTEMPTS the
# violations Part 1 says must be impossible: a direct write to a live prompt,
# an internal agent born without the director, a public record derived from
# internal input, an agent writing the evaluation set or reading a rubric, a
# peer review by its own author, a loop past its B-5 bound. Zero rows
# returned means healthy. Then the negative control: drop the prompt lock
# and the suite MUST go red.
#
#     scripts/institution-tests.sh          (--keep / --port N as elsewhere)
#
# Not part of `pnpm test`: CI has no Postgres.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/pg-cluster.sh"
pgc_parse_flags "$@"
pgc_bootstrap "institution"

RC=0
echo ""
run_suite "institution_guards (B-1 prompt lock, B-2 committee, B-3 lane at birth, data_class propagation, reviews, B-5 bounds, B-9 evals, 1-E decisions)" \
  "$REPO/supabase/tests/institution_guards.sql" || RC=1

echo ""
echo "==> negative control: dropping os_lab_agents_prompt_lock"
psql_ "-c 'drop trigger os_lab_agents_prompt_lock on public.os_lab_agents;'" >/dev/null 2>&1
if run_suite "institution_guards WITH PROMPT LOCK DROPPED (must FAIL)" \
     "$REPO/supabase/tests/institution_guards.sql" >/dev/null 2>&1; then
  echo "FAIL  suite stayed green with the prompt lock dropped — it does not catch the regression"
  RC=1
else
  echo "ok    suite goes red when the prompt lock is dropped (it catches the regression)"
fi
psql_ "-c 'create trigger os_lab_agents_prompt_lock before update of system_prompt on public.os_lab_agents for each row execute function public.os_lab_agents_prompt_lock();'" >/dev/null 2>&1

echo ""
echo "==> negative control: re-granting anon EXECUTE on os_inst_eval_score(uuid) (the grant 100 left open, 102 closed)"
psql_ "-c 'grant execute on function public.os_inst_eval_score(uuid) to anon;'" >/dev/null 2>&1
if run_suite "institution_guards WITH ANON ABLE TO SCORE (must FAIL)" \
     "$REPO/supabase/tests/institution_guards.sql" >/dev/null 2>&1; then
  echo "FAIL  suite stayed green with anon able to call the scorer — the grant matrix is not checked"
  RC=1
else
  echo "ok    suite goes red when anon can call the scorer (it catches the regression)"
fi
psql_ "-c 'revoke execute on function public.os_inst_eval_score(uuid) from anon;'" >/dev/null 2>&1

echo ""
if [ $RC -eq 0 ]; then echo "PASS — the institution's guards hold at the database layer, both negative controls red as required"
else echo "FAIL — see above"; fi
exit $RC
