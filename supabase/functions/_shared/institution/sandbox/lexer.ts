// The sandbox language — tokeniser.
//
// WHY A LANGUAGE AND NOT A JS SANDBOX. B-7 requires execution with no
// network access from inside. Every way of running JavaScript inside this
// runtime keeps a path to the host: `eval` and `new Function` inherit the
// enclosing scope and globalThis (and _shared/modelEval.ts rule A5 already
// forbids them for exactly this reason); a Worker in the edge runtime still
// carries `fetch`; a WASM interpreter would have to be vendored as a binary
// blob that nothing in this repo can audit. So the sandbox executes a small
// language of its own: no host bindings exist to reach, which makes "no
// network" a property of the grammar rather than a permission we hope holds.
// The cost is that a script is not JavaScript; the gain is that the only
// functions reachable are the ones in stdlib.ts, and the proof is a test
// that calls fetch() inside a script and is told there is no such function.
//
// The grammar, in full:
//   program    := statement*
//   statement  := 'let' IDENT '=' expr | 'return' expr | 'if' expr block ('else' block)?
//               | 'for' IDENT 'in' expr block | IDENT '=' expr | expr
//   expr       := ternary over || && == != < <= > >= + - * / % ^ unary(-!)
//               | call | index | member | literal | array | record | '(' expr ')'
// Comments: '#' to end of line. No user functions, no while, no closures —
// every loop is bounded by the array it walks, so a script cannot spin.

export type TokenKind = 'num' | 'str' | 'ident' | 'op' | 'punct' | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  num?: number;
  pos: number;
  line: number;
}

const OPERATORS = [
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '->',
  '+', '-', '*', '/', '%', '^', '<', '>', '=', '!',
];
const PUNCT = ['(', ')', '[', ']', '{', '}', ',', ':', ';', '?'];

export class LexError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`);
    this.name = 'LexError';
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const push = (kind: TokenKind, value: string, num?: number, pos = i) =>
    tokens.push({ kind, value, num, pos, line });

  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
    if (ch === '#') { while (i < source.length && source[i] !== '\n') i += 1; continue; }
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < source.length && /[0-9_]/.test(source[i])) i += 1;
      if (source[i] === '.' && /[0-9]/.test(source[i + 1] ?? '')) {
        i += 1;
        while (i < source.length && /[0-9_]/.test(source[i])) i += 1;
      }
      if (source[i] === 'e' || source[i] === 'E') {
        const save = i;
        i += 1;
        if (source[i] === '+' || source[i] === '-') i += 1;
        if (/[0-9]/.test(source[i] ?? '')) { while (i < source.length && /[0-9]/.test(source[i])) i += 1; }
        else i = save;
      }
      const raw = source.slice(start, i).replace(/_/g, '');
      push('num', raw, Number(raw), start);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i += 1;
      let out = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          const next = source[i + 1];
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next ?? '';
          i += 2;
          continue;
        }
        if (source[i] === '\n') line += 1;
        out += source[i];
        i += 1;
      }
      if (i >= source.length) throw new LexError('unterminated string', line);
      i += 1;
      push('str', out, undefined, start);
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i += 1;
      push('ident', source.slice(start, i), undefined, start);
      continue;
    }
    if (ch === '.') {
      push('punct', '.', undefined, i);
      i += 1;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) { push('op', op, undefined, i); i += op.length; continue; }
    if (PUNCT.includes(ch)) { push('punct', ch, undefined, i); i += 1; continue; }
    throw new LexError(`unexpected character ${JSON.stringify(ch)}`, line);
  }
  tokens.push({ kind: 'eof', value: '', pos: source.length, line });
  return tokens;
}
