/**
 * Controls some transports offer beyond the FsreTransport interface: the
 * synthetic mock exposes its simulated clock and speed; the real transport
 * will not. UI code uses hasMockControls and degrades gracefully when the
 * controls are absent.
 */

import type { FsreTransport } from './contract';

export type MockSpeed = '1x' | '10x' | 'pause';

export interface MockControls {
  /** Streams the transport's clock reading (ISO 8601). */
  subscribeClock(cb: (iso: string) => void): () => void;
  /** Changes the transport's clock rate only — never a derivation rule. */
  setSpeed(speed: MockSpeed): void;
  /** Releases the transport's timers; safe on any transport. */
  dispose(): void;
}

export function hasMockControls(t: FsreTransport): t is FsreTransport & MockControls {
  return (
    'subscribeClock' in t &&
    'setSpeed' in t &&
    'dispose' in t &&
    typeof (t as MockControls).subscribeClock === 'function' &&
    typeof (t as MockControls).setSpeed === 'function' &&
    typeof (t as MockControls).dispose === 'function'
  );
}
