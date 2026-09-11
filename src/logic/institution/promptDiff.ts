/**
 * The diff a proposal carries.
 *
 * Deliberately a line diff and nothing cleverer: the director reads it to
 * decide whether to install a prompt, and a minimal-edit-distance diff that
 * reflows paragraphs is harder to read than one that says "these lines went,
 * these arrived". Longest common subsequence over lines, rendered as unified
 * -/+ with a little context.
 */
export function promptDiff(before: string, after: string, context = 2): string {
  const a = before.split('\n');
  const b = after.split('\n');

  // LCS table. Prompts are hundreds of lines at most, so the quadratic
  // table is cheaper than any cleverness that could get the answer wrong.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  type Line = { sign: ' ' | '-' | '+'; text: string };
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ sign: ' ', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ sign: '-', text: a[i] });
      i += 1;
    } else {
      lines.push({ sign: '+', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    lines.push({ sign: '-', text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    lines.push({ sign: '+', text: b[j] });
    j += 1;
  }

  // Keep changed lines and `context` unchanged lines around them; mark the
  // gaps so nobody reads the diff as the whole prompt.
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.sign === ' ') return;
    for (let offset = -context; offset <= context; offset += 1) {
      const at = index + offset;
      if (at >= 0 && at < lines.length) keep.add(at);
    }
  });
  if (keep.size === 0) return '(no change)';

  const out: string[] = [];
  let skipping = false;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      if (skipping) {
        out.push('@@');
        skipping = false;
      }
      out.push(`${line.sign}${line.text}`);
    } else {
      skipping = true;
    }
  });
  return out.join('\n');
}
