// Page content → the text the agent actually reads, which is what B-6
// archives ("the extracted text actually used"). Deliberately simple and
// deterministic: scripts, styles and comments dropped; block tags become
// line breaks; entities decoded; whitespace collapsed; a hard size cap with
// a visible truncation marker so a record never silently ends mid-figure.

export const MAX_EXTRACT_CHARS = 200_000;

export type ContentKind = 'html' | 'json' | 'csv' | 'text' | 'xml' | 'other';

export function contentKindFor(contentType: string | null): ContentKind {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('html')) return 'html';
  if (type.includes('json')) return 'json';
  if (type.includes('csv')) return 'csv';
  if (type.includes('xml') || type.includes('atom') || type.includes('rss')) return 'xml';
  if (type.startsWith('text/')) return 'text';
  return 'other';
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

export interface Extracted {
  title: string | null;
  text: string;
  truncated: boolean;
}

export function extractHtml(html: string, maxChars = MAX_EXTRACT_CHARS): Extracted {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() || null : null;
  let text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|table|ul|ol|dd|dt|header|footer|nav|aside|figcaption)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return capText(text, maxChars, title);
}

export function capText(text: string, maxChars: number, title: string | null = null): Extracted {
  if (text.length <= maxChars) return { title, text, truncated: false };
  return {
    title,
    text: `${text.slice(0, maxChars)}\n[truncated at ${maxChars} chars of ${text.length}]`,
    truncated: true,
  };
}

/** JSON is archived pretty-printed so a diff of two retrievals reads. */
export function normaliseJsonText(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
