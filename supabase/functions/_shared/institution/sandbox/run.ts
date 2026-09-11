// The sandbox evaluator — B-7's execution, with the properties B-7 requires:
//
//   no network        the only callables are stdlib.ts; there is no binding
//                     to fetch, Deno, globalThis, require or import, and a
//                     script naming one is told the function does not exist.
//   corpus-addressed  inputs arrive as `inputs`, a record the CALLER builds
//                     from corpus records it has verified by hash. A script
//                     cannot read anything else.
//   reproducible      deterministic: seeded PRNG, no clock, no I/O. The same
//                     script, inputs and seed produce the same result, which
//                     is why the result carries all three.
//   bounded           a step budget and a wall-clock deadline; loops iterate
//                     over materialised lists, so a script cannot spin.
//
// The result is a value plus everything needed to re-derive it. The caller
// writes that into a corpus record of kind 'execution'.

import { parse, ParseError, type Expr, type Stmt } from './parser.ts';
import { LexError } from './lexer.ts';
import { buildStdlib, makeRandom, SandboxError, STDLIB_NAMES, STDLIB_VERSION, type StdlibHost, type Value } from './stdlib.ts';

export interface SandboxLimits {
  steps: number;
  timeMs: number;
  outputBytes: number;
}

export const DEFAULT_LIMITS: SandboxLimits = { steps: 2_000_000, timeMs: 5_000, outputBytes: 256_000 };

export interface SandboxRequest {
  script: string;
  inputs: Record<string, Value>;
  seed?: number;
  limits?: Partial<SandboxLimits>;
  /** Wall clock, injected so tests are deterministic and the sandbox has no clock of its own. */
  now?: () => number;
}

export interface SandboxSuccess {
  ok: true;
  value: Value;
  logs: string[];
  steps: number;
  runtimeMs: number;
  seed: number;
  stdlibVersion: string;
}

export interface SandboxFailure {
  ok: false;
  error: string;
  kind: 'parse' | 'runtime' | 'limit';
  logs: string[];
  steps: number;
  runtimeMs: number;
  seed: number;
  stdlibVersion: string;
}

export type SandboxOutcome = SandboxSuccess | SandboxFailure;

class LimitError extends Error {}
class ReturnSignal extends Error {
  constructor(readonly value: Value) {
    super('return');
  }
}

const isRecord = (value: Value): value is { [key: string]: Value } =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function truthy(value: Value): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function equals(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equals(x, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    return ak.length === bk.length && ak.every((k, i) => k === bk[i] && equals(a[k], b[k]));
  }
  return false;
}

export function runSandbox(request: SandboxRequest): SandboxOutcome {
  const limits: SandboxLimits = { ...DEFAULT_LIMITS, ...(request.limits ?? {}) };
  const seed = Number.isFinite(request.seed) ? Math.trunc(request.seed as number) : 1;
  const now = request.now ?? (() => Date.now());
  const started = now();
  const logs: string[] = [];
  let steps = 0;
  const stdlib = buildStdlib();
  const random = makeRandom(seed);

  const charge = (amount: number) => {
    steps += amount;
    if (steps > limits.steps) throw new LimitError(`step budget exhausted (${limits.steps})`);
    if ((steps & 0x3ff) === 0 && now() - started > limits.timeMs) {
      throw new LimitError(`time budget exhausted (${limits.timeMs} ms)`);
    }
  };
  const host: StdlibHost = {
    random,
    charge,
    log: (line) => {
      if (logs.length < 200) logs.push(line);
    },
  };

  const finish = (): { runtimeMs: number } => ({ runtimeMs: Math.max(0, now() - started) });

  let program: Stmt[];
  try {
    program = parse(request.script);
  } catch (error) {
    const message = error instanceof ParseError || error instanceof LexError ? error.message : String(error);
    return { ok: false, error: message, kind: 'parse', logs, steps, ...finish(), seed, stdlibVersion: STDLIB_VERSION };
  }

  // The one and only scope chain: a frame stack of plain Maps. `inputs` is
  // frozen at the bottom; a script may read it and may not replace it.
  const globals = new Map<string, Value>();
  globals.set('inputs', request.inputs as Value);
  const scopes: Array<Map<string, Value>> = [globals];

  const lookup = (name: string): Value => {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      const frame = scopes[i];
      if (frame.has(name)) return frame.get(name) as Value;
    }
    throw new SandboxError(`unknown name ${name}`);
  };
  const assign = (name: string, value: Value): void => {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      if (scopes[i].has(name)) {
        scopes[i].set(name, value);
        return;
      }
    }
    throw new SandboxError(`unknown name ${name} — declare it with let`);
  };

  function evaluate(node: Expr): Value {
    charge(1);
    switch (node.t) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'bool': return node.v;
      case 'null': return null;
      case 'ident': {
        if (node.name === 'inputs') return request.inputs as Value;
        return lookup(node.name);
      }
      case 'array': return node.items.map(evaluate);
      case 'record': {
        const out: { [key: string]: Value } = {};
        for (const entry of node.entries) out[entry.key] = evaluate(entry.value);
        return out;
      }
      case 'unary': {
        const operand = evaluate(node.operand);
        if (node.op === '!') return !truthy(operand);
        if (typeof operand !== 'number') throw new SandboxError('unary minus needs a number');
        return -operand;
      }
      case 'ternary': return truthy(evaluate(node.test)) ? evaluate(node.then) : evaluate(node.other);
      case 'binary': {
        if (node.op === '&&') return truthy(evaluate(node.left)) ? evaluate(node.right) : false;
        if (node.op === '||') {
          const left = evaluate(node.left);
          return truthy(left) ? left : evaluate(node.right);
        }
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        switch (node.op) {
          case '==': case '===': return equals(left, right);
          case '!=': case '!==': return !equals(left, right);
          case '+':
            if (typeof left === 'string' || typeof right === 'string') {
              return `${typeof left === 'string' ? left : JSON.stringify(left)}${typeof right === 'string' ? right : JSON.stringify(right)}`;
            }
            if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
            break;
          default: break;
        }
        if (typeof left !== 'number' || typeof right !== 'number') {
          throw new SandboxError(`line ${node.line}: operator ${node.op} needs numbers`);
        }
        switch (node.op) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/': return right === 0 ? Number.NaN : left / right;
          case '%': return right === 0 ? Number.NaN : left % right;
          case '^': return left ** right;
          case '<': return left < right;
          case '<=': return left <= right;
          case '>': return left > right;
          case '>=': return left >= right;
          default: throw new SandboxError(`line ${node.line}: unknown operator ${node.op}`);
        }
      }
      case 'index': {
        const target = evaluate(node.target);
        const index = evaluate(node.index);
        if (Array.isArray(target)) {
          if (typeof index !== 'number' || !Number.isInteger(index)) {
            throw new SandboxError(`line ${node.line}: a list index must be an integer`);
          }
          const at = index < 0 ? target.length + index : index;
          if (at < 0 || at >= target.length) throw new SandboxError(`line ${node.line}: index ${index} is out of range (length ${target.length})`);
          return target[at];
        }
        if (isRecord(target)) {
          if (typeof index !== 'string') throw new SandboxError(`line ${node.line}: a record key must be a string`);
          return index in target ? target[index] : null;
        }
        if (typeof target === 'string') {
          if (typeof index !== 'number') throw new SandboxError(`line ${node.line}: a string index must be a number`);
          return target.slice(index, index + 1);
        }
        throw new SandboxError(`line ${node.line}: cannot index this value`);
      }
      case 'member': {
        const target = evaluate(node.target);
        if (isRecord(target)) return node.key in target ? target[node.key] : null;
        if (Array.isArray(target) && node.key === 'length') return target.length;
        if (typeof target === 'string' && node.key === 'length') return target.length;
        throw new SandboxError(`line ${node.line}: ${node.key} is not a field of this value`);
      }
      case 'call': {
        const fn = stdlib[node.name];
        if (!fn) {
          throw new SandboxError(
            `line ${node.line}: there is no function ${node.name} in the sandbox. The sandbox has no network, no filesystem and no host access; available functions: ${STDLIB_NAMES.join(', ')}.`,
          );
        }
        const args = node.args.map(evaluate);
        charge(2);
        return fn(args, host);
      }
      default: throw new SandboxError('unsupported expression');
    }
  }

  function execute(statements: Stmt[]): void {
    for (const statement of statements) {
      charge(1);
      switch (statement.t) {
        case 'let': {
          const frame = scopes[scopes.length - 1];
          if (statement.name === 'inputs') throw new SandboxError(`line ${statement.line}: inputs is read-only`);
          frame.set(statement.name, evaluate(statement.value));
          break;
        }
        case 'assign': {
          if (statement.name === 'inputs') throw new SandboxError(`line ${statement.line}: inputs is read-only`);
          assign(statement.name, evaluate(statement.value));
          break;
        }
        case 'return': throw new ReturnSignal(evaluate(statement.value));
        case 'expr': evaluate(statement.value); break;
        case 'if': {
          if (truthy(evaluate(statement.test))) {
            scopes.push(new Map());
            try { execute(statement.then); } finally { scopes.pop(); }
          } else if (statement.other) {
            scopes.push(new Map());
            try { execute(statement.other); } finally { scopes.pop(); }
          }
          break;
        }
        case 'for': {
          const iterable = evaluate(statement.iterable);
          if (!Array.isArray(iterable)) throw new SandboxError(`line ${statement.line}: for iterates a list`);
          for (const item of iterable) {
            charge(1);
            const frame = new Map<string, Value>();
            frame.set(statement.name, item);
            scopes.push(frame);
            try { execute(statement.body); } finally { scopes.pop(); }
          }
          break;
        }
        default: throw new SandboxError('unsupported statement');
      }
    }
  }

  try {
    execute(program);
    return { ok: true, value: null, logs, steps, ...finish(), seed, stdlibVersion: STDLIB_VERSION };
  } catch (error) {
    if (error instanceof ReturnSignal) {
      const encoded = JSON.stringify(error.value ?? null);
      if (encoded && encoded.length > limits.outputBytes) {
        return {
          ok: false,
          error: `result is ${encoded.length} bytes, over the ${limits.outputBytes}-byte cap`,
          kind: 'limit',
          logs, steps, ...finish(), seed, stdlibVersion: STDLIB_VERSION,
        };
      }
      return { ok: true, value: error.value, logs, steps, ...finish(), seed, stdlibVersion: STDLIB_VERSION };
    }
    if (error instanceof LimitError) {
      return { ok: false, error: error.message, kind: 'limit', logs, steps, ...finish(), seed, stdlibVersion: STDLIB_VERSION };
    }
    const message = error instanceof SandboxError ? error.message : error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, kind: 'runtime', logs, steps, ...finish(), seed, stdlibVersion: STDLIB_VERSION };
  }
}

export { STDLIB_NAMES, STDLIB_VERSION };
export type { Value };
