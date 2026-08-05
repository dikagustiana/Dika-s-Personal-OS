# Review — Personal OS (pre-backend pass)

Reviewed at the point of picking the project up for backend + deployment work
(commit `4ab1de0`). Scope: does it build, do tests pass, is the data seam
clean enough to swap in a real backend. This is not a UI review.

## Verification

| Check | Result |
| --- | --- |
| `pnpm install` | OK (pnpm 10, Node 20) |
| `pnpm test:run` | 8/8 tests pass (`score.test.ts`, `week.test.ts`) |
| `pnpm build` | OK (`tsc -b` strict + vite build) |

## The data seam

The seam is clean. Every read/write in all five views (`Today`, `Timebox`,
`Week`, `Projects`, `Analytics`) goes through the `Repository` interface
obtained from `useAppStore((s) => s.repository)`. I found **no** view that
reaches around the interface — no direct storage access, no imports of
`mockRepository` outside `appStore.ts`, no hidden persistence.

Semantics of the mock worth knowing because the Supabase implementation must
replicate them exactly:

- `listEntries({ date })` filters **per type**: `timeblock` by `.date`,
  `task` by `.dueDate`, `braindump` by `createdAt.slice(0, 10)` (UTC date),
  and `habit` entries always pass a date filter. The Supabase repo mirrors
  this via a promoted `entry_date` column plus an `OR type = 'habit'` clause.
- `updateEntry(id, patch)` uses spread-merge, so a key explicitly present
  with value `undefined` (e.g. `completedAt: undefined` when un-completing a
  task in `Today.tsx`) **clears** the field. The Supabase repo replicates
  this by merging in JS and dropping `undefined` keys before writing JSONB.
- IDs and `createdAt`/`updatedAt` are generated client-side
  (`crypto.randomUUID()`, `new Date().toISOString()`).

## Findings (flagged, deliberately not fixed — backend was the mandate)

1. **No `.gitignore` existed.** `node_modules/`, `dist/` and `*.tsbuildinfo`
   were unignored, and nothing would have stopped a `.env` with real keys
   from being committed. Fixed in this branch (this one I did fix, since the
   backend work makes it a security issue, not a style issue).
2. **Score not persisted until a habit is toggled** (`Today.tsx`):
   `toggleTask` only writes the daily log `if (dailyLog)` — on a fresh day
   with no log yet, completing tasks records no score until the first habit
   toggle creates the log. `toggleHabit` and Timebox's `snapshotTodayScore`
   do handle the null case. One-line fix, but it changes app behaviour, so
   left for the owner to confirm.
3. **Full refetch every minute** (`Today.tsx`): `loadToday` depends on `now`,
   which a `setInterval` updates every 60 s, so the view refetches all
   entries + daily log + weekly plan each minute. Harmless in-memory; against
   Supabase it is 3 network calls/minute while the Today view is open. Fine
   for a single user, but worth knowing it's there.
4. **`listEntries()` without a filter** is used by `Today.tsx` and
   `Timebox.snapshotTodayScore`, then filtered client-side. With one user's
   data volume this is fine; if entry count ever grows large, pass the
   `type`/`date` filters instead.
5. **Habits and projects have no creation UI** — they exist only in seed
   data. With an empty cloud database the Habits card and Projects view would
   be permanently empty. Addressed by a seed migration
   (`supabase/migrations/..._seed.sql`) that inserts the five habits and four
   projects with the same fixed UUIDs as `src/data/seed.ts`.
6. **Timezone quirk (pre-existing):** braindumps are date-bucketed by the UTC
   date of `createdAt` while "today" is the local date, so a dump captured
   late evening west of UTC (or early morning east) can bucket to a
   neighbouring day. Kept as-is; the Supabase repo reproduces the same
   semantics rather than silently changing them.
7. **Bundle size:** single 643 kB JS chunk (recharts + lucide dominate).
   Cosmetic for a personal tool; code-splitting the Analytics view would fix
   it if it ever matters.
8. **Sidebar copy says "Local prototype / Mock data only"** — no longer
   accurate when Supabase credentials are configured. Left untouched (UI is
   out of scope), flagged for the next UI pass.

## Schema mapping (what the backend adds)

See `supabase/migrations/` for the source of truth. Summary:

| Domain type (`types.ts`) | Table | Notes |
| --- | --- | --- |
| `Entry` (discriminated union) | `os_entries` | Shared fields as columns (`id`, `type`, `created_at`, `updated_at`, `tags`); type-specific fields in `payload jsonb` (camelCase, domain-shaped); `entry_date` promoted for filtering (task → `dueDate`, timeblock → `date`, braindump → UTC date of `createdAt`, habit → null); indexes on `(type)` and `(entry_date)` |
| `DailyLog` | `os_daily_logs` | `date` pk, `habits jsonb`, `score int` |
| `WeeklyPlan` | `os_weekly_plans` | `week` pk, `theme`, `goals jsonb`, `reviewed_at` |
| `Project` | `os_projects` | Real columns; `milestones jsonb`; `sort_order` instead of the reserved-ish `order` (PostgREST uses `order` as its sorting query param, so a column named `order` cannot be filtered/ordered on unambiguously) |

`types.ts` and `repository.ts` are **unchanged**. The mock repository is
unchanged and remains the no-credentials fallback.

## Security posture (decision + residual risk)

**Context:** single user, no auth system by design, data in Supabase cloud,
anon key necessarily shipped in the client bundle.

**Decision: a single passphrase enforced server-side by RLS, sent as a
request header.** All `os_` tables have RLS enabled with a single policy that
calls `os_key_valid()`, which compares the `x-app-key` request header against
a bcrypt hash stored in a `private` schema table (not exposed through the
API). The app shows a passphrase gate before any data call; the passphrase is
verified via an `os_verify_key()` RPC, kept in `localStorage`, and attached
to every PostgREST request as a header.

Why this over the two suggested options:

- *Env-provided passphrase gate (`VITE_APP_*`):* any `VITE_` env var is baked
  into the public JS bundle, so the passphrase would be readable by anyone
  who opens DevTools on the deployed site — it gates the UI but not the
  database, which stays fully open to anyone with URL + anon key. That fails
  the "never leave tables open to the anon role unconditionally" requirement.
- *Supabase anonymous sign-in + session-scoped RLS:* anonymous sessions are
  per-browser. The owner uses this from a phone **and** a laptop (mobile is a
  hard requirement), which yields different anonymous user IDs that can't see
  each other's rows — either the RLS scope breaks multi-device use, or the
  policies degrade to "any authenticated user", which an attacker satisfies
  by calling `signInAnonymously()` themselves. Also, clearing browser storage
  would orphan the data.

The header+RLS approach keeps the secret **out of the bundle entirely**
(the user types it), enforces it **server-side on every request**, and works
across any number of devices.

**What an attacker with the deployed URL + anon key can still do:**

- Call `os_verify_key()` repeatedly to brute-force the passphrase — there is
  no rate limit beyond Supabase's platform limits. A long random passphrase
  makes this impractical; a weak one does not.
- Discover table names and the API shape (schema introspection is visible).
- Nothing else: reads return empty sets and writes fail while the header
  check fails.

**If the attacker also obtains the passphrase** (shoulder-surfing, XSS,
reading `localStorage` on a shared device), they have full read/write over
all data — there is no second factor and no per-row ownership. Rotating is
one SQL statement (documented in the README).

Residual risks accepted for a single-user personal tool: passphrase in
`localStorage` (XSS or device compromise exposes it), no brute-force rate
limiting, no audit log. If any of these become unacceptable, the next step up
is real Supabase email+password auth with a single pre-created user — the
gate component and RLS policies are the only things that would change.

## Collaborator access (added 2026-08-04)

The app stops being strictly single-user: a small number of colleagues hold
Supabase magic-link accounts, entity-scoped membership, and exactly two
capabilities — **write Finish Line cells for their entities (`input → figure`
and the note), and read SAMB WORK projects**. Everything else about the
security posture above is unchanged: the passphrase path was not edited,
weakened, or migrated, and every pre-existing policy is byte-identical to the
baseline recorded in `docs/preflight-collab.md`.

### New objects

| Object | What it is |
| --- | --- |
| `os_entity_members` | (user_id → auth.users, entity_code → os_finish_line_entities, role `contributor`). Never seeded — rows are real colleagues, inserted manually (README). |
| `os_member_entities()` | `SECURITY DEFINER STABLE` → text[] of the caller's entity codes; `{}` for anon/owner. Called in policies as `(select …)` so it is one InitPlan per query, never per-row (measured: InitPlan 3, ~0.5 ms, plans in `docs/preflight-collab.md`). |
| `os_projects.engagement` | `samb \| gunungjati \| internal`, NOT NULL, **no default** — a future Gunung Jati project is invisible to SAMB collaborators unless someone explicitly says otherwise. TypeScript requires the field at every construction site. |
| `os_finish_line_cells.actor_kind / actor / changed_at` | Trigger-written attribution. Any owner write resets `actor_kind` to `owner`, so a contributor-written `figure` is distinguishable until the owner touches it. |
| `os_finish_line_cell_history` | Append-only audit: cell, from/to state, note-changed flag, actor, timestamp. Written only by the trigger; SELECT owner-only; **no UPDATE or DELETE policy exists for anyone, including the owner**. |
| `os_finish_line_cells_write_guard()` | BEFORE UPDATE trigger. Owner header → any transition. Contributor JWT → membership on the row's entity, column allowlist (a jsonb diff of the whole row, so new columns are covered by default), and `input → figure` only. Neither credential → reject. EXECUTE revoked from client roles — a trigger is not an API. |

### Policy set per touched table (after the change)

Every table keeps its four `require app key to select/insert/update/delete`
policies untouched; the additions are all permissive, `to authenticated`,
`member `-prefixed, OR'd by Postgres:

| Table | Added |
| --- | --- |
| os_finish_line_cells | member SELECT (own entities) + member UPDATE (own entities; trigger enforces the transition) |
| os_finish_line_items / _entities / _account_map | member SELECT (any membership — structure needed to render a column) |
| os_finish_line_deps / _item_projects | member SELECT via `exists` join to an own-entity cell; item-grain edges (`cell_id null`) stay invisible |
| os_projects | member SELECT — as first shipped, `domain='work' and engagement='samb'`; **replaced at slice 1** by the per-project grant, see the 2026-08-05 section below. Still read only, no write policy of any kind |
| os_entity_members | owner CRUD (passphrase; SELECT deliberately does **not** accept the share read key) + member SELECT of own rows |
| os_finish_line_cell_history | owner SELECT only |
| **os_finish_line_accounts** | **nothing** — 560 rows of real chart of accounts stay owner-only; a member read returns a clean empty set and the UI renders an empty state |
| **every GROWTH table, os_entries, daily logs, weekly plans** | **nothing** — isolation is the absence of a policy, not a predicate |

### The submitter/approver rule, and why there is no acceptance state

`CellState` is not a pipeline — it describes what is true of the Excel pack —
so no `submitted`/`accepted` state was added. The split rides the states that
exist: `input → figure` is *delivery* ("the number now exists, and nothing
more"), which is exactly what a contributor knows; `zero`, `undefined`,
`locked`, and every backward move are *assertions about the pack* that only
the owner stands behind. Acceptance stays what it always was — derived on
read from the edges behind a figure — and the interim signal is attribution:
a contributor-written cell renders a submission dot until the owner's next
touch resets `actor_kind`. Enforced twice: `guardCellTransition` client-side
for the fast failure, the trigger in SQL for the real one. Verified live by
`supabase/tests/collab_rls.sql` (16 cases, run inside `begin…rollback`
against production, all passing) — including direct-API attempts that bypass
the UI entirely.

### Residual risk — what a contributor JWT can reach, stated as a boundary

A collaborator holds a real JWT and can call PostgREST directly; the UI is
cosmetic. The complete reachable surface of that JWT is:

- **Read**: Finish Line structure (items, entities, account map), cells /
  deps / cell-grain edges for *their* entities only, **WORK** projects the
  owner granted them **one by one** (since slice 1 — including milestone
  text, PICs and documents links inside those rows; GROWTH projects are not
  grantable at all, by trigger, the owner path included), tasks inside those
  granted projects, and their own membership rows on both axes.
- **Write**: `state` (`input → figure` only) and `note` on cells in their
  entities; tasks in their granted projects — INSERT and UPDATE of content
  fields only (`title, detail, status, due_date, assignee, sort_order`),
  `project_id` immutable, a changed assignee must belong to the project, no
  DELETE. Every such write is stamped and appended to history by a trigger;
  client-supplied actor values are overwritten.
- **Nothing else.** No GROWTH row by any path (no policy exists to
  misconfigure), no accounts, no entries/logs/plans, no history reads on
  either history table, no task or project DELETE, no project INSERT or
  UPDATE, no share-link functions (they check the owner key internally). A
  contributor with zero membership rows reads nothing at all — on both axes
  independently: an entity grant opens zero projects, a project grant opens
  zero cells.

Accepted residuals: a contributor can see the *names* of all five entities
and the full pack structure (not per-entity states outside their own); they
can see all SAMB project milestones including other entities' PIC names;
`figure` written by a contributor is a claim the owner must still verify —
by design, that verification is the owner's edge/milestone work, and the
submission dot exists so unverified claims cannot masquerade as reviewed.
Magic-link email is the authentication factor: a compromised mailbox is a
compromised contributor account, bounded by the surface above.

### Provisioning (revised 2026-08-04, same day): owner-provisioned, no email

The first cut of collaborator entry — a magic-link email form on the gate —
was removed the day it landed, before any collaborator existed. Three
reasons: `os_entity_members` is owner-write-only, so self-service produced
accounts that could see nothing and saved the owner no steps; a public email
input invites sends against arbitrary addresses on Supabase's rate-limited
built-in mailer; and making email delivery the only entry path meant SMTP
and DNS work before a single person could log in.

The replacement: the owner provisions from a panel inside the passphrase
session. The `provision-collaborator` Edge Function (actions `create`,
`link`, `revoke`, `list`) creates the confirmed user, grants membership,
and **generates a sign-in link without sending anything** — the link is
returned to the owner, who hands it over out of band. The link targets the
app itself (`#collab_token=<hashed token>`); the gate consumes it with
`verifyOtp`, so no Supabase redirect, Site-URL setting, or SMTP is involved
anywhere. The gate's collaborator surface is now a passive sentence — there
is no control on the public screen at all.

That function is the most privileged code path in the app — service role,
RLS bypassed — and is bounded accordingly: gated by the same
bcrypt + escalating-delay + lockout check as the unlock gate
(`_shared/appKeyAuth.ts`, one shared counter), before the body is parsed;
the service role key exists only in the function environment; the action
set is a closed enum with `role` hardcoded `'contributor'`; emails are
validated and entity codes checked against `os_finish_line_entities`;
nothing structural is read from a request. Every successful action appends
to `private.os_provision_log` (append-only, `private` schema, one
service_role-only SECURITY DEFINER door in — the `os_auth_attempts`
posture), and a failed audit write fails the action. `revoke` deletes
membership rows and deliberately keeps the auth user: history rows keep
their actor, and a membershipless JWT reads nothing from its next query on.

**Revised 2026-08-05 (the zero-grant incident).** The magic-link entry is
now PROVEN end to end — a generated link was consumed live and the account
carries a real `last_sign_in_at` — but the slice-1 project grants never
landed once: the panel wrote them straight to `os_project_members` through
the repository while mounting the picker behind Edge-Function state, and
the stored key's 12-hour sessionStorage TTL expired minutes after the owner
created the first two collaborators. Every later panel visit failed its
gated `list`, bailed before loading the picker's data, and showed a lock
notice with nothing actionable — the grant attempts never sent one request
(API logs: zero writes against `os_project_members`). The fix moves the
project axis into the function: actions `grant-projects` (several ids, one
audited log row) and `revoke-project` join the enum, project ids are
validated against `os_projects` with the WORK-only rule pre-checked for a
clean 400 — while the domain-guard trigger stays the boundary and fires for
the service role too, verified live — `revoke` clears BOTH axes
server-side in one audited action, and a dead panel session now renders an
explicit re-unlock banner and refuses every write loudly. The log gained a
`project_ids` column (`20260804000048`). The repository's grant/revoke
methods remain as the SQL capability model and the mock's test surface; the
panel no longer uses them.

### WORK collaboration slice 1 (2026-08-05): the second axis, tasks, and one policy replaced

**The first deliberate removal of a live policy in this project.** Everything
before slice 1 was additive; migration `20260804000045` dropped
`member reads samb work projects` on `os_projects` and replaced it with
`member reads granted projects`:
`using (id = any ((select public.os_member_projects())::uuid[]))` — no
`domain` condition, no `engagement` condition *as first shipped* (the
`domain` half of that was a mistake, corrected the same day — see the
domain-gap section below). Why replaced rather than extended: the old
predicate was a broad allow (one entity grant exposed every SAMB WORK
project), and membership fails closed where an engagement predicate cannot —
zero grants reads zero projects, observed live before anything else shipped.
`engagement` is demoted to a client attribute (grouping/reporting); an
owner's private WORK project is simply a project with no members, and the
owner UI marks the two states (`dibagikan · N` / `privat`) so
private-by-omission is never accidental. The down-migration restores the
engagement policy verbatim; the removal is the only one — the policy
inventory diff shows every other table byte-identical, GROWTH included.

**Project membership is a second tenancy axis, independent of the first.**
`os_project_members` (user → project, owner-written only, never seeded) and
`os_member_projects()` mirror the entity axis exactly, including the
InitPlan calling convention (verified in the live plans: `os_key_valid`,
`os_read_key_valid` and `os_member_projects` each evaluate once per query).
Neither grant implies the other: the RLS suite proves an entity-only
identity reads zero projects and a project-only identity reads zero cells.

**Tasks are the first member-writable, member-creatable table** —
`os_tasks`, with `os_task_history` born in the same migration, which is the
note-history lesson applied before it costs anything: the value columns are
NOT NULL, the trigger writes five birth rows (`from_value = ''`) on every
INSERT, so every field of every task has an unbroken chain from `''` to the
live value and *any* out-of-band write is caught by the chain check — there
is no pre-migration null case at all. The `os_tasks_write_guard()` trigger
is the boundary (owner branch unrestricted; member branch: membership on
INSERT, `project_id` immutable even between two granted projects, jsonb-diff
column allowlist, changed-assignee-must-be-member, attribution stamped,
EXECUTE revoked from client roles at birth). Members have **no DELETE
anywhere** — `done` or `cancelled` are the terminal states, so history keeps
meaning — and no task-history access; the owner reads history with the full
key only (the share read key was deliberately **not** widened to tasks:
an already-issued credential does not silently grow scope).

Verified live 2026-08-05, all inside `begin…rollback` against production:
the original 16 RLS cases (case 5 rewritten to the new zero-grant truth) and
15 slice-1 cases in `supabase/tests/collab_rls.sql` — including revocation
on live claims with an entity-axis positive control, and the owner path
exercised as the anon role with a transaction-local throwaway key; the
task-chain checker validated arm by arm against deliberately tampered
history; advisors clean of new findings.

### The GROWTH domain gap, closed same day (2026-08-05): the second policy replacement

Slice 1's per-project policy dropped **both** conditions, and only one of
those drops was right. Membership fails closed against the **absence** of a
grant; it does nothing against a **wrong** one — one mis-click in the
collaborator panel would have exposed a GROWTH project row (all 16 GROWTH
rows carry real milestone content: LPDP, Chevening, IELTS, Research,
Website), and the same gap ran into `os_tasks`, whose member policies
consume the same function. That violated the standing invariant: GROWTH is
never reachable by an authenticated non-owner through any code path.

Migration `20260804000047` closes it in three deliberately redundant layers:

1. **The grant itself fails.** A `BEFORE INSERT OR UPDATE` trigger on
   `os_project_members` refuses any non-WORK project — **the owner path
   included**. GROWTH isolation is not a permission the owner can spend; it
   is a property of the schema. If a growth project ever genuinely needs
   sharing, the escape hatch is a migration — a deliberate act with a diff,
   not a click in a panel. An id that resolves to nothing gets its own
   distinct message. EXECUTE revoked from client roles at birth.
2. **The function filters.** `os_member_projects()` now joins `os_projects`
   and keeps `domain='work'`, so every consumer — the projects policy, all
   three task policies, anything a later slice adds — inherits the guard in
   one place, still as one InitPlan per query. **The task policies carry no
   domain condition BY DESIGN**: they consume this function. Do not add a
   redundant join later thinking the omission is an oversight.
3. **The policy says it out loud.** `member reads granted projects` now
   reads `domain = 'work' and id = any (…)`. Redundant given layer two and
   kept anyway: a column check on the row already being filtered costs
   nothing and makes the intent readable in the policy list. **This is the
   second deliberate policy replacement** (the first: `20260804000045`);
   the down-migration restores the slice-1 predicate verbatim.

The panel's work-only picker remains what it always was — convenience, not
the control.

Verified live 2026-08-05, rolled back: 6 new cases in `collab_rls.sql` —
GROWTH grant refused on the owner path; unresolvable id refused with its own
message; **with the layer-one trigger disabled and a GROWTH membership row
planted directly, `os_member_projects()` returns empty, the projects policy
returns zero rows, and the tasks policy returns zero rows for a real
owner-created task on that project** (layer two proven independently, not
assumed to be shielded by layer one); a WORK grant behaves exactly as
before with the poisoned row inert beside it. All 31 prior cases re-run
unchanged. The policy inventory diff shows exactly this one replacement;
GROWTH tables untouched; advisors show no new findings. Standing check 4
(below) watches for the one case the trigger cannot see: a project whose
domain is flipped after a grant — such grants deliberately do not survive
the flip.

### Standing integrity checks — run the file, not the prose

The runnable set lives in **`supabase/tests/integrity_checks.sql`** (paste
into the SQL editor; every check returns **zero rows when healthy**, and each
carries its own what-a-hit-means comment). It currently holds:

1. **The history note chain.** Since migration `20260804000043` every history
   row stores note contents on both sides (`''` = empty; NULL only in the 3
   pre-migration rows). `to_note` of row N must equal `from_note` of row N+1
   and the final `to_note` must equal the live cell note — a break means a
   write bypassed the trigger.
2. **The password grant surface.** Any `auth.users` row whose
   `encrypted_password` is a real hash (`''` is the explicit no-password
   convention since `20260804000049`) — see the boundary below for why this
   is the control that matters. Fired for real on 2026-08-05 and caught the
   GoTrue birth-password behaviour; proven to fire on a post-birth hash.
3. **The task history chain** (slice 1). Stronger than the note chain
   because tasks were born audited: every content field of every live task
   must chain unbroken from `''` to the live value — four arms (no history
   at all, first row not from empty, mid-chain break, tip vs live row), each
   proven to fire on a deliberately tampered chain before the check was
   committed.
4. **The project-membership domain boundary** (domain-gap patch). Any
   `os_project_members` row whose project is not `domain='work'` — the case
   the layer-one trigger cannot see (a domain flipped after the grant). Such
   a row grants nothing (layers two and three filter it) but must not
   exist. Proven to fire on a deliberately planted row.

Companion in the same set: `scripts/probe-password-grant.sh` (anon key only)
reports whether the platform-level password grant is enabled. All checks
verified clean on 2026-08-05.

### The password surface, stated as a boundary (2026-08-05)

What is true, not what is meant:

- **Password grant is enabled at the project level** and, per Supabase's
  documented model, cannot be disabled independently of the email provider —
  and the email provider must stay on, because `#collab_token` consumption
  (`verifyOtp`) runs through it. `/auth/v1/token?grant_type=password` is
  therefore reachable API surface; `scripts/probe-password-grant.sh` reports
  its state (verbatim on 2026-08-05:
  `{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}`
  — enabled).
- **No user currently has a usable password**, and since migration
  `20260804000049` none can be BORN with one. Check 2 fired for real on
  2026-08-05: both collaborators created that day held non-null hashes from
  the moment of creation — GoTrue's admin `createUser` **generates a random
  password when none is supplied**, a platform behaviour the code-level
  audit of provision-collaborator could not see (the hand-inserted test
  user, which skipped GoTrue, stayed null; the auth log shows only
  `user_signedup`, no password change — birth, not a set). Response: every
  `encrypted_password` normalized to `''` (never NULL — GoTrue's Go scanner
  has 500'd on NULL string columns in this project) and a BEFORE INSERT
  trigger on `auth.users` forces `''` at birth for every future insert,
  GoTrue included. A usable password now requires a deliberate post-birth
  UPDATE — exactly the two routes below — and check 2 flags any real hash.
  The grant is **inert while that check returns zero rows**.
- **A collaborator with a live session can set themselves a password**
  (`updateUser({ password })` against GoTrue directly — the app offers no
  UI for it). That yields a credential that does not expire, but it grants
  *authentication only*: membership governs every row, and revoking
  membership closes access immediately against an already-issued JWT — that
  was tested live on 2026-08-04, not inferred.
- **The recovery flow is a live route to a password.** Established
  2026-08-05, not assumed: `POST /auth/v1/recover` for the retained test
  identity returned `{}` 200 and the auth log shows the built-in mailer
  dispatching —
  `{"event":"mail.send","mail_from":"noreply@mail.app.supabase.io","mail_to":"kucingkuroshiro+asi-selftest@gmail.com","mail_type":"recovery"}`
  — with no rate-limit response. So recovery is self-service **for the
  account's own mailbox**: anyone holding the anon key can trigger recovery
  mail to any known address, which is inbox noise for that person rather
  than a compromise — the attacker does not receive the mail. The built-in
  service's sending is configuration, not design, and can change without
  warning.
- The app itself never calls any password or recovery endpoint — there is no
  password UI anywhere — so every route above is reachable only by hitting
  the API directly.

### The share read key, confirmed as a boundary

Every SELECT policy's owner arm reads `os_key_valid() OR os_read_key_valid()`
— GROWTH included — so the read-only key is a full-read credential. Confirmed
live (2026-08-04): `private.os_read_key.key_hash` is still `'unset'`, meaning
**no read-only key has ever been issued and nothing can satisfy that arm
today**; no Edge Function references `os_read_key` (share recipients hold a
share *token*, validated against `private.os_share_links` by the `share-view`
function, which reads with the server-held service-role key — see its header:
no x-app-key is involved anywhere). Boundary statement: the read key must
never be issued to a share recipient or collaborator — if it is ever set, it
grants read of everything, GROWTH included, and the correct channel for
scoped sharing remains share links.

## Deployment (verified 2026-07-24)

- **Live URL:** https://dika-personal-os.vercel.app (Vercel project
  `dika-personal-os`). The team-scoped aliases
  (`dika-personal-os-*-projects.vercel.app`) are behind Vercel's standard
  deployment protection (SSO) — use the production domain above.
- **Supabase project:** `dikagustiana-prod` (`ascbthsgborseynmmthm`,
  ap-southeast-1) — an existing empty project created the day before this
  work, used instead of creating a duplicate. All four migrations applied;
  passphrase hash set outside version control.
- The Vercel MCP tooling used for deployment cannot set project env vars, so
  the deployment builds via a `build.sh` shim that clones this repo's branch
  and passes the two public `VITE_` values inline. Recommended follow-up:
  connect the GitHub repo to the Vercel project and move the two values into
  dashboard env vars (Settings → Environment Variables), then delete the shim.
- **End-to-end verification against production** (Playwright, Chromium,
  desktop 1440px + mobile 390px): passphrase gate blocks before any data
  call; wrong passphrase rejected; create task, toggle habit (writes
  `os_daily_logs`), save weekly plan with goals, toggle project milestone —
  all four persisted across reload; mobile viewport renders with bottom
  navigation working. 14/14 checks passed. Test residue was cleaned; the
  database holds only the seeded habits and projects.
