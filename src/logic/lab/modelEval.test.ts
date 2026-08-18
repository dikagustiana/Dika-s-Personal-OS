// The first-party evaluator, tested where it can be watched. This imports
// the DENO copy directly (same trick as the drift test): the evaluator is
// pure TS, and what runs in the function is what is tested here — no
// parallel client copy to drift.
import { describe, expect, it } from 'vitest';
import {
  deriveUnit,
  EVALUATOR_VERSION,
  evaluateExpression,
  evaluateModelSpec,
  formatUnit,
  mulberry32,
  parseExpression,
  parseUnit,
  sampleDistribution,
} from '../../../supabase/functions/_shared/modelEval';

const env = (pairs: Record<string, number>) => new Map(Object.entries(pairs));

describe('the expression grammar: arithmetic, never code', () => {
  it('parses precedence, parens, right-associative ^ and unary minus', () => {
    expect(evaluateExpression(parseExpression('2 + 3 * 4'), env({}))).toBe(14);
    expect(evaluateExpression(parseExpression('(2 + 3) * 4'), env({}))).toBe(20);
    expect(evaluateExpression(parseExpression('2 ^ 3 ^ 2'), env({}))).toBe(512);
    expect(evaluateExpression(parseExpression('-x + 10'), env({ x: 4 }))).toBe(6);
    expect(evaluateExpression(parseExpression('cap * util / 100'), env({ cap: 200, util: 7.3 }))).toBeCloseTo(14.6);
  });

  it('refuses anything that is not arithmetic — call syntax, brackets, semicolons', () => {
    expect(() => parseExpression('f(x)')).toThrow();
    expect(() => parseExpression('x; y')).toThrow();
    expect(() => parseExpression('a[0]')).toThrow();
    expect(() => parseExpression('import x')).toThrow(); // 'import x' = two names back-to-back
    expect(() => evaluateExpression(parseExpression('ghost + 1'), env({}))).toThrow(/ghost/);
  });
});

describe('unit algebra, symbolic over the AST', () => {
  const units = new Map([
    ['price', parseUnit('IDR/tonne')],
    ['volume', parseUnit('tonne')],
    ['rate', parseUnit('%')],
    ['count', parseUnit('')],
  ]);

  it('multiplies through, cancels through division, and formats', () => {
    expect(formatUnit(deriveUnit(parseExpression('price * volume'), units))).toBe('idr');
    expect(formatUnit(deriveUnit(parseExpression('price * volume / volume'), units))).toBe('idr/tonne'.replace('/', '*tonne^-1') === 'idr*tonne^-1' ? 'idr*tonne^-1' : 'idr*tonne^-1');
    expect(formatUnit(deriveUnit(parseExpression('volume ^ 2'), units))).toBe('tonne^2');
    expect(formatUnit(deriveUnit(parseExpression('rate * count'), units))).toBe('(dimensionless)');
  });

  it('refuses adding unlike quantities, naming both units', () => {
    expect(() => deriveUnit(parseExpression('price + volume'), units)).toThrow(/idr.*tonne|tonne.*idr/);
  });

  it('refuses a dimensioned quantity raised to a non-integer power', () => {
    expect(() => deriveUnit(parseExpression('volume ^ 1.5'), units)).toThrow(/integer/);
  });
});

describe('determinism and distributions', () => {
  it('mulberry32 is deterministic per seed and uniform-ish', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let index = 0; index < 5; index++) expect(a()).toBe(b());
    const c = mulberry32(43);
    expect(mulberry32(42)()).not.toBe(c());
  });

  it('samples stay inside declared supports', () => {
    const rng = mulberry32(7);
    for (let index = 0; index < 500; index++) {
      const u = sampleDistribution({ type: 'uniform', min: 2, max: 5 }, rng);
      expect(u).toBeGreaterThanOrEqual(2);
      expect(u).toBeLessThanOrEqual(5);
      const t = sampleDistribution({ type: 'triangular', min: 0, mode: 1, max: 4 }, rng);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(4);
      const p = sampleDistribution({ type: 'pert', min: 10, mode: 12, max: 20 }, rng);
      expect(p).toBeGreaterThanOrEqual(10);
      expect(p).toBeLessThanOrEqual(20);
    }
  });
});

describe('evaluateModelSpec — every check writes a row, never goes absent', () => {
  const params = [
    { name: 'price', value: 1500, unit: 'IDR/tonne' },
    { name: 'volume', value: 200, unit: 'tonne' },
  ];

  it('expression kind: value, unit check, finite check, version pin', () => {
    const outcome = evaluateModelSpec(
      { kind: 'expression', expression: 'price * volume', outputUnit: 'IDR' },
      params,
      1,
    );
    expect(outcome.value).toBe(300_000);
    expect(outcome.evaluatorVersion).toBe(EVALUATOR_VERSION);
    expect(outcome.checks.find((check) => check.name === 'unit_algebra')?.passed).toBe(true);
    expect(outcome.checks.find((check) => check.name === 'finite')?.passed).toBe(true);
    expect(outcome.checksPassed).toBe(true);
    expect(outcome.sensitivityPassed).toBe(true);
  });

  it('a unit mismatch is a RECORDED failure, not an exception and not silence', () => {
    const outcome = evaluateModelSpec(
      { kind: 'expression', expression: 'price * volume', outputUnit: 'tonne' },
      params,
      1,
    );
    const unitCheck = outcome.checks.find((check) => check.name === 'unit_algebra');
    expect(unitCheck?.passed).toBe(false);
    expect(unitCheck?.detail).toContain('idr');
    expect(outcome.checksPassed).toBe(false);
  });

  it('bounds and identities are declared and re-checked', () => {
    const outcome = evaluateModelSpec(
      {
        kind: 'expression',
        expression: 'price * volume',
        outputUnit: 'IDR',
        bounds: { min: 0, max: 100 }, // deliberately violated
        identities: [{ left: 'volume', right: 'volume + 1' }], // deliberately false
      },
      params,
      1,
    );
    expect(outcome.checks.find((check) => check.name === 'bounds')?.passed).toBe(false);
    expect(outcome.checks.find((check) => check.name === 'identity')?.passed).toBe(false);
    expect(outcome.checksPassed).toBe(false);
  });

  it('monte_carlo: deterministic per seed, 3-seed convergence recorded', () => {
    const spec = {
      kind: 'monte_carlo' as const,
      expression: 'price * volume',
      outputUnit: 'IDR',
      iterations: 2000,
    };
    const mcParams = [
      { name: 'price', value: 1500, unit: 'IDR/tonne', distribution: { type: 'normal' as const, mean: 1500, sd: 50 } },
      { name: 'volume', value: 200, unit: 'tonne', distribution: { type: 'uniform' as const, min: 150, max: 250 } },
    ];
    const first = evaluateModelSpec(spec, mcParams, 42);
    const second = evaluateModelSpec(spec, mcParams, 42);
    expect(first.value).toBe(second.value); // same seed, same answer, forever
    expect(first.checks.find((check) => check.name === 'seed_convergence')?.passed).toBe(true);
    expect(first.summary).toHaveProperty('p5');
    expect(first.summary).toHaveProperty('p95');
  });

  it('scenario: base plus named overrides, all recorded', () => {
    const outcome = evaluateModelSpec(
      {
        kind: 'scenario',
        expression: 'price * volume',
        outputUnit: 'IDR',
        scenarios: { bear: { volume: 100 }, bull: { volume: 300 } },
      },
      params,
      1,
    );
    const scenarios = outcome.summary.scenarios as Record<string, number>;
    expect(scenarios.base).toBe(300_000);
    expect(scenarios.bear).toBe(150_000);
    expect(scenarios.bull).toBe(450_000);
  });

  it('a spec that IGNORES its inputs fails sensitivity — a hardcoded answer is not a model (lab-eval-2)', () => {
    // The expression names its parameter and then multiplies it away: the
    // output never moves however the input moves. The brief's rule is
    // exact — "if the output does not move, the model is not a function of
    // its inputs" — and this is the check that catches a spec smuggling a
    // constant behind a resolvable result id.
    const outcome = evaluateModelSpec(
      { kind: 'expression', expression: 'volume * 0 + 42', outputUnit: '' },
      [{ name: 'volume', value: 200, unit: '' }],
      1,
    );
    expect(outcome.sensitivityPassed).toBe(false);
    const check = outcome.checks.find((entry) => entry.name === 'perturbation_1pct');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('not a function of its inputs');
  });

  it('an expression naming NO parameter fails sensitivity outright', () => {
    const outcome = evaluateModelSpec(
      { kind: 'expression', expression: '42', outputUnit: '' },
      [{ name: 'volume', value: 200, unit: '' }],
      1,
    );
    expect(outcome.sensitivityPassed).toBe(false);
    expect(
      outcome.checks.find((entry) => entry.name === 'perturbation_1pct')?.detail,
    ).toContain('names no parameter');
  });

  it('the 1% perturbation smoke test catches a singularity crossing', () => {
    // x sits just below the pole of 1/(x-1); a 1% move crosses it and the
    // result flips sign violently. sensitivity_passed must be false, with
    // the offending parameter recorded.
    const outcome = evaluateModelSpec(
      { kind: 'expression', expression: '1 / (x - 1)', outputUnit: '' },
      [{ name: 'x', value: 0.995, unit: '' }],
      1,
    );
    expect(outcome.sensitivityPassed).toBe(false);
    const check = outcome.checks.find((entry) => entry.name === 'perturbation_1pct');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('x');
  });

  it('a malformed spec throws BEFORE anything is recorded — the refusal path', () => {
    expect(() =>
      evaluateModelSpec({ kind: 'expression', expression: 'price * ghost', outputUnit: 'IDR' }, params, 1),
    ).toThrow(/ghost/);
  });
});
