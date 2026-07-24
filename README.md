# Personal OS

A private, single-user command center for focused daily execution and long-term growth. The app defaults to **Work / Today** and includes responsive Today, Timebox, Week, Projects, and Analytics views.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Verify

```bash
npm run test:run
npm run build
```

## Data boundary

This prototype is intentionally mock-only. Every read and write goes through the async [`Repository`](src/data/repository.ts) interface, with the active implementation supplied by the Zustand store. [`MockRepository`](src/data/mockRepository.ts) keeps seeded data in memory and resets on reload. It contains no database client, credentials, SQL, migrations, environment values, or persistence. A separate Supabase implementation can replace the active repository in one line without changing any view or application logic.
