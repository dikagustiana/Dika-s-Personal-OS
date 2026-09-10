// Turns a positioner's timed emissions into real sends. Pending emissions for
// an agent are cancelled when a newer semantic event supersedes them.
import { CAMPUS } from '../src/core/layout/campus';
import { Positioner } from '../src/core/scenario/positioner';
import type { SemanticEvent } from '../src/core/scenario/semantic';
import type { SourceContext } from './sources/types';

export class EmissionScheduler {
  readonly positioner: Positioner;
  private readonly pending = new Map<string, NodeJS.Timeout[]>();
  private seq = 0;

  constructor(
    private readonly ctx: SourceContext,
    idPrefix = 'evt',
  ) {
    const stamp = Date.now().toString(36);
    this.positioner = new Positioner(CAMPUS, { nextEventId: () => `${idPrefix}-${stamp}-${++this.seq}` });
  }

  /** Apply a semantic event now. Returns the time (ms epoch) of the last emission, i.e. the arrival. */
  emit(sem: SemanticEvent, nowMs = Date.now()): number {
    const emissions = this.positioner.apply(sem, nowMs);
    this.cancel(sem.agentId);
    const timers: NodeJS.Timeout[] = [];
    let last = nowMs;
    for (const e of emissions) {
      last = Math.max(last, e.atMs);
      if (e.atMs <= nowMs) {
        this.ctx.publish(e.event);
        this.positioner.markArrived(sem.agentId, e.atMs);
      } else {
        timers.push(
          setTimeout(() => {
            this.ctx.publish(e.event);
            this.positioner.markArrived(sem.agentId, e.atMs);
          }, e.atMs - nowMs),
        );
      }
    }
    if (timers.length) this.pending.set(sem.agentId, timers);
    return last;
  }

  cancel(agentId: string): void {
    for (const t of this.pending.get(agentId) ?? []) clearTimeout(t);
    this.pending.delete(agentId);
  }

  cancelAll(): void {
    for (const id of Array.from(this.pending.keys())) this.cancel(id);
  }
}
