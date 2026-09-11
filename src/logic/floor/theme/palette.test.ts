// The mirror is only useful if it cannot drift. index.css stores each token
// as an HSL triplet with the intended hex in a comment; this re-derives the
// hex from the triplet — so a token edited in index.css and forgotten here
// fails, and so does a comment that stopped matching its own value.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOST, departmentColor } from './palette';

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lum - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${to(r)}${to(g)}${to(b)}`;
}

const CSS = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8');

function tokenHex(name: string): string {
  const match = CSS.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!match) throw new Error(`--${name} is not declared in src/index.css`);
  return hslToHex(Number(match[1]), Number(match[2]), Number(match[3]));
}

describe('the floor palette mirrors the host ramp', () => {
  const CASES: Array<[keyof typeof HOST, string]> = [
    ['foreground', 'foreground'],
    ['foregroundSecondary', 'foreground-secondary'],
    ['foregroundMuted', 'foreground-muted'],
    ['surface1', 'surface-1'],
    ['surface3', 'surface-3'],
    ['border', 'border'],
    ['primary', 'primary'],
    ['primaryForeground', 'primary-foreground'],
    ['success', 'success'],
    ['destructive', 'destructive'],
    ['escalate', 'escalate'],
    ['chart1', 'chart-1'],
    ['chart2', 'chart-2'],
    ['chart3', 'chart-3'],
    ['chart4', 'chart-4'],
  ];

  for (const [key, token] of CASES) {
    it(`${key} is --${token}`, () => {
      expect(HOST[key].toUpperCase()).toBe(tokenHex(token));
    });
  }

  it('gives a department the same tint every time, and an unknown one the muted tone', () => {
    expect(departmentColor('verification')).toBe(departmentColor('verification'));
    expect(Object.values(HOST)).toContain(departmentColor('verification'));
    expect(departmentColor(null)).toBe(HOST.foregroundMuted);
  });

  it('carries no colour the host ramp does not define', () => {
    // A hex here that no token produces is a second design system starting.
    const declared = new Set(CASES.map(([, token]) => tokenHex(token)));
    for (const value of Object.values(HOST)) expect(declared.has(value.toUpperCase())).toBe(true);
  });
});
