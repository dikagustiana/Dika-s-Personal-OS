// Bot Crossing event server. One WebSocket endpoint carries the canonical
// stream; REST serves telemetry history and output documents; the event
// source is chosen by EVENT_SOURCE (mock | live).
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { EventBus } from './eventBus';
import { LiveEventSource } from './sources/LiveEventSource';
import { MockEventSource } from './sources/MockEventSource';
import type { EventSource, SourceContext } from './sources/types';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';
const SOURCE = (process.env.EVENT_SOURCE ?? 'mock').toLowerCase();

async function main(): Promise<void> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const log = (msg: string) => app.log.info(msg);
  const bus = new EventBus(log);

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get('/health', async () => ({ ok: true, source: SOURCE, ...bus.getStats() }));
  app.get('/api/stats', async () => bus.getStats());
  app.get('/api/agents', async () => bus.snapshot());
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/agents/:id/history', async (req) => {
    const limit = Math.min(300, Math.max(1, Number(req.query.limit ?? 100) || 100));
    return bus.historyFor(req.params.id, limit);
  });
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/output', async (req, reply) => {
    const doc = bus.getOutput(req.params.taskId);
    // No output yet is a normal state, not an error: 204 keeps the browser console quiet.
    if (!doc) return reply.code(204).send();
    return doc;
  });

  app.get('/events', { websocket: true }, (socket) => {
    bus.addClient(socket);
  });

  const ctx: SourceContext = {
    publish: (e) => bus.publish(e),
    publishRaw: (t) => bus.publishRaw(t),
    storeOutput: (d) => bus.storeOutput(d),
    log,
  };

  // Swapping sources is this one line (A-5).
  const source: EventSource =
    SOURCE === 'live'
      ? new LiveEventSource(app, {
          upstreamSseUrl: process.env.UPSTREAM_SSE_URL,
          upstreamFormat: (process.env.UPSTREAM_FORMAT as 'langgraph' | 'crewai' | 'autogen' | 'custom' | undefined) ?? 'custom',
        })
      : new MockEventSource({
          includeMalformed: process.env.MOCK_INCLUDE_MALFORMED !== '0',
          includeUnknownState: process.env.MOCK_INCLUDE_UNKNOWN_STATE !== '0',
        });

  await source.start(ctx);
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`event source: ${source.name} · ws://localhost:${PORT}/events`);

  const shutdown = async () => {
    source.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
