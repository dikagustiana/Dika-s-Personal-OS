'use client';
import type { ClientEventSource, TransportHandlers } from './types';

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

/**
 * WebSocket transport with exponential-backoff reconnect. It hands every frame
 * to the handler unparsed; validation happens in the store's ingest path,
 * which is the transport boundary for the app.
 */
export class WebSocketEventSource implements ClientEventSource {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = MIN_BACKOFF_MS;
  private stopped = true;
  private everOpened = false;

  constructor(
    private readonly url: string,
    private readonly handlers: TransportHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.handlers.onStatus('closed');
  }

  private connect(): void {
    if (this.stopped) return;
    this.handlers.onStatus(this.everOpened ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.scheduleReconnect(`could not open socket: ${(e as Error).message}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.everOpened = true;
      this.backoff = MIN_BACKOFF_MS;
      this.handlers.onStatus('open');
    };
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') this.handlers.onFrame(m.data, Date.now());
    };
    ws.onerror = () => {
      /* onclose follows; the reconnect happens there. */
    };
    ws.onclose = (ev) => {
      this.ws = null;
      if (this.stopped) return;
      this.scheduleReconnect(`socket closed (${ev.code})`);
    };
  }

  private scheduleReconnect(detail: string): void {
    this.handlers.onStatus('reconnecting', `${detail}; retry in ${this.backoff} ms`);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }
}
