import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IELTS_TOPICS } from './topics';

/**
 * THE JOIN BETWEEN THE DATABASE AND THE CONTENT, ENFORCED.
 *
 * os_ielts_topic.slug is also the path under content/ielts/. The weakness
 * view's whole value is that a row saying "matching headings: 6 misses in 10"
 * links to the method for matching headings — and that link is built by
 * string concatenation from the slug. A slug with no file produces a dead
 * link on the most important row in the app; a file with no slug is content
 * nobody can reach.
 *
 * Neither failure is visible in a green build, which is why this test exists.
 *
 * WHAT THIS CHECKS AGAINST. IELTS_TOPICS (src/logic/ielts/topics.ts), not the
 * database — CI has no database. topics.ts and the seed migration are kept in
 * agreement by a live query, recorded in REVIEW.md. So the chain is:
 * migration seed == topics.ts (checked live) == MDX files (checked here).
 */

const CONTENT_ROOT = join(process.cwd(), 'content', 'ielts');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Every .mdx under content/ielts/, as slugs — 'reading/matching-headings'. */
function slugsOnDisk(): string[] {
  return walk(CONTENT_ROOT)
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => relative(CONTENT_ROOT, file).replace(/\.mdx$/, '').split(sep).join('/'))
    .sort();
}

function frontmatterOf(slug: string): Record<string, string> {
  const raw = readFileSync(join(CONTENT_ROOT, `${slug}.mdx`), 'utf8');
  const match = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => /^([a-z_]+):\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      // Values may be single-quoted to protect a colon in a label
      // ('Part 1: Interview'), which YAML needs and this parser must undo.
      .map((m) => [m[1], m[2].replace(/^'(.*)'$/, '$1')]),
  );
}

describe('IELTS topic ↔ MDX parity', () => {
  it('every topic slug has an MDX file', () => {
    const onDisk = new Set(slugsOnDisk());
    const orphanSlugs = IELTS_TOPICS.map((t) => t.slug).filter((slug) => !onDisk.has(slug));
    expect(orphanSlugs, 'topic slugs with no content/ielts/<slug>.mdx').toEqual([]);
  });

  it('every MDX file has a topic slug', () => {
    const known = new Set<string>(IELTS_TOPICS.map((t) => t.slug));
    const orphanFiles = slugsOnDisk().filter((slug) => !known.has(slug));
    expect(orphanFiles, 'MDX files with no row in IELTS_TOPICS').toEqual([]);
  });

  it('each file’s frontmatter slug equals its own path', () => {
    // Catches the copy-paste failure the other two tests cannot see: a file at
    // the right path whose frontmatter still names the file it was copied
    // from. Both sets stay balanced, and the page claims to be another page.
    const mismatched = slugsOnDisk()
      .map((slug) => ({ slug, declared: frontmatterOf(slug).slug }))
      .filter((row) => row.declared !== row.slug);
    expect(mismatched, 'frontmatter slug disagrees with file path').toEqual([]);
  });

  it('each file’s frontmatter skill and kind match the taxonomy', () => {
    const mismatched = IELTS_TOPICS.map((topic) => {
      const fm = frontmatterOf(topic.slug);
      return { slug: topic.slug, declared: `${fm.skill}/${fm.kind}`, expected: `${topic.skill}/${topic.kind}` };
    }).filter((row) => row.declared !== row.expected);
    expect(mismatched, 'frontmatter skill/kind disagrees with IELTS_TOPICS').toEqual([]);
  });

  it('records the Notion page every file came from', () => {
    const missing = slugsOnDisk().filter(
      // 32 hex digits with dashes. The extraction is one-time and deliberate;
      // when the Notion source changes, this id is how you find what to re-read.
      (slug) => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(frontmatterOf(slug).source_notion_page ?? ''),
    );
    expect(missing, 'files with no valid source_notion_page').toEqual([]);
  });

  it('sorts criteria after task and question types within a skill', () => {
    // A REAL DEFECT THIS CAUGHT. Writing task types ran 10..120 and writing
    // criteria 100..130, so the method index interleaved them — "Task
    // Response" landed between two Task 2 entries. The sort was valid and
    // wrong, which no type or parity check can see.
    for (const skill of ['listening', 'reading', 'writing', 'speaking'] as const) {
      const forSkill = IELTS_TOPICS.filter((topic) => topic.skill === skill);
      const highestNonCriterion = Math.max(
        ...forSkill.filter((topic) => topic.kind !== 'criterion').map((topic) => topic.sortOrder),
      );
      const lowestCriterion = Math.min(
        ...forSkill.filter((topic) => topic.kind === 'criterion').map((topic) => topic.sortOrder),
        Number.POSITIVE_INFINITY,
      );
      expect(lowestCriterion, `${skill}: criterion sort band overlaps the task-type band`).toBeGreaterThan(
        highestNonCriterion,
      );
    }
  });

  it('gives every topic in a skill a distinct sort order', () => {
    for (const skill of ['listening', 'reading', 'writing', 'speaking'] as const) {
      const orders = IELTS_TOPICS.filter((topic) => topic.skill === skill).map((t) => t.sortOrder);
      expect(new Set(orders).size, `${skill}: duplicate sort_order makes the index order arbitrary`).toBe(
        orders.length,
      );
    }
  });

  it('hasMethod tells the truth about every page', () => {
    // The flag drives a "no method yet" marker on the weakness rows, so a
    // wrong one either hides a real gap or libels a real page. The files are
    // the authority; this reads them and compares.
    //
    // The marker is the one the stub generator writes, not a length rule: a
    // page that IS method but happens to be three sentences long (which the
    // extraction brief explicitly allows) must not be misread as a gap.
    const wrong = IELTS_TOPICS.map((topic) => {
      const raw = readFileSync(join(CONTENT_ROOT, `${topic.slug}.mdx`), 'utf8');
      return { slug: topic.slug, declared: topic.hasMethod, actual: !raw.includes('tone="empty"') };
    }).filter((row) => row.declared !== row.actual);
    expect(wrong, 'hasMethod disagrees with the page it describes').toEqual([]);
  });

  it('contains no signed Notion asset URLs', () => {
    // Notion's file and image URLs are pre-signed and expire, so one committed
    // here renders today and 403s in a fortnight — a silent rot the build
    // cannot see. The extraction drops assets rather than hot-linking them.
    const offenders = walk(CONTENT_ROOT)
      .filter((file) => file.endsWith('.mdx'))
      .filter((file) => {
        const raw = readFileSync(file, 'utf8');
        return (
          /prod-files-secure|s3\.us-west-2\.amazonaws\.com|X-Amz-Signature|secure\.notion-static\.com|attachment:/i.test(
            raw,
          ) || /file\.notion\.so/i.test(raw)
        );
      })
      .map((file) => relative(CONTENT_ROOT, file));
    expect(offenders, 'committed content holds a signed Notion URL that will expire').toEqual([]);
  });
});
