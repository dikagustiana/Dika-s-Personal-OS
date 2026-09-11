// Search results, parsed from what the endpoint actually returned.
//
// The institution has no search API key of its own. The backend is a secret
// the director sets — INSTITUTION_SEARCH_URL, a template containing {query}
// — and the default is DuckDuckGo's keyless HTML endpoint. Both shapes are
// handled here: a JSON body with an array of results under a few common
// keys, or an HTML result page. Whatever comes back, the RAW body is
// archived first (B-6) and this parser only decides what the agent is shown;
// a parser that silently returned nothing would otherwise hide a working
// retrieval, so `parseSearch` reports the shape it found.

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface ParsedSearch {
  shape: 'json' | 'html' | 'none';
  hits: SearchHit[];
}

const clean = (text: string): string =>
  text.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** DuckDuckGo wraps every outbound link as /l/?uddg=<encoded>. */
export function unwrapRedirect(href: string): string {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    if (target) return target;
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    return href;
  } catch {
    return href;
  }
}

export function parseSearchJson(body: unknown, limit: number): SearchHit[] {
  const container = body as Record<string, unknown> | null;
  if (!container || typeof container !== 'object') return [];
  const candidates = ['results', 'items', 'organic', 'organic_results', 'webPages', 'data'];
  let list: unknown = null;
  for (const key of candidates) {
    const value = (container as Record<string, unknown>)[key];
    if (Array.isArray(value)) { list = value; break; }
    if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).value)) {
      list = (value as Record<string, unknown>).value;
      break;
    }
  }
  if (!Array.isArray(list)) return [];
  const hits: SearchHit[] = [];
  for (const entry of list.slice(0, limit)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const url = [row.url, row.link, row.href].find((value) => typeof value === 'string') as string | undefined;
    if (!url) continue;
    const title = [row.title, row.name, row.heading].find((value) => typeof value === 'string') as string | undefined;
    const snippet = [row.snippet, row.description, row.excerpt, row.content].find((value) => typeof value === 'string') as string | undefined;
    hits.push({ title: clean(title ?? url), url, snippet: clean(snippet ?? '') });
  }
  return hits;
}

export function parseSearchHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    const url = unwrapRedirect(clean(match[1]).replace(/&amp;/g, '&'));
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    hits.push({ title: clean(match[2]), url, snippet: '' });
    if (hits.length >= limit) break;
  }
  if (hits.length > 0) {
    const snippets = [...html.matchAll(/<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => clean(match[1]));
    hits.forEach((hit, index) => { if (snippets[index]) hit.snippet = snippets[index]; });
    return hits;
  }
  // Fallback for an endpoint whose markup we do not know: any absolute link
  // with visible text, minus the obvious chrome. Reported as html shape so a
  // reader can tell a guessed parse from a known one.
  const generic = /<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{3,200}?)<\/a>/gi;
  for (const match of html.matchAll(generic)) {
    const url = match[1].replace(/&amp;/g, '&');
    const title = clean(match[2]);
    if (!title || seen.has(url)) continue;
    if (/duckduckgo\.com|\.css|\.js$|javascript:/i.test(url)) continue;
    seen.add(url);
    hits.push({ title, url, snippet: '' });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function parseSearch(contentType: string | null, raw: string, limit: number): ParsedSearch {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('json')) {
    try {
      return { shape: 'json', hits: parseSearchJson(JSON.parse(raw), limit) };
    } catch {
      return { shape: 'none', hits: [] };
    }
  }
  if (type.includes('html') || /<html/i.test(raw)) {
    return { shape: 'html', hits: parseSearchHtml(raw, limit) };
  }
  try {
    return { shape: 'json', hits: parseSearchJson(JSON.parse(raw), limit) };
  } catch {
    return { shape: 'none', hits: [] };
  }
}

/** The endpoint URL for a query, from the configured template. */
export function searchUrlFor(template: string, query: string): string {
  if (template.includes('{query}')) return template.replace('{query}', encodeURIComponent(query));
  const separator = template.includes('?') ? '&' : '?';
  return `${template}${separator}q=${encodeURIComponent(query)}`;
}
