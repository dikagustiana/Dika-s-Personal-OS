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
