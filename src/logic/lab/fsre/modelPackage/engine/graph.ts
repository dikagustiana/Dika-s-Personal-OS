// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/lib/finance-in-action/engine/graph.ts. Do not edit here; re-copy.
/**
 * The dependency graph, built only from parsed references.
 *
 * This is the one source of every relationship the viewer shows: the
 * Connections lens and the unit-economics drivers both ask it. Nothing in the
 * viewer states that one row depends on another; if the formulas do not say
 * so, the graph does not either.
 */
import { normaliseKey } from './address';
import type { Engine } from './engine';

export type Depth = 'one' | 'full';

export class DependencyGraph {
  private readonly pre = new Map<string, string[]>();
  private readonly dep = new Map<string, string[]>();

  constructor(engine: Engine) {
    for (const key of engine.cells.keys()) {
      const refs = Array.from(new Set(engine.refs(key)));
      this.pre.set(key, refs);
      for (const r of refs) {
        const list = this.dep.get(r);
        if (list) list.push(key);
        else this.dep.set(r, [key]);
      }
    }
  }

  /** The cells this cell reads: one level, or the full chain back to its sources. */
  precedents(cellRef: string, depth: Depth = 'one'): string[] {
    return this.walk(normaliseKey(cellRef), this.pre, depth);
  }

  /** The cells that read this cell: one level, or the full chain forward. */
  dependents(cellRef: string, depth: Depth = 'one'): string[] {
    return this.walk(normaliseKey(cellRef), this.dep, depth);
  }

  /** Every cell that sits on a cycle, each cycle reported once as its member keys. */
  cycles(): string[][] {
    // Tarjan's strongly connected components; a component is a cycle when it
    // has more than one member or a member that reads itself.
    let index = 0;
    const idx = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const out: string[][] = [];
    const visit = (v: string) => {
      idx.set(v, index);
      low.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);
      for (const w of this.pre.get(v) ?? []) {
        if (!idx.has(w)) {
          visit(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        }
      }
      if (low.get(v) === idx.get(v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        if (comp.length > 1 || (this.pre.get(v) ?? []).includes(v)) out.push(comp.sort());
      }
    };
    for (const v of this.pre.keys()) if (!idx.has(v)) visit(v);
    return out;
  }

  private walk(start: string, edges: Map<string, string[]>, depth: Depth): string[] {
    const first = edges.get(start) ?? [];
    if (depth === 'one') return [...first];
    const seen = new Set<string>();
    const queue = [...first];
    while (queue.length) {
      const k = queue.shift()!;
      if (seen.has(k) || k === start) continue;
      seen.add(k);
      for (const n of edges.get(k) ?? []) if (!seen.has(n)) queue.push(n);
    }
    return Array.from(seen);
  }
}
