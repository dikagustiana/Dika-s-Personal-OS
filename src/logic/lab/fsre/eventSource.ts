/**
 * FSRE BUILDING — WHERE EVENTS COME FROM. THE ONE MODULE THAT CHANGES FOR LIVE.
 *
 * The view asks a source for a run (the stage data, the skill data and the
 * events so far) and, for a live source, subscribes to the events that
 * follow. Everything downstream — data.ts, the reducer, the scene, every
 * component — takes FsreRun and FsreEvent and nothing else, so when
 * milestone M5 lands, liveSource below is the only code that changes: it
 * will poll an owner-checked edge function every LIVE_POLL_SECONDS and
 * hand new events to `subscribe`'s callback.
 *
 * WHY A RESULT, NOT A THROW. load() resolves to a result union, the same
 * idea as ReadResult in src/data/readResult.ts: "not connected" and "the
 * file is malformed" are expected outcomes the screen must SAY, and an
 * exception crossing into a component is how a failure ends up rendered as
 * an empty building that looks like a quiet day.
 *
 * WHY THE CURSOR LIVES IN THE VIEW. A cursor is "how many events are
 * applied", which is the reader's position, not the source's. The source
 * only ever appends; `appendEvents` and `followCursor` below are the whole
 * contract between the two: new events are added in order without
 * duplicates (a poll may resend), and a reader who was at the end moves to
 * the new end while a reader who stepped back stays where they were.
 *
 * Replay data is bundled and reached through a dynamic import, so the
 * fixtures land in the building's lazy chunk and never in the main bundle.
 */
import { parseFsreRun, type FsreFileNames, type FsreRawFiles, type FsreRun } from './data';
import type { FsreEvent } from './events';
import { formatNumber } from './format';

export type FsreSourceKind = 'replay' | 'live';

export type FsreLoadFailure = {
  ok: false;
  /** not-connected: an expected state, not an error. invalid-data: a file failed validation. failed: the load itself broke. */
  reason: 'not-connected' | 'invalid-data' | 'failed';
  /** What to tell the reader. Never a count. */
  detail: string;
};

export type FsreLoadResult = { ok: true; run: FsreRun } | FsreLoadFailure;

export interface FsreEventSource {
  id: string;
  /** Shown on the run switcher. */
  label: string;
  kind: FsreSourceKind;
  /** What the switcher can say before anything is loaded. */
  availability: 'ready' | 'not-connected';
  load(): Promise<FsreLoadResult>;
  /**
   * Live sources only: deliver events that arrive after load(), in order.
   * Returns the unsubscribe. A replay has nothing more to say and omits it.
   */
  subscribe?: (run: FsreRun, onEvents: (events: FsreEvent[]) => void) => () => void;
}

export interface ReplaySourceOptions {
  id: string;
  label: string;
  fileNames: FsreFileNames;
  /** Resolves the three raw files; a dynamic import keeps them out of the main bundle. */
  files: () => Promise<FsreRawFiles>;
}

export function createReplaySource(options: ReplaySourceOptions): FsreEventSource {
  return {
    id: options.id,
    label: options.label,
    kind: 'replay',
    availability: 'ready',
    async load() {
      let raw: FsreRawFiles;
      try {
        raw = await options.files();
      } catch (error) {
        return { ok: false, reason: 'failed', detail: `The replay files could not be loaded: ${error instanceof Error ? error.message : String(error)}` };
      }
      const parsed = parseFsreRun(raw, options.fileNames, options.label);
      return parsed.ok ? { ok: true, run: parsed.run } : { ok: false, reason: 'invalid-data', detail: parsed.detail };
    },
  };
}

/** M5: how often the live source will poll its edge function. */
export const LIVE_POLL_SECONDS = { min: 5, max: 10 } as const;

/**
 * The live pipeline, not connected yet. Typed, selectable, and honest: it
 * answers "not connected" rather than an empty run, so the building can
 * never show a live feed that is not there. M5 replaces load() with the
 * first poll and adds `subscribe`.
 */
export const liveSource: FsreEventSource = {
  id: 'live',
  label: 'Live pipeline',
  kind: 'live',
  availability: 'not-connected',
  async load() {
    return {
      ok: false,
      reason: 'not-connected',
      detail: `The live feed is not connected yet. It will poll an owner-checked edge function every ${formatNumber(LIVE_POLL_SECONDS.min)} to ${formatNumber(LIVE_POLL_SECONDS.max)} seconds once milestone M5 is built; until then only the replay plays.`,
    };
  },
};

/** Add incoming events after the current ones, in order, skipping ids already present. */
export function appendEvents(current: readonly FsreEvent[], incoming: readonly FsreEvent[]): FsreEvent[] {
  if (incoming.length === 0) return [...current];
  const seen = new Set(current.map((event) => event.id));
  const fresh = incoming.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  return [...current, ...fresh];
}

/** The bundled replay's files, as the screen names them when it says which is provisional. */
export const REPLAY_FILE_NAMES: FsreFileNames = { stages: 'stages.json', skills: 'skills.json', replay: 'replay-unvr.json' };

/**
 * The dry run, replayed from src/data/fsre/ (copied unchanged from the GLM
 * build; every file still says it is provisional). Dynamic imports: the
 * three files become their own chunks, fetched only when the building is
 * opened, and never part of the main bundle.
 */
export const replaySource: FsreEventSource = createReplaySource({
  id: 'replay',
  label: `Replay of ${REPLAY_FILE_NAMES.replay}`,
  fileNames: REPLAY_FILE_NAMES,
  files: async () => {
    const [stages, skills, replay] = await Promise.all([
      import('../../../data/fsre/stages.json'),
      import('../../../data/fsre/skills.json'),
      import('../../../data/fsre/replay-unvr.json'),
    ]);
    return { stages: stages.default, skills: skills.default, replay: replay.default };
  },
});

/** The run switcher's entries, in order. The first is opened by default. */
export const FSRE_SOURCES: readonly FsreEventSource[] = [replaySource, liveSource];

/** A reader at the end follows new events; a reader who stepped back stays put. */
export function followCursor(cursor: number, previousLength: number, nextLength: number): number {
  return cursor >= previousLength ? nextLength : cursor;
}
