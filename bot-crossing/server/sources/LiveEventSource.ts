// Live connectors (C-5): webhook routes per framework plus an optional upstream
// SSE reader, all normalising through the same adapters, positioner and
// scheduler as the mock. Swapping mock for live is one line in server/index.ts.
import type { FastifyInstance } from 'fastify';
import { ADAPTERS, isAdapterName } from '../adapters';
import type { AdapterName } from '../adapters/types';
import { EmissionScheduler } from '../scheduler';
import type { EventSource, SourceContext } from './types';

export interface LiveOptions {
  /** An upstream text/event-stream endpoint to subscribe to, e.g. a LangGraph stream. */
  upstreamSseUrl?: string;
  upstreamFormat?: AdapterName;
}

export class LiveEventSource implements EventSource {
  readonly name = 'live';
  private scheduler!: EmissionScheduler;
  private ctx!: SourceContext;
  private stopped = false;
  private abort: AbortController | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly opts: LiveOptions = {},
  ) {}

  start(ctx: SourceContext): void {
    this.ctx = ctx;
    this.scheduler = new EmissionScheduler(ctx, 'live');

    this.app.post<{ Params: { adapter: string } }>('/ingest/:adapter', async (req, reply) => {
      const name = req.params.adapter;
      if (!isAdapterName(name)) return reply.code(404).send({ error: `unknown adapter '${name}'`, adapters: Object.keys(ADAPTERS) });
      const accepted = this.ingest(name, req.body);
      return reply.code(202).send({ accepted });
    });

    // Already-canonical events (or a batch), validated by the bus.
    this.app.post('/ingest/canonical', async (req, reply) => {
      const list = Array.isArray(req.body) ? req.body : [req.body];
      let ok = 0;
      for (const ev of list) if (ctx.publish(ev)) ok++;
      return reply.code(ok === list.length ? 202 : 422).send({ accepted: ok, rejected: list.length - ok });
    });

    // Output documents for the inspector's preview.
    this.app.post<{ Body: { taskId?: string; agentId?: string; title?: string; department?: string; content?: string } }>(
      '/ingest/output',
      async (req, reply) => {
        const b = req.body ?? {};
        if (!b.taskId || typeof b.content !== 'string') return reply.code(400).send({ error: 'taskId and content are required' });
        ctx.storeOutput({
          taskId: b.taskId,
          agentId: b.agentId ?? 'unknown',
          title: b.title ?? b.taskId,
          department: b.department ?? '',
          format: 'markdown',
          content: b.content,
          generatedAt: new Date().toISOString(),
        });
        return reply.code(202).send({ stored: true });
      },
    );

    if (this.opts.upstreamSseUrl) void this.readUpstream(this.opts.upstreamSseUrl, this.opts.upstreamFormat ?? 'custom');
    ctx.log(`live source started: POST /ingest/{${Object.keys(ADAPTERS).join('|')}} · /ingest/canonical · /ingest/output`);
  }

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    this.scheduler?.cancelAll();
  }

  private ingest(name: AdapterName, body: unknown): number {
    const events = ADAPTERS[name].normalize(body);
    for (const ev of events) this.scheduler.emit(ev);
    return events.length;
  }

  /** Minimal SSE client with reconnect; each `data:` payload goes through the adapter. */
  private async readUpstream(url: string, format: AdapterName): Promise<void> {
    let backoff = 1000;
    while (!this.stopped) {
      this.abort = new AbortController();
      try {
        const res = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: this.abort.signal });
        if (!res.ok || !res.body) throw new Error(`upstream ${res.status}`);
        this.ctx.log(`upstream SSE connected: ${url} (${format})`);
        backoff = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const data = chunk
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
              .join('\n');
            if (!data) continue;
            try {
              this.ingest(format, JSON.parse(data));
            } catch (e) {
              this.ctx.log(`upstream frame dropped: ${(e as Error).message}`);
            }
          }
        }
      } catch (e) {
        if (this.stopped) return;
        this.ctx.log(`upstream SSE error: ${(e as Error).message}; retry in ${backoff}ms`);
      }
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}
