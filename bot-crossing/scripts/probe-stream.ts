// Console inspector for the event stream (Phase 3 verification, and a handy
// dev tool): connects to the WebSocket, validates every frame with the same
// Zod schema the browser uses, and prints what it saw after N seconds.
//   pnpm probe 30            (defaults: 30 s, ws://localhost:4000/events)
import WebSocket from 'ws';
import { parseCanonicalEvent } from '../src/core/events/schema';

const seconds = Number(process.argv[2] ?? 30);
const url = process.argv[3] ?? 'ws://localhost:4000/events';
const ws = new WebSocket(url);
const states = new Map<string, number>();
const agents = new Set<string>();
const groups = new Map<string, Set<string>>();
let frames = 0;
let invalid = 0;
let walkingWithTarget = 0;
let deliveringWithTarget = 0;
const invalidSamples: string[] = [];

ws.on('message', (data) => {
  frames++;
  const r = parseCanonicalEvent(data.toString());
  if (!r.ok) {
    invalid++;
    if (invalidSamples.length < 3) invalidSamples.push(r.reason.slice(0, 140));
    return;
  }
  const e = r.event;
  agents.add(e.agentId);
  states.set(e.currentState, (states.get(e.currentState) ?? 0) + 1);
  if (e.currentState === 'OFFICE_WALKING' && e.targetDestinationHex) walkingWithTarget++;
  if (e.currentState === 'OFFICE_DELIVERING' && e.targetDestinationHex) deliveringWithTarget++;
  if (e.collaborationGroupId) {
    const s = groups.get(e.collaborationGroupId) ?? new Set<string>();
    s.add(e.agentId);
    groups.set(e.collaborationGroupId, s);
  }
  if (process.env.PROBE_VERBOSE) console.log(`${e.timestamp} ${e.agentId.padEnd(20)} ${e.currentState.padEnd(22)} ${e.taskDetails.progressPercentage}% ${e.taskDetails.activeSubtask}`);
});
ws.on('open', () => console.log(`connected to ${url}; listening ${seconds}s`));
ws.on('error', (e) => console.error('socket error', e.message));
setTimeout(() => {
  console.log(
    JSON.stringify(
      {
        seconds,
        frames,
        invalid,
        invalidSamples,
        agents: agents.size,
        states: Object.fromEntries(states),
        walkingWithTarget,
        deliveringWithTarget,
        groups: Object.fromEntries(Array.from(groups, ([k, v]) => [k, Array.from(v)])),
      },
      null,
      1,
    ),
  );
  ws.close();
  process.exit(0);
}, seconds * 1000);
