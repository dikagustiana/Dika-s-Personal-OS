# CLAUDE.md

Working notes for an agent taking over this repo. Dense on purpose. Read
before editing anything.

Single-developer app. The owner is the only user. There is no team, no
staging environment, and no second pair of eyes. **Optimise for not breaking
working software, then quality, then speed — in that order.**

---

## 1. Stack

| Layer | Choice | Proof |
| --- | --- | --- |
| Framework | React 18.3 | `package.json` |
| Language | TypeScript 5.7, `strict: true` | `tsconfig.app.json` |
| Build | Vite 5.4 | `vite.config.ts` |
| Package manager | **pnpm 10.33** | `package.json:packageManager` |
| Styling | Tailwind 3.4 + shadcn (new-york / zinc) | `tailwind.config.ts`, `components.json` |
| State | zustand 5 — three stores, no context providers | `src/store/` |
| Data | `@supabase/supabase-js` behind a `Repository` interface | `src/data/repository.ts` |
| Auth (owner) | One passphrase → bcrypt → `x-app-key` header → RLS | `supabase/migrations/20260724000002_security.sql` |
| Auth (collaborator) | Supabase magic-link JWT + membership tables | `20260804000037`, `20260804000044` |
| Routing | **None.** No router dependency. Views are zustand state. | `src/App.tsx` |
| Content | MDX for IELTS method pages | `content/ielts/**` |
| Deploy | Vercel SPA rewrite | `vercel.json` |

~77k LOC across 263 `.ts`/`.tsx` files. Node 20+.

**pnpm only.** `package-lock.json` is gitignored deliberately — an npm lockfile
is not a second opinion, it is the residue of running the wrong package
manager. CI installs with `--frozen-lockfile`.

---

## 2. Commands

```bash
pnpm install          # --frozen-lockfile in CI
pnpm dev
pnpm typecheck        # tsc -b --force
pnpm test:run         # vitest, 87 files / 1590 tests
pnpm build            # tsc -b && vite build — production build must succeed
```

**There is no `lint` script, no ESLint config and no Prettier config.** This is
a known, accepted gap. Do not add either without being asked, and never ship a
repo-wide format pass — it makes review impossible and is an instant revert.

### SQL suites — not part of `pnpm test`

CI has no Postgres, and a suite that silently skips reports green for work it
did not do. Run these by hand after any migration touching a policy, a grant,
a function or a trigger. Each stands up a throwaway cluster, replays every
migration, and includes a negative control that must go red:

```bash
scripts/role-read-tests.sh        # per-role reads, RLS fn grants, definer gates, entity shape
scripts/lab-epistemic-tests.sh    # the epistemic gates, both identities
scripts/lab-boundary-tests.sh
scripts/seed-guard-tests.sh
scripts/grant-scope-tests.sh      # the grant model: backfill measured as each contributor,
                                  # per-identity reads/writes, 3 negative controls, collab_rls.sql
```

House convention for every file in `supabase/tests/`: **zero rows returned
means healthy.** Any row it returns names what broke. Several carry an
"audit inert" floor check so a broken matcher cannot read as healthy forever —
preserve that idea in anything new.

---

## 3. Directory conventions

```
src/
  data/       Repository interface + 3 impls + guards + types. The seam.
  logic/      Pure functions. Heavily tested. The real brain — put logic here,
              not in components, so it can be tested without a DOM.
  views/      work/ growth/ lab/ share/ — one directory per shell area.
  components/ Shared UI; ui/ holds the primitives; project/ and ielts/ are
              feature clusters.
  store/      appStore (navigation + repository + viewer), labLiveStore, toastStore.
  layout/     AppShell.tsx — the only layout.
  hooks/      useMutation, useDailyLog.
  lib/        utils.ts (cn only).
supabase/
  migrations/       Forward migrations, filename order is a contract.
  migrations/down/  Rollbacks. Newer migrations all have one; ~38 early ones do not.
  functions/        Deno edge functions. _shared/ holds appKeyAuth + provision.
  tests/            Standing SQL checks. Zero rows = healthy.
scripts/            Bash harnesses for the SQL suites. lib/pg-cluster.sh is shared.
content/ielts/      MDX method pages. Path === the topic slug in os_ielts_topic.
docs/               Runbooks + screenshot history (v5–v8).
deploy/             Vercel notes. Documentation only — nothing here builds.
```

Two files sit under `views/growth/` but are mounted in the **WORK** branch of
`App.tsx`: `Escalations.tsx` (hardcodes `listProjects('work')`) and
`Projects.tsx` (serves both domains). Known misplacement; no data leaks. Do not
"fix" it by moving files unless that is the task.

---

## 4. The WORK / GROWTH contract

`Domain = 'work' | 'growth'` (`src/data/types.ts:7`). Two fully separate
worlds. **This separation is load-bearing. Never merge, blur or "simplify" it.**

Client scoping is `state.workspace` in `Projects.tsx`, `Today.tsx`, `Week.tsx`.
That is convenience. **The boundary is in SQL**, in three deliberately
redundant layers (`20260804000047_growth_domain_guard.sql`):

1. A trigger on `os_project_members` refuses any non-WORK project — **including
   from the owner path**. GROWTH isolation is not a permission the owner can
   spend; it is a property of the schema.
2. `os_member_projects()` joins `os_projects` and keeps only `domain='work'`,
   so every consumer inherits the guard in one place, as one InitPlan.
3. The `member reads granted projects` policy carries an explicit
   `domain = 'work'` conjunct. Redundant, kept for readability.

The task policies carry **no** domain condition **by design** — they consume
`os_member_projects()`. Do not add a redundant join thinking it was an
oversight.

If a GROWTH project ever genuinely needs sharing, the escape hatch is a
migration — a deliberate act with a diff, not a click in a panel.

### The third axis

`ShellArea = Workspace | 'lab'` (`src/store/appStore.ts`). **Lab is
deliberately NOT a `Workspace`**, because `Workspace` doubles as the data
`Domain` and Lab has no entries, timeboxes or weekly plans. Making it a Domain
would hand every data view a third value it has no rows for. While the lab is
open, `workspace` keeps its last value and no data view is mounted to read it.

---

## 5. The Lab data boundary

Two separate contracts. Both are enforced in the **database**; the TypeScript
is a fast pre-flight so the owner reads a sentence instead of a PostgREST
error.

### 5a. Internal data reaches Anthropic models only

`src/data/labGuards.ts` + trigger `20260817000074`. An agent whose
`dataClass` is `internal` must have a `defaultProviderId` that **resolves** to
the Anthropic provider row — a null id, a dangling id and a wrong provider all
fail, so a NULL cannot satisfy the boundary by vacuity.

There is no flag, no bypass argument and no dev mode. **If a guard is in the
way, the boundary is in the way, and that is a conversation with the owner,
not a parameter.**

### 5b. The epistemic gates — verified data vs inference

`src/data/labEvidenceGuards.ts` mirrors, and `20260817000077` (amended by
`079`, `080`, `082`) enforces:

| Gate | Rule |
| --- | --- |
| G-EXTRACT | No source document, no locator, no ≥20-char definition scope → no datapoint row. |
| G-VERIFY | A datapoint is born `IND`; reaching `V` needs a verification note, and an agent-extracted one needs its internal check passed. Provenance (`extraction_method`) is frozen after insert. |
| G-CLAIM | Approval refused on: unverified supporting datapoints, unresolved conflicts, `abstract_only` references, an open **DIRECT** contradiction, layer B with no evidence or <20-char inference step, layer C with <20-char inference step. |
| G-LAYER | An output may not cite both sides of an open contradiction. |
| G-OUTPUT | A stale output, or one citing a non-approved claim, cannot finalize. |
| G-FALSIFY | Every addressed sub-question needs a satisfied evidence requirement. |
| G-NUMBER | Every figure in output prose needs a backing datapoint, or a `[C]` / `[sim:<id>]` tag. |

**Never loosen a gate, never remove one because it is in the way, and never
let synthesised content reach a verified field.**

`supabase/tests/lab_epistemic_gates.sql` proves the database holds these with
the client file bypassed entirely, against an owner identity and an
agent identity (superuser with no key).

**Known drift (P2, not a hole):** `labEvidenceGuards.ts`'s header says the
mirrors run in both repository implementations. On the Supabase path
`verifyDatapoint`, `approveClaim` and `finalizeOutput` do **not** call them —
the guards run in the **view** layer instead (`EvidenceDatapoints.tsx:226`,
`EvidenceClaims.tsx:179`, `EvidenceOutputs.tsx:75`). The database still
refuses, so nothing is bypassable today; but for those three the client guard
is effectively UI-only, which is the exact shape `labGuards.ts` warns against.

---

## 6. Data-access patterns to follow

### Everything goes through `Repository`

Never construct a Supabase client in a component. `src/data/repository.ts` is
the interface; `mockRepository` is the boot default so a bare clone runs;
`PassphraseGate` swaps in `supabaseRepository` after verification.
`research`, `lab` and `labEvidence` are sub-seams with their own interfaces.

### `ReadResult<T>`, not `T[]`, for anything that counts problems

An empty array cannot tell a card whether it found nothing or failed to look.
This shipped after a live build rendered *"0 milestones make no pack line
trustworthy — None"* when the truth was 458. A missing relation arrives as
`{ok: false, reason: 'missing-relation'}` so the card can say **COULD NOT
CHECK** and show no number at all. See `src/data/readResult.ts`.

The frontend routinely ships before a migration is applied — that is why a
missing relation is a degraded read, never a crash.

### Writes carry a required `origin`

`CellWriteOrigin = 'human' | 'contributor' | 'rollup' | 'model'`. A cell state
may only change through a **direct human edit**. Not by inference, not by a
rollup, not by a linked milestone being ticked done. When a rollup disagrees
it raises a `contradiction` for a person and **stops** — it never resolves it
by writing.

`origin` is a required argument, not an optional hint, because a UI-only guard
is bypassed by the first caller that forgets.

### Every mutation goes through `useMutation`

`src/hooks/useMutation.ts`. On failure it resolves `undefined` and raises a
**retryable** toast that is never auto-dismissed. Callers must check before
discarding user input:

```ts
const created = await run('Add task', () => repository.createEntry(input));
if (!created) return;   // draft still on screen, safe to retry
setDraft('');           // only now
```

A silent failure costs the owner real work. Handle loading, empty, error,
offline and permission-denied on every surface.

### Reads are whole-table + join in memory where the tables are small

`listProcessStepItems` reads 83 rows against 101 steps and joins client-side,
because both directions are needed and a per-row query would be one round trip
per opened panel. Follow this where the row counts justify it; do not
generalise it to large tables.

### Collaborator access to the Finish line is a grant row, not a membership

Since `20260904000095`, `os_entity_members` is the **enrolment** and
`os_finish_line_grants` — `(user_id, entity_code, section_id, capability)` —
is the **scope**. Membership alone reads structure (items, entities, process
tables) and **no cell and no account**; cells come from grants through
`os_member_readable_cells()` / `os_member_writable_cells()`, accounts follow
their cell plus the entity's unmapped ones (`os_member_granted_entities()`).
`write` includes `read`. A grant requires its membership (cascading FK), so
revoking the membership takes the grants with it.

Fixed decisions, not open questions: the unit of scope is the **section**
(never the cell, never the project, never `os_finish_line_item_projects`);
`section_id` is NOT NULL and must be a `kind = 'section'` item (trigger
guard) — no wildcard row; a **new section is granted to nobody**; the **four
parentless metrics** (COGS / Sales × Poultry processing / Poultry trading)
resolve to themselves in the cell join and are therefore reachable by no
grant — owner-only until a migration says otherwise; `capability` lives on
the grant row and `os_entity_members.role` stays untouched; accounts stay
read-only for members. Never write a member policy on cells or accounts
against `os_member_entities()` again — `scripts/grant-scope-tests.sh` re-adds
that exact policy as a negative control and asserts the suite goes red. Full
reasoning: `docs/rls-conventions.md` §6.

---

## 7. Naming conventions actually in use

- Tables: `os_<area>_<thing>`, snake_case. Rows map to camelCase TypeScript in
  the repository layer, never in components.
- Migrations: `YYYYMMDD0000NN_snake_case.sql`. **Filename order is a contract**
  the SQL suites defend (57 must land before 58).
- Down-migrations: same basename + `_down.sql` under `migrations/down/`.
- Guard modules: `<area>Guards.ts`, throwing a named `<Area>GuardError`.
- Tests sit beside their subject: `foo.ts` → `foo.test.ts`.
- Components: PascalCase files, named exports (not default) except `App`.
- UI copy is mixed Indonesian/English by surface — match the file you are in.
  **Code, comments and commit messages are English.**

Comment density here is far above average and it is deliberate: comments record
*why*, and several record a decision that was made, retracted, and remade.
Match it. When you change a decision a comment explains, update the comment in
the same commit.

---

## 8. Known landmines

1. **The migration set cannot rebuild the database.** A from-scratch replay
   dies at `20260806000051` (#48 of 87) with an FK violation: the SAMB process
   seed references `os_finish_line_items` UUIDs as literals, and **no migration
   populates that table**. `scripts/lib/pg-cluster.sh` generates fabricated
   stand-ins to get past it. Treat `supabase/migrations/` as schema history,
   **not** as a disaster-recovery mechanism.

2. **Migration files and production have drifted.** At least once a migration's
   effect was absent from live (`20260724000012`'s revoke). Do not assume a
   migration in the tree is in effect — check the catalog.

3. **Migration `20260726000025` was never applied as written.** It describes
   schema that was already live. Numbers `022`, `023`, `024` never existed on
   any branch, though `types.ts:592` cites two of them.

4. **Seeds are guarded and raise on re-run.** Several process seeds refuse
   loudly if their rows already exist, because a silent duplicate is worse than
   a stopped migration. Do not "fix" that by removing the guard.

5. **Step→Finish-line mapping is by literal UUID, never by label.** Three
   Finish-line labels appear twice, so a by-label match picks the wrong twin.

6. **`figure` is not terminal.** `isGapEligible()` in
   `src/data/finishLineGuards.ts` is the single predicate deciding which cell
   states need work behind them. `zero` is deliberately deferred pending a
   `trading` flag on entities. When that is lifted it must be **one line** in
   that file — never a scattered `state !== 'zero'`.

7. **The Finish line owns the only URL in the app.** Leaving it must restore
   the address (`App.tsx`), or a reload lands somewhere the reader did not
   leave.

8. **The workbook is authoritative for `os_finish_line_accounts`** (626 rows).
   The app never edits workbook-owned columns, there is no importer and no
   sync, and the only write path is an explicit previewed paste. Nothing tells
   you when it has gone stale.

9. **Production builds from `main` via Vercel's Git integration.** Verified by
   measurement, not assumption: a push landing `48d20eb` produced a live bundle
   stamped `48d20eb` seconds later with no manual trigger. The old
   `deploy/vercel-bootstrap/` — which cloned the repo and ran `npm install` on
   this pnpm project — was dead weight and has been deleted. If staleness is
   ever suspected again, push and compare the sidebar build stamp; the one-line
   `curl` is in `deploy/README.md`.

10. **Free-tier Supabase.** No automated daily backups, no PITR. Manual
    `supabase db dump` is the only backup mechanism available.

11. **`current_user` inside a `SECURITY DEFINER` function is the DEFINER, not
    the caller.** It reads `postgres` no matter who called. A gate written
    against it never fires. The caller's role is the `role` GUC —
    `current_setting('role', true)` — which PostgREST sets per request and
    pg_cron leaves as `'none'`. This shipped once (`20260827000089`, corrected
    by `...091`) and reached production, because a catalog check cannot tell a
    gate that runs from a gate that is merely mentioned. Gate predicates get a
    **behavioural** test: `supabase/tests/anon_definer_gate_behaviour.sql`.

12. **The repo's migration filenames and the live ledger's versions are two
    different numbering schemes.** Production has ~93 entries whose names and
    timestamps do not match the 88 files here; several repo files were applied
    as two or more ledger entries. **Never** run `supabase db push`,
    `migration up`, `db reset` or `db remote commit` — any of them replays from
    `0001_schema.sql` against live production data. Apply migrations one at a
    time (the `apply_migration` tool), which is what every entry in that ledger
    already reflects.

---

## 9. Do not touch

Load-bearing ugliness, named so it is left alone deliberately rather than
accidentally.

1. **The three-layer GROWTH guard** (`20260804000047`). It looks redundant. The
   redundancy is the design — membership fails closed against an *absent*
   grant and does nothing against a *wrong* one.

2. **The literal UUIDs in the process seeds.** See landmine 5. Converting them
   to label lookups is a silent data-corruption bug.

3. **The `ReadResult` ceremony.** Verbose, and it exists because the app twice
   rendered a failed read as a confident zero. Do not simplify it back to
   arrays.

4. **`os_key_valid()`'s anon grant.** RLS cannot work without it. It is the
   gate, not a hole.

5. **The `(select fn())` InitPlan wrapper in RLS predicates**
   (`20260728000030`). Adopted after a live 500. The optimisation and the
   7-August outage's failure mode are the same line of SQL — read
   `supabase/tests/rls_function_grants.sql` before touching any policy.

---

## 10. Half-built, not dead

**The Lab evidence layer.** ~25 tables, a 1,205-line edge function, 1,161 lines
of gate tests — and in production `os_lab_datapoints`, `os_lab_claims`,
`os_lab_outputs`, `os_lab_questions`, `os_lab_projects` and
`os_lab_source_documents` are **all zero rows**. `os_lab_agents` (13) and
`os_lab_runs` (5) show it has been exercised, not adopted.

`TODO.md` states that nothing in the repo is half-built and that every absent
item is absent on purpose. Take that at face value: **flag before deleting
anything here, and delete nothing without asking.**

---

## 11. Hard constraints for any agent working here

Never, without asking the owner first:

- Touch `.env`, `.env.*`, or anything holding a key. Never read a secret's
  value into output. Never commit one.
- Put a service-role key anywhere it can reach the client bundle.
- Run destructive SQL, `DROP`, `TRUNCATE`, or apply a migration against the
  live database. **Migrations ship as versioned files; the owner applies them.**
- Weaken, bypass or `TODO`-comment out an RLS policy, a guard or an auth check.
- Rewrite git history, `push --force`, `reset --hard`, or delete a branch.
- Add a dependency, or bump a major version.
- Delete a file believed unused — propose it.
- Change schema shape, API contracts or route paths.
- Reformat files you are not otherwise editing.

Always:

- TypeScript strict. A new `any` is a bug. The tree currently has **zero**
  `as any` and three documented `as unknown as` — keep it that way.
- Preserve existing behaviour unless the approved finding says to change it.
- When two patterns exist, follow the one dominant **in that area**; note the
  inconsistency rather than unilaterally resolving it.
- Never bundle a refactor with a behaviour change in the same commit.
- If a change turns out bigger than estimated, stop and re-scope.

Verification gate before every commit: `pnpm typecheck`, `pnpm test:run`,
`pnpm build`, plus the relevant `scripts/*-tests.sh` when SQL changed. Paste
real output. If you cannot verify something, say so.
