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
nothing else; see REVIEW.md for the full boundary. Like the passphrase, their
identities live **outside version control**: no migration seeds them and no
invite UI exists. Two manual steps, in this order:

1. Create the user in the Supabase dashboard (Authentication → Users → Add
   user, with their email). Email magic-link sign-in must be enabled once
   under Authentication → Providers → Email.
2. Grant membership with one SQL statement per entity (SQL editor):

```sql
insert into public.os_entity_members (user_id, entity_code)
values ('<auth user uuid>', 'ASI');  -- one of SAMB · ASI · ARBI · KNI · KDU
```

They then enter through "Masuk sebagai kolaborator" on the unlock screen; the
magic link signs them in and membership decides what they see. Revoke by
deleting the membership row (their session then reads nothing), or delete the
user in the dashboard.

## Verify

```bash
pnpm test:run
pnpm build
```

## Data boundary

Every read and write goes through the async [`Repository`](src/data/repository.ts) interface, with the active implementation supplied by the Zustand store. [`MockRepository`](src/data/mockRepository.ts) keeps seeded data in memory and is the no-credentials fallback. [`supabaseRepository.ts`](src/data/supabaseRepository.ts) implements the same interface against Postgres — the swap happens in [`PassphraseGate`](src/components/PassphraseGate.tsx) after the passphrase is verified, and no view or logic code knows the difference. See [REVIEW.md](REVIEW.md) for the schema mapping and the security posture, including residual risk.

## Deployment

Deployed on Vercel (project `dika-personal-os`). The current setup builds from this repo's branch via `build.sh` in the deployment shim; the two `VITE_` values are baked in at build time (they are public client config — the secret is the passphrase, which lives only as a bcrypt hash in the database). To redeploy after pushing changes, trigger a new deployment of the Vercel project. A cleaner long-term setup is connecting the GitHub repo to the Vercel project and setting the two env vars in the dashboard — one-time, in Project Settings → Environment Variables.
