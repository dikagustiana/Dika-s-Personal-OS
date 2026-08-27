# Deployment notes

Live site: <https://dika-personal-os.vercel.app>
Vercel project: `dika-personal-os` (team `dikagirawan-4804s-projects`)
Supabase project: `personal-os` (ref `ascbthsgborseynmmthm`)

**Status: the Git integration is connected and production builds from `main`
automatically.** The problem this folder was written to document is closed, and
the interim bootstrap it described has been deleted. The history is kept below
because the failure mode was silent for three releases and is worth
recognising if it ever returns.

## How production builds today

Push to `main` → Vercel builds the repo directly (Framework Preset: Vite) →
deploy. Nothing manual, no bootstrap, no pinned commit.

Measured 27 Aug 2026: a push landing commit `48d20eb` produced a live bundle
carrying build SHA `48d20eb` and build time `04:19:52Z`, seconds later, with no
manual trigger. Only an authenticated Git integration can do that — a
deployment with no Git connection cannot know a push happened. That is the test
to repeat if you ever suspect staleness again; it takes one push and one
`curl`.

## The problem this folder used to document

For a while the live site did not reflect anything merged to `main`. Two
independent causes, both in Vercel config rather than in the app:

1. **No GitHub integration.** The Vercel project had never been connected to
   `dikagustiana/Dika-s-Personal-OS`, so nothing about a push or a merge reached
   Vercel and no deployment was ever triggered automatically.
2. **A bootstrap pinned to a stale commit.** Because Vercel had no source of its
   own, production was built by a three-file "bootstrap" deployment whose build
   script cloned the repo at a *hardcoded commit SHA* — `1c1996a` (PR #4, "v2").
   Every later merge rebuilt v2 and was invisible in production.

A third issue surfaced while fixing those: the Supabase `VITE_*` values were
never saved as Vercel **project** environment variables. They had been injected
into a single one-off deployment, so any new deployment built without them and
shipped a mock-mode bundle.

## Environment variables

Under Settings → Environment Variables, scoped to **Production**:

| Name                     | Value                                             |
| ------------------------ | ------------------------------------------------- |
| `VITE_SUPABASE_URL`      | `https://ascbthsgborseynmmthm.supabase.co`        |
| `VITE_SUPABASE_ANON_KEY` | the `personal-os` publishable key                 |

Both are public by design — they ship inside the client bundle. The database is
guarded by the app passphrase via RLS, not by these values.

## Why `vercel-bootstrap/` is gone

It was three files (`build.sh`, `package.json`, `vercel.json`) that cloned
`main` and built it, as a stand-in for the Git integration that now exists. It
was deleted rather than kept as a fallback for two reasons:

- **It had stopped being true.** It described itself as how production builds.
  It was not, and a reader trusting it would have reasoned about deployment
  from a file with no effect on anything.
- **It ran `npm install` on a pnpm project** whose `.gitignore` deliberately
  excludes `package-lock.json`, so npm resolved fresh and ignored
  `pnpm-lock.yaml` entirely. Had it still been in the build path, production
  would have shipped dependency versions CI never tested. It was not in the
  path — but a dormant copy of that mistake is not a fallback worth having.

It also cloned the repository over unauthenticated HTTPS, so it would have
broken the moment the repository became private. Recovering it means
`git log -- deploy/vercel-bootstrap/`; nothing about it is worth reconstructing
from memory.

## Build stamp

Every build bakes a short commit SHA and UTC timestamp into the bundle (Vite
`define`, see `vite.config.ts`), rendered in small muted type at the bottom of
the sidebar. "Is the live site running the code I merged?" is answered by
comparing that stamp to `git log` — no guessing from UI features. SHA
resolution order: `VERCEL_GIT_COMMIT_SHA` (which is what supplies it now that
the Git integration exists) → local `git rev-parse` → a gitignored `.build-sha`
file → `unknown`.

The stamp is also readable without opening the app, which is how the
measurement above was taken:

```bash
curl -s https://dika-personal-os.vercel.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
curl -s https://dika-personal-os.vercel.app/assets/index-XXXX.js | grep -oE '"[0-9a-f]{7}"' | head -1
```
