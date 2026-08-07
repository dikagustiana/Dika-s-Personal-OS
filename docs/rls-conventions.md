# RLS conventions

Rules that already have a production outage behind them. Each one is stated
with the incident that produced it, because a rule without its reason gets
tidied away by the next person who finds it inconvenient.

---

## 1. Every function called in an RLS predicate must have EXECUTE for every role that can reach the table

**This is the one that broke production on 7 August 2026.**

`os_member_entities()` was granted to `authenticated` only. Migration
`20260804000037` did that deliberately, and left a comment saying why:

```sql
-- anon can never hold membership, so anon gets no execute. The member
-- policies are `to authenticated`, which is the only role that evaluates
-- this function.
```

True when written. Then `process_member_read_policies` added eight SELECT
policies to the `os_process_*` tables **with no `to` clause**. No `to` clause
means `to public`. `public` includes `anon`. The comment silently became
false, and every read of every process table began throwing:

```
42501  permission denied for function os_member_entities
```

### Why no other policy could save it

Each table still carried a passing `require app key to select` policy, and
Postgres ORs permissive policies — so the intuition is that the owner's read
should have survived on the `os_key_valid()` branch. It did not, and the
reason is the house performance pattern:

```sql
using (entity_code = any ((select public.os_member_entities())::text[]))
--                        ^^^^^^ this wrap
```

The wrap exists because the unwrapped call is evaluated **once per row** and
produced a live 500 (migration `20260728000030`). Wrapping makes it an
**InitPlan**: evaluated once, *before* any row is processed. An InitPlan is
not reachable by OR short-circuiting, so a failing predicate takes the whole
query down no matter what else would have passed.

**The pattern that is correct for performance is exactly the pattern that
makes a missing grant unsurvivable.** You cannot fix this class by writing
policies more carefully. You fix it by checking the grants.

### "Can reach" means the `to` clause

Not which role the policy was written for, and not which role the app happens
to use. This distinction is the entire difference between two sets of member
policies in this schema:

| Policies | `to` clause | Needs an `anon` grant? |
|---|---|---|
| `os_finish_line_*` member policies (`20260804000040`) | `to authenticated` | No |
| `os_process_*` member policies (`20260806000058`) | *(none)* → `to public` | **Yes** |

Note also that the owner's own requests run as **`anon`** with an `x-app-key`
header, not as `authenticated`. "Only contributors are affected" is almost
never true here.

### How to check

```bash
psql "$DATABASE_URL" -f supabase/tests/rls_function_grants.sql
```

Zero rows means healthy. It is catalog-only and read-only, so it is safe
against the live project. **Run it after any migration that adds a policy,
adds a function, or changes a grant.** It carries its own tripwire: if the
matcher ever stops matching, it reports that instead of quietly returning
zero rows.

As of the last audit: 4 functions appear in RLS predicates — `os_key_valid`,
`os_read_key_valid`, `os_member_entities`, `os_member_projects` — across 509
(policy, role) pairs, with **zero violations**.

---

## 2. Prefer `to authenticated` on member policies, and grant deliberately when you cannot

A member policy that can only ever be true for a JWT holder should say so with
`to authenticated`. Then `anon` never evaluates it and no grant is needed.

The `os_process_*` policies do not follow this, because live already holds
them as `to public` and the repo records what live has rather than what would
have been tidier. Migration `20260806000057` grants `anon` the EXECUTE that
this makes necessary. Narrowing them later is a real option — but it is a
behaviour change to reason about, not a cleanup, because of the owner-runs-as-
`anon` point above.

---

## 3. Order grants before the policies that need them

In live, `process_member_read_policies` (04:14) landed before
`grant_member_entities_to_anon` (06:26). Everything in between was broken.

The repo files are numbered the other way — `20260806000057` grant, then
`20260806000058` policies — so a replay into a fresh environment never
reproduces the window. When you write a policy that calls a function, put the
grant in an earlier-numbered file, and check the down-migrations unwind in the
mirror order (policies dropped first, grant revoked second).

---

## 4. A read that returns zero rows must not be told it knows why

Not strictly an RLS rule, but the same incident, seen from the frontend.

RLS filtering every row and a genuinely empty table are **indistinguishable to
a client**: both come back as an empty set with no error. So no empty-state
copy may name a cause it did not observe. The swimlane once announced that the
seed had not landed while the seed was intact at 53 steps, and sent two people
after a data problem that was a permissions problem.

- A successful read of zero rows states the observation, and may name *whose
  access* produced it — the app knows the viewer, and that is an observation.
- `42P01` may name its cause, because the read proved it.
- `42501` and every other permission error must reach the surface **with its
  SQLSTATE**, never folded into an empty state. Do not widen the `42P01` guard
  to swallow `42703` or `42501`.

Enforced by `src/views/work/processEmptyState.test.tsx` and implemented in
`src/views/work/processUi.tsx` (`processEmptyClause`, `entityEmptyClause`) and
`src/data/readResult.ts`.

---

## 5. Test the read path as the roles that actually read

Every frontend test in this repo runs against a repository double, so before
August 2026 **no test had ever executed a SELECT as `anon` or
`authenticated`.** That is why the outage above reached production with a
fully green suite: a policy regression is invisible to a mock by construction.

```bash
scripts/role-read-tests.sh
```

Stands up a throwaway Postgres, replays every migration in filename order,
and reads all nine `os_process_*` tables as four identities: `anon` without a
key, the owner (`anon` + `x-app-key`), a contributor holding five entities,
and a contributor holding only ARBI.

**The invariant that matters most is zero throws**, checked before any row
count. The suite ends by revoking the `anon` grant and asserting that it goes
**red** — a suite that cannot fail proves nothing.

It is deliberately not part of `pnpm test`: CI has no Postgres, and a suite
that silently skips reports green for work it did not do.

### A known gap it exposes

The replay needs stand-in rows because **`os_finish_line_items` and
`os_finish_line_entities` are created by migrations but populated by none** —
live's 55 items and 5 entities were written from outside the repo, and the
process seeds reference 22 of those item uuids as literals. A from-scratch
replay therefore cannot reproduce live without scaffolding. The script
generates the minimum by reading the seeds, and says so when it runs.
