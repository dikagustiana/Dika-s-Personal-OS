import { describe, expect, it } from 'vitest';
import type { FsreEvent } from './events';
import { FSRE_SOURCES, appendEvents, createReplaySource, followCursor, liveSource, replaySource, type FsreEventSource } from './eventSource';
import { buildContext, createStateCache, reduceEvents } from './reducer';
import { PROVISIONAL_FILES, REAL_DATA, UNVR_FILE_NAMES, tenCompanyRun } from './__fixtures__/fsreFixtures';

const replay = (files: () => Promise<typeof PROVISIONAL_FILES>) =>
  createReplaySource({ id: 'replay-test', label: 'Replay of the test run', fileNames: UNVR_FILE_NAMES, files });

describe('a replay source (over the provisional GLM fixture)', () => {
  it('loads, validates and labels its run', async () => {
    const source = replay(async () => PROVISIONAL_FILES);
    expect(source).toMatchObject({ id: 'replay-test', kind: 'replay', availability: 'ready' });
    expect(source.subscribe).toBeUndefined();
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.label).toBe('Replay of the test run');
    expect(result.run.events).toHaveLength(17);
    expect(result.run.provenance.map((p) => p.fileName)).toEqual(['stages.json', 'skills.json', 'replay-unvr.json']);
  });

  it('says the data is invalid, and where, instead of showing an empty building', async () => {
    const result = await replay(async () => ({ ...PROVISIONAL_FILES, stages: { stages: 'none' } })).load();
    expect(result).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(!result.ok && result.detail).toContain('stages.json');
  });

  it('says the load failed when the files cannot be reached', async () => {
    const result = await replay(async () => {
      throw new Error('chunk missing');
    }).load();
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    expect(!result.ok && result.detail).toContain('chunk missing');
  });
});

describe('the bundled replay (src/data/fsre/, the real export of brief 04)', () => {
  it('validates through data.ts, with no file provisional and each file giving its own source', async () => {
    const result = await replaySource.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.id).toBe(REAL_DATA.replay.run);
    expect(result.run.events).toHaveLength(REAL_DATA.replay.events.length);
    expect(result.run.events).toHaveLength(50);
    expect(result.run.stages).toHaveLength(13);
    expect(result.run.skills).toHaveLength(11);
    expect(result.run.timesRecorded).toBe(true);
    expect(result.run.provenance).toEqual([
      { file: 'stages', fileName: 'stages.json', provisional: false, stated: true, source: REAL_DATA.stages.source },
      { file: 'skills', fileName: 'skills.json', provisional: false, stated: true, source: REAL_DATA.skills.source },
      { file: 'replay', fileName: 'replay-unvr.json', provisional: false, stated: true, source: REAL_DATA.replay.source },
    ]);
  });

  it('is offered first, before the live pipeline', () => {
    expect(FSRE_SOURCES.map((source) => source.id)).toEqual(['replay', 'live']);
    expect(new Set(FSRE_SOURCES.map((source) => source.id)).size).toBe(FSRE_SOURCES.length);
  });
});

describe('the live source, before milestone M5', () => {
  it('is typed, selectable and answers "not connected" — never an empty run', async () => {
    expect(liveSource).toMatchObject({ id: 'live', kind: 'live', availability: 'not-connected' });
    expect(liveSource.subscribe).toBeUndefined();
    const result = await liveSource.load();
    expect(result).toMatchObject({ ok: false, reason: 'not-connected' });
    expect(!result.ok && result.detail).toContain('5 to 10 seconds');
  });
});

describe('the cursor contract between a source and the view', () => {
  const run = tenCompanyRun();
  const events = run.events;

  it('appends in order and skips events a poll sends twice', () => {
    const head = events.slice(0, 10);
    const next = appendEvents(head, [events[9], events[10], events[11], events[10]]);
    expect(next.map((e) => e.id)).toEqual(events.slice(0, 12).map((e) => e.id));
    expect(appendEvents(head, [])).toEqual(head);
  });

  it('moves a reader at the end to the new end, and leaves a reader who stepped back', () => {
    expect(followCursor(10, 10, 14)).toBe(14);
    expect(followCursor(6, 10, 14)).toBe(6);
  });

  it('feeds a subscribing source through the same reducer: only the source differs', async () => {
    // A stand-in for M5: loads the first half, then delivers the rest.
    let deliver: (batch: FsreEvent[]) => void = () => {};
    const fakeLive: FsreEventSource = {
      id: 'fake-live',
      label: 'Fake live',
      kind: 'live',
      availability: 'ready',
      load: async () => ({ ok: true, run: { ...run, events: events.slice(0, 50) } }),
      subscribe: (_run, onEvents) => {
        deliver = onEvents;
        return () => {
          deliver = () => {};
        };
      },
    };
    const loaded = await fakeLive.load();
    if (!loaded.ok) throw new Error('fake live failed');
    const ctx = buildContext(loaded.run);
    const cache = createStateCache(ctx);
    let list = loaded.run.events;
    let cursor = list.length;
    cache.stateAt(list, cursor);
    const unsubscribe = fakeLive.subscribe?.(loaded.run, (batch) => {
      const next = appendEvents(list, batch);
      cursor = followCursor(cursor, list.length, next.length);
      list = next;
    });
    deliver(events.slice(50, 90));
    deliver(events.slice(85));
    unsubscribe?.();
    deliver(events.slice(0, 3)); // after unsubscribe: ignored
    expect(cursor).toBe(events.length);
    expect(cache.stateAt(list, cursor)).toEqual(reduceEvents(ctx, events));
  });
});
