// The SSE client parser. The server frames are `event: X\ndata: {json}\n\n`;
// the parser must hold torn frames across reads and drop malformed ones
// without dropping the run — the run row, not this parser, is the record.
import { describe, expect, it } from 'vitest';
import { drainSseBuffer } from './labModel';

describe('drainSseBuffer', () => {
  it('parses complete frames and keeps the torn tail', () => {
    const buffer =
      'event: run\ndata: {"runId":"r1","provider":"kimi","model":"m"}\n\n' +
      'event: delta\ndata: {"text":"hal"}\n\n' +
      'event: delta\ndata: {"text":"o'; // torn — no closing \n\n
    const { frames, rest } = drainSseBuffer(buffer);
    expect(frames).toEqual([
      { event: 'run', data: { runId: 'r1', provider: 'kimi', model: 'm' } },
      { event: 'delta', data: { text: 'hal' } },
    ]);
    expect(rest).toBe('event: delta\ndata: {"text":"o');
  });

  it('finishes the torn frame once the rest arrives', () => {
    const first = drainSseBuffer('event: delta\ndata: {"te');
    expect(first.frames).toEqual([]);
    const second = drainSseBuffer(`${first.rest}xt":"ok"}\n\n`);
    expect(second.frames).toEqual([{ event: 'delta', data: { text: 'ok' } }]);
    expect(second.rest).toBe('');
  });

  it('drops a malformed frame without dropping its neighbours', () => {
    const buffer =
      'event: delta\ndata: {not json}\n\n' + 'event: done\ndata: {"runId":"r1","status":"ok"}\n\n';
    const { frames } = drainSseBuffer(buffer);
    expect(frames).toEqual([{ event: 'done', data: { runId: 'r1', status: 'ok' } }]);
  });

  it('defaults the event name to message when the server omits it', () => {
    const { frames } = drainSseBuffer('data: {"x":1}\n\n');
    expect(frames).toEqual([{ event: 'message', data: { x: 1 } }]);
  });
});
