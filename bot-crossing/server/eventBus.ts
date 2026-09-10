// In-memory event bus: validates, stores the latest event per agent plus a
// short history, keeps output documents, and broadcasts each event as one
// JSON text frame — the canonical A-2 object, no envelope — to every client.
import type { WebSocket } from 'ws';
import { CanonicalEventSchema, type CanonicalEvent } from '../src/core/events/schema';

export interface OutputDocument {
  taskId: string;
  agentId: string;
  title: string;
  department: string;
  format: 'markdown';
  content: string;
  generatedAt: string;
}

export interface BusStats {
  published: number;
  rejected: number;
  rawFramesSent: number;
  clients: number;
  startedAt: string;
}

const HISTORY_PER_AGENT = 300;

export class EventBus {
  private readonly clients = new Set<WebSocket>();
  private readonly latest = new Map<string, CanonicalEvent>();
  private readonly history = new Map<string, CanonicalEvent[]>();
  private readonly outputs = new Map<string, OutputDocument>();
  private readonly stats: BusStats = { published: 0, rejected: 0, rawFramesSent: 0, clients: 0, startedAt: new Date().toISOString() };

  constructor(private readonly log: (msg: string) => void = () => {}) {}

  /** Validate and broadcast. Returns false (and logs the raw payload) if the event fails the contract. */
  publish(event: unknown): boolean {
    const res = CanonicalEventSchema.safeParse(event);
    if (!res.success) {
      this.stats.rejected++;
      this.log(`rejected event: ${res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')} raw=${JSON.stringify(event)}`);
      return false;
    }
    const ev = res.data;
    this.latest.set(ev.agentId, ev);
    const h = this.history.get(ev.agentId) ?? [];
    h.push(ev);
    if (h.length > HISTORY_PER_AGENT) h.splice(0, h.length - HISTORY_PER_AGENT);
    this.history.set(ev.agentId, h);
    this.stats.published++;
    this.broadcast(JSON.stringify(ev));
    return true;
  }

  /**
   * Send an unvalidated text frame. Used only by the mock source to prove the
   * client boundary drops malformed input (Phase 3 verification). Nothing
   * about it is stored.
   */
  publishRaw(text: string): void {
    this.stats.rawFramesSent++;
    this.broadcast(text);
  }

  storeOutput(doc: OutputDocument): void {
    this.outputs.set(doc.taskId, doc);
  }

  getOutput(taskId: string): OutputDocument | undefined {
    return this.outputs.get(taskId);
  }

  snapshot(): CanonicalEvent[] {
    return Array.from(this.latest.values());
  }

  historyFor(agentId: string, limit: number): CanonicalEvent[] {
    const h = this.history.get(agentId) ?? [];
    return h.slice(-limit);
  }

  getStats(): BusStats {
    return { ...this.stats, clients: this.clients.size };
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    // Snapshot: the latest event per agent, as ordinary frames. A reconnecting
    // client dedupes by eventId and re-syncs anything it missed.
    for (const ev of this.latest.values()) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
    }
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  private broadcast(text: string): void {
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  }
}
