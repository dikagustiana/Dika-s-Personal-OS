/**
 * The model-package viewer modules under this folder are COPIES of the
 * site's (dikagustiana/dikagustiana.com src/lib/finance-in-action and
 * src/data), pinned to one commit: the two repositories are separate and
 * this one is public, so a copy with a locked version beats a dependency
 * (PRD "FSRE publish path" §6.2 C). Every file says so on its first line,
 * with the 40-character SHA and the path it came from, and every file is
 * pinned to the SAME SHA: a folder copied from two commits is two viewers.
 *
 * validate.ts alone carries a second line: its two `@/data/...` imports
 * (the site's alias) became relative paths to the data files copied beside
 * it. Nothing else is edited here; a change is a re-copy.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = __dirname;
const PIN = /^\/\/ Copied from dikagustiana\/dikagustiana\.com@([0-9a-f]{40}) (\S+)\. Do not edit here; re-copy\.$/;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out.sort();
}

describe('the copied viewer modules', () => {
  const files = sources(ROOT);

  it('exist: the contract, the engine, the formatter, the checks and the two data lists the contract validates against', () => {
    expect(files.map((f) => relative(ROOT, f))).toEqual([
      'constants.ts',
      'contract/links.ts',
      'contract/types.ts',
      'contract/validate.ts',
      'data/capitalConditions.ts',
      'data/industryChain.ts',
      'engine/address.ts',
      'engine/engine.ts',
      'engine/graph.ts',
      'engine/index.ts',
      'engine/parser.ts',
      'engine/recalc.ts',
      'format.ts',
      'model/checks.ts',
      'model/workbook.ts',
    ]);
  });

  it.each(files.map((f) => [relative(ROOT, f), f]))('%s carries the pin header with a 40-character SHA and its site path', (name, path) => {
    const first = readFileSync(path, 'utf8').split('\n')[0];
    const match = PIN.exec(first);
    expect(match, `${name}: ${first}`).not.toBeNull();
    // the site path ends with this file's own name, under src/
    expect(match?.[2]).toMatch(/^src\//);
    expect(match?.[2].endsWith(name.split('/').pop() as string)).toBe(true);
  });

  it('are all pinned to the same commit', () => {
    const shas = new Set(files.map((f) => PIN.exec(readFileSync(f, 'utf8').split('\n')[0])?.[1]));
    expect(shas.size).toBe(1);
  });

  it('import nothing through the site alias, and nothing outside this folder', () => {
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      expect(text, relative(ROOT, path)).not.toMatch(/from '@\//);
      for (const m of text.matchAll(/from '(\.[^']+)'/g)) {
        expect(m[1], `${relative(ROOT, path)} imports ${m[1]}`).not.toMatch(/^\.\.\/\.\.\//);
      }
    }
  });
});
