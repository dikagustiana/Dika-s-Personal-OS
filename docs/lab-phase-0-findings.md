# Lab — Phase 0 findings

Read-only investigation of the codebase before any Lab code is written.
Six areas as briefed, then how Lab mirrors each, then the conflicts that
need a ruling before Phase 1. Nothing in this document is implemented yet.

---

## 0. Stack reality check (read this first)

The brief describes "a production Next.js + Supabase application". **The
codebase is not Next.js.** It is a Vite + React 18 single-page app
(`vite.config.ts`, `index.html`, `package.json` — react 18.3, zustand 5,
Tailwind 3.4, vitest 2, pnpm), deployed on Vercel with a single catch-all
rewrite to `index.html` (`vercel.json`). There are no server routes in the
app; every server-side capability lives in **Supabase Edge Functions**
(`supabase/functions/`, Deno).

Consequences for Lab, applied throughout this document:

- "One server route" (Part E) → **one Edge Function**.
- `/lab`, `/lab/run/[slug]`, `/lab/runs`, `/lab/chains` (Part F) → **views in
  a third workspace**, not URL routes (see §1 and Conflict C2).
- "Generate/refresh TypeScript types" (Part D) → **hand-written domain
  types**, matching the existing pattern (see §3 and Conflict C4).

---

## 1. Section registration — how Growth and Work are defined

There is **no router**. Sections are called **workspaces** and live in a
zustand store:

- `src/store/appStore.ts` — `type Workspace = 'work' | 'growth'`, plus one
  view union per workspace (`WorkView`, `GrowthView`) and one current-view
  field per workspace (`workView`, `growthView`). Cross-view navigation uses
  one-shot "focus" handoffs (`ProjectFocus`, `FinishLineFocus`, `ProsesFocus`)
  set by the navigator and consumed-and-cleared on arrival.
- `src/layout/AppShell.tsx` — one nav array per workspace
  (`workNav`, `growthNav`: `{ id, label, short, icon: LucideIcon }`), a
  2-column `WorkspaceSwitch` toggle, a desktop rail, a mobile drawer, and a
  mobile bottom strip, all driven by the same arrays. Contributors
  (magic-link collaborators) see a filtered `workNav` and no workspace
  switch — the filter is cosmetic; RLS is the boundary.
- `src/App.tsx` — a plain if/else switch on `workspace` + view, with
  `key={workspace}` remounts so local state never leaks across worlds.

**Exactly one view has a real URL**: the Finish line
(`src/views/work/finishLineRoute.ts` — hand-parsed paths, `history.replaceState`,
deliberately not a router; the file's header explains that every other view
is "state with no address" and that adding a router "would put every other
view's addresslessness up for renegotiation").

Per-section state/context: none beyond the store fields above. Views read
data through `useAppStore((s) => s.repository)`.

## 2. Supabase schema conventions

- **Naming**: all tables `snake_case`, prefixed `os_`, plural for
  collections (`os_projects`, `os_tasks`, `os_finish_line_cells`); singular
  for logs/singletons (`os_sign_in_log`, `os_task_history`). Two schemas:
  `public` (PostgREST-visible) and `private` (secrets, attempt counters,
  provision log — never exposed).
- **Primary keys**: `id uuid primary key default gen_random_uuid()` for
  surrogate keys; natural text/date keys where the row is the key; composite
  PKs on join tables. No bigint identity anywhere.
- **Timestamps**: `created_at timestamptz not null default now()`,
  `updated_at timestamptz not null default now()`. Older tables use a shared
  `os_set_updated_at()` BEFORE UPDATE trigger; newer guarded tables set
  `new.updated_at := now()` inside their write-guard trigger instead
  ("a timestamp the client can backdate is not a timestamp",
  `20260804000039_cell_attribution.sql`). Where the two disagree, the newer
  guard-owned pattern wins for any table that has a guard.
- **Enums**: never Postgres enums — inline `check (col in (...))`
  allowlists. `sort_order int not null default 0` (never `order` — PostgREST
  reserves it). jsonb blobs are `not null default '[]'::jsonb` and "read
  with the row, never queried alone".
- **Auth model**: there are **no `user_id` columns on data rows by design**.
  Two identities exist:
  - *Owner*: no Supabase Auth. Every request carries an `x-app-key` header,
    bcrypt-checked by `public.os_key_valid()` (SECURITY DEFINER over
    `private.os_app_secret`). The owner runs as **`anon` + header**.
  - *Collaborators*: real Supabase Auth (magic link), scoped by **entity
    code** through membership tables (`os_entity_members`,
    `os_project_members`) and array-returning SECURITY DEFINER helpers
    (`os_member_entities()`, `os_member_projects()`).
- **RLS**: enabled on every `public.os_*` table. The uniform owner set is
  four policies per table, named literally `require app key to
  select/insert/update/delete`, each predicate subquery-wrapped —
  `using ((select public.os_key_valid()))` — so the bcrypt compare becomes a
  per-statement InitPlan, not a per-row call (a live 3.1 s statement-timeout
  incident is recorded in `20260728000030_rls_policy_initplan.sql`). Member
  policies are *additive* and prefixed `member `; **tables collaborators
  must never reach simply have no member policy at all** ("isolation is the
  absence of a policy, not a predicate that could be misconfigured",
  `20260804000040_member_policies.sql`). Audit tables have no UPDATE/DELETE
  policy for anyone.
- **Cross-table rules**: enforced by BEFORE INSERT/UPDATE **SECURITY DEFINER
  triggers**, e.g. `os_project_members_domain_guard`
  (`20260804000047_growth_domain_guard.sql`) which raises when a grant
  targets a non-WORK project. House trigger conventions: function and
  trigger share a name; `set search_path = ''`; `drop trigger if exists`
  then `create trigger`; **EXECUTE revoked from `public`, `anon`,
  `authenticated`** on every trigger function (trigger machinery doesn't
  check EXECUTE; no client role should hold it).

## 3. Migration workflow

- Files: `supabase/migrations/YYYYMMDD` + 6-digit **globally monotonic
  counter** + `_snake_case_name.sql` (…000071, 000072 is current head).
- Applied **one file at a time via the Supabase MCP `apply_migration`
  tool** (or SQL editor). No CLI config (`supabase/config.toml` does not
  exist), no migration npm script. Nearly every file's header records
  status: `APPLIED <date> via the Supabase apply_migration tool (ledger
  name ...)`, or `NOT APPLIED`, or `ALREADY APPLIED LIVE — this file exists
  to RECORD it`, plus explicit warnings never to run `supabase db push`
  (repo numbering ≠ live ledger numbering).
- **Down migrations** exist from `…000037` onward in
  `supabase/migrations/down/<stem>_down.sql`: mirror-order drops
  (triggers → functions → policies → indexes → tables), `if exists`
  throughout, an explicit statement of what data is destroyed.
- **Types are NOT generated.** No `database.types.ts`, no `Database`
  generic. Domain types are hand-written camelCase in `src/data/types.ts`
  ("Maps 1:1 to src/data/types.ts"), mapped by hand inside the repository
  implementations. The Supabase client is untyped.
- SQL test suites live in `supabase/tests/` — plain SQL (not pgTAP), with a
  uniform contract: **zero rows when healthy; any returned row names what
  broke**. `scripts/role-read-tests.sh` replays every migration in filename
  order into a throwaway Postgres 16 cluster and runs the suites, ending
  with a negative control ("a suite that cannot fail proves nothing").
  These are deliberately outside `pnpm test`/CI.

## 4. API layer

- **Edge Functions only** (Deno, `supabase/functions/<name>/index.ts`).
  There is already a model-execution layer to mirror:
  - `run-research-prompt` — a generic **OpenAI-compatible
    `/chat/completions` client** (currently pointed at Moonshot/Kimi via
    env: `RESEARCH_MODEL_BASE_URL`, `RESEARCH_MODEL_API_KEY`,
    `RESEARCH_MODEL_DEFAULT`, …). GET is an unauthenticated capability
    probe; POST requires `confirmed: true` (409 otherwise) and the app key.
    It **writes nothing** and returns the whole completion in one JSON
    response. The provider's `usage` object is passed through but **nothing
    reads it — no token accounting or cost math exists anywhere in the
    repo today**.
  - `run-research-council` — same client; **one stage per HTTP call** (the
    browser sequences advisors → peers → chairman), concurrency-capped
    worker pool, bounded 429 retry, partial results preserved on seat
    failure.
- **No streaming anywhere.** No `stream: true`, no SSE, no
  `ReadableStream` in functions or client. Progress today is reported
  per-stage, not per-token. Lab's streaming executor is new ground, not a
  pattern conflict (nothing forbids it; nothing precedes it).
- **Auth inside functions**: `_shared/appKeyAuth.ts` (`checkAppKey`) — the
  one real shared helper. It replays the passphrase gate's full
  escalating-delay/lockout ladder against the same `private.os_auth_attempts`
  counter (the first version was a free brute-force oracle; the header
  documents it) and **fails closed** on any internal error.
- **Error shape** — two shapes, both read by the client on purpose:
  guard/validation refusals are `{ error: string, retryAfter? }` with real
  HTTP statuses (400/401/405/429/500); the function's own refusals are
  `{ ...capabilities, sent: false, reason: <prose> }` with 200 for normal
  "not configured / gated" states, 409 for unconfirmed, 502 for provider
  failure. Provider error bodies are **never echoed** ("it can contain the
  key"). Client-side, `refusalDetail`/`refusalReason`
  (`src/data/researchModel.ts`) render both shapes.
- **Client calling pattern**: not `supabase.functions.invoke` — a
  hand-rolled `edgeFunctionCall<T>()` in `src/data/supabaseRepository.ts`
  (`fetch` to `${url}/functions/v1/<name>`, `apikey` + anon `Authorization`
  + optional `x-app-key`), which deliberately never throws on non-2xx.
- **CORS**: no shared helper; each function copies the same `CORS` const
  and `json()` wrapper (allow-headers include `x-app-key` where relevant;
  origin `*`; OPTIONS short-circuit).
- **Data seams**: views call a `Repository` interface (`src/data/repository.ts`)
  with two implementations — `mockRepository` (bare-clone default) and
  `SupabaseRepository` (swapped in by the passphrase gate). Bounded
  subsystems hang off it as separate interfaces (`repository.research:
  ResearchRepository`) rather than widening the main seam. Write invariants
  live in guard modules on the mutation path (`researchGuards.ts` narrows
  what `origin: 'model'` may write), never in the UI alone.
- Existing routing precedent: `public.os_model_routing` (task → model name,
  blank = server default; RLS'd like everything else). It is a **research
  subsystem setting** — four columns, no providers, no costs — not a
  provider registry. Lab does not reuse or modify it.

## 5. Design system

- **Tokens** in `src/index.css` `:root`, consumed via `tailwind.config.ts`
  where the color scale is a **full override** — Tailwind's default palette
  is deliberately absent, so an off-palette class produces no CSS.
  Imperial-brand light palette: `--background`, `--surface-1/2/3` (inverted
  elevation: white is highest), `--border`/`--border-subtle`, three text
  tiers (`--foreground`, `-secondary`, `-muted`), `--primary`,
  `--success` (done only, never a warning), `--escalate` (amber),
  `--destructive`, `--chart-1..4`. One radius token, one shadow
  (`shadow-card`). `black` only for scrims.
- **Light theme only.** No `.dark` class, no `dark:` variants, `color-scheme:
  light`. (The brief's dark/light question resolves to: single theme.)
- **Fonts**: self-hosted Plus Jakarta Sans (`font-sans`) + Playfair Display
  (`font-display`, headings). **`font-mono` is deliberately not a legal
  class**; numbers use `tabular-nums`.
- **Primitives** (`src/components/ui/`): `Button` (CVA; one solid primary
  per screen), `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Checkbox`,
  `Input`, `EmptyRow`, `Progress`, `TbcChip`, logo components. **There is no
  Badge, Dialog/Modal, Table, Tabs, Select or Tooltip primitive.**
  - Status chips are a per-feature convention (`processUi.tsx`,
    `finishLineUi.tsx`): `rounded-sm px-1.5 py-0.5 text-[10px] font-semibold
    uppercase tracking-[0.08em]`, filled = present/actionable, outlined =
    blocked, tone via tokens.
  - Tables are semantic `<table>` in `overflow-x-auto` wrappers inside
    card-styled sections; uppercase 10px muted headers on `bg-surface-2`;
    sticky theads on matrices.
  - **No modals.** The single `role="dialog"` in the app is the mobile nav
    drawer. Create/edit is **inline expansion** (a toggled inline `Card`,
    e.g. `Projects.tsx`) or an in-place detail panel (`CellDetailPanel`).
  - Empty states are one-row `EmptyRow`s (never taller than a filled row);
    a *failed read must never render as an empty state* — `Checking` /
    `CouldNotCheck` components exist for that (`finishLineUi.tsx`).
  - Filters: `.native-select` or `aria-pressed` toggle groups via
    `filterButtonClass`, always reporting how many rows are hidden.
- **Page skeleton**: `.page-shell` → `<header class="mb-7 border-b
  border-border-subtle pb-7">` with `.page-kicker` (e.g. `Work / Monthly
  Close`), `.page-title`, muted lede.
- **Icons**: lucide-react, `size-4` inline / `size-5` nav, token colors,
  `aria-label` on icon-only buttons.
- **Toasts**: zustand `toastStore`, `error | info`, never auto-dismiss,
  optional retry; writes go through `useMutation().run(...)`.
- **Tests**: vitest; node env by default, `// @vitest-environment jsdom`
  per component test; **design-invariant tests** that assert copy rules and
  token discipline (some read source files off disk to enforce
  codebase-wide rules). Zustand store reset in `afterEach`.
- **Copy**: mixed-language by audience — collaborator-facing WORK surfaces
  are Indonesian, owner dashboards English. Every non-obvious decision
  carries a prose comment; that is the house standard.

## 6. Where secrets live

- Client `.env`: only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  (public by nature; absent = mock repository).
- The passphrase hash lives in `private.os_app_secret`, set out-of-band by
  SQL (README documents the statement). Collaborator identities likewise
  never appear in the repo.
- Model provider credentials are **Edge Function secrets** (`Deno.env.get`),
  set out-of-band in the Supabase dashboard — `RESEARCH_MODEL_API_KEY` etc.
  appear only in function code; no `supabase secrets set` runbook exists in
  the repo. Keys are never stored in tables, never echoed in errors.
- Precedent worth keeping: "it is an environment variable and not a constant
  because it is a property of the ACCOUNT, not of the code" (council
  `maxConcurrency` comment).

---

## How Lab will mirror each of these

1. **Section registration** — Lab becomes the third `Workspace`:
   `'work' | 'growth' | 'lab'`, a `LabView` union
   (`'registry' | 'run' | 'runs' | 'chains'`), `labView` + `setLabView` in
   the store, a `labNav` array in `AppShell`, a third column on
   `WorkspaceSwitch`, and a `workspace === 'lab'` branch in `App.tsx` with
   `key` remounts. "Open the run screen for agent X" and "jump to this
   run's lineage in the log" use the established one-shot focus-handoff
   pattern (`LabRunFocus`, `LabLogFocus`), like `ProjectFocus`. Contributors
   never see Lab: the workspace switch is already hidden for them, and Lab
   tables get **no member policies** (isolation by absence). No URLs in v1
   (see C2).
2. **Schema** — five tables, `os_lab_` prefix, plural, uuid PKs,
   `created_at`/`updated_at timestamptz`, inline CHECK allowlists for
   enums (`data_class in ('internal','public')` — not null, no default),
   `sort_order`-style ints, jsonb `steps` with camelCase keys read-with-row.
   Names: `os_lab_providers`, `os_lab_agents`, `os_lab_runs`,
   `os_lab_artifacts`, `os_lab_chains`. RLS: the uniform four
   `require app key to …` policies per table, subquery-wrapped, plus the
   conditional read-only-key widening for SELECT where the codebase applies
   it; **no member policies**. `runs` is treated like the history tables:
   no UPDATE policy beyond what the executor needs, no DELETE (a run log
   that can be rewritten is not a log) — exact policy set to be settled in
   the Phase 1 migration text. Indexes on `os_lab_runs.agent_id`,
   `parent_run_id`, `chain_id`, `created_at`.
3. **Data boundary** — a `<table>_<purpose>_guard` SECURITY DEFINER trigger
   pair in the house style (same-name function+trigger, `set search_path =
   ''`, EXECUTE revoked from all three client roles, drop-if-exists
   idempotency, raise exception with a sentence that names the rule):
   one on `os_lab_agents` (internal agent must reference an Anthropic
   `default_provider_id`; NULL provider on an internal agent is also
   refused at the moments it matters — written so a NULL cannot satisfy
   the check) and one on `os_lab_runs` (insert/update refused when the
   agent is internal and the resolved provider row is not Anthropic —
   checked against the provider's identity, not its mutable name column;
   exact column design in Phase 1). The DB-layer test joins
   `supabase/tests/` in the zero-rows-when-healthy style: a rolled-back
   transaction attempts the violating inserts directly in SQL (application
   layer bypassed entirely) and emits a finding row if the trigger did NOT
   raise; runnable under `scripts/role-read-tests.sh`'s throwaway-cluster
   harness, with a negative control.
4. **Migrations** — next numbers in sequence (`202608XX0000NN_lab_*.sql`),
   one concern per file, headers carrying the APPLIED/NOT APPLIED ledger
   note, matching `down/` files with mirror-order drops. Applied via the
   Supabase MCP `apply_migration` tool, one at a time, only when we reach
   that step. Seed migration inserts the three provider rows (anthropic /
   deepseek / kimi — two adapters only) and the seed agents.
5. **Executor** — one Edge Function (`run-lab-agent`), Deno, copying the
   house CORS/json wrappers and `checkAppKey` **before anything billable**;
   two adapter functions (anthropic `/v1/messages`, openai-compatible
   `/chat/completions`) normalized to `{ text, tokensIn, tokensOut }`;
   provider base_url/model/rates read from `os_lab_providers`; keys from
   function secrets (per-provider env names, e.g. `LAB_ANTHROPIC_API_KEY`,
   with DeepSeek/Kimi able to share the adapter but not the key). The
   function **writes** `os_lab_runs` via the service role (dispatch:
   `status='running'`; completion/abort: terminal update) — a deliberate,
   documented departure from the research functions' write-nothing rule,
   because the run log *is* the observability deliverable and a
   client-written log dies with the tab (see C6). Streaming via SSE
   `ReadableStream`; the runs row is the source of truth, the stream is
   only transport. Boundary re-validated in the function before dispatch;
   violation → typed error string, `status='error'` runs row, **never a
   silent provider fallback**. Cost computed from the provider row's rate
   columns at run time; no price constants in code. Error shapes follow the
   two-shape convention; provider bodies never echoed.
6. **Types & data seam** — hand-written camelCase types in
   `src/data/types.ts` (or a lab-scoped types module if `types.ts` growth
   is a concern), a bounded `LabRepository` interface hanging off
   `Repository` exactly like `ResearchRepository`, implemented in both
   `mockRepository` (so a bare clone renders Lab with seeded mock data) and
   `SupabaseRepository`. Client-side boundary guard module
   (`labGuards.ts`) on the mutation path, mirroring `researchGuards.ts`,
   with vitest coverage.
7. **Screens** — `.page-shell` + kicker/title headers (`Lab / Registry`),
   `Card` grids for agent cards, per-feature `labUi.tsx` chips
   (`data_class` badge: `internal` filled primary-dim tone, `public`
   outlined; status tones: success/escalate/destructive as the palette
   dictates), semantic tables for the run log with the house header style,
   `EmptyRow` empty states, `Checking`/`CouldNotCheck`-style failure states
   (a failed read never renders as "no runs"), `.native-select` filters
   that report hidden-row counts, inline-expansion create/edit (no modal —
   see C5), toasts via `useMutation`. IDR display converts stored USD with
   a rate from a config module, not inline (see C7). Charts, if any, use
   the `--chart-N` tokens; recharts only.
8. **Secrets** — provider API keys as Edge Function secrets only;
   `os_lab_providers` stores base_url/model/rates but never keys; the
   migration header documents which env names must be set out-of-band,
   following the RESEARCH_MODEL_* precedent.
9. **Testing** — vitest for parser/guard/cost logic (dependency-checker
   parser gets the four known phantom slugs as fixtures), jsdom
   design-invariant tests for the screens in the house style, plain-SQL
   boundary suite in `supabase/tests/`. CI stays as is (vitest + build);
   SQL suites run via `scripts/` like today.

### Where Growth and Work disagree, the choice made

- **`updated_at` maintenance**: shared `os_set_updated_at` trigger (older,
  2026-07-24) vs guard-trigger-owned timestamps (newer, 2026-08-04). Lab
  tables with a guard trigger (`os_lab_agents`, `os_lab_runs`) let the
  guard own the timestamp; plain tables (`os_lab_providers`,
  `os_lab_chains`) use the shared trigger. Chosen because the newer
  migrations state the reason explicitly (client-backdatable timestamps).
- **Member policy `to` clause** (`to authenticated` vs `to public`): moot
  for Lab — Lab has no member policies at all, per the
  isolation-by-absence convention.
- **Create/edit surface**: WORK's newer screens use inline expansion;
  nothing uses modals. Inline expansion chosen (also resolves the brief's
  "modal or detail route" to the codebase pattern).

---

## Conflicts needing a ruling (Part H: codebase pattern wins, flagged not silently applied)

- **C1 — Next.js vs Vite.** The brief's Next.js framing (route handlers,
  `/lab/*` file routes) doesn't exist here. Proposed: Edge Function
  executor + workspace views, as described above. *Assumed resolved by the
  facts; flagging for the record.*
- **C2 — URLs.** The brief names paths (`/lab/run/[slug]`, `/lab/runs`,
  `/lab/chains`); the codebase's stated position is that views are
  addressless unless a view earns a URL (only Finish line has one, with a
  written justification). Proposed: **no Lab URLs in v1**; navigation is
  store state + focus handoffs. If deep-linking a run/lineage later proves
  worth bookmarking, it can earn a path the way Finish line did.
- **C3 — "Nav as a visual peer of Growth and Work"** requires touching
  shared files the brief says not to modify (`appStore.ts`, `AppShell.tsx`,
  `App.tsx`, and `main.tsx` only if needed). Per Part H this is flagged
  before making it: the changes are strictly additive (new union member,
  new nav array, third switch column, new `workspace === 'lab'` branch);
  no Growth/Work view, table, policy, or Edge Function is modified.
- **C4 — Generated types.** The brief says "Generate/refresh TypeScript
  types"; the codebase has none (hand-written domain types, untyped
  client, by design). Proposed: hand-written types, codebase pattern wins.
- **C5 — "Create/edit agent in a modal"** — no modal exists or is wanted;
  inline expansion per the codebase. The brief itself allows "consistent
  with how Growth/Work handle it", so this is resolution, not deviation.
- **C6 — Executor writes to the DB.** The research functions write nothing
  (a stated safety property); Lab's run log requires server-side writes
  (crash-surviving `running` rows are a Part E requirement, and a
  client-written log dies with the tab). Proposed: `run-lab-agent` writes
  **only** to `os_lab_runs` + `os_lab_artifacts`, states so in its header
  the way `share-view` states its scope, and stays greppably true (the
  council function's stale "writes ONE row" comment is the cautionary
  tale — noted below).
- **C7 — IDR rate location.** "Config, not inline." No config table or
  settings module exists. Proposed: a small `src/lib/labConfig.ts` (or
  equivalent) exporting the display rate with a dated comment — display
  concern, client-side, USD remains the stored truth. Alternative if a
  DB-authored value is preferred: a one-row settings table. Default is the
  config module unless you say otherwise.
- **C8 — Tooltip on the disabled provider selector.** No tooltip primitive
  exists, and a `title`-only tooltip is unreachable on touch. Proposed:
  disabled `.native-select` plus an always-visible one-line explanation in
  muted text ("Internal data — Anthropic only"), which is also the more
  honest rendering of a structural rule.
- **C9 — Supabase Storage for artifacts.** No Storage usage exists anywhere
  yet (no buckets, no policies). `os_lab_artifacts.storage_path` introduces
  it: bucket + policies must be created (owner-only, service-role writes
  from the executor). New ground, flagged; will follow the same
  key-validated posture as everything else.
- **C10 — `agents.version`.** The brief specifies a bare `version int`.
  With prompt diff/version-compare explicitly out of scope (Part G),
  proposed v1 semantics: version starts at 1 and increments on any edit to
  `system_prompt`; no history table (that would be the version-compare
  feature by the back door). Noted in TODO.md as deferred.

## Incidental findings (pre-existing, not Lab's to fix silently)

- `run-research-council/index.ts` header claims it "writes ONE row to
  os_research_council_sessions" — it writes nothing; the client writes that
  row. Stale comment in a codebase whose safety argument leans on
  write-scope comments being greppable and true. Worth a one-line fix in
  its own commit *if approved* (it touches a Growth-serving function, so
  per the brief's rules it is flagged, not done).
- `run-research-prompt` returns the provider `usage` object and nothing
  reads it — confirming that Lab's token/cost accounting has no precedent
  to reuse; it will be built fresh in the executor.

---

*Phase 0 ends here. No code has been written. Awaiting approval before
Phase 1 (schema).*
