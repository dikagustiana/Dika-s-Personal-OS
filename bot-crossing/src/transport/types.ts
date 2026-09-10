export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface TransportHandlers {
  /** One inbound frame, still unvalidated text. */
  onFrame(text: string, receivedAtMs: number): void;
  onStatus(status: ConnectionStatus, detail?: string): void;
}

/** The client-side stream. WebSocket today; an SSE implementation is a one-line swap. */
export interface ClientEventSource {
  start(): void;
  stop(): void;
}
