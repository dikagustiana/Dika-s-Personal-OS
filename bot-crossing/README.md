# Bot Crossing

Real-time 3D visualisation of autonomous AI agent execution as activity inside
a stylised desert office campus. Agents walk to desks, sit and type, meet
around tables, carry finished output to the archive terminal — driven entirely
by an event stream, never by the renderer's imagination.

```bash
pnpm install
pnpm dev          # Fastify event server on :4000 + Next.js on :3000
```

Open http://localhost:3000. In the first ten seconds you see a glass-pod
office campus in the desert lit for your local time of day, twenty named
agents standing in the Coffee Lounge, the first of them already walking to
their department's desk bay, and the top bar counting the fleet by state.
Click any agent to open its inspector. Add `?dev=1` to force the developer
panel (time scrubber, grid mode, frame rate, stream inspector) on a
production build.

Environment: copy `.env.example` to `.env` to change ports or point the
client at another event server. `EVENT_SOURCE=live` swaps the mock for the
webhook/SSE adapters (`POST /ingest/langgraph|crewai|autogen|custom`,
`/ingest/canonical`, `/ingest/output`).

```bash
pnpm typecheck
pnpm test:run     # pure-logic tests: hex math, A*, layout, lighting, schema
pnpm build
```

See `PROGRESS.md` for build state, `DECISIONS.md` for every choice made,
`PLACEHOLDERS.md` for what is stubbed, `ASSETS.md` for licences.
