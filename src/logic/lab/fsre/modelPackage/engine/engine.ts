// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/engine/engine.ts. Do not edit here; re-copy.
/**
 * The formula evaluator.
 *
 * Ported from the reference prototype's `Engine` class (engine lines only; see
 * parser.ts). Semantics follow Excel where the prototype did: a blank cell is
 * zero in arithmetic, a range is only valid inside an aggregate, errors
 * propagate, and a cell that reaches itself evaluates to #CIRC!.
 *
 * Framework-free: no React, no DOM, no package types. The model layer
 * (../model) turns a package into the cell map this class reads.
 */
import { normaliseKey } from './address';
import { parse, rangeKeys, refsOf, type Ast } from './parser';

export type ErrorCode = '#CIRC!' | '#DIV/0!' | '#VALUE!' | '#NAME?' | '#NUM!' | '#ERR!' | '#REF!';
export interface ErrorValue {
  err: ErrorCode;
}
export type Value = number | string | boolean | null | ErrorValue;

export const err = (code: ErrorCode): ErrorValue => ({ err: code });
export const isErr = (v: unknown): v is ErrorValue => !!v && typeof v === 'object' && 'err' in v;
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type EngineCell =
  | { kind: 'value'; value: number | string | boolean | null }
  | { kind: 'formula'; source: string; ast: Ast | null; parseError?: string };

const COMPARISONS = ['=', '<>', '<', '>', '<=', '>='];

/** Builds an engine cell from a formula, keeping a syntax error as the cell's value instead of throwing. */
export function formulaCell(source: string, sheet: string): EngineCell {
  try {
    return { kind: 'formula', source, ast: parse(source, sheet) };
  } catch (e) {
    return { kind: 'formula', source, ast: null, parseError: e instanceof Error ? e.message : String(e) };
  }
}

export class Engine {
  readonly cells: Map<string, EngineCell>;
  private memo = new Map<string, Value>();
  private stack = new Set<string>();

  constructor(cells: Map<string, EngineCell>) {
    this.cells = new Map();
    for (const [k, c] of cells) this.cells.set(normaliseKey(k), c);
  }

  /** The cells a cell reads directly, ranges expanded. Empty for a value cell. */
  refs(key: string): string[] {
    const cell = this.cells.get(normaliseKey(key));
    return cell && cell.kind === 'formula' ? refsOf(cell.ast) : [];
  }

  /** Replaces a value cell's value. Clears the memo; call recalc() or get() afterwards. */
  setValue(key: string, value: number | null): void {
    const k = normaliseKey(key);
    const cell = this.cells.get(k);
    if (!cell || cell.kind !== 'value') throw new Error(`${k} is not a value cell`);
    this.cells.set(k, { kind: 'value', value });
    this.memo = new Map();
  }

  get(key: string): Value {
    const k = normaliseKey(key);
    if (this.memo.has(k)) return this.memo.get(k) as Value;
    const cell = this.cells.get(k);
    if (!cell) return null;
    if (this.stack.has(k)) return err('#CIRC!');
    let v: Value;
    if (cell.kind === 'formula') {
      if (!cell.ast) {
        v = err('#ERR!');
      } else {
        this.stack.add(k);
        try {
          v = this.ev(cell.ast);
        } catch {
          v = err('#ERR!');
        }
        this.stack.delete(k);
        if (typeof v === 'number' && !Number.isFinite(v)) v = err('#NUM!');
      }
    } else {
      v = cell.value;
    }
    this.memo.set(k, v);
    return v;
  }

  /** Evaluates every cell from scratch and returns the values by key. */
  recalc(): Map<string, Value> {
    this.memo = new Map();
    this.stack = new Set();
    for (const k of this.cells.keys()) this.get(k);
    return new Map(this.memo);
  }

  private num(v: Value): number | ErrorValue {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    if (isErr(v)) return v;
    return err('#VALUE!');
  }

  private ev(n: Ast): Value {
    switch (n.t) {
      case 'num':
        return n.v;
      case 'str':
        return n.v;
      case 'ref':
        return this.get(n.key);
      case 'range':
        return err('#VALUE!');
      case 'neg': {
        const x = this.num(this.ev(n.e));
        return isErr(x) ? x : -x;
      }
      case 'bin': {
        if (COMPARISONS.includes(n.op)) {
          let a = this.ev(n.l);
          let b = this.ev(n.r);
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          if (a === null) a = 0;
          if (b === null) b = 0;
          switch (n.op) {
            case '=':
              return a === b;
            case '<>':
              return a !== b;
            case '<':
              return a < b;
            case '>':
              return a > b;
            case '<=':
              return a <= b;
            default:
              return a >= b;
          }
        }
        const a = this.num(this.ev(n.l));
        if (isErr(a)) return a;
        const b = this.num(this.ev(n.r));
        if (isErr(b)) return b;
        switch (n.op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            return b === 0 ? err('#DIV/0!') : a / b;
          case '^':
            return Math.pow(a, b);
          default:
            return err('#ERR!');
        }
      }
      case 'fn':
        return this.fn(n.name, n.args);
      default:
        return err('#ERR!');
    }
  }

  private flat(args: Ast[]): { v: Value; fromRange: boolean }[] {
    const vals: { v: Value; fromRange: boolean }[] = [];
    for (const a of args) {
      if (a.t === 'range') {
        for (const k of rangeKeys(a.a, a.b)) vals.push({ v: this.get(k), fromRange: true });
      } else {
        vals.push({ v: this.ev(a), fromRange: false });
      }
    }
    return vals;
  }

  private fn(name: string, args: Ast[]): Value {
    if (name === 'IF') {
      const c = this.ev(args[0]);
      if (isErr(c)) return c;
      const truthy = c === true || (typeof c === 'number' && c !== 0);
      const branch = truthy ? args[1] : args[2];
      return branch ? this.ev(branch) : false;
    }
    if (name === 'IFERROR') {
      const v = this.ev(args[0]);
      return isErr(v) ? this.ev(args[1]) : v;
    }
    if (name === 'ABS') {
      const x = this.num(this.ev(args[0]));
      return isErr(x) ? x : Math.abs(x);
    }
    if (name === 'SUM' || name === 'AVERAGE' || name === 'MIN' || name === 'MAX') {
      const nums: number[] = [];
      for (const { v, fromRange } of this.flat(args)) {
        if (isErr(v)) return v;
        if (typeof v === 'number') nums.push(v);
        else if (!fromRange && v !== null && typeof v !== 'string') {
          const x = this.num(v);
          if (isErr(x)) return x;
          nums.push(x);
        }
      }
      if (name === 'SUM') return nums.reduce((s, x) => s + x, 0);
      if (!nums.length) return name === 'AVERAGE' ? err('#DIV/0!') : 0;
      if (name === 'AVERAGE') return nums.reduce((s, x) => s + x, 0) / nums.length;
      return name === 'MIN' ? Math.min(...nums) : Math.max(...nums);
    }
    return err('#NAME?');
  }
}
