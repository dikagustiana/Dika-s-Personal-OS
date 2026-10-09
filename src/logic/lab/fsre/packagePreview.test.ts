/**
 * Reading a staged package for the partner room: the shape check, the site's
 * own rules through the pinned copies, the summary and the cell detail. The
 * package is the suite's SYNTHETIC golden case (SYNP), the same fixture the
 * site tests with; nothing in it is a real company figure.
 */
import { describe, expect, it } from 'vitest';
import synp from './__fixtures__/synp.SYNTHETIC.package.json';
import { EVENT_KIND_WORDS, FOLDER_STATUS_WORDS } from './statuses';
import {
  CELL_KIND_MARKS,
  HASH_SHOWN,
  ISSUES_SHOWN,
  RELEASE_STATUS_WORDS,
  cellDetail,
  gateMark,
  issuesShown,
  packageShapeProblem,
  provenanceOf,
  readPackage,
  shortHash,
  summarise,
} from './packagePreview';
import type { ModelPackage } from './modelPackage/contract/types';

const PKG = synp as unknown as ModelPackage;
const clone = (): ModelPackage => JSON.parse(JSON.stringify(PKG)) as ModelPackage;

describe('readPackage', () => {
  it('reads the SYNP package with no issue, and lists its sheets in the contract order', () => {
    const reading = readPackage(PKG);
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.issues).toEqual([]);
    expect(reading.sheets).toEqual(['reported', 'model', 'assumptions']);
    expect(reading.summary.cells).toBe(PKG.sheets.reduce((n, s) => n + s.rows.reduce((m, r) => m + r.cells.length, 0), 0));
  });

  it('keeps a package that fails the site’s rules, with the issues listed', () => {
    const pkg = clone();
    pkg.meta.chainStage = 'nowhere';
    const reading = readPackage(pkg);
    expect(reading.ok && reading.issues.map((i) => i.path)).toEqual(['meta.chainStage']);
  });

  it('runs the engine checks once the contract rules pass: a formula reading outside the package is reported', () => {
    const pkg = clone();
    const model = pkg.sheets.find((s) => s.id === 'model');
    const cell = model?.rows[0]?.cells[0];
    if (!cell) throw new Error('fixture changed');
    cell.formula = '=reported!Z999';
    const reading = readPackage(pkg);
    expect(reading.ok && reading.issues.some((i) => i.message.includes('outside the package'))).toBe(true);
  });

  it.each([
    [null, 'not an object'],
    [{ meta: {} }, 'meta lacks ticker'],
    [{ ...PKG, meta: { ...PKG.meta, provenance: 'guess' } }, 'not a provenance'],
    [{ ...PKG, sheets: [{ id: 'balance', rows: [] }] }, 'a sheet lacks an id'],
    [{ ...PKG, sheets: [{ id: 'model', rows: [{ id: 'x', label: 'x', unit: 'u', cells: [{ value: 'nine', kind: 'sourced' }] }] }] }, 'not a number or null'],
    [{ ...PKG, workpaper: { gates: [{ name: 'Gate 1', status: 'maybe' }] } }, 'known status'],
  ])('refuses a package without the contract’s shape: %#', (raw, words) => {
    expect(packageShapeProblem(raw)).toContain(words);
    const reading = readPackage(raw);
    expect(reading.ok).toBe(false);
    expect(!reading.ok && reading.detail).toContain(words);
  });
});

describe('summarise', () => {
  it('counts cells per kind and tie-outs per status, and reads the provenance', () => {
    const summary = summarise(PKG);
    const kinds = Object.values(summary.byKind).reduce((a, b) => a + b, 0);
    expect(kinds).toBe(summary.cells);
    expect(summary.byKind.sourced).toBeGreaterThan(0);
    expect(summary.byKind.formula).toBeGreaterThan(0);
    expect(summary.tieOuts.agrees).toBeGreaterThan(0);
    expect(summary.tieOuts.differs).toBe(0);
    expect(summary.gates.map((g) => g.name)).toEqual(PKG.workpaper.gates.map((g) => g.name));
    expect(summary.provenance).toBe('synthetic');
    expect(summary.provenanceNote).toContain('SYNTHETIC');
    expect(summary.productionReady).toBe(false);
  });

  it('is production-ready only for filings, with no note', () => {
    const pkg = clone();
    pkg.meta.provenance = 'filings';
    expect(summarise(pkg)).toMatchObject({ provenance: 'filings', provenanceNote: '', productionReady: true });
  });
});

describe('the words and marks', () => {
  it('uses the building’s own vocabulary for a release’s status', () => {
    expect(RELEASE_STATUS_WORDS).toEqual({ staged: EVENT_KIND_WORDS.package_staged, published: FOLDER_STATUS_WORDS.published });
  });

  it('gives every cell kind a glyph and a tone, with no two kinds sharing both', () => {
    const marks = Object.values(CELL_KIND_MARKS).map((m) => `${m.glyph}|${m.tone}`);
    expect(new Set(marks).size).toBe(marks.length);
    expect(Object.values(CELL_KIND_MARKS).every((m) => m.glyph.length > 0)).toBe(true);
  });

  it('marks a gate from the contract’s list', () => {
    expect(gateMark({ name: 'Gate 1', status: 'passed' })).toEqual({ glyph: '✓', word: 'Passed', tone: 'done' });
    expect(gateMark({ name: 'Gate 2', status: 'passed_with_escalation' })).toMatchObject({ glyph: '!', tone: 'escalated' });
    expect(gateMark({ name: 'Gate 3', status: 'failed' })).toMatchObject({ glyph: '✗', tone: 'failed' });
    expect(gateMark({ name: 'Partner review', status: 'not_run' })).toMatchObject({ glyph: '–', tone: 'idle' });
  });

  it('shortens the hash and caps the issue list', () => {
    expect(shortHash('a'.repeat(64))).toBe('a'.repeat(HASH_SHOWN));
    const issues = Array.from({ length: ISSUES_SHOWN + 3 }, (_, i) => ({ path: `p${i}`, message: 'm' }));
    expect(issuesShown(issues)).toEqual({ lines: issues.slice(0, ISSUES_SHOWN).map((i) => `${i.path}: m`), more: 3 });
    expect(issuesShown([])).toEqual({ lines: [], more: 0 });
  });

  it('reads the provenance without the full checks, and null when there is none', () => {
    expect(provenanceOf(PKG)).toBe('synthetic');
    expect(provenanceOf({ meta: { provenance: 'filings' } })).toBe('filings');
    expect(provenanceOf({ meta: { provenance: 'guess' } })).toBeNull();
    expect(provenanceOf('nothing')).toBeNull();
  });
});

describe('cellDetail', () => {
  it('describes a sourced cell with its source and a formula cell with its formula and tie-out', () => {
    const sourced = cellDetail(PKG, { sheetId: 'reported', rowIndex: 0, periodIndex: 0 });
    expect(sourced).toMatchObject({ kindWord: 'Sourced', row: { label: 'Revenue' }, period: { id: 'FY24' } });
    expect(sourced?.cell.source?.issuer).toContain('SYNTHETIC');
    expect(sourced?.value).toBe('8.100.000');
    const model = PKG.sheets.find((s) => s.id === 'model');
    const tied = model?.rows.findIndex((r) => r.cells.some((c) => c.tieOut));
    if (tied === undefined || tied < 0) throw new Error('fixture changed');
    const formula = cellDetail(PKG, { sheetId: 'model', rowIndex: tied, periodIndex: 0 });
    expect(formula?.cell.formula).toMatch(/^=/);
    expect(formula?.tieOut).toMatchObject({ word: 'Agrees', tone: 'done', difference: '0,00' }); // the site's house format, two decimals under ten
  });

  it('is null when the selection names no cell', () => {
    expect(cellDetail(PKG, { sheetId: 'assumptions', rowIndex: 0, periodIndex: 0 })).toBeNull();
    expect(cellDetail(PKG, { sheetId: 'model', rowIndex: 0, periodIndex: 99 })).toBeNull();
  });
});
