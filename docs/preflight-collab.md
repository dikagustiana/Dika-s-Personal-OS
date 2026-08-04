# Pre-flight — entity-scoped collaborator access

Captured live from Supabase project `ascbthsgborseynmmthm` on 2026-08-04, **before
the first migration of this task**. This file is the baseline the GROWTH policy
diff is measured against (§9 of the task); the post-change diff is appended at
the bottom when verification runs.

## 1. Row counts, every `public.os_*` table (exact)

| Table | Rows |
| --- | ---: |
| os_daily_logs | 6 |
| os_entries | 33 |
| os_fact_library | 0 |
| os_finish_line_account_map | 50 |
| os_finish_line_accounts | 560 |
| os_finish_line_cells | 245 |
| os_finish_line_deps | 80 |
| os_finish_line_entities | 5 |
| os_finish_line_item_projects | 48 |
| os_finish_line_items | 55 |
| os_ielts_errors | 0 |
| os_ielts_results | 1 |
| os_ielts_sessions | 1 |
| os_model_routing | 14 |
| os_projects | 40 |
| os_research_claims | 0 |
| os_research_council_sessions | 0 |
| os_research_cycles | 0 |
| os_research_items | 0 |
| os_research_log | 0 |
| os_research_meta | 0 |
| os_weekly_plans | 2 |

`auth.users`: 0 rows — Supabase Auth unused before this task.

## 2. Policy inventory baseline (the GROWTH diff reference)

Pulled from `pg_policy`. Every one of the 22 tables above carries **exactly these
four policies and no others** — 88 policies total, uniform. `roles=ALL` means the
policy row names no role (applies to every role); the predicate is what gates.

```
<table> | require app key to delete | DELETE | permissive | roles=ALL | using=( SELECT os_key_valid() AS os_key_valid) | check=-
<table> | require app key to insert | INSERT | permissive | roles=ALL | using=- | check=( SELECT os_key_valid() AS os_key_valid)
<table> | require app key to select | SELECT | permissive | roles=ALL | using=(( SELECT os_key_valid() AS os_key_valid) OR ( SELECT os_read_key_valid() AS os_read_key_valid)) | check=-
<table> | require app key to update | UPDATE | permissive | roles=ALL | using=( SELECT os_key_valid() AS os_key_valid) | check=( SELECT os_key_valid() AS os_key_valid)
```

Confirmed per-table for: os_daily_logs, os_entries, os_fact_library,
os_finish_line_account_map, os_finish_line_accounts, os_finish_line_cells,
os_finish_line_deps, os_finish_line_entities, os_finish_line_item_projects,
os_finish_line_items, os_ielts_errors, os_ielts_results, os_ielts_sessions,
os_model_routing, os_projects, os_research_claims, os_research_council_sessions,
os_research_cycles, os_research_items, os_research_log, os_research_meta,
os_weekly_plans.

GROWTH tables in that list (must be byte-identical after this task):
os_ielts_errors, os_ielts_results, os_ielts_sessions, os_research_claims,
os_research_council_sessions, os_research_cycles, os_research_items,
os_research_log, os_research_meta, os_fact_library, os_model_routing.

## 3. Key-check functions (live `pg_get_functiondef`)

```sql
CREATE OR REPLACE FUNCTION public.os_key_valid()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  candidate text;
  stored text;
begin
  candidate := coalesce(
    current_setting('request.headers', true)::json ->> 'x-app-key',
    ''
  );
  select key_hash into stored from private.os_app_secret;
  if candidate = '' or stored is null or stored = 'unset' then
    return false;
  end if;
  return extensions.crypt(candidate, stored) = stored;
end;
$function$
```

```sql
CREATE OR REPLACE FUNCTION public.os_read_key_valid()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  candidate text;
  stored text;
begin
  candidate := coalesce(
    current_setting('request.headers', true)::json ->> 'x-app-key',
    ''
  );
  select key_hash into stored from private.os_read_key;
  if candidate = '' or stored is null or stored = 'unset' then
    return false;
  end if;
  return extensions.crypt(candidate, stored) = stored;
end;
$function$
```

Neither function is edited by this task (§2 rule: never edit or drop an existing
policy or function).

## 4. Test and build baseline

```
pnpm test:run   → Test Files 38 passed (38) · Tests 696 passed (696)
pnpm build      → tsc -b + vite build OK (chunk-size warning only, pre-existing)
```

## 5. §4 backfill simulation (run before Migration B)

Classification rule applied read-only against live titles:

| would_be | count |
| --- | ---: |
| internal | 19 (16 growth + `Decks`, `Claude skill ecosystem`, `Meta / PMO`) |
| samb | 21 (includes `Consolidation & group modeling`, deliberately visible) |
| gunungjati | 0 |

Total 40. Matches the required 21 / 19 / 0 exactly; all four sentinel titles
matched byte-for-byte, so the title-based backfill is safe to run.

## 6. Advisors baseline (for new-vs-preexisting triage in §9)

Security — 14 WARN, all pre-existing, all the same class:
`anon/authenticated can execute SECURITY DEFINER function` for the seven
functions that are *designed* to be callable without a session (`os_key_valid`,
`os_read_key_valid`, `os_verify_key`, `os_share_link_create`,
`os_share_link_extend`, `os_share_link_revoke`, `os_share_links_list`). This is
the architecture — RLS predicates and the unlock gate run as anon — reported,
not fixed.

Performance — 16 INFO, all pre-existing: unindexed FKs
(`os_finish_line_account_map.item_id`, `os_finish_line_cells.entity_code`,
`os_finish_line_deps.input_id`, `os_ielts_errors.result_id`), no-PK on the four
`private.*backup*` tables, and eight never-used indexes.

## 7. Migration ledger position

Live ledger ends at `20260731021633 share_links` (33 applied migrations). Repo
files and ledger use different numbering schemes on purpose — migrations in this
task are applied via the Supabase migration tool (never `db push` / `db reset`)
and the repo files record the same SQL.

---

# Post-change verification (§9) — appended after the migrations landed

Applied this task (ledger names): `collab_membership`, `project_engagement`,
`cell_attribution`, `member_policies`, `write_guard_grants`. Repo files
`20260804000037..41` plus down-migrations under `supabase/migrations/down/`.

## A. §9 assertion run — ALL 16 CASES PASSED

`supabase/tests/collab_rls.sql` executed against production twice (once when
written, once after `write_guard_grants`), everything inside
`begin; … rollback;`. Both runs reached the final select, which only happens
when every assertion holds. Synthetic ASI-only member observed: 49 ASI cells
and nothing else; 21 work+samb projects and nothing else; zero rows from every
GROWTH table, entries, logs, plans, accounts, and history; `input → figure`
succeeded with contributor stamp + history row; `input → zero/undefined/locked`,
`figure → input`, cross-entity, column changes, INSERT/DELETE, and every write
to accounts/projects/history rejected; anon saw zero rows everywhere. Zero
fixture residue confirmed after the runs (`auth.users` 0, memberships 0,
history 0, all 245 cells `actor_kind='owner'`).

## B. GROWTH policy diff — EMPTY

Re-pulled the full policy inventory and compared every GROWTH table (plus
entries/daily logs/weekly plans) against §2's baseline: all 14 tables carry
**exactly 4 policies, byte-identical predicates**, nothing added, nothing
changed. The new policies live only on: os_finish_line_cells (2),
os_finish_line_items, os_finish_line_entities, os_finish_line_account_map,
os_finish_line_deps, os_finish_line_item_projects, os_projects (1 each),
os_entity_members (5, new table), os_finish_line_cell_history (1, new table).
Total 88 → 102.

## C. explain analyze — os_member_entities() is an InitPlan, once per query

Member SELECT on `os_finish_line_cells` (the table whose per-row bcrypt once
produced a live 500):

```
Seq Scan on os_finish_line_cells  (actual time=2.415..2.625 rows=49 loops=1)
  Filter: ((InitPlan 1).col1 OR (InitPlan 2).col1 OR (entity_code = ANY ((InitPlan 3).col1)))
  Rows Removed by Filter: 196
  InitPlan 1 → os_key_valid        (actual time=1.430..1.431 rows=1 loops=1)
  InitPlan 2 → os_read_key_valid   (actual time=0.417..0.418 rows=1 loops=1)
  InitPlan 3 → os_member_entities  (actual time=0.508..0.509 rows=1 loops=1)
Execution Time: 2.655 ms
```

Member SELECT on `os_projects`:

```
Seq Scan on os_projects  (actual time=1.745..1.790 rows=21 loops=1)
  Filter: ((InitPlan 1).col1 OR (InitPlan 2).col1 OR ((domain = 'work') AND (engagement = 'samb') AND ((InitPlan 3).col1 <> '{}')))
  Rows Removed by Filter: 19
  InitPlan 3 → os_member_entities  (actual time=0.557..0.557 rows=1 loops=1)
Execution Time: 1.834 ms
```

All three functions evaluate exactly once per statement (`loops=1`); the
per-row work is a constant-array test. No per-row function calls anywhere.

## D. Advisors after the change — new-vs-preexisting

Security:
- NEW, resolved: `os_finish_line_cells_write_guard()` executable by
  anon/authenticated (Supabase default grants on new functions). Fixed by
  migration `write_guard_grants` — a trigger function is not an API and
  trigger firing does not check caller EXECUTE. Re-verified: the §9 suite
  still passes end-to-end after the revoke.
- NEW, accepted: `os_member_entities()` executable by authenticated — required:
  policy predicates evaluate as the querying role, which must hold EXECUTE.
  Same class as the seven pre-existing warnings on os_key_valid /
  os_read_key_valid / os_verify_key / share-link functions, which are the
  architecture. anon holds no grant on it.
- Pre-existing, unchanged: the 14 baseline WARNs (§6 above).

Performance:
- NEW, accepted by design: `multiple_permissive_policies` WARN on the 8 tables
  that now carry a member policy beside the owner policy for the same
  role/action. This is the task's mandated architecture — additive OR'd
  policies, never editing the existing ones — and the measured cost is three
  InitPlans totalling ~2 ms per query (plans above), not per-row work.
- NEW, expected: `unused_index` INFO on `os_entity_members_entity_idx` and
  `os_finish_line_cells_actor_idx` — brand-new indexes with zero members yet.
- Pre-existing, unchanged: unindexed FKs, backup-table no-PK, other unused
  indexes (§6 above). Reported, not fixed, per task instruction.
