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
