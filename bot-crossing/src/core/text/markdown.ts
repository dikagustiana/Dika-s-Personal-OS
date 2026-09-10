// A deliberately small markdown parser for output documents: headings, task
// lists, bullet lists, paragraphs, and inline bold / code. Produces a block
// tree that the HUD renders as React elements — never innerHTML — because
// live adapters may post untrusted text.
export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'code'; text: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; items: Array<{ checked: boolean | null; inlines: Inline[] }> }
  | { kind: 'code'; text: string };

export function parseInlines(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: 'text', text: text.slice(last, idx) });
    const tok = m[0];
    if (tok.startsWith('**')) out.push({ kind: 'bold', text: tok.slice(2, -2) });
    else out.push({ kind: 'code', text: tok.slice(1, -1) });
    last = idx + tok.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Array<{ checked: boolean | null; inlines: Inline[] }> | null = null;
  let code: string[] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'paragraph', inlines: parseInlines(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list && list.length) blocks.push({ kind: 'list', items: list });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (code !== null) {
      if (line.startsWith('```')) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else code.push(raw);
      continue;
    }
    if (line.startsWith('```')) {
      flushPara();
      flushList();
      code = [];
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, inlines: parseInlines(h[2]) });
      continue;
    }
    const li = /^[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line);
    if (li) {
      flushPara();
      list = list ?? [];
      list.push({ checked: li[1] === undefined ? null : li[1].toLowerCase() === 'x', inlines: parseInlines(li[2]) });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n') });
  flushPara();
  flushList();
  return blocks;
}

/** Plain-text preview: the first `n` characters of body text, headings stripped. */
export function markdownPreview(src: string, n = 160): string {
  const text = parseMarkdown(src)
    .filter((b) => b.kind === 'paragraph' || b.kind === 'list')
    .map((b) => (b.kind === 'paragraph' ? b.inlines.map((i) => i.text).join('') : b.items.map((i) => i.inlines.map((x) => x.text).join('')).join(' · ')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}
