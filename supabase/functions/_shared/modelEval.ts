// The first-party model evaluator. HAND-WRITTEN, VERSION-PINNED, and the
// ONLY thing that ever executes a model spec.
//
// A5, absolute: no eval, no new Function, no dynamic import, no subprocess,
// no WASM, no remote execution service. A model spec is DECLARATIVE JSON —
// an arithmetic expression over named parameters plus distribution/scenario
// declarations — and this file is the entire interpreter for it. The spec
// cannot express loops, calls, or side effects, because the grammar below
// cannot parse them.
//
// EVERY CHECK WRITES A ROW, NEVER GOES ABSENT: a failed check is a recorded
// {name, passed:false, detail}, so "the check failed" and "nobody ran the
// check" are distinguishable states forever. checksPassed is the conjunction
// the database stores; the list is the evidence.
//
// DETERMINISM: all randomness flows from mulberry32(seed). Same spec, same
// params, same seed, same EVALUATOR_VERSION ⇒ same result, forever. That is
// what makes a [sim:<result_id>] tag auditable.
//
// Pure TS, no Deno APIs — vitest imports this file directly.

/** Bump on ANY behavioural change; results carry the version that made them. */
export const EVALUATOR_VERSION = 'lab-eval-1';

// ---------------------------------------------------------------------------
// expression grammar: numbers, named params, + - * / ^, parens, unary minus
// ---------------------------------------------------------------------------

type Token =
  | { type: 'num'; value: number }
  | { type: 'name'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' | '(' | ')' };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
    } else if (/[0-9.]/.test(char)) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(expression.slice(index));
      if (!match) throw new Error(`Malformed number at position ${index}.`);
      tokens.push({ type: 'num', value: Number(match[0]) });
      index += match[0].length;
    } else if (/[a-z_]/i.test(char)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(expression.slice(index));
      if (!match) throw new Error(`Malformed name at position ${index}.`);
      tokens.push({ type: 'name', value: match[0] });
      index += match[0].length;
    } else if ('+-*/^()'.includes(char)) {
      tokens.push({ type: 'op', value: char as '+' | '-' | '*' | '/' | '^' | '(' | ')' });
      index += 1;
    } else {
      throw new Error(`The expression grammar has no '${char}' — specs are arithmetic, never code.`);
    }
  }
  return tokens;
}

export type ExprNode =
  | { type: 'num'; value: number }
  | { type: 'param'; name: string }
  | { type: 'neg'; arg: ExprNode }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: ExprNode; right: ExprNode };

/** Recursive descent: expr := term (('+'|'-') term)*; term := factor (('*'|'/') factor)*;
 *  factor := unary ('^' factor)?; unary := '-' unary | atom; atom := num | name | '(' expr ')'. */
export function parseExpression(expression: string): ExprNode {
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const expectOp = (op: string) => {
    const token = take();
    if (!token || token.type !== 'op' || token.value !== op) {
      throw new Error(`Expected '${op}' in the expression.`);
    }
  };
  function atom(): ExprNode {
    const token = take();
    if (!token) throw new Error('The expression ends mid-thought.');
    if (token.type === 'num') return { type: 'num', value: token.value };
    if (token.type === 'name') return { type: 'param', name: token.value };
    if (token.type === 'op' && token.value === '(') {
      const inner = expr();
      expectOp(')');
      return inner;
    }
    throw new Error(`Unexpected '${token.type === 'op' ? token.value : ''}' in the expression.`);
  }
  function unary(): ExprNode {
    const token = peek();
    if (token && token.type === 'op' && token.value === '-') {
      take();
      return { type: 'neg', arg: unary() };
    }
    return atom();
  }
  function factor(): ExprNode {
    const base = unary();
    const token = peek();
    if (token && token.type === 'op' && token.value === '^') {
      take();
      // Right-associative, as exponentiation is.
      return { type: 'bin', op: '^', left: base, right: factor() };
    }
    return base;
  }
  function term(): ExprNode {
    let node = factor();
    for (;;) {
      const token = peek();
      if (token && token.type === 'op' && (token.value === '*' || token.value === '/')) {
        take();
        node = { type: 'bin', op: token.value, left: node, right: factor() };
      } else return node;
    }
  }
  function expr(): ExprNode {
    let node = term();
    for (;;) {
      const token = peek();
      if (token && token.type === 'op' && (token.value === '+' || token.value === '-')) {
        take();
        node = { type: 'bin', op: token.value, left: node, right: term() };
      } else return node;
    }
  }
  const root = expr();
  if (position !== tokens.length) throw new Error('Trailing tokens after the expression.');
  return root;
}

export function evaluateExpression(node: ExprNode, env: ReadonlyMap<string, number>): number {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'param': {
      const value = env.get(node.name);
      if (value === undefined) throw new Error(`Unknown parameter '${node.name}'.`);
      return value;
    }
    case 'neg':
      return -evaluateExpression(node.arg, env);
    case 'bin': {
      const left = evaluateExpression(node.left, env);
      const right = evaluateExpression(node.right, env);
      switch (node.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return left / right;
        case '^': return Math.pow(left, right);
      }
    }
  }
}

export function expressionParams(node: ExprNode, into = new Set<string>()): Set<string> {
  if (node.type === 'param') into.add(node.name);
  else if (node.type === 'neg') expressionParams(node.arg, into);
  else if (node.type === 'bin') {
    expressionParams(node.left, into);
    expressionParams(node.right, into);
  }
  return into;
}

// ---------------------------------------------------------------------------
// unit algebra — symbolic, over the same AST
// ---------------------------------------------------------------------------
//
// A unit string is tokens joined by '*' and '/', each with an optional
// integer '^' exponent: 'IDR', 'IDR/tonne', 'tonne*km', 'IDR/tonne^2'.
// Each distinct token is its own base dimension — the algebra does not know
// physics, it knows bookkeeping: units MULTIPLY through '*', cancel through
// '/', must MATCH across '+'/'-', and the derived result must equal the
// declared output unit. '%' and '' are dimensionless. Conservative: a
// mismatch is a failed check, never a silent coercion.

export type UnitVector = Map<string, number>;

export function parseUnit(unit: string): UnitVector {
  const vector: UnitVector = new Map();
  const trimmed = unit.trim();
  if (trimmed === '' || trimmed === '%') return vector; // dimensionless
  let sign = 1;
  for (const piece of trimmed.split(/(?=[*/])/)) {
    let token = piece.trim();
    if (token.startsWith('*')) { sign = sign; token = token.slice(1).trim(); }
    else if (token.startsWith('/')) { sign = -1 * Math.abs(sign); token = token.slice(1).trim(); }
    // note: '/' applies to THIS token only; reset after applying
    const match = /^([^^]+?)(?:\^(-?\d+))?$/.exec(token);
    if (!match) throw new Error(`Unparseable unit fragment '${token}'.`);
    const name = match[1].trim().toLowerCase();
    const exponent = (match[2] ? Number(match[2]) : 1) * (sign < 0 ? -1 : 1);
    if (name !== '' && name !== '%') {
      vector.set(name, (vector.get(name) ?? 0) + exponent);
      if (vector.get(name) === 0) vector.delete(name);
    }
    sign = 1;
  }
  return vector;
}

function unitAdd(a: UnitVector, b: UnitVector, factor: 1 | -1): UnitVector {
  const out: UnitVector = new Map(a);
  for (const [name, exponent] of b) {
    const next = (out.get(name) ?? 0) + factor * exponent;
    if (next === 0) out.delete(name);
    else out.set(name, next);
  }
  return out;
}

function unitEquals(a: UnitVector, b: UnitVector): boolean {
  if (a.size !== b.size) return false;
  for (const [name, exponent] of a) if (b.get(name) !== exponent) return false;
  return true;
}

export function formatUnit(vector: UnitVector): string {
  if (vector.size === 0) return '(dimensionless)';
  return [...vector.entries()]
    .map(([name, exponent]) => (exponent === 1 ? name : `${name}^${exponent}`))
    .join('*');
}

/**
 * Derives the unit of the expression symbolically. Throws with a named
 * fragment on any illegal combination — the caller records it as a failed
 * unit_algebra check, never lets it pass silently.
 */
export function deriveUnit(node: ExprNode, units: ReadonlyMap<string, UnitVector>): UnitVector {
  switch (node.type) {
    case 'num':
      return new Map();
    case 'param': {
      const unit = units.get(node.name);
      if (!unit) throw new Error(`No unit recorded for parameter '${node.name}'.`);
      return unit;
    }
    case 'neg':
      return deriveUnit(node.arg, units);
    case 'bin': {
      const left = deriveUnit(node.left, units);
      const right = deriveUnit(node.right, units);
      switch (node.op) {
        case '+':
        case '-':
          if (!unitEquals(left, right)) {
            throw new Error(
              `unit mismatch across '${node.op}': ${formatUnit(left)} vs ${formatUnit(right)} — adding unlike quantities is the error this check exists for.`,
            );
          }
          return left;
        case '*':
          return unitAdd(left, right, 1);
        case '/':
          return unitAdd(left, right, -1);
        case '^': {
          if (node.right.type !== 'num' || !Number.isInteger(node.right.value)) {
            if (left.size === 0) return new Map(); // dimensionless^anything
            throw new Error('a dimensioned quantity may only be raised to an integer literal power.');
          }
          const out: UnitVector = new Map();
          for (const [name, exponent] of left) out.set(name, exponent * node.right.value);
          return out;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// deterministic randomness: mulberry32, and the five distributions
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Distribution =
  | { type: 'normal'; mean: number; sd: number }
  | { type: 'lognormal'; mu: number; sigma: number }
  | { type: 'uniform'; min: number; max: number }
  | { type: 'triangular'; min: number; mode: number; max: number }
  | { type: 'pert'; min: number; mode: number; max: number };

function sampleNormal(rng: () => number): number {
  // Box–Muller; guard u1=0.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Marsaglia–Tsang for shape >= 1, with the standard boost below 1. */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    const u = Math.max(rng(), 1e-12);
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = sampleNormal(rng);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = Math.max(rng(), 1e-12);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

export function sampleDistribution(distribution: Distribution, rng: () => number): number {
  switch (distribution.type) {
    case 'normal':
      return distribution.mean + distribution.sd * sampleNormal(rng);
    case 'lognormal':
      return Math.exp(distribution.mu + distribution.sigma * sampleNormal(rng));
    case 'uniform':
      return distribution.min + (distribution.max - distribution.min) * rng();
    case 'triangular': {
      const { min, mode, max } = distribution;
      const u = rng();
      const cut = (mode - min) / (max - min);
      return u < cut
        ? min + Math.sqrt(u * (max - min) * (mode - min))
        : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
    }
    case 'pert': {
      const { min, mode, max } = distribution;
      if (max === min) return min;
      const alpha = 1 + (4 * (mode - min)) / (max - min);
      const beta = 1 + (4 * (max - mode)) / (max - min);
      return min + (max - min) * sampleBeta(alpha, beta, rng);
    }
  }
}

// ---------------------------------------------------------------------------
// the spec, the checks, the evaluation
// ---------------------------------------------------------------------------

export interface ModelParamInput {
  name: string;
  value: number;
  unit: string;
  distribution?: Distribution | null;
}

export interface ModelSpecInput {
  kind: 'expression' | 'monte_carlo' | 'scenario';
  expression: string;
  outputUnit: string;
  bounds?: { min?: number; max?: number };
  /** Declared identities re-checked at evaluation, e.g. total = a + b. */
  identities?: Array<{ left: string; right: string; tolerance?: number }>;
  iterations?: number;
  /** scenario name → parameter overrides. */
  scenarios?: Record<string, Record<string, number>>;
}

export interface EvalCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface EvalOutcome {
  evaluatorVersion: string;
  /** The headline value: point result, MC mean, or the base scenario. */
  value: number | null;
  unit: string;
  summary: Record<string, unknown>;
  checks: EvalCheck[];
  checksPassed: boolean;
  sensitivityPassed: boolean;
}

const MAX_ITERATIONS = 100_000;
const SEED_TOLERANCE = 0.05; // three seeds must agree on the mean within 5%
const PERTURBATION = 0.01; // the 1% smoke test
const ELASTICITY_CAP = 100; // |Δresult|/|result| per 1% input move

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function relDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));
}

function runOnce(
  node: ExprNode,
  params: readonly ModelParamInput[],
  overrides: ReadonlyMap<string, number>,
): number {
  const env = new Map<string, number>();
  for (const param of params) env.set(param.name, overrides.get(param.name) ?? param.value);
  return evaluateExpression(node, env);
}

function monteCarlo(
  node: ExprNode,
  params: readonly ModelParamInput[],
  iterations: number,
  seed: number,
): number[] {
  const rng = mulberry32(seed);
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const env = new Map<string, number>();
    for (const param of params) {
      env.set(param.name, param.distribution ? sampleDistribution(param.distribution, rng) : param.value);
    }
    samples.push(evaluateExpression(node, env));
  }
  return samples;
}

/**
 * Evaluates one spec. NEVER throws on a check failure — failures are rows.
 * Throws only on a malformed spec (unparseable expression / unknown params),
 * which the caller reports as a refusal before anything is recorded.
 */
export function evaluateModelSpec(
  spec: ModelSpecInput,
  params: readonly ModelParamInput[],
  seed: number,
): EvalOutcome {
  const node = parseExpression(spec.expression);
  const wanted = expressionParams(node);
  for (const name of wanted) {
    if (!params.some((param) => param.name === name)) {
      throw new Error(`The expression names parameter '${name}' and the spec does not supply it.`);
    }
  }

  const checks: EvalCheck[] = [];

  // 1. unit algebra, symbolic over the AST.
  try {
    const units = new Map(params.map((param) => [param.name, parseUnit(param.unit)]));
    const derived = deriveUnit(node, units);
    const declared = parseUnit(spec.outputUnit);
    checks.push(
      unitEquals(derived, declared)
        ? { name: 'unit_algebra', passed: true, detail: `derived ${formatUnit(derived)} = declared ${formatUnit(declared)}` }
        : { name: 'unit_algebra', passed: false, detail: `derived ${formatUnit(derived)} ≠ declared ${formatUnit(declared)}` },
    );
  } catch (error) {
    checks.push({ name: 'unit_algebra', passed: false, detail: error instanceof Error ? error.message : 'unit derivation failed' });
  }

  // Evaluate by kind.
  let value: number | null = null;
  const summary: Record<string, unknown> = {};
  const iterations = Math.min(Math.max(spec.iterations ?? 10_000, 100), MAX_ITERATIONS);

  if (spec.kind === 'monte_carlo') {
    const samples = monteCarlo(node, params, iterations, seed).sort((a, b) => a - b);
    const mean = samples.reduce((total, sample) => total + sample, 0) / samples.length;
    value = mean;
    summary.iterations = samples.length;
    summary.mean = mean;
    summary.p5 = quantile(samples, 0.05);
    summary.p50 = quantile(samples, 0.5);
    summary.p95 = quantile(samples, 0.95);
    const bad = samples.filter((sample) => !Number.isFinite(sample)).length;
    checks.push(
      bad === 0
        ? { name: 'finite', passed: true, detail: `${samples.length} samples, all finite` }
        : { name: 'finite', passed: false, detail: `${bad} of ${samples.length} samples are NaN/Inf` },
    );
    // 3-seed convergence: the answer may not belong to the seed.
    const means = [seed + 1, seed + 2].map((otherSeed) => {
      const other = monteCarlo(node, params, iterations, otherSeed);
      return other.reduce((total, sample) => total + sample, 0) / other.length;
    });
    const worst = Math.max(...means.map((other) => relDiff(mean, other)));
    checks.push(
      worst <= SEED_TOLERANCE
        ? { name: 'seed_convergence', passed: true, detail: `3 seeds agree within ${(worst * 100).toFixed(2)}%` }
        : { name: 'seed_convergence', passed: false, detail: `seed means diverge by ${(worst * 100).toFixed(2)}% (> ${SEED_TOLERANCE * 100}%) — the answer belongs to the seed, not the model` },
    );
  } else if (spec.kind === 'scenario') {
    const base = runOnce(node, params, new Map());
    value = base;
    const scenarioValues: Record<string, number> = { base };
    for (const [name, overrides] of Object.entries(spec.scenarios ?? {})) {
      scenarioValues[name] = runOnce(node, params, new Map(Object.entries(overrides)));
    }
    summary.scenarios = scenarioValues;
    const bad = Object.entries(scenarioValues).filter(([, scenarioValue]) => !Number.isFinite(scenarioValue));
    checks.push(
      bad.length === 0
        ? { name: 'finite', passed: true, detail: `${Object.keys(scenarioValues).length} scenarios, all finite` }
        : { name: 'finite', passed: false, detail: `non-finite scenarios: ${bad.map(([name]) => name).join(', ')}` },
    );
  } else {
    value = runOnce(node, params, new Map());
    checks.push(
      Number.isFinite(value)
        ? { name: 'finite', passed: true, detail: `result ${value}` }
        : { name: 'finite', passed: false, detail: `result is ${value}` },
    );
  }

  // bounds, when declared.
  if (spec.bounds && value !== null) {
    const { min, max } = spec.bounds;
    const inBounds =
      Number.isFinite(value) && (min === undefined || value >= min) && (max === undefined || value <= max);
    checks.push({
      name: 'bounds',
      passed: inBounds,
      detail: inBounds
        ? `${value} within [${min ?? '-∞'}, ${max ?? '∞'}]`
        : `${value} outside declared [${min ?? '-∞'}, ${max ?? '∞'}]`,
    });
  }

  // declared identities, re-checked at base parameters.
  for (const identity of spec.identities ?? []) {
    try {
      const leftValue = runOnce(parseExpression(identity.left), params, new Map());
      const rightValue = runOnce(parseExpression(identity.right), params, new Map());
      const tolerance = identity.tolerance ?? 1e-6;
      const holds = relDiff(leftValue, rightValue) <= tolerance;
      checks.push({
        name: 'identity',
        passed: holds,
        detail: `${identity.left} = ${identity.right}: ${leftValue} vs ${rightValue}${holds ? '' : ' — the declared identity does not hold at these parameters'}`,
      });
    } catch (error) {
      checks.push({
        name: 'identity',
        passed: false,
        detail: `${identity.left} = ${identity.right}: ${error instanceof Error ? error.message : 'unevaluable'}`,
      });
    }
  }

  // The 1% perturbation smoke test → sensitivity_passed. Each input moves
  // +1% alone; the result must stay finite and move by a bounded factor.
  // This is a smoke test for singularities, not an elasticity study.
  let sensitivityPassed = true;
  const perturbations: Record<string, number> = {};
  const baseline = value;
  if (baseline !== null && Number.isFinite(baseline)) {
    for (const param of params) {
      if (!wanted.has(param.name)) continue;
      const moved = runOnce(node, params, new Map([[param.name, param.value * (1 + PERTURBATION) || PERTURBATION]]));
      // Relative to the BASELINE, deliberately: a blowup or sign flip across
      // a singularity must register even when max(|a|,|b|) would hide it.
      const change = Math.abs(moved - baseline) / Math.max(1e-12, Math.abs(baseline));
      perturbations[param.name] = change;
      if (!Number.isFinite(moved) || change > PERTURBATION * ELASTICITY_CAP) {
        sensitivityPassed = false;
      }
    }
  } else {
    sensitivityPassed = false;
  }
  checks.push({
    name: 'perturbation_1pct',
    passed: sensitivityPassed,
    detail: sensitivityPassed
      ? 'no 1% input move breaks or unboundedly swings the result'
      : `a 1% input move produced a non-finite or > ${ELASTICITY_CAP}× swing: ${JSON.stringify(perturbations)}`,
  });
  summary.perturbations = perturbations;

  return {
    evaluatorVersion: EVALUATOR_VERSION,
    value: value !== null && Number.isFinite(value) ? value : null,
    unit: spec.outputUnit,
    summary,
    checks,
    checksPassed: checks.every((check) => check.passed),
    sensitivityPassed,
  };
}
