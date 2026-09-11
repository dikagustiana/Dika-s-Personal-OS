// The extracted text is what B-6 archives and what a citation resolves to,
// so it has to be the text the agent actually read.

import { describe, expect, it } from 'vitest';
import {
  contentKindFor,
  decodeEntities,
  extractHtml,
  normaliseJsonText,
  capText,
} from '../../../supabase/functions/_shared/institution/extract';

describe('extractHtml', () => {
  it('keeps the readable text and drops scripts and styles', () => {
    const html = `<html><head><title>Poultry 2024</title><style>.a{color:red}</style>
      <script>var leak = "tracking"</script></head>
      <body><h1>Output</h1><p>Production reached 3.850.000 tonnes.</p></body></html>`;
    const extracted = extractHtml(html);
    expect(extracted.title).toBe('Poultry 2024');
    expect(extracted.text).toContain('Production reached 3.850.000 tonnes.');
    expect(extracted.text).not.toContain('tracking');
    expect(extracted.text).not.toContain('color:red');
  });

  it('turns block tags into line breaks so a table does not become one line', () => {
    const extracted = extractHtml('<table><tr><td>2023</td><td>3.85</td></tr><tr><td>2024</td><td>4.02</td></tr></table>');
    expect(extracted.text.split('\n')).toHaveLength(2);
    expect(extracted.text.split('\n')[0]).toContain('2023');
  });

  it('marks a truncation instead of ending mid-figure in silence', () => {
    const extracted = extractHtml(`<p>${'x'.repeat(500)}</p>`, 100);
    expect(extracted.truncated).toBe(true);
    expect(extracted.text).toContain('[truncated at 100 chars of 500]');
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('a &amp; b &#8212; c &#x2014; d &nbsp;e')).toBe('a & b — c — d  e');
  });

  it('leaves an unknown entity alone rather than guessing', () => {
    expect(decodeEntities('&notanentity;')).toBe('&notanentity;');
  });
});

describe('contentKindFor', () => {
  it('classifies what the server said it sent', () => {
    expect(contentKindFor('text/html; charset=utf-8')).toBe('html');
    expect(contentKindFor('application/json')).toBe('json');
    expect(contentKindFor('text/csv')).toBe('csv');
    expect(contentKindFor('application/pdf')).toBe('other');
    expect(contentKindFor(null)).toBe('other');
  });
});

describe('normaliseJsonText', () => {
  it('pretty-prints JSON so two retrievals can be diffed', () => {
    expect(normaliseJsonText('{"b":1,"a":2}')).toBe('{\n  "b": 1,\n  "a": 2\n}');
  });

  it('leaves a body that is not JSON exactly as it arrived', () => {
    expect(normaliseJsonText('not json')).toBe('not json');
  });
});

describe('capText', () => {
  it('passes short text through untouched', () => {
    expect(capText('short', 100)).toEqual({ title: null, text: 'short', truncated: false });
  });
});
