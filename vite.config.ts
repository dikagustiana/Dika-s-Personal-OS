import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
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
  plugins: [
    // BEFORE react(), not after: @mdx-js/rollup turns .mdx into JSX, and the
    // React plugin has to see that JSX to apply the automatic runtime. The
    // other order compiles nothing and fails at import.
    //
    // remarkFrontmatter makes the YAML block a parsed node rather than a
    // paragraph of stray text at the top of every page. It is deliberately
    // NOT remark-mdx-frontmatter: the app never reads frontmatter at runtime.
    // Topic metadata (slug, skill, kind, label, order) comes from
    // os_ielts_topic and from src/logic/ielts/topics.ts, so exporting it from
    // the MDX too would create a third copy that can disagree with the other
    // two. The frontmatter exists to make each file self-describing to a
    // human and to give topicContent.test.ts something to check the path
    // against.
    //
    // remarkGfm is required, not cosmetic: the Notion source is mostly
    // tables, and every one of them lands in these files as a GFM table.
    { enforce: 'pre', ...mdx({ remarkPlugins: [remarkFrontmatter, remarkGfm] }) },
    react({ include: /\.(jsx|js|mdx|md|tsx|ts)$/ }),
  ],
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
