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

Collaborators are colleagues who write Finish Line cells for their own
entities (`input → figure` plus the note) and read SAMB WORK projects —
nothing else; see REVIEW.md for the full boundary. Their identities live
**outside version control**, like the passphrase: no migration seeds them,
and **the app never sends email**.

Provisioning is owner-only, from the **Kolaborator panel** on the Finish Line
page (owner session): enter their email, tick their entities, and the panel
returns a **one-time sign-in link** — copy it and send it yourself over
WhatsApp. Links are short-lived and single-use; when a collaborator's session
lapses, generate a fresh one with *Tautan baru* on their row. *Cabut* removes
every membership immediately (their next query reads nothing) while keeping
the auth user, so cell history keeps its actor.

Behind the panel sits the `provision-collaborator` Edge Function: it verifies
the owner passphrase server-side with the same bcrypt-plus-lockout check as
the unlock gate, holds the service role key in its environment only, and
appends every action to `private.os_provision_log`. No dashboard steps, no
SMTP, and no self-service path exist — an email address gets access only when
the owner types it into that panel.

## Verify

```bash
pnpm test:run
pnpm build
```

## Data boundary

Every read and write goes through the async [`Repository`](src/data/repository.ts) interface, with the active implementation supplied by the Zustand store. [`MockRepository`](src/data/mockRepository.ts) keeps seeded data in memory and is the no-credentials fallback. [`supabaseRepository.ts`](src/data/supabaseRepository.ts) implements the same interface against Postgres — the swap happens in [`PassphraseGate`](src/components/PassphraseGate.tsx) after the passphrase is verified, and no view or logic code knows the difference. See [REVIEW.md](REVIEW.md) for the schema mapping and the security posture, including residual risk.

## Deployment

Deployed on Vercel (project `dika-personal-os`). The current setup builds from this repo's branch via `build.sh` in the deployment shim; the two `VITE_` values are baked in at build time (they are public client config — the secret is the passphrase, which lives only as a bcrypt hash in the database). To redeploy after pushing changes, trigger a new deployment of the Vercel project. A cleaner long-term setup is connecting the GitHub repo to the Vercel project and setting the two env vars in the dashboard — one-time, in Project Settings → Environment Variables.
