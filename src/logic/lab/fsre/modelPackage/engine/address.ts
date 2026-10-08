// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/engine/address.ts. Do not edit here; re-copy.
/**
 * Cell addresses for the formula engine.
 *
 * A cell key is `<sheet>!<column><row>`, for example `model!C12`. Sheet names
 * are compared without regard to case, as Excel compares them, so the key
 * always carries the sheet in lower case: `Model!C12`, `'model'!$C$12` and
 * `MODEL!C12` all name `model!C12`. Column and row are kept as written, with
 * the `$` anchors dropped (they matter only when a formula is copied).
 */

/** 1 → A, 26 → Z, 27 → AA. */
export function colLetter(n: number): string {
  let s = '';
  let rest = n;
  while (rest > 0) {
    const m = (rest - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    rest = Math.floor((rest - 1) / 26);
  }
  return s;
}

/** A → 1, Z → 26, AA → 27. */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export const normaliseSheet = (sheet: string): string => sheet.toLowerCase();

export function cellKey(sheet: string, col: string, row: number): string {
  return `${normaliseSheet(sheet)}!${col}${row}`;
}

export interface ParsedKey {
  sheet: string;
  col: string;
  row: number;
}

const KEY_RE = /^([^!]+)!\$?([A-Z]{1,3})\$?(\d+)$/;

/** Splits a key into its parts, or returns null when it is not a cell key. */
export function parseKey(key: string): ParsedKey | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return { sheet: normaliseSheet(m[1].replace(/^'(.*)'$/, '$1')), col: m[2], row: Number(m[3]) };
}

/** The canonical form of any key the engine accepts. */
export function normaliseKey(key: string): string {
  const p = parseKey(key);
  return p ? cellKey(p.sheet, p.col, p.row) : key;
}
