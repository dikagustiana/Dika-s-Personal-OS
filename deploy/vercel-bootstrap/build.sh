#!/usr/bin/env bash
# Bootstrap build for the Personal OS Vercel project (project: dika-personal-os).
#
# WHY THIS EXISTS
# The Vercel project has no GitHub integration, so Vercel has no source of its
# own. Production is therefore built by a three-file "bootstrap" deployment
# (this script + vercel.json + package.json) that clones the public repo and
# builds it.
#
# THE TRAP THIS REPLACES
# The original bootstrap cloned a *hardcoded commit SHA*. Every merge to main
# after that SHA was invisible to production — the site kept rebuilding the same
# old commit forever. Always clone a branch, never a pinned commit.
set -euo pipefail

REPO_URL="https://github.com/dikagustiana/Dika-s-Personal-OS.git"
BRANCH="main"

# Both values are public by design: they ship inside the client bundle. The
# database is guarded by the app passphrase via RLS, not by these. They should
# live as Vercel Production environment variables; this script only reports
# whether they are actually set.
if [ -n "${VITE_SUPABASE_URL:-}" ]; then
  echo "=== VITE_SUPABASE_URL: from Vercel project env vars ==="
else
  echo "=== VITE_SUPABASE_URL: NOT set on the project ==="
  echo "    Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as Production env"
  echo "    vars in Vercel, or this build ships a mock-mode bundle."
fi

rm -rf repo dist
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" repo

cd repo
echo "=== Building $BRANCH at commit $(git rev-parse HEAD) ==="
npm install
npm run build
cd ..

cp -r repo/dist dist

# Fail the build rather than silently shipping a mock-mode bundle to production.
if [ -n "${VITE_SUPABASE_URL:-}" ] && ! grep -q "$VITE_SUPABASE_URL" dist/assets/*.js; then
  echo "ERROR: Supabase URL is not in the built bundle - would ship in mock mode." >&2
  exit 1
fi

ls -la dist dist/assets
