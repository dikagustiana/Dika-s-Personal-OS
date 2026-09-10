# Bot Crossing

Real-time 3D visualisation of autonomous AI agent execution as activity inside
a stylised desert office campus. Agents walk to desks, sit and type, meet
around tables, carry finished output to the archive terminal — driven entirely
by an event stream, never by the renderer's imagination.

```bash
pnpm install
pnpm dev          # Fastify event server on :4000 + Next.js on :3000
```

Open http://localhost:3000. Add `?dev=1` to force the developer panel (time
scrubber, grid mode, frame rate) on a production build.

```bash
pnpm typecheck
pnpm test:run     # pure-logic tests: hex math, A*, layout, lighting, schema
pnpm build
```

See `PROGRESS.md` for build state, `DECISIONS.md` for every choice made,
`PLACEHOLDERS.md` for what is stubbed, `ASSETS.md` for licences.
