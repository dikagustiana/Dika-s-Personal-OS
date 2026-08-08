# Personal OS

A private, single-user command center split into two fully separate worlds: **WORK** (the day job — SAMB, finance) and **GROWTH** (self-development — university, scholarshaip, research, website). Each workspace has its own Today, Timebox, Week, Projects, and Analytics views with independently scoped data and its own daily score; WORK additionally has an Escalations board-review screen. WORK timeboxes 08:30–18:30, GROWTH 18:30–23:30.

**Live:** https://dika-personal-os.vercel.app — enter the app passphrase to unlock. Data persists in Supabase (project `dikagustiana-prod`).

## Run locally

Requires Node.js 20 or newer.

```bash
pnpm install    # npm install also works
pnpm dev
```

With no configuration the app runs on the in-memory **mock repository**: seeded data, resets on reload, no credentials needed. This is the default for anyone cloning the repo.

### Connecting to Supabase

Copy `.env.example` to `.env` and fill in both values (Supabase dashboard → Project Settings → API):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

When both are set, the app shows a passphrase gate on load and, once unlocked, reads and writes through Supabase. The passphrase is checked server-side and attached to every request as an `x-app-key` header that row-level security validates — the anon key alone grants no data access. Never commit `.env` (it is gitignored).

### Setting up a fresh database

Apply the SQL files in `supabase/migrations/` in order (Supabase SQL editor or CLI). Then set the passphrase — this is the one step that lives outside version control:

```sql
update private.os_app_secret
set key_hash = extensions.crypt('your-passphrase', extensions.gen_salt('bf'));
```

Run the same statement any time you want to rotate the passphrase.

### Adding a collaborator

Collaborators are colleagues who hold two **independent** kinds of access —
see REVIEW.md for the full boundary:

- **Entity access** opens their Finish Line columns: cell writes
  (`input → figure` plus the note), nothing structural.
- **Project access** opens individual WORK projects, granted **one by one**:
  read the project, and create/edit its tasks (status, due date, assignee —
  never delete; a task ends as *done* or *cancelled*). A project with no
  grants is the owner's private project, and the card says so (`privat`).
  **Only WORK projects are grantable at all** — a GROWTH grant is refused in
  the database, the owner's own session included; sharing a growth project
  would take a migration, not a click.

Neither grant implies the other, and zero grants reads zero rows. Their
identities live **outside version control**, like the passphrase: no
migration seeds them, and **the app never sends email**.

Provisioning is owner-only, from the **Kolaborator panel** on the Finish Line
page (owner session): enter their email, tick their entities, and the panel
returns a **one-time sign-in link** — copy it and send it yourself over
WhatsApp. Project grants sit on the same row, labelled apart from the entity
chips (*+ beri akses proyek* / ×). Links are short-lived and single-use; when
a collaborator's session lapses, generate a fresh one with *Tautan baru* on
their row. *Cabut* removes every membership on **both axes** immediately
(their next query reads nothing) while keeping the auth user, so cell and
task history keep their actor.

Behind the panel sits the `provision-collaborator` Edge Function: it verifies
the owner passphrase server-side with the same bcrypt-plus-lockout check as
the unlock gate, holds the service role key in its environment only, and
appends every action — entity grants, **project grants**, links, revokes —
to `private.os_provision_log`. No dashboard steps, no SMTP, and no
self-service path exist — an email address gets access only when the owner
types it into that panel.

There is deliberately **no manual-SQL membership recipe** here anymore: the
first cut documented one beside the passphrase statement, and it was retired
when provisioning shipped, because a grant that skips the panel skips the
audit log. The owner key can still write the membership tables from the SQL
editor — that power is inherent — but the panel is the path that leaves a
record, so use it.

## Verify

```bash
pnpm test:run
pnpm build
```

### Verifying the database, not just the app

`pnpm test:run` runs against a repository double, so it cannot see an RLS or
grant regression — that is how `permission denied for function
os_member_entities` reached production with a green suite. Two checks cover
the database itself:

```bash
# Catalog-only, read-only, safe against live. Zero rows = healthy.
psql "$DATABASE_URL" -f supabase/tests/rls_function_grants.sql

# Throwaway cluster: replays every migration, then reads the nine
# os_process_* tables as anon, as the owner, and as two contributors.
scripts/role-read-tests.sh

# Throwaway cluster: proves the one-shot seed guards actually refuse, do
# not duplicate, and can still be got past via the down-seed.
scripts/seed-guard-tests.sh
```

**Run the first two after any migration that adds a policy, adds a function,
or changes a grant**, and the third after touching either process seed file or
its down-seed. The rules they enforce — and the outage behind each — are in
[docs/rls-conventions.md](docs/rls-conventions.md).

Both scripts share `scripts/lib/pg-cluster.sh`, which builds the cluster and
replays the migrations. Note what it has to do first: `os_finish_line_items`
and `os_finish_line_entities` are created by migrations and populated by none,
so a from-scratch replay needs stand-in rows before the process seeds will
apply. That gap is real, and the script says so every time it runs.

## Writing Finish Line cells (changed 2026-08-04)

Cell writes are guarded by a database trigger: an UPDATE on
`os_finish_line_cells` must carry either the owner's `x-app-key` header or a
member JWT. A bare UPDATE from the SQL editor now **fails loudly** with
`finish line cells: writes require the owner key or an authenticated
contributor` — that is the design, because every cell write must land in
`os_finish_line_cell_history` with an actor.

So: cell states and notes are edited **through the app** (the cell panel).
If a SQL session is genuinely needed, satisfy the owner branch at the top of
the transaction:

```sql
begin;
select set_config('request.headers',
       json_build_object('x-app-key', '<passphrase>')::text, true);
-- updates to os_finish_line_cells here run as the owner and are audited
commit;
```

The passphrase typed into that `set_config` line is the real credential:
**never let it end up in a saved query, a committed file, or a pasted
prompt.** Type it, run it, close the editor tab. Everything else — items,
entities, deps, edges, accounts — is not behind this trigger and behaves as
before.

## IELTS prep (GROWTH → IELTS)

Five tabs behind one nav entry. **Prep** shows days to the test, sessions in
the rolling week, and the *binding constraint* — the skill furthest below its
per-skill floor, never the average. **Log session** records one practice
attempt and tags what went wrong; for Listening and Reading it derives the
band from the raw score and lets you override it. **Weakness** ranks those
tags and links each row to its method. **Method** renders the reference
content. **Bands & errors** is the pre-existing full-mock band tracker and
pasted-feedback error log, unchanged.

The reference content lives in the repo as MDX under `content/ielts/`, one
file per topic, extracted one-time from the Notion *IELTS Mastery Toolkit*.
**The path after `content/ielts/` is exactly `os_ielts_topic.slug`** — that
equality is what makes a weakness row a link, and
[`topicContent.test.ts`](src/logic/ielts/topicContent.test.ts) fails the build
if any slug lacks a file or any file lacks a slug.

30 of the 45 pages are honest stubs: the Notion sheets name most question
types without explaining any of them, and no method was invented to fill the
gap. Stubs are marked in the index and on the weakness rows. Editing content
means editing the MDX and committing it — there is no CMS, and no write-back
to Notion. See [REVIEW.md](REVIEW.md) for the extraction report.

## Data boundary

Every read and write goes through the async [`Repository`](src/data/repository.ts) interface, with the active implementation supplied by the Zustand store. [`MockRepository`](src/data/mockRepository.ts) keeps seeded data in memory and is the no-credentials fallback. [`supabaseRepository.ts`](src/data/supabaseRepository.ts) implements the same interface against Postgres — the swap happens in [`PassphraseGate`](src/components/PassphraseGate.tsx) after the passphrase is verified, and no view or logic code knows the difference. See [REVIEW.md](REVIEW.md) for the schema mapping and the security posture, including residual risk.

## Deployment

Deployed on Vercel (project `dika-personal-os`). The current setup builds from this repo's branch via `build.sh` in the deployment shim; the two `VITE_` values are baked in at build time (they are public client config — the secret is the passphrase, which lives only as a bcrypt hash in the database). To redeploy after pushing changes, trigger a new deployment of the Vercel project. A cleaner long-term setup is connecting the GitHub repo to the Vercel project and setting the two env vars in the dashboard — one-time, in Project Settings → Environment Variables.
