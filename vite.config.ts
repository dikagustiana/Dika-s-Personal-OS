import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Build stamp, rendered at the bottom of the sidebar so "is the live site
// running the code I merged?" is answerable at a glance. Resolution order:
// Vercel's git metadata (present once the repo is Git-connected), the local
// git checkout, then a `.build-sha` file (written by hand for git-less file
// uploads; gitignored), and finally an honest "unknown".
function commitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    /* not a git checkout */
  }
  const stampFile = path.resolve(__dirname, '.build-sha');
  if (existsSync(stampFile)) {
    return readFileSync(stampFile, 'utf8').trim().slice(0, 7);
  }
  return 'unknown';
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(commitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
  },
});
