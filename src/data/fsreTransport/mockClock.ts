/**
 * The mock's simulated clock. It is the only clock the synthetic run uses:
 * event timestamps, no-signal windows and command timings all read from it.
 * The speed control (1x, 10x, pause) changes this clock's rate only — never
 * a derivation rule.
 */
import { NO_SIGNAL_AFTER_MIN } from '../../logic/lab/fsre/statuses';
import type { MockSpeed } from './controls';

export type { MockSpeed };

const RATE_BY_SPEED: Record<MockSpeed, number> = { '1x': 1, '10x': 10, pause: 0 };

export class MockClock {
  private simMs: number;
  private wallAnchor: number;
  /** The current speed setting; 'pause' freezes simulated time. */
  speed: MockSpeed = '1x';
  private subs = new Set<(iso: string) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(startIso: string) {
    this.simMs = Date.parse(startIso);
    this.wallAnchor = Date.now();
  }

  /** Start emitting the current simulated time about twice a second. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      const iso = this.nowIso();
      for (const sub of this.subs) sub(iso);
    }, 500);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.subs.clear();
  }

  subscribe(cb: (iso: string) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  setSpeed(speed: MockSpeed): void {
    // freeze the current simulated time against the wall clock first
    this.simMs = this.simNowMs();
    this.wallAnchor = Date.now();
    this.speed = speed;
  }

  private simNowMs(): number {
    const elapsed = (Date.now() - this.wallAnchor) * RATE_BY_SPEED[this.speed];
    return this.simMs + elapsed;
  }

  nowIso(): string {
    return new Date(this.simNowMs()).toISOString();
  }

  /** Test hook: move simulated time forward immediately. */
  advanceMs(ms: number): void {
    this.simMs = this.simNowMs() + ms;
    this.wallAnchor = Date.now();
  }
}

/** One no-signal window, in ms, for tests and the mock script. */
export const NO_SIGNAL_MS = NO_SIGNAL_AFTER_MIN * 60_000;
