import type { ComponentType } from 'react';
import { IELTS_TOPICS } from '../../../logic/ielts/topics';

/**
 * THE MDX PAGES, KEYED BY SLUG — the content half of the integration.
 *
 * `content/ielts/reading/matching-headings.mdx` is registered under
 * `reading/matching-headings`, which is exactly `os_ielts_topic.slug`. That
 * equality is why a weakness row can link to its own method with nothing but
 * string concatenation, and topicContent.test.ts fails the build if either
 * side gains a member the other lacks.
 *
 * Eager, not lazy. Forty-five short documents are a rounding error next to
 * recharts, and lazy chunks would put a loading state between "matching
 * headings: 6 misses in 10" and the method for matching headings — the one
 * transition in this app that has to feel like following a link.
 */

type MdxComponent = ComponentType<{
  components?: Record<string, ComponentType<Record<string, unknown>>>;
}>;

const modules = import.meta.glob<{ default: MdxComponent }>('../../../../content/ielts/**/*.mdx', {
  eager: true,
});

function slugFromPath(path: string): string {
  return path.replace(/^.*\/content\/ielts\//, '').replace(/\.mdx$/, '');
}

export const METHOD_PAGES: ReadonlyMap<string, MdxComponent> = new Map(
  Object.entries(modules).map(([path, module]) => [slugFromPath(path), module.default]),
);

/**
 * Slugs whose page records a gap in the source rather than a method.
 *
 * READ FROM THE TAXONOMY, not from the files. The obvious implementation —
 * a second `import.meta.glob` with `?raw`, scanning for the stub marker — does
 * not work: the MDX plugin claims `.mdx?raw` too and returns a compiled
 * component, so the scan receives a function and `raw.includes` throws at
 * module-evaluation time, before React mounts. That failure took the whole app
 * to a blank page, which is how it was found.
 *
 * topicContent.test.ts reads the real files and fails if any `hasMethod` flag
 * disagrees with the page it describes, so the declared value cannot rot.
 */
export const STUB_SLUGS: ReadonlySet<string> = new Set(
  IELTS_TOPICS.filter((topic) => !topic.hasMethod).map((topic) => topic.slug),
);

export function methodPageFor(slug: string): MdxComponent | undefined {
  return METHOD_PAGES.get(slug);
}
