// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/model/workbook.ts. Do not edit here; re-copy.
/**
 * A package, laid out as a workbook the engine can read.
 *
 * The addressing convention is the contract's (contract/types.ts ADDRESSING):
 * sheet id, header on row 1, rows[n] on row n + 2, the first period in column
 * C. This module is the only place that turns (sheet, row, period) into a cell
 * key and back; the grid, the inspector, the lens, unit economics and the
 * export all go through it.
 */
import { ADDRESSING, splitRowRef, type Cell, type ModelPackage, type Row, type SheetId } from '../contract/types';
import { cellKey, colLetter, parseKey } from '../engine/address';
import { DependencyGraph } from '../engine/graph';
import { Engine, formulaCell, type EngineCell, type Value } from '../engine/engine';

export interface CellAddress {
  key: string;
  sheet: SheetId;
  rowId: string;
  rowIndex: number;
  periodIndex: number;
}

export const periodColumn = (periodIndex: number): string => colLetter(ADDRESSING.firstPeriodColumn + periodIndex);
export const rowNumber = (rowIndex: number): number => ADDRESSING.firstDataRow + rowIndex;

export class Workbook {
  readonly pkg: ModelPackage;
  readonly engine: Engine;
  readonly graph: DependencyGraph;
  private readonly addresses = new Map<string, CellAddress>();
  private readonly rows = new Map<string, { row: Row; rowIndex: number; sheet: SheetId }>();

  constructor(pkg: ModelPackage) {
    this.pkg = pkg;
    const cells = new Map<string, EngineCell>();
    for (const sheet of pkg.sheets) {
      sheet.rows.forEach((row, rowIndex) => {
        this.rows.set(`${sheet.id}!${row.id}`, { row, rowIndex, sheet: sheet.id });
        row.cells.forEach((cell, periodIndex) => {
          const key = cellKey(sheet.id, periodColumn(periodIndex), rowNumber(rowIndex));
          this.addresses.set(key, { key, sheet: sheet.id, rowId: row.id, rowIndex, periodIndex });
          cells.set(key, toEngineCell(cell, sheet.id));
        });
      });
    }
    this.engine = new Engine(cells);
    this.graph = new DependencyGraph(this.engine);
  }

  /** The row a "sheet!rowId" reference names. */
  row(rowRef: string): Row | undefined {
    const p = splitRowRef(rowRef);
    return p ? this.rows.get(`${p.sheet}!${p.rowId}`)?.row : undefined;
  }

  rowIndexOf(rowRef: string): number | undefined {
    const p = splitRowRef(rowRef);
    return p ? this.rows.get(`${p.sheet}!${p.rowId}`)?.rowIndex : undefined;
  }

  /** The cell key of a row in a period, or undefined when either is unknown. */
  keyOf(rowRef: string, periodId: string): string | undefined {
    const p = splitRowRef(rowRef);
    const entry = p ? this.rows.get(`${p.sheet}!${p.rowId}`) : undefined;
    const periodIndex = this.periodIndex(periodId);
    if (!entry || periodIndex < 0) return undefined;
    return cellKey(entry.sheet, periodColumn(periodIndex), rowNumber(entry.rowIndex));
  }

  periodIndex(periodId: string): number {
    return this.pkg.periods.findIndex((p) => p.id === periodId);
  }

  address(key: string): CellAddress | undefined {
    const p = parseKey(key);
    return p ? this.addresses.get(cellKey(p.sheet, p.col, p.row)) : undefined;
  }

  /** "sheet!rowId" for a cell key. */
  rowRefOf(key: string): string | undefined {
    const a = this.address(key);
    return a ? `${a.sheet}!${a.rowId}` : undefined;
  }

  /** The package's own cell behind a key: its kind, formula, source and note. */
  cell(key: string): Cell | undefined {
    const a = this.address(key);
    if (!a) return undefined;
    return this.pkg.sheets.find((s) => s.id === a.sheet)?.rows[a.rowIndex]?.cells[a.periodIndex];
  }

  allKeys(): string[] {
    return Array.from(this.addresses.keys());
  }

  /** Recalculates everything from the package as published. */
  values(): Map<string, Value> {
    return this.engine.recalc();
  }
}

function toEngineCell(cell: Cell, sheet: SheetId): EngineCell {
  if (cell.kind === 'formula' && cell.formula) return formulaCell(cell.formula, sheet);
  return { kind: 'value', value: cell.value };
}
