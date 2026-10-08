// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/engine/parser.ts. Do not edit here; re-copy.
/**
 * Formula tokenizer and parser.
 *
 * Ported from the reference prototype (fsre-skills,
 * docs/company-models/reference/ptba-model-prototype.html, the engine lines
 * between the ENGINE markers). Only the engine was taken; none of the
 * prototype's data. Changes from the prototype: TypeScript types, sheet names
 * normalised to lower case in keys, `$` anchors accepted on both sides of a
 * sheet-qualified reference, and errors raised as FormulaSyntaxError.
 *
 * Grammar, loosest binding first:
 *   comparison  =  <>  <  >  <=  >=
 *   additive    +  -
 *   multiplicative  *  /
 *   power       ^          (left-associative, as in Excel)
 *   unary       -  +
 *   primary     number | "string" | reference | range | FN(args) | ( expr )
 */
import { cellKey, colIndex, colLetter, normaliseSheet } from './address';

export class FormulaSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaSyntaxError';
  }
}

interface RefToken {
  t: 'ref';
  sheet: string;
  /** True when the sheet was written in the reference. */
  qualified: boolean;
  col: string;
  row: number;
  key: string;
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | RefToken
  | { t: 'fn'; v: string }
  | { t: 'op'; v: string };

export type Ast =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; key: string }
  | { t: 'range'; a: RefToken; b: RefToken }
  | { t: 'neg'; e: Ast }
  | { t: 'bin'; op: string; l: Ast; r: Ast }
  | { t: 'fn'; name: string; args: Ast[] };

const COMPARISONS = ['=', '<>', '<', '>', '<=', '>='];

function tokenize(src: string, ctx: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ') {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      if (j >= src.length) throw new FormulaSyntaxError('Unterminated string');
      toks.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\d+(\.\d+)?/.exec(rest))) {
      toks.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if ((m = /^(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))!\$?([A-Z]{1,3})\$?(\d+)/.exec(rest))) {
      const sheet = normaliseSheet(m[1] ?? m[2]);
      const row = Number(m[4]);
      toks.push({ t: 'ref', sheet, qualified: true, col: m[3], row, key: cellKey(sheet, m[3], row) });
      i += m[0].length;
      continue;
    }
    if ((m = /^[A-Z]+(?=\()/.exec(rest))) {
      toks.push({ t: 'fn', v: m[0] });
      i += m[0].length;
      continue;
    }
    if ((m = /^\$?([A-Z]{1,3})\$?(\d+)/.exec(rest))) {
      const row = Number(m[2]);
      toks.push({ t: 'ref', sheet: ctx, qualified: false, col: m[1], row, key: cellKey(ctx, m[1], row) });
      i += m[0].length;
      continue;
    }
    if ((m = /^(<=|>=|<>|[+\-*/^(),:=<>])/.exec(rest))) {
      toks.push({ t: 'op', v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new FormulaSyntaxError(`Bad character ${ch}`);
  }
  return toks;
}

/**
 * Parses a formula. A leading `=` is allowed and ignored. `ctx` is the sheet
 * the formula lives on, which unqualified references resolve to.
 */
export function parse(source: string, ctx: string): Ast {
  const body = source.startsWith('=') ? source.slice(1) : source;
  const sheet = normaliseSheet(ctx);
  const toks = tokenize(body, sheet);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v: string) => {
    const tk = peek();
    return !!tk && tk.t === 'op' && tk.v === v;
  };
  const inOps = (ops: string[]) => {
    const tk = peek();
    return !!tk && tk.t === 'op' && ops.includes(tk.v);
  };

  const expr = (): Ast => cmp();
  function cmp(): Ast {
    let l = add();
    while (inOps(COMPARISONS)) {
      const op = (next() as { v: string }).v;
      l = { t: 'bin', op, l, r: add() };
    }
    return l;
  }
  function add(): Ast {
    let l = mul();
    while (inOps(['+', '-'])) {
      const op = (next() as { v: string }).v;
      l = { t: 'bin', op, l, r: mul() };
    }
    return l;
  }
  function mul(): Ast {
    let l = pw();
    while (inOps(['*', '/'])) {
      const op = (next() as { v: string }).v;
      l = { t: 'bin', op, l, r: pw() };
    }
    return l;
  }
  function pw(): Ast {
    let l = un();
    while (isOp('^')) {
      next();
      l = { t: 'bin', op: '^', l, r: un() };
    }
    return l;
  }
  function un(): Ast {
    if (isOp('-')) {
      next();
      return { t: 'neg', e: un() };
    }
    if (isOp('+')) {
      next();
      return un();
    }
    return prim();
  }
  function prim(): Ast {
    const tk = next();
    if (!tk) throw new FormulaSyntaxError('Unexpected end');
    if (tk.t === 'num') return { t: 'num', v: tk.v };
    if (tk.t === 'str') return { t: 'str', v: tk.v };
    if (tk.t === 'ref') {
      if (isOp(':')) {
        next();
        const b = next();
        if (!b || b.t !== 'ref') throw new FormulaSyntaxError('Bad range');
        // An unqualified end of a range lives on the start's sheet.
        const end: RefToken = b.qualified ? b : { ...b, sheet: tk.sheet, key: cellKey(tk.sheet, b.col, b.row) };
        return { t: 'range', a: tk, b: end };
      }
      return { t: 'ref', key: tk.key };
    }
    if (tk.t === 'fn') {
      next(); // the opening parenthesis, guaranteed by the lookahead
      const args: Ast[] = [];
      if (!isOp(')')) {
        args.push(expr());
        while (isOp(',')) {
          next();
          args.push(expr());
        }
      }
      if (!isOp(')')) throw new FormulaSyntaxError('Missing )');
      next();
      return { t: 'fn', name: tk.v, args };
    }
    if (tk.t === 'op' && tk.v === '(') {
      const e = expr();
      if (!isOp(')')) throw new FormulaSyntaxError('Missing )');
      next();
      return e;
    }
    throw new FormulaSyntaxError(`Unexpected ${tk.v}`);
  }

  const ast = expr();
  if (p < toks.length) throw new FormulaSyntaxError('Trailing input');
  return ast;
}

/** Every cell key a range covers, column by column. */
export function rangeKeys(a: RefToken, b: RefToken): string[] {
  const c1 = colIndex(a.col);
  const c2 = colIndex(b.col);
  const out: string[] = [];
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
      out.push(cellKey(a.sheet, colLetter(c), r));
    }
  }
  return out;
}

/** Every cell key a formula reads, ranges expanded, in order of appearance. */
export function refsOf(ast: Ast | null | undefined, out: string[] = []): string[] {
  if (!ast) return out;
  switch (ast.t) {
    case 'ref':
      out.push(ast.key);
      break;
    case 'range':
      out.push(...rangeKeys(ast.a, ast.b));
      break;
    case 'bin':
      refsOf(ast.l, out);
      refsOf(ast.r, out);
      break;
    case 'neg':
      refsOf(ast.e, out);
      break;
    case 'fn':
      ast.args.forEach((a) => refsOf(a, out));
      break;
    default:
      break;
  }
  return out;
}
