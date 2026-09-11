// What the institution shows an agent after a search. The raw body is
// archived whatever happens (B-6); this decides what is readable.

import { describe, expect, it } from 'vitest';
import {
  parseSearch,
  parseSearchHtml,
  parseSearchJson,
  searchUrlFor,
  unwrapRedirect,
} from '../../../supabase/functions/_shared/institution/searchParse';

describe('searchUrlFor', () => {
  it('substitutes an encoded query into the template', () => {
    expect(searchUrlFor('https://x.test/s?q={query}&n=5', 'poultry margin')).toBe('https://x.test/s?q=poultry%20margin&n=5');
  });

  it('appends q= when the template has no placeholder', () => {
    expect(searchUrlFor('https://x.test/s', 'a b')).toBe('https://x.test/s?q=a%20b');
    expect(searchUrlFor('https://x.test/s?k=1', 'a')).toBe('https://x.test/s?k=1&q=a');
  });
});

describe('unwrapRedirect', () => {
  it('unwraps the DuckDuckGo redirect so the citation points at the source', () => {
    expect(unwrapRedirect('/l/?uddg=https%3A%2F%2Fbps.go.id%2Fx&rut=1')).toBe('https://bps.go.id/x');
  });

  it('leaves a plain URL alone', () => {
    expect(unwrapRedirect('https://bps.go.id/x')).toBe('https://bps.go.id/x');
  });
});

describe('parseSearchJson', () => {
  it('reads the common result-array shapes', () => {
    expect(parseSearchJson({ results: [{ title: 'A', url: 'https://a.test', snippet: 'sa' }] }, 5))
      .toEqual([{ title: 'A', url: 'https://a.test', snippet: 'sa' }]);
    expect(parseSearchJson({ webPages: { value: [{ name: 'B', url: 'https://b.test', description: 'sb' }] } }, 5))
      .toEqual([{ title: 'B', url: 'https://b.test', snippet: 'sb' }]);
  });

  it('drops an entry with no URL rather than inventing one', () => {
    expect(parseSearchJson({ results: [{ title: 'A' }] }, 5)).toEqual([]);
  });

  it('honours the limit', () => {
    const body = { results: Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `https://x.test/${i}` })) };
    expect(parseSearchJson(body, 3)).toHaveLength(3);
  });
});

describe('parseSearchHtml', () => {
  const html = `
    <div class="result">
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fbps.go.id%2Fone">Poultry <b>statistics</b> 2024</a>
      <a class="result__snippet">Output rose to 3.85 million tonnes.</a>
    </div>
    <div class="result">
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Foecd.org%2Ftwo">OECD outlook</a>
      <a class="result__snippet">Projections to 2033.</a>
    </div>`;

  it('reads result links and their snippets, unwrapped', () => {
    expect(parseSearchHtml(html, 5)).toEqual([
      { title: 'Poultry statistics 2024', url: 'https://bps.go.id/one', snippet: 'Output rose to 3.85 million tonnes.' },
      { title: 'OECD outlook', url: 'https://oecd.org/two', snippet: 'Projections to 2033.' },
    ]);
  });

  it('falls back to plain links for markup it does not know', () => {
    const hits = parseSearchHtml('<html><body><a href="https://c.test/page">A useful page</a></body></html>', 5);
    expect(hits).toEqual([{ title: 'A useful page', url: 'https://c.test/page', snippet: '' }]);
  });
});

describe('parseSearch', () => {
  it('reports the shape it parsed so a guessed parse is visible', () => {
    expect(parseSearch('application/json', '{"results":[]}', 5).shape).toBe('json');
    expect(parseSearch('text/html', '<html><a class="result__a" href="https://a.test">A</a></html>', 5).shape).toBe('html');
    expect(parseSearch('text/plain', 'not structured at all', 5)).toEqual({ shape: 'none', hits: [] });
  });
});
