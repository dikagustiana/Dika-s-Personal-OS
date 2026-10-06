import { describe, expect, it } from 'vitest';
import stagesFile from '../../../data/fsre/stages.json';
import skillsFile from '../../../data/fsre/skills.json';
import type { FsreEvent } from './events';
import { createLiveSource, LIVE_POLL_SECONDS, liveSource, type LiveFeedCall } from './eventSource';

const WAVE = 'wave-2026-09';
const files = async () => ({ stages: stagesFile, skills: skillsFile });

type Answer = { status: number; body: unknown } | Error;

/** A feed that answers from a script, and remembers what it was asked. */
function scriptedFeed(answers: Answer[]) {
  const asked: Array<{ wave?: string; afterSeq?: number }> = [];
  const call: LiveFeedCall = async (body) => {
    asked.push(body);
    const next = answers.shift();
    if (!next) throw new Error('the script ran out');
    if (next instanceof Error) throw next;
    return next;
  };
  return { call, asked };
}

/** Timers that run only when the test says so. */
function manualTimers() {
  const pending: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  return {
    setTimer: (run: () => void, ms: number) => {
      const timer = { run, ms, cancelled: false };
      pending.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    pending: () => pending.filter((t) => !t.cancelled),
    async fire() {
      const timer = pending.find((t) => !t.cancelled);
      if (!timer) throw new Error('no timer pending');
      timer.cancelled = true;
      timer.run();
      // let the tick's awaits settle
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
  };
}

let seq = 0;
const move = (stage: string, status: string, from: [string, string]) => ({
  seq: ++seq,
  wave_id: WAVE,
  company_id: 'INTP',
  kind: 'transition',
  stage,
  stage_status: status,
  from_stage: from[0],
  from_status: from[1],
  review_cycle: 0,
  actor: 'router',
  ref: null,
  at: '2026-10-06T01:00:00Z',
  payload: {},
});
const waves = { status: 200, body: { ok: true, waves: [{ wave_id: WAVE, last_at: '2026-10-06T01:00:00Z', events: 3 }, { wave_id: 'wave-2026-02' }] } };
const page = (events: unknown[], more = false) => ({ status: 200, body: { ok: true, wave: WAVE, events, more } });

describe('the live source', () => {
  it('without a backend says "not connected", never an empty run', async () => {
    expect(liveSource.availability).toBe('not-connected');
    expect(await liveSource.load()).toMatchObject({ ok: false, reason: 'not-connected' });
  });

  it.each([
    [{ status: 404, body: { code: 'NOT_FOUND' } }, 'not-connected', 'not deployed'],
    [{ status: 500, body: { ok: false, reason: 'not-configured' } }, 'not-connected', 'FSRE_STATUS_DB_URL'],
    [{ status: 401, body: { ok: false, reason: 'bad-key' } }, 'failed', 'passphrase'],
    [{ status: 502, body: { ok: false, reason: 'read-failed' } }, 'failed', '502 (read-failed)'],
    [new Error('offline'), 'failed', 'could not be reached: offline'],
  ] as const)('says what the feed answered: %#', async (answer, reason, words) => {
    const result = await createLiveSource({ call: scriptedFeed([answer]).call, files }).load();
    expect(result).toMatchObject({ ok: false, reason });
    expect(result.ok ? '' : result.detail).toContain(words);
  });

  it('says so when no wave has recorded an event', async () => {
    const result = await createLiveSource({ call: scriptedFeed([{ status: 200, body: { ok: true, waves: [] } }]).call, files }).load();
    expect(result).toMatchObject({ ok: false, reason: 'not-connected' });
  });

  it('loads the newest wave page by page, as a final (not provisional) run', async () => {
    seq = 0;
    const feed = scriptedFeed([
      waves,
      page([move('selected', 'in_progress', ['selected', 'pending'])], true),
      page([move('selected', 'passed', ['selected', 'in_progress'])]),
    ]);
    const result = await createLiveSource({ call: feed.call, files }).load();
    expect(feed.asked).toEqual([{}, { wave: WAVE, afterSeq: 0 }, { wave: WAVE, afterSeq: 1 }]);
    if (!result.ok) throw new Error(result.detail);
    expect(result.run.id).toBe(WAVE);
    expect(result.run.label).toBe(`Live pipeline · ${WAVE}`);
    expect(result.run.events.map((e) => [e.id, e.kind])).toEqual([['s1', 'stage_started'], ['s2', 'stage_completed']]);
    expect(result.run.provenance.find((p) => p.file === 'replay')).toMatchObject({ provisional: false, stated: true });
  });

  it('refuses a feed whose rows do not fit', async () => {
    seq = 0;
    const bad = { ...move('selected', 'in_progress', ['selected', 'pending']), seq: 3 };
    const result = await createLiveSource({ call: scriptedFeed([waves, page([bad])]).call, files }).load();
    expect(result).toMatchObject({ ok: false, reason: 'invalid-data' });
  });

  it('follows the feed: new events in order, quiet polls slower, a stranger stops it', async () => {
    seq = 0;
    const first = move('selected', 'in_progress', ['selected', 'pending']);
    const second = move('selected', 'passed', ['selected', 'in_progress']);
    const feed = scriptedFeed([waves, page([first]), page([first, second]), page([]), new Error('offline'), page([{ ...second, seq: 9 }])]);
    const timers = manualTimers();
    const source = createLiveSource({ call: feed.call, files, setTimer: timers.setTimer });
    const loaded = await source.load();
    if (!loaded.ok) throw new Error(loaded.detail);

    const delivered: FsreEvent[][] = [];
    const problems: Array<string | null> = [];
    const unsubscribe = source.subscribe?.(loaded.run, (batch) => delivered.push(batch), (detail) => problems.push(detail));
    expect(timers.pending().map((t) => t.ms)).toEqual([LIVE_POLL_SECONDS.min * 1000]);

    await timers.fire(); // the resent first row is skipped, the second arrives
    expect(feed.asked.at(-1)).toEqual({ wave: WAVE, afterSeq: 1 });
    expect(delivered.map((batch) => batch.map((e) => e.id))).toEqual([['s2']]);
    expect(timers.pending().map((t) => t.ms)).toEqual([LIVE_POLL_SECONDS.min * 1000]);

    await timers.fire(); // nothing new: poll slower
    expect(timers.pending().map((t) => t.ms)).toEqual([LIVE_POLL_SECONDS.max * 1000]);

    await timers.fire(); // unreachable: say so, keep trying
    expect(problems.at(-1)).toContain('could not be reached');
    expect(timers.pending()).toHaveLength(1);

    await timers.fire(); // a gap: stop following, keep what was drawn
    expect(problems.at(-1)).toContain('stops following the feed');
    expect(problems.at(-1)).toContain('seq 2');
    expect(timers.pending()).toHaveLength(0);
    expect(delivered).toHaveLength(1);
    unsubscribe?.();
  });

  it('unsubscribing cancels the next poll', async () => {
    seq = 0;
    const feed = scriptedFeed([waves, page([move('selected', 'in_progress', ['selected', 'pending'])])]);
    const timers = manualTimers();
    const source = createLiveSource({ call: feed.call, files, setTimer: timers.setTimer });
    const loaded = await source.load();
    if (!loaded.ok) throw new Error(loaded.detail);
    const unsubscribe = source.subscribe?.(loaded.run, () => undefined);
    expect(timers.pending()).toHaveLength(1);
    unsubscribe?.();
    expect(timers.pending()).toHaveLength(0);
    expect(feed.asked).toHaveLength(2);
  });
});
