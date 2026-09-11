// The sandbox language — parser. Produces a plain-object AST the evaluator
// walks. No code generation anywhere: nothing is ever compiled to a host
// function, which is the property that keeps the host unreachable.

import { type Token, tokenize } from './lexer.ts';

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'ident'; name: string; line: number }
  | { t: 'array'; items: Expr[] }
  | { t: 'record'; entries: Array<{ key: string; value: Expr }> }
  | { t: 'unary'; op: '-' | '!'; operand: Expr }
  | { t: 'binary'; op: string; left: Expr; right: Expr; line: number }
  | { t: 'call'; name: string; args: Expr[]; line: number }
  | { t: 'index'; target: Expr; index: Expr; line: number }
  | { t: 'member'; target: Expr; key: string; line: number }
  | { t: 'ternary'; test: Expr; then: Expr; other: Expr };

export type Stmt =
  | { t: 'let'; name: string; value: Expr; line: number }
  | { t: 'assign'; name: string; value: Expr; line: number }
  | { t: 'return'; value: Expr; line: number }
  | { t: 'if'; test: Expr; then: Stmt[]; other: Stmt[] | null; line: number }
  | { t: 'for'; name: string; iterable: Expr; body: Stmt[]; line: number }
  | { t: 'expr'; value: Expr; line: number };

export class ParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`);
    this.name = 'ParseError';
  }
}

const KEYWORDS = new Set(['let', 'return', 'if', 'else', 'for', 'in', 'true', 'false', 'null']);

/** Binding powers. '^' is right-associative (exponent). */
const BINARY_POWER: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
  '^': 7,
};

export function parse(source: string): Stmt[] {
  const tokens = tokenize(source);
  let p = 0;
  const peek = (): Token => tokens[p];
  const at = (kind: Token['kind'], value?: string) =>
    tokens[p].kind === kind && (value === undefined || tokens[p].value === value);
  const next = (): Token => tokens[p++];
  const expect = (kind: Token['kind'], value?: string): Token => {
    if (!at(kind, value)) {
      throw new ParseError(`expected ${value ?? kind}, found ${JSON.stringify(peek().value || peek().kind)}`, peek().line);
    }
    return next();
  };
  const eatSemis = () => { while (at('punct', ';')) next(); };

  function parseBlock(): Stmt[] {
    expect('punct', '{');
    const body: Stmt[] = [];
    eatSemis();
    while (!at('punct', '}')) {
      if (at('eof')) throw new ParseError('unterminated block', peek().line);
      body.push(parseStatement());
      eatSemis();
    }
    expect('punct', '}');
    return body;
  }

  function parseStatement(): Stmt {
    const token = peek();
    if (at('ident', 'let')) {
      next();
      const name = expect('ident').value;
      if (KEYWORDS.has(name)) throw new ParseError(`${name} is a keyword`, token.line);
      expect('op', '=');
      return { t: 'let', name, value: parseExpr(0), line: token.line };
    }
    if (at('ident', 'return')) {
      next();
      return { t: 'return', value: parseExpr(0), line: token.line };
    }
    if (at('ident', 'if')) {
      next();
      const test = parseExpr(0);
      const then = parseBlock();
      let other: Stmt[] | null = null;
      if (at('ident', 'else')) {
        next();
        other = at('ident', 'if') ? [parseStatement()] : parseBlock();
      }
      return { t: 'if', test, then, other, line: token.line };
    }
    if (at('ident', 'for')) {
      next();
      const name = expect('ident').value;
      expect('ident', 'in');
      const iterable = parseExpr(0);
      return { t: 'for', name, iterable, body: parseBlock(), line: token.line };
    }
    if (token.kind === 'ident' && !KEYWORDS.has(token.value) && tokens[p + 1]?.kind === 'op' && tokens[p + 1].value === '=') {
      next();
      next();
      return { t: 'assign', name: token.value, value: parseExpr(0), line: token.line };
    }
    return { t: 'expr', value: parseExpr(0), line: token.line };
  }

  function parsePrimary(): Expr {
    const token = next();
    if (token.kind === 'num') return { t: 'num', v: token.num ?? Number(token.value) };
    if (token.kind === 'str') return { t: 'str', v: token.value };
    if (token.kind === 'op' && (token.value === '-' || token.value === '!')) {
      return { t: 'unary', op: token.value, operand: parseUnaryTarget() };
    }
    if (token.kind === 'punct' && token.value === '(') {
      const inner = parseExpr(0);
      expect('punct', ')');
      return inner;
    }
    if (token.kind === 'punct' && token.value === '[') {
      const items: Expr[] = [];
      while (!at('punct', ']')) {
        items.push(parseExpr(0));
        if (at('punct', ',')) next();
        else break;
      }
      expect('punct', ']');
      return { t: 'array', items };
    }
    if (token.kind === 'punct' && token.value === '{') {
      const entries: Array<{ key: string; value: Expr }> = [];
      while (!at('punct', '}')) {
        const keyToken = next();
        const key = keyToken.kind === 'str' || keyToken.kind === 'ident' ? keyToken.value : null;
        if (key === null) throw new ParseError('record keys are names or strings', keyToken.line);
        expect('punct', ':');
        entries.push({ key, value: parseExpr(0) });
        if (at('punct', ',')) next();
        else break;
      }
      expect('punct', '}');
      return { t: 'record', entries };
    }
    if (token.kind === 'ident') {
      if (token.value === 'true') return { t: 'bool', v: true };
      if (token.value === 'false') return { t: 'bool', v: false };
      if (token.value === 'null') return { t: 'null' };
      if (KEYWORDS.has(token.value)) throw new ParseError(`unexpected keyword ${token.value}`, token.line);
      if (at('punct', '(')) {
        next();
        const args: Expr[] = [];
        while (!at('punct', ')')) {
          args.push(parseExpr(0));
          if (at('punct', ',')) next();
          else break;
        }
        expect('punct', ')');
        return { t: 'call', name: token.value, args, line: token.line };
      }
      return { t: 'ident', name: token.value, line: token.line };
    }
    throw new ParseError(`unexpected ${JSON.stringify(token.value || token.kind)}`, token.line);
  }

  function parseUnaryTarget(): Expr {
    return parsePostfix(parsePrimary());
  }

  function parsePostfix(base: Expr): Expr {
    let target = base;
    for (;;) {
      if (at('punct', '[')) {
        const line = peek().line;
        next();
        const index = parseExpr(0);
        expect('punct', ']');
        target = { t: 'index', target, index, line };
        continue;
      }
      if (at('punct', '.')) {
        const line = peek().line;
        next();
        const key = expect('ident').value;
        target = { t: 'member', target, key, line };
        continue;
      }
      return target;
    }
  }

  function parseExpr(minPower: number): Expr {
    let left = parsePostfix(parsePrimary());
    for (;;) {
      const token = peek();
      if (token.kind === 'op' && BINARY_POWER[token.value] !== undefined) {
        const power = BINARY_POWER[token.value];
        if (power < minPower) return left;
        next();
        const right = parseExpr(token.value === '^' ? power : power + 1);
        left = { t: 'binary', op: token.value, left, right, line: token.line };
        continue;
      }
      if (token.kind === 'punct' && token.value === '?') {
        next();
        const then = parseExpr(0);
        expect('punct', ':');
        const other = parseExpr(0);
        left = { t: 'ternary', test: left, then, other };
        continue;
      }
      return left;
    }
  }

  const program: Stmt[] = [];
  eatSemis();
  while (!at('eof')) {
    program.push(parseStatement());
    eatSemis();
  }
  return program;
}
