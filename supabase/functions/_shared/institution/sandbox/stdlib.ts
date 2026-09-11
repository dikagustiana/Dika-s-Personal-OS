// The sandbox standard library — the ONLY functions a script can reach.
// There is no host binding here: no fetch, no Deno, no globalThis, no
// require, no import. A script asking for one is told the function does not
// exist, which is the no-network guarantee B-7 asks for, proved by attempt
// in src/logic/institution/sandbox.test.ts.
//
// Everything is deterministic. Randomness comes from a seeded generator, so
// a Monte Carlo run re-executes to the same numbers from the recorded script
// and seed — otherwise the result is not reproducible and, per B-7, not a
// result.

export const STDLIB_VERSION = 'institution-stdlib@1.0.0';

export type Value = number | string | boolean | null | Value[] | { [key: string]: Value };

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

const num = (value: Value, fn: string, position: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SandboxError(`${fn}: argument ${position + 1} must be a finite number`);
  }
  return value;
};

const arr = (value: Value, fn: string, position: number): Value[] => {
  if (!Array.isArray(value)) throw new SandboxError(`${fn}: argument ${position + 1} must be a list`);
  return value;
};

const numbers = (value: Value, fn: string, position: number): number[] =>
  arr(value, fn, position).map((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new SandboxError(`${fn}: element ${index} of argument ${position + 1} is not a finite number`);
    }
    return entry;
  });

/** Deterministic PRNG: mulberry32 over a 32-bit seed derived from the script's seed argument. */
export function makeRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StdlibHost {
  random: () => number;
  /** Bumped per call so a script cannot hide an unbounded loop inside a library call. */
  charge: (steps: number) => void;
  log: (line: string) => void;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function quantileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

function linreg(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number; n: number; stderr: number } {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i += 1) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const r2 = syy === 0 ? 1 : 1 - sse / syy;
  const stderr = n > 2 ? Math.sqrt(sse / (n - 2)) : Number.NaN;
  return { slope, intercept, r2, n, stderr };
}

type Fn = (args: Value[], host: StdlibHost) => Value;

export function buildStdlib(): Record<string, Fn> {
  const lib: Record<string, Fn> = {
    // ---- arithmetic ------------------------------------------------------
    abs: (a) => Math.abs(num(a[0], 'abs', 0)),
    round: (a) => {
      const digits = a.length > 1 ? num(a[1], 'round', 1) : 0;
      const factor = 10 ** digits;
      return Math.round(num(a[0], 'round', 0) * factor) / factor;
    },
    floor: (a) => Math.floor(num(a[0], 'floor', 0)),
    ceil: (a) => Math.ceil(num(a[0], 'ceil', 0)),
    sqrt: (a) => Math.sqrt(num(a[0], 'sqrt', 0)),
    exp: (a) => Math.exp(num(a[0], 'exp', 0)),
    ln: (a) => Math.log(num(a[0], 'ln', 0)),
    log10: (a) => Math.log10(num(a[0], 'log10', 0)),
    pow: (a) => num(a[0], 'pow', 0) ** num(a[1], 'pow', 1),
    min: (a) => Math.min(...a.map((v, i) => num(v, 'min', i))),
    max: (a) => Math.max(...a.map((v, i) => num(v, 'max', i))),
    clamp: (a) => Math.min(Math.max(num(a[0], 'clamp', 0), num(a[1], 'clamp', 1)), num(a[2], 'clamp', 2)),

    // ---- lists -----------------------------------------------------------
    len: (a) => (Array.isArray(a[0]) ? a[0].length : typeof a[0] === 'string' ? a[0].length : (() => { throw new SandboxError('len: argument 1 must be a list or string'); })()),
    range: (a, host) => {
      const start = num(a[0], 'range', 0);
      const end = a.length > 1 ? num(a[1], 'range', 1) : null;
      const step = a.length > 2 ? num(a[2], 'range', 2) : 1;
      const from = end === null ? 0 : start;
      const to = end === null ? start : end;
      if (step === 0) throw new SandboxError('range: step may not be 0');
      const count = Math.max(0, Math.ceil((to - from) / step));
      if (count > 100_000) throw new SandboxError(`range: ${count} elements exceeds the 100000 cap`);
      host.charge(count);
      const out: Value[] = [];
      for (let i = 0; i < count; i += 1) out.push(from + i * step);
      return out;
    },
    push: (a) => [...arr(a[0], 'push', 0), a[1]],
    concat: (a) => [...arr(a[0], 'concat', 0), ...arr(a[1], 'concat', 1)],
    slice: (a) => arr(a[0], 'slice', 0).slice(num(a[1], 'slice', 1), a.length > 2 ? num(a[2], 'slice', 2) : undefined),
    sort: (a, host) => {
      const xs = numbers(a[0], 'sort', 0);
      host.charge(xs.length);
      return [...xs].sort((x, y) => x - y);
    },
    reverse: (a) => [...arr(a[0], 'reverse', 0)].reverse(),
    get: (a) => {
      const record = a[0];
      if (record === null || typeof record !== 'object' || Array.isArray(record)) {
        throw new SandboxError('get: argument 1 must be a record');
      }
      const key = a[1];
      if (typeof key !== 'string') throw new SandboxError('get: argument 2 must be a string');
      return key in record ? record[key] : (a.length > 2 ? a[2] : null);
    },
    keys: (a) => {
      const record = a[0];
      if (record === null || typeof record !== 'object' || Array.isArray(record)) {
        throw new SandboxError('keys: argument 1 must be a record');
      }
      return Object.keys(record).sort();
    },
    column: (a, host) => {
      const rows = arr(a[0], 'column', 0);
      const key = a[1];
      if (typeof key !== 'string') throw new SandboxError('column: argument 2 must be a string');
      host.charge(rows.length);
      return rows.map((row, index) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) {
          throw new SandboxError(`column: row ${index} is not a record`);
        }
        return key in row ? row[key] : null;
      });
    },

    // ---- descriptive statistics -----------------------------------------
    sum: (a, host) => { const xs = numbers(a[0], 'sum', 0); host.charge(xs.length); return xs.reduce((x, y) => x + y, 0); },
    mean: (a, host) => { const xs = numbers(a[0], 'mean', 0); host.charge(xs.length); if (xs.length === 0) throw new SandboxError('mean: empty list'); return mean(xs); },
    median: (a, host) => { const xs = numbers(a[0], 'median', 0); host.charge(xs.length); if (xs.length === 0) throw new SandboxError('median: empty list'); return quantileOf([...xs].sort((x, y) => x - y), 0.5); },
    stdev: (a, host) => {
      const xs = numbers(a[0], 'stdev', 0);
      host.charge(xs.length);
      if (xs.length < 2) throw new SandboxError('stdev: needs at least 2 values');
      const m = mean(xs);
      return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
    },
    variance: (a, host) => {
      const xs = numbers(a[0], 'variance', 0);
      host.charge(xs.length);
      if (xs.length < 2) throw new SandboxError('variance: needs at least 2 values');
      const m = mean(xs);
      return xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
    },
    quantile: (a, host) => {
      const xs = numbers(a[0], 'quantile', 0);
      host.charge(xs.length);
      const q = num(a[1], 'quantile', 1);
      if (q < 0 || q > 1) throw new SandboxError('quantile: q is between 0 and 1');
      return quantileOf([...xs].sort((x, y) => x - y), q);
    },
    correl: (a, host) => {
      const xs = numbers(a[0], 'correl', 0);
      const ys = numbers(a[1], 'correl', 1);
      if (xs.length !== ys.length) throw new SandboxError('correl: lists differ in length');
      host.charge(xs.length);
      const mx = mean(xs);
      const my = mean(ys);
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < xs.length; i += 1) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
      }
      return sxx === 0 || syy === 0 ? Number.NaN : sxy / Math.sqrt(sxx * syy);
    },
    cagr: (a) => {
      const start = num(a[0], 'cagr', 0);
      const end = num(a[1], 'cagr', 1);
      const years = num(a[2], 'cagr', 2);
      if (start <= 0 || years <= 0) throw new SandboxError('cagr: start and years must be positive');
      return (end / start) ** (1 / years) - 1;
    },
    growth: (a, host) => {
      const xs = numbers(a[0], 'growth', 0);
      host.charge(xs.length);
      const out: Value[] = [];
      for (let i = 1; i < xs.length; i += 1) out.push(xs[i - 1] === 0 ? Number.NaN : xs[i] / xs[i - 1] - 1);
      return out;
    },

    // ---- regression, time series, finance --------------------------------
    regress: (a, host) => {
      const xs = numbers(a[0], 'regress', 0);
      const ys = numbers(a[1], 'regress', 1);
      if (xs.length !== ys.length) throw new SandboxError('regress: lists differ in length');
      if (xs.length < 3) throw new SandboxError('regress: needs at least 3 points');
      host.charge(xs.length * 3);
      const fit = linreg(xs, ys);
      return { slope: fit.slope, intercept: fit.intercept, r2: fit.r2, n: fit.n, stderr: fit.stderr };
    },
    forecast: (a, host) => {
      const ys = numbers(a[0], 'forecast', 0);
      const ahead = num(a[1], 'forecast', 1);
      if (ys.length < 3) throw new SandboxError('forecast: needs at least 3 observations');
      if (ahead < 1 || ahead > 100) throw new SandboxError('forecast: ahead is between 1 and 100');
      host.charge(ys.length + ahead * 3);
      const xs = ys.map((_, index) => index);
      const fit = linreg(xs, ys);
      const points: Value[] = [];
      for (let i = 1; i <= ahead; i += 1) {
        const x = ys.length - 1 + i;
        const point = fit.intercept + fit.slope * x;
        const halfWidth = Number.isFinite(fit.stderr) ? 1.96 * fit.stderr : Number.NaN;
        points.push({ t: x, point, low: point - halfWidth, high: point + halfWidth });
      }
      return { method: 'ols-trend', slope: fit.slope, intercept: fit.intercept, r2: fit.r2, stderr: fit.stderr, points };
    },
    movingAverage: (a, host) => {
      const xs = numbers(a[0], 'movingAverage', 0);
      const window = num(a[1], 'movingAverage', 1);
      if (window < 1 || !Number.isInteger(window)) throw new SandboxError('movingAverage: window is a positive integer');
      host.charge(xs.length);
      const out: Value[] = [];
      for (let i = window - 1; i < xs.length; i += 1) out.push(mean(xs.slice(i - window + 1, i + 1)));
      return out;
    },
    npv: (a, host) => {
      const rate = num(a[0], 'npv', 0);
      const flows = numbers(a[1], 'npv', 1);
      host.charge(flows.length);
      return flows.reduce((acc, flow, index) => acc + flow / (1 + rate) ** (index + 1), 0);
    },
    irr: (a, host) => {
      const flows = numbers(a[0], 'irr', 0);
      host.charge(200);
      let low = -0.9999;
      let high = 10;
      const value = (rate: number) => flows.reduce((acc, flow, index) => acc + flow / (1 + rate) ** index, 0);
      if (value(low) * value(high) > 0) return Number.NaN;
      for (let i = 0; i < 200; i += 1) {
        const mid = (low + high) / 2;
        if (value(low) * value(mid) <= 0) high = mid;
        else low = mid;
      }
      return (low + high) / 2;
    },
    breakeven: (a) => {
      const fixed = num(a[0], 'breakeven', 0);
      const price = num(a[1], 'breakeven', 1);
      const variable = num(a[2], 'breakeven', 2);
      if (price <= variable) throw new SandboxError('breakeven: price must exceed variable cost');
      return fixed / (price - variable);
    },

    // ---- simulation and scenarios ---------------------------------------
    montecarlo: (a, host) => {
      const spec = a[0];
      if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new SandboxError('montecarlo: argument 1 is a record { draws, mean, sd, low, high, dist }');
      }
      const draws = Math.trunc(num((spec.draws ?? 1000) as Value, 'montecarlo.draws', 0));
      if (draws < 1 || draws > 200_000) throw new SandboxError('montecarlo: draws is between 1 and 200000');
      host.charge(draws);
      const dist = typeof spec.dist === 'string' ? spec.dist : 'normal';
      const samples: number[] = [];
      for (let i = 0; i < draws; i += 1) {
        if (dist === 'uniform') {
          const low = num((spec.low ?? 0) as Value, 'montecarlo.low', 0);
          const high = num((spec.high ?? 1) as Value, 'montecarlo.high', 0);
          samples.push(low + host.random() * (high - low));
        } else if (dist === 'triangular') {
          const low = num((spec.low ?? 0) as Value, 'montecarlo.low', 0);
          const high = num((spec.high ?? 1) as Value, 'montecarlo.high', 0);
          const mode = num((spec.mode ?? (low + high) / 2) as Value, 'montecarlo.mode', 0);
          const u = host.random();
          const c = (mode - low) / (high - low);
          samples.push(u < c
            ? low + Math.sqrt(u * (high - low) * (mode - low))
            : high - Math.sqrt((1 - u) * (high - low) * (high - mode)));
        } else {
          const mu = num((spec.mean ?? 0) as Value, 'montecarlo.mean', 0);
          const sd = num((spec.sd ?? 1) as Value, 'montecarlo.sd', 0);
          // Box–Muller, one variate per draw so the seed maps to the sample.
          const u1 = Math.max(host.random(), Number.EPSILON);
          const u2 = host.random();
          samples.push(mu + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
        }
      }
      const sorted = [...samples].sort((x, y) => x - y);
      return {
        draws,
        dist,
        mean: mean(samples),
        sd: draws > 1 ? Math.sqrt(samples.reduce((acc, x) => acc + (x - mean(samples)) ** 2, 0) / (draws - 1)) : 0,
        p5: quantileOf(sorted, 0.05),
        p50: quantileOf(sorted, 0.5),
        p95: quantileOf(sorted, 0.95),
        min: sorted[0],
        max: sorted[sorted.length - 1],
      };
    },
    sensitivity: (a, host) => {
      // { base: number, drivers: [{ name, low, high, effect }] } where effect
      // is the change in the result per unit of the driver. Deterministic
      // tornado: |high − low| × |effect|, ranked.
      const spec = a[0];
      if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new SandboxError('sensitivity: argument 1 is a record { base, drivers }');
      }
      const base = num((spec.base ?? 0) as Value, 'sensitivity.base', 0);
      const drivers = Array.isArray(spec.drivers) ? spec.drivers : [];
      host.charge(drivers.length * 4);
      const rows = drivers.map((driver, index) => {
        if (driver === null || typeof driver !== 'object' || Array.isArray(driver)) {
          throw new SandboxError(`sensitivity: driver ${index} is not a record`);
        }
        const low = num((driver.low ?? 0) as Value, 'sensitivity.low', 0);
        const high = num((driver.high ?? 0) as Value, 'sensitivity.high', 0);
        const effect = num((driver.effect ?? 1) as Value, 'sensitivity.effect', 0);
        const downside = base + (low * effect);
        const upside = base + (high * effect);
        return {
          name: typeof driver.name === 'string' ? driver.name : `driver_${index}`,
          downside,
          upside,
          swing: Math.abs(upside - downside),
        };
      });
      rows.sort((x, y) => (y.swing as number) - (x.swing as number));
      return { base, tornado: rows as unknown as Value };
    },
    optimise: (a, host) => {
      // Grid search over one driver: { low, high, steps, slope, intercept }
      // maximise or minimise a linear response. Deliberately tiny — a real
      // optimiser belongs in a dataset, not in a sandbox with a step budget.
      const spec = a[0];
      if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new SandboxError('optimise: argument 1 is a record { low, high, steps, slope, intercept, goal }');
      }
      const low = num((spec.low ?? 0) as Value, 'optimise.low', 0);
      const high = num((spec.high ?? 1) as Value, 'optimise.high', 0);
      const steps = Math.trunc(num((spec.steps ?? 100) as Value, 'optimise.steps', 0));
      if (steps < 2 || steps > 10_000) throw new SandboxError('optimise: steps is between 2 and 10000');
      const slope = num((spec.slope ?? 1) as Value, 'optimise.slope', 0);
      const intercept = num((spec.intercept ?? 0) as Value, 'optimise.intercept', 0);
      const goal = spec.goal === 'min' ? 'min' : 'max';
      host.charge(steps);
      let bestX = low;
      let bestY = intercept + slope * low;
      for (let i = 1; i < steps; i += 1) {
        const x = low + ((high - low) * i) / (steps - 1);
        const y = intercept + slope * x;
        if ((goal === 'max' && y > bestY) || (goal === 'min' && y < bestY)) {
          bestX = x;
          bestY = y;
        }
      }
      return { goal, x: bestX, y: bestY, steps };
    },

    // ---- output ----------------------------------------------------------
    note: (a, host) => {
      const line = a.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ');
      host.log(line.slice(0, 2_000));
      return null;
    },
  };
  return lib;
}

export const STDLIB_NAMES: readonly string[] = Object.keys(buildStdlib()).sort();
