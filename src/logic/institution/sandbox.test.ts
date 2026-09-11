// B-7 — the sandbox, tested by what it refuses as much as by what it
// computes. The no-network claim is not a comment: the first block attempts
// the escapes and asserts each one is told the function does not exist.

import { describe, expect, it } from 'vitest';
import { runSandbox } from '../../../supabase/functions/_shared/institution/sandbox/run';
import { STDLIB_NAMES } from '../../../supabase/functions/_shared/institution/sandbox/stdlib';

const run = (script: string, inputs: Record<string, unknown> = {}, seed = 7) =>
  runSandbox({ script, inputs: inputs as never, seed });

describe('no host access (B-7)', () => {
  const escapes = [
    'return fetch("https://example.org")',
    'return globalThis',
    'return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
    'return require("node:fs")',
    'return eval("1+1")',
    'return Function("return 1")()',
    'return import("node:https")',
    'return process.env',
    'return XMLHttpRequest()',
    'return WebSocket("wss://example.org")',
  ];

  for (const script of escapes) {
    it(`refuses ${script.slice(7, 40)}`, () => {
      const outcome = run(script);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toMatch(/no function|unknown name|unexpected|expected/i);
      }
    });
  }

  it('says what IS available when a script asks for something that is not', () => {
    const outcome = run('return fetch("x")');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain('no network');
      expect(outcome.error).toContain('mean');
    }
  });

  it('has no clock, so two runs of the same script agree', () => {
    const script = 'return montecarlo({ draws: 500, mean: 10, sd: 2 })';
    const a = run(script);
    const b = run(script);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
  });

  it('changes its answer with the seed, so the seed is real', () => {
    const script = 'return montecarlo({ draws: 500, mean: 10, sd: 2 }).p95';
    const a = runSandbox({ script, inputs: {}, seed: 1 });
    const b = runSandbox({ script, inputs: {}, seed: 2 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value).not.toBe(b.value);
  });
});

describe('bounds', () => {
  it('stops a script that asks for too many steps', () => {
    const outcome = runSandbox({
      script: 'let total = 0\nfor x in range(100000) { total = total + x }\nreturn total',
      inputs: {},
      limits: { steps: 5_000 },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.kind).toBe('limit');
      expect(outcome.error).toContain('step budget');
    }
  });

  it('stops a script that runs past the deadline', () => {
    let tick = 0;
    const outcome = runSandbox({
      script: 'let total = 0\nfor x in range(50000) { total = total + x }\nreturn total',
      inputs: {},
      limits: { timeMs: 10 },
      now: () => { tick += 5; return tick; },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.kind).toBe('limit');
  });

  it('refuses a result larger than the output cap', () => {
    const outcome = runSandbox({
      script: 'return range(20000)',
      inputs: {},
      limits: { outputBytes: 1_000 },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('over the 1000-byte cap');
  });

  it('caps range so a script cannot allocate its way out', () => {
    const outcome = run('return len(range(1000000))');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('exceeds the 100000 cap');
  });
});

describe('inputs are corpus-addressed and read-only', () => {
  it('reads a dataset handed in by the caller', () => {
    const outcome = run('return sum(column(inputs.rows, "value"))', {
      rows: [{ value: 10 }, { value: 32 }, { value: 8 }],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toBe(50);
  });

  it('refuses to let a script replace inputs', () => {
    const outcome = run('let inputs = 1\nreturn inputs');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('read-only');
  });

  it('cannot see a name the caller did not provide', () => {
    const outcome = run('return mystery');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('unknown name mystery');
  });
});

describe('the analysis library', () => {
  it('computes descriptive statistics', () => {
    const outcome = run('let xs = [100, 104, 109, 113, 118]\nreturn { mean: mean(xs), median: median(xs), sd: round(stdev(xs), 3), p90: quantile(xs, 0.9) }');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value).toMatchObject({ mean: 108.8, median: 109, p90: 116 });
    }
  });

  it('computes a CAGR, and caught a wrong answer in the held-fixed eval set', () => {
    // (118/100)^(1/4) - 1 = 4.2246%. The seeded evaluation eval-range-not-point
    // said "CAGR 4.23%" and its rubric demanded the token 4.2 with no digit
    // after it, so a correct answer would have scored badly and a wrong one
    // well. Corrected by migration 20260910000103 — the director owns the set,
    // so the correction is a migration with a diff, never an agent write.
    const outcome = run('return round(cagr(100, 118, 4) * 100, 2)');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toBe(4.22);
  });

  it('fits a regression and reports r2 and standard error', () => {
    const outcome = run('return regress([1,2,3,4,5], [2,4,6,8,10])');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const value = outcome.value as Record<string, number>;
      expect(value.slope).toBeCloseTo(2, 10);
      expect(value.intercept).toBeCloseTo(0, 10);
      expect(value.r2).toBeCloseTo(1, 10);
    }
  });

  it('forecasts with a range rather than a bare point', () => {
    const outcome = run('return forecast([100, 104, 109, 113, 118], 2)');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const value = outcome.value as { points: Array<{ point: number; low: number; high: number }> };
      expect(value.points).toHaveLength(2);
      expect(value.points[0].low).toBeLessThan(value.points[0].point);
      expect(value.points[0].high).toBeGreaterThan(value.points[0].point);
    }
  });

  it('ranks a sensitivity tornado by swing', () => {
    const outcome = run(`return sensitivity({ base: 100, drivers: [
      { name: "price", low: -5, high: 5, effect: 3 },
      { name: "volume", low: -10, high: 10, effect: 4 }
    ] })`);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const value = outcome.value as { tornado: Array<{ name: string; swing: number }> };
      expect(value.tornado[0].name).toBe('volume');
      expect(value.tornado[0].swing).toBe(80);
    }
  });

  it('reports an error the analyst can act on, not a stack trace', () => {
    const outcome = run('return stdev([1])');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBe('stdev: needs at least 2 values');
      expect(outcome.kind).toBe('runtime');
    }
  });

  it('keeps notes the analyst wrote, capped', () => {
    const outcome = run('note("checking the yield series")\nreturn 1');
    expect(outcome.ok).toBe(true);
    expect(outcome.logs).toEqual(['checking the yield series']);
  });

  it('exposes a stable library surface for the provenance record', () => {
    expect(STDLIB_NAMES).toContain('montecarlo');
    expect(STDLIB_NAMES).not.toContain('fetch');
    expect(STDLIB_NAMES).not.toContain('eval');
  });
});

describe('language shape', () => {
  it('runs conditionals and loops', () => {
    const outcome = run(`
      let total = 0
      for x in [1, 2, 3, 4, 5] {
        if x % 2 == 0 { total = total + x } else { total = total + 0 }
      }
      return total
    `);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toBe(6);
  });

  it('reports the line of a parse error', () => {
    const outcome = run('let a = 1\nlet = 2');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.kind).toBe('parse');
      expect(outcome.error).toContain('line 2');
    }
  });

  it('refuses an out-of-range index instead of returning null', () => {
    const outcome = run('return [1,2,3][7]');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('out of range');
  });

  it('records the steps and runtime the provenance envelope needs', () => {
    const outcome = run('return sum(range(100))');
    expect(outcome.ok).toBe(true);
    expect(outcome.steps).toBeGreaterThan(0);
    expect(outcome.runtimeMs).toBeGreaterThanOrEqual(0);
    expect(outcome.stdlibVersion).toMatch(/^institution-stdlib@/);
  });
});
