# Island tasks — the desktop island's door into WORK tasks

The owner's Windows island (Oyen Poni fork, `C:\work\oyenza-studio`, branch
`more-me`) shows and edits the WORK daily tasks held in `os_entries`. It is a
second client next to the SPA. It is not a second owner. Decision: D-28.
Migration: `supabase/migrations/20261026000109_island_tasks.sql`.

## What the island can reach

| Can | Cannot |
|---|---|
| Read open WORK tasks, and WORK tasks completed since a timestamp it passes | habits, brain dumps, GROWTH outside tasks / weekly items / blocks |
| Create a WORK task (`normal`, or `urgent` only when sent explicitly) | `os_daily_logs` (score), `os_projects`, Finish line, IELTS, Lab |
| Patch `title`, `done`, `dueDate` on a WORK task | change `priority`, `projectId`, `weeklyGoalId`, `tags`, `domain` |
| Read the WORK time blocks of one day; plan one; rename, move, mark `done` or back to `planned` (D-33) | delete a block; set `skipped` / `carried` / `blocked`; link a task or milestone; set a category |
| The same for GROWTH tasks and blocks, plus weekly items in either domain (D-34) | `os_weekly_plans` (the web's ISO-week goals) |
| | delete anything |

## Calls

All three are `POST {SUPABASE_URL}/rest/v1/rpc/<fn>` with the headers the SPA
bundle already uses (`apikey` and `Authorization: Bearer` with the public anon
key) plus `x-island-token: <64 hex>` and `Content-Type: application/json`.

| Function | Token | Body | 200 returns |
|---|---|---|---|
| `os_island_tasks` | read | `{"p_since": "2026-10-25T17:00:00Z"}` (the island's local midnight in UTC) | `{"server_time": …, "tasks": [row…]}` in creation order |
| `os_island_task_create` | write | `{"p_title": "…", "p_priority": "normal"\|"urgent", "p_due": "YYYY-MM-DD"\|null}` | `row` |
| `os_island_task_patch` | write | `{"p_id": "<uuid>", "p_expected_updated_at": "<row.updated_at verbatim>", "p_patch": {"done": true}}` | `row` |

`row` = `{"id", "title", "priority", "done", "completed_at", "due_date", "project", "pic_options", "pic", "updated_at"}`.
`completed_at` and `due_date` are echoed as stored, or `null`. `project` is the
SAMB Project Board project of a tracker task (`payload.tracker.project`, D-30),
or `null` for every other task ("stand alone"); added by migration
`20261026000112_island_task_project`. `pic_options` is `[{"id","name"}]`,
the people who may hold a tracker task with no PIC (empty otherwise, and
while a pick is on its way); `pic` is the name picked, while that pick is
pending or taken (D-32, migration `20261026000115_tracker_assign_pic`).

### `os_island_task_assign` (write token)

`{"p_id", "p_expected_updated_at", "p_person": "<uuid>"|null}` → `row`. A
person picks one of `pic_options`; `null` undoes the last pick the board
took. PT404 not a tracker task, PT409 `updated_at` moved, PT422 not offered /
already has a PIC / a pick on its way / nothing to undo. The board's answer
arrives later (courier `tracker-writeback`): a refused pick brings the
options back.

Errors use PostgREST's body `{"code","message","details","hint"}`:

| HTTP | code | When |
|---|---|---|
| 401 | PT401 | no token, wrong token, revoked token, or the other capability's token. One message for all, on purpose |
| 404 | PT404 | id not found, or not a WORK task. A GROWTH id looks exactly like a missing one |
| 409 | PT409 | `updated_at` moved: the web changed the row first. Web wins; the island refetches |
| 422 | PT422 | patch key outside `title`/`done`/`dueDate`, empty patch, empty or >500-char title, bad priority, bad date |

Every 200 carries `Cache-Control: no-store`.

## Time blocks (D-33)

Migration `20261027000116_island_blocks.sql`. The island's Tasks tab shows
them as a "Blocks" segment beside the task segments.

| Function | Token | Body | 200 returns |
|---|---|---|---|
| `os_island_blocks` | read | `{"p_day": "2026-10-27"}` (the island's local day) | `{"blocks": [block…]}` in start order |
| `os_island_block_create` | write | `{"p_day", "p_start": "09:00", "p_end": "10:30", "p_label"}` | `block` |
| `os_island_block_patch` | write | `{"p_id", "p_expected_updated_at", "p_patch": {…}}`, keys `done`, `label`, `start` + `end` | `block` |

`block` = `{"id", "date", "start", "end", "label", "category", "status",
"task_id", "updated_at"}`; `category` and `task_id` are `null` when absent,
and every value is read as text, so one odd payload can't break the list.

**Times fit the web's grid.** WORK's Timebox shows 30-minute slots from
08:30 to 18:30 and finds a block by its start (`src/logic/timebox.ts`). So
both writes require `HH:MM` on `:00` or `:30`, `08:30 <= start < end <=
18:30`, and no overlap with another WORK block that day. An overlapping
block would land in a slot the grid has already given away and never be
seen. Longer blocks are fine: the web shows them at their start and counts
their full duration. PT422 carries the reason (`overlaps 09:00–09:30 …`).

**Create** writes what the web's `createBlock` writes: `{date, start, end,
label, status: "planned"}`, `tags '{}'`, `entry_date = date`. It is
unattributed (no `taskId` or `milestoneId`) and has no category.

**`done`** does what the web's `setBlockStatus` (`src/views/work/Today.tsx`)
does for the same two statuses:

- `true` → `status: "done"`; `false` → `status: "planned"`. `blockedOn` and
  `carryNote` are removed either way.
- Done with a `taskId` that names an **open WORK task** ticks that task too
  (`done: true` + `completedAt`). The tracker writeback trigger (D-31) sees it
  like a web tick. Unticking a block never reopens the task.

PT404 not a WORK block, PT409 `updated_at` moved, PT422 bad key / time /
label, or `start` without `end`. There is no delete. Skipped, carried and
blocked need a reason or a carry-over, and attribution needs a pick; all
three stay in the web. The score is not written, as with tasks (next
section).

## GROWTH and weekly items (D-34)

Migration `20261028000117_island_growth_weekly.sql`. The island's Tasks tab
has a Work | Growth switch; each side has weekly items (a stretch of days
with to-dos under it), daily to-dos and time blocks.

**Weekly items** live in a new table, `os_weekly_items`: `domain`
(`work`/`growth`), `title`, `start_date`..`end_date` (at most 93 days),
optional `project_id` (same domain, enforced by trigger) and `area`, and
`status` `open` / `done` / `carried`. RLS is the `os_weekly_plans` set
(owner key writes, owner or read key reads); members see nothing, so the
GROWTH guard holds. `os_weekly_plans` (the web's ISO-week goals) is not
touched. A to-do joins an item through `payload.weeklyItemId`; the web keeps
unknown payload keys, so a web edit leaves the link in place.

The WORK-only doors above are unchanged. The new doors take the domain:

| Function | Token | Body | 200 returns |
|---|---|---|---|
| `os_island_tasks_in` | read | `{"p_domain", "p_since"}` | `{"server_time", "tasks": [task…]}` |
| `os_island_task_create_in` | write | `{"p_domain", "p_title", "p_priority", "p_due", "p_weekly_item"}` | `task` |
| `os_island_task_patch_in` | write | `{"p_domain", "p_id", "p_expected_updated_at", "p_patch"}`, keys `title`, `done`, `dueDate`, `weeklyItemId` | `task` |
| `os_island_weekly_items` | read | `{"p_domain", "p_from", "p_to"}` (≤ 400 days; items overlapping the range) | `{"server_time", "items": [item…]}` |
| `os_island_weekly_create` | write | `{"p_domain", "p_title", "p_start", "p_end", "p_project", "p_area"}` | `item` |
| `os_island_weekly_patch` | write | `{"p_id", "p_expected_updated_at", "p_patch"}`, keys `title`, `start` + `end`, `status` (`open`/`done`), `area` | `item` |
| `os_island_weekly_carry` | write | `{"p_id", "p_expected_updated_at"}` | the new `item` |
| `os_island_blocks_in` | read | `{"p_day"}` | `{"blocks": [block…]}` of both domains |
| `os_island_block_create_in` | write | `{"p_domain", "p_day", "p_start", "p_end", "p_label", "p_ref_kind", "p_ref_id"}`, ref `task` or `weekly` | `block` |
| `os_island_block_patch_in` | write | as `os_island_block_patch` plus `p_domain` | `block` |

`task` and `block` gain `domain` and `weekly_item_id`. `item` = `{"id",
"domain", "title", "start_date", "end_date", "project_id", "project",
"area", "status", "carried_from", "todos", "todos_done", "updated_at"}`.

**Carry** marks the item `carried` and copies it to start on the Sunday
after its end, with the same length (the island's week runs Sunday to
Saturday). Open to-dos move to the copy; done ones stay with the original.

**Blocks keep the web's windows.** The island draws one 08:30–23:30 grid,
but the web's Timebox gives each workspace its own stretch
(`src/logic/timebox.ts`): WORK 08:30–18:30, GROWTH 18:30–23:30. A block
outside its domain's window would never show in the web, so the doors refuse
it (PT422). No overlap on the same day. A GROWTH block may name a GROWTH
to-do or weekly item; ticking it ticks the named to-do, as for WORK.

PT404 a reference of the other domain or a missing row, PT409 a stale
`updated_at`, PT422 a bad domain, key, date range or time. Nothing is
deleted from the island.

## Payload shape: mirrors the SPA

`src/data/supabaseRepository.ts` (`entryToRow`) serialises a `TaskEntry`
through JSON, so absent fields are absent keys, not nulls. The RPCs write the
same way:

- create → `{title, priority, done: false}` plus `dueDate` when given. No
  `completedAt`, `weeklyGoalId` or `projectId` keys.
- `done: true` → `completedAt` in `Date.toISOString()` form (UTC, ms, `Z`).
- `done: false` → the `completedAt` key is removed.
- `dueDate: null` → the `dueDate` key is removed.
- `entry_date` follows `dueDate` (the SPA's `entryDateFor` for tasks), so the
  SPA's date filters see island writes the same as their own.

## The score: accepted limitation

The RPCs never touch `os_daily_logs`. Today (`src/views/work/Today.tsx`)
computes the score **on screen** from live state every time it loads (a
`useMemo` over the fetched tasks). It **writes** `os_daily_logs` only from a
mutation made in the web (`commitTasks` → `recomputeAndPersistDailyLog`).
So an urgent task ticked from the island shows in the web's on-screen score
at the next load. The stored daily log catches up only at the next web
mutation that day, and never for a past day. Accepted: the owner is
reworking the score (2026-10-26). No score code was added for the island.

Note also that the web's scored set (`isScoredTask`) is every **open urgent**
task whatever its due date, plus urgent tasks completed today. The island's
"Today" group is a to-do view instead: any task due today. Different on
purpose; the `!` mark on the island shows which rows the web scores.

## Tokens: runbook

Owner only, in the Supabase SQL editor (or MCP `execute_sql`) as `postgres`.
Raw tokens are shown once and never stored. Only their SHA-256 is.

```sql
-- mint (one per capability)
select private.os_island_token_mint('read',  'poni-desktop read');
select private.os_island_token_mint('write', 'poni-desktop write');

-- list
select id, capability, label, created_at, revoked_at, last_seen_at
  from private.os_island_tokens order by created_at;

-- revoke
update private.os_island_tokens set revoked_at = now()
 where label = 'poni-desktop read' and revoked_at is null;
```

On the island: `token r <read>`, `token w <write>`, `token clear`. The values
are sealed with DPAPI in `%LOCALAPPDATA%\Poni\os-island.bin`.

**Rotate:** mint new → type it on the island → revoke the old. The old one
answers 401 at the next call.

`last_seen_at` is stamped at most hourly.

## Checks

- `supabase/tests/island_tasks.sql` — one DO block that always raises
  `island_tasks PASS (n checks)` or `… FAIL …`. The exception rolls back
  every write it made, so it is safe to run against production.
- `supabase/tests/island_growth_weekly.sql` — the D-34 doors, same pattern
  (`island_growth_weekly PASS (n checks)`).
- `scripts/island-tasks-tests.sh` — the same file on a local replay, plus a
  negative control (the patch RPC without its WORK filter must go red).

## One-time import of the island's old local list

`scripts/poni-tasks-import.mjs` turns the island's old `data.json` task list
into a review file, then into one INSERT transaction tagged `poni-import`:

```
node scripts/poni-tasks-import.mjs review <copy of data.json> scratch/poni-tasks-review.json
# owner edits domain / include / priority in the review file
node scripts/poni-tasks-import.mjs sql scratch/poni-tasks-review.json scratch/poni-tasks-import.sql
```

Reversal: `delete from public.os_entries where 'poni-import' = any(tags);`.
The island's `data.json` is never modified. The official build and the Mac
page still read it.
