import { describe, expect, it } from 'vitest';
import { markdownPreview, parseInlines, parseMarkdown } from './markdown';

describe('markdown', () => {
  it('parses headings, task lists, paragraphs and code fences', () => {
    const blocks = parseMarkdown(['# Title', '', 'Prepared by **Someone** (`agent-x`)', '', '## Work log', '- [x] Done thing', '- [ ] Open thing', '- plain', '', '```', 'const a = 1;', '```'].join('\n'));
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'paragraph' });
    expect((blocks[1] as { inlines: unknown[] }).inlines).toEqual([
      { kind: 'text', text: 'Prepared by ' },
      { kind: 'bold', text: 'Someone' },
      { kind: 'text', text: ' (' },
      { kind: 'code', text: 'agent-x' },
      { kind: 'text', text: ')' },
    ]);
    expect(blocks[2]).toMatchObject({ kind: 'heading', level: 2 });
    const list = blocks[3];
    expect(list.kind).toBe('list');
    if (list.kind === 'list') expect(list.items.map((i) => i.checked)).toEqual([true, false, null]);
    expect(blocks[4]).toEqual({ kind: 'code', text: 'const a = 1;' });
  });

  it('never produces HTML: script tags stay text', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks).toEqual([{ kind: 'paragraph', inlines: [{ kind: 'text', text: '<script>alert(1)</script>' }] }]);
    expect(parseInlines('no marks')).toEqual([{ kind: 'text', text: 'no marks' }]);
  });

  it('previews body text without headings and trims to length', () => {
    const p = markdownPreview('# Head\n\nFirst para here.\n\n- a\n- b\n', 20);
    expect(p).toBe('First para here. a …');
    expect(markdownPreview('# Only heading')).toBe('');
  });
});
