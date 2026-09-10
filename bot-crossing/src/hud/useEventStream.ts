'use client';
import { useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { WebSocketEventSource } from '@/transport/WebSocketEventSource';

export function eventStreamUrl(): string {
  if (process.env.NEXT_PUBLIC_EVENT_WS_URL) return process.env.NEXT_PUBLIC_EVENT_WS_URL;
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.hostname}:4000/events`;
  }
  return 'ws://localhost:4000/events';
}

/** Opens the canonical event stream for the lifetime of the app and feeds the agent store. */
export function useEventStream(): void {
  useEffect(() => {
    const store = useAgentStore.getState();
    const source = new WebSocketEventSource(eventStreamUrl(), {
      onFrame: (text, at) => useAgentStore.getState().ingestFrame(text, at),
      onStatus: (status, detail) => useAgentStore.getState().setConnection(status, detail),
    });
    store.setConnection('connecting');
    source.start();
    return () => source.stop();
  }, []);
}
