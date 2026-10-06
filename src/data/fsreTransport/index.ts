/**
 * The one place that knows which transports exist. UI code asks for a
 * transport by mode and talks only to FsreTransport (plus the optional
 * MockControls through the type guard in controls.ts).
 */
import type { FsreTransport } from './contract';
import { MockTransport } from './mockTransport';
import { SupabaseTransport } from './supabaseTransport';

export function createTransport(mode: 'synthetic' | 'live'): FsreTransport {
  if (mode === 'synthetic') return new MockTransport();
  return new SupabaseTransport();
}
