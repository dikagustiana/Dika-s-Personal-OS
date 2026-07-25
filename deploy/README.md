# Deployment notes

Live site: <https://dika-personal-os.vercel.app>
Vercel project: `dika-personal-os` (team `dikagirawan-4804s-projects`)
Supabase project: `dikagustiana-prod` (ref `ascbthsgborseynmmthm`)

## The problem this folder documents

For a while the live site did not reflect anything merged to `main`. Two
independent causes, both in Vercel config rather than in the app:

1. **No GitHub integration.** The Vercel project has never been connected to
   `dikagustiana/Dika-s-Personal-OS`. Nothing about a push or a merge reaches
   Vercel, so no deployment is ever triggered automatically.
2. **A bootstrap pinned to a stale commit.** Because Vercel had no source of its
   own, production was built by a three-file "bootstrap" deployment whose build
   script cloned the repo at a *hardcoded commit SHA*. That SHA was `1c1996a`
   (PR #4, "v2"), so every later merge — v3 (#5) and v4 (#6) — rebuilt v2 and
   was invisible in production.

A third issue surfaced while fixing those: the Supabase `VITE_*` values were
never saved as Vercel **project** environment variables. They had been injected
into a single one-off deployment, so any new deployment built without them and
shipped a mock-mode bundle.

## The permanent fix

Connect the Vercel project to GitHub. Vercel Dashboard → project
`dika-personal-os` → Settings → Git → Connect Git Repository →
`dikagustiana/Dika-s-Personal-OS`, production branch `main`. This requires
dashboard access and cannot be done through the Vercel API.

Once connected, delete the bootstrap: set Framework Preset back to **Vite** and
clear the custom Install/Build/Output overrides, so Vercel builds the repo
directly on every push to `main`.

Also set, under Settings → Environment Variables, scoped to **Production**:

| Name                     | Value                                             |
| ------------------------ | ------------------------------------------------- |
| `VITE_SUPABASE_URL`      | `https://ascbthsgborseynmmthm.supabase.co`        |
| `VITE_SUPABASE_ANON_KEY` | the `dikagustiana-prod` publishable key           |

Both are public by design — they ship inside the client bundle. The database is
guarded by the app passphrase via RLS, not by these values.

## The interim bootstrap (`vercel-bootstrap/`)

Until the Git integration exists, production is built by these three files
deployed as their own Vercel deployment. They clone `main` at its tip — never a
pinned commit — and build it.

The copy actually deployed carries the two `VITE_` values as inline fallbacks so
production does not depend on env vars that are not set yet. The copy here reads
them only from the environment; once the Production env vars are configured, the
two copies behave identically.

This folder is documentation and is not used by the app build.

## Build stamp (v5)

Every build now bakes a short commit SHA and UTC timestamp into the bundle
(Vite `define`, see `vite.config.ts`), rendered in small muted type at the
bottom of the sidebar. "Is the live site running the code I merged?" is
answered by comparing that stamp to `git log` — no more guessing from UI
features. SHA resolution order: `VERCEL_GIT_COMMIT_SHA` (present once the Git
integration exists) → local `git rev-parse` → a gitignored `.build-sha` file
(for git-less file uploads) → `unknown`.

Until the dashboard-only Git connection is made, interim production deploys are
prebuilt locally from the repo (so the stamp carries the real SHA) and uploaded
as static files. The stamp makes any future staleness self-evident.
