/**
 * THE TRANSPORT (3-C) — Supabase Realtime, not a second process.
 *
 * The standalone build ran a Fastify server on :4000 with a WebSocket event
 * bus and an emission scheduler. All three are deleted. What replaces them:
 * a Realtime subscription to the institution's own tables. A row lands, the
 * floor re-reads the brief's snapshot, projects it into semantic events, and
 * the positioner turns those into wire events the scene already knows how to
 * render.
 *
 * THE RULE THIS FILE IS BUILT AROUND. The positioner now runs in the
 * browser, and in the standalone build it ran server-side and held
 * authority: it delayed the arrival event by the real walk duration, so the
 * client received a correctly-timed stream and could not invent anything.
 * Moving it here removes that. So:
 *
 *   the client may DERIVE POSITION. It may never DERIVE STATE.
 *
 * An avatar may walk and may arrive at the anchor, and then it waits. It
 * does not enter OFFICE_WORKING because it got there; it enters
 * OFFICE_WORKING when an event says so — and every event here comes from a
 * row. The arrival emissions the positioner schedules carry the SAME state
 * the row already implies, which is why they are not an invention; the
 * test that proves it is in project.test.ts (the state-origin rule) and in
 * stateOrigin.test.ts, which fails if any state reaches the store from
 * anywhere but an inbound event.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export type StreamStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface InstitutionStreamOptions {
  /** Called when any watched table changes; the caller re-reads and projects. */
  onChange: (table: string) => void;
  onStatus: (status: StreamStatus, detail?: string) => void;
}

/**
 * The tables the floor watches. Each one is a thing that happens on the
 * floor: work assigned, a review filed, a submission carried, a rebuttal, a
 * blocked call, a proposal, and the brief's own status.
 */
export const WATCHED_TABLES = [
  'os_inst_assignments',
  'os_inst_reviews',
  'os_inst_submissions',
  'os_inst_debates',
  'os_inst_egress_blocks',
  'os_inst_agent_versions',
  'os_inst_events',
  'os_inst_briefs',
] as const;

export class InstitutionStream {
  private channel: RealtimeChannel | null = null;

  constructor(
    private readonly client: SupabaseClient,
    private readonly options: InstitutionStreamOptions,
  ) {}

  start(): void {
    if (this.channel) return;
    this.options.onStatus('connecting');
    const channel = this.client.channel('institution-floor');
    for (const table of WATCHED_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        this.options.onChange(table);
      });
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') this.options.onStatus('open');
      else if (status === 'CHANNEL_ERROR') this.options.onStatus('error', 'the realtime channel reported an error');
      else if (status === 'TIMED_OUT') this.options.onStatus('error', 'the realtime channel timed out');
      else if (status === 'CLOSED') this.options.onStatus('closed');
    });
    this.channel = channel;
  }

  stop(): void {
    if (!this.channel) return;
    void this.client.removeChannel(this.channel);
    this.channel = null;
    this.options.onStatus('closed');
  }
}
