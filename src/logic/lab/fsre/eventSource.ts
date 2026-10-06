/**
 * FSRE BUILDING — WHERE EVENTS COME FROM.
 *
 * The view asks a source for a run (the stage data, the skill data and the
 * events so far) and, for a live source, subscribes to the events that
 * follow. Everything downstream — data.ts, the reducer, the scene, every
 * component — takes FsreRun and FsreEvent and nothing else.
 *
 * THE LIVE SOURCE (milestone M5). It reads the owner-checked edge function
 * fsre-events through an injected call (src/data/fsreLiveFeed.ts; this
 * module stays free of the network), translates the suite's rows with
 * liveMap.ts, and polls every LIVE_POLL_SECONDS. Without a backend, or
 * before the function is deployed and given its database, it says "not
 * connected" — never an empty run. A feed that stops answering, or answers
 * with rows that do not fit, is reported through `subscribe`'s onProblem and
 * is not drawn further: the building keeps what it had and says so.
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
import { z } from 'zod';
import { parseFsreEvent, parseFsreRun, type FsreFileNames, type FsreRawFiles, type FsreRun } from './data';
import type { FsreEvent } from './events';
import { formatNumber } from './format';
import { createLiveMapper, LIVE_SOURCE_NAME, type LiveMapper, type LiveRawEvent } from './liveMap';

export type FsreSourceKind = 'replay' | 'live';

export type FsreLoadFailure = {
  ok: false;
  /** not-connected: an expected state, not an error. invalid-data: a file failed validation. failed: the load itself broke. */
  reason: 'not-connected' | 'invalid-data' | 'failed';
  /** What to tell the reader. Never a count. */
  detail: string;
};

export type FsreLoadResult = { ok: true; run: FsreRun } | FsreLoadFailure;

/** What the approval function answered: whether approval is (or was) possible, and every reason it is not. */
export interface FsreApprovalAnswer {
  ok: boolean;
  reasons: string[];
}

/**
 * The owner's approval, as the partner room sees it (milestone M5): `check`
 * asks the database whether a staged package may be approved and why not;
 * `approve` asks it to approve, re-checking every condition in its own
 * transaction. A refusal is an answer (ok: false, reasons); a failed call
 * throws. Every rule lives in the database; the building only carries the
 * owner's click to it.
 */
export interface FsreApproval {
  check(company: string, version: string): Promise<FsreApprovalAnswer>;
  approve(company: string, version: string): Promise<FsreApprovalAnswer>;
}

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
   * `onProblem` hears why the feed stopped (and null once it answers again).
   */
  subscribe?: (run: FsreRun, onEvents: (events: FsreEvent[]) => void, onProblem?: (detail: string | null) => void) => () => void;
  /** Live sources with a backend only: the owner's approval. A replay never has it. */
  approval?: FsreApproval;
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

/** How often the live source polls its edge function: soon after news, slower while quiet or failing. */
export const LIVE_POLL_SECONDS = { min: 5, max: 10 } as const;

/** The live feed as the source sees it: the function's status and its parsed body (null when not JSON). */
export type LiveFeedCall = (body: { wave?: string; afterSeq?: number }) => Promise<{ status: number; body: unknown }>;

export interface LiveSourceOptions {
  /** Null when this build has no backend: the source then says "not connected". */
  call: LiveFeedCall | null;
  /** The suite's stage and skill data; a dynamic import keeps them out of the main bundle. */
  files: () => Promise<{ stages: unknown; skills: unknown }>;
  /** Timer seam for tests. Returns the cancel. */
  setTimer?: (run: () => void, ms: number) => () => void;
  /** The owner's approval call; offered only together with a feed. */
  approval?: FsreApproval | null;
}

const LIVE_FILE_NAMES: FsreFileNames = { stages: 'stages.json', skills: 'skills.json', replay: LIVE_SOURCE_NAME };
/** One load reads at most this many pages of the function's 500 events. */
const LIVE_MAX_PAGES = 200;

const wavesSchema = z.object({ ok: z.literal(true), waves: z.array(z.object({ wave_id: z.string().min(1) }).passthrough()) });
const pageSchema = z.object({ ok: z.literal(true), wave: z.string().min(1), events: z.array(z.unknown()), more: z.boolean() });

const NOT_CONNECTED = `The live feed is not connected in this build (no backend is configured), so only the replay plays. With one, it polls the owner-checked edge function fsre-events every ${formatNumber(LIVE_POLL_SECONDS.min)} to ${formatNumber(LIVE_POLL_SECONDS.max)} seconds.`;

function feedFailure(status: number, body: unknown): FsreLoadFailure {
  const said = typeof body === 'object' && body !== null && 'reason' in body ? String((body as { reason: unknown }).reason) : null;
  if (status === 404) {
    return { ok: false, reason: 'not-connected', detail: 'The live feed function (fsre-events) is not deployed yet, so only the replay plays.' };
  }
  if (said === 'not-configured') {
    return { ok: false, reason: 'not-connected', detail: 'The live feed function is deployed but has no database connection yet (its secret FSRE_STATUS_DB_URL is not set).' };
  }
  if (status === 401 || status === 403) {
    return { ok: false, reason: 'failed', detail: 'The live feed did not accept this session. Unlock the app with the passphrase again.' };
  }
  return { ok: false, reason: 'failed', detail: `The live feed answered ${formatNumber(status)}${said ? ` (${said})` : ''}.` };
}

function unreachable(error: unknown): string {
  return `The live feed could not be reached: ${error instanceof Error ? error.message : String(error)}`;
}

export function createLiveSource(options: LiveSourceOptions): FsreEventSource {
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  });
  /** The translation state of the last load, per run: a poll continues where the load stopped. */
  const mappers = new Map<string, LiveMapper>();

  return {
    id: 'live',
    label: 'Live pipeline',
    kind: 'live',
    availability: options.call ? 'ready' : 'not-connected',
    ...(options.call && options.approval ? { approval: options.approval } : {}),
    async load() {
      const call = options.call;
      if (!call) return { ok: false, reason: 'not-connected', detail: NOT_CONNECTED };
      try {
        const listed = await call({});
        const waves = wavesSchema.safeParse(listed.body);
        if (listed.status !== 200 || !waves.success) return feedFailure(listed.status, listed.body);
        const wave = waves.data.waves[0]?.wave_id;
        if (!wave) return { ok: false, reason: 'not-connected', detail: 'The live feed answers, and no wave has recorded an event yet.' };
        const label = `Live pipeline · ${wave}`;
        const files = await options.files();
        const empty = parseFsreRun({ ...files, replay: { provisional: false, run: wave, events: [] } }, LIVE_FILE_NAMES, label);
        if (!empty.ok) return { ok: false, reason: 'invalid-data', detail: empty.detail };
        const mapper = createLiveMapper(empty.run.stages, wave);
        const events: LiveRawEvent[] = [];
        for (let page = 0; ; page += 1) {
          if (page === LIVE_MAX_PAGES) return { ok: false, reason: 'failed', detail: `The live feed sent more than ${formatNumber(LIVE_MAX_PAGES)} pages for one wave.` };
          const answer = await call({ wave, afterSeq: mapper.lastSeq() });
          const parsed = pageSchema.safeParse(answer.body);
          if (answer.status !== 200 || !parsed.success) return feedFailure(answer.status, answer.body);
          const mapped = mapper.map(parsed.data.events);
          if (!mapped.ok) return { ok: false, reason: 'invalid-data', detail: mapped.detail };
          events.push(...mapped.events);
          if (!parsed.data.more) break;
        }
        const replay = { provisional: false, run: wave, label, timesRecorded: true, source: `${LIVE_SOURCE_NAME}, wave ${wave}`, events };
        const full = parseFsreRun({ ...files, replay }, LIVE_FILE_NAMES, label);
        if (!full.ok) return { ok: false, reason: 'invalid-data', detail: full.detail };
        mappers.set(full.run.id, mapper);
        return { ok: true, run: full.run };
      } catch (error) {
        return { ok: false, reason: 'failed', detail: unreachable(error) };
      }
    },
    subscribe(run, onEvents, onProblem) {
      const call = options.call;
      const mapper = mappers.get(run.id);
      if (!call || !mapper) return () => undefined;
      let stopped = false;
      let cancel: () => void = () => undefined;
      const stop = (detail: string) => {
        stopped = true;
        onProblem?.(`${detail} The building shows the events up to seq ${formatNumber(mapper.lastSeq())} and stops following the feed.`);
      };
      const tick = async () => {
        if (stopped) return;
        let delay: number = LIVE_POLL_SECONDS.max;
        try {
          const answer = await call({ wave: run.id, afterSeq: mapper.lastSeq() });
          const page = pageSchema.safeParse(answer.body);
          if (answer.status !== 200 || !page.success) {
            onProblem?.(feedFailure(answer.status, answer.body).detail);
          } else {
            const mapped = mapper.map(page.data.events);
            if (!mapped.ok) return stop(mapped.detail);
            const fresh: FsreEvent[] = [];
            for (const raw of mapped.events) {
              const parsed = parseFsreEvent(raw, run);
              if (!parsed.ok) return stop(parsed.detail);
              fresh.push(parsed.event);
            }
            onProblem?.(null);
            if (stopped) return;
            if (fresh.length > 0) onEvents(fresh);
            delay = page.data.more ? 0 : fresh.length > 0 ? LIVE_POLL_SECONDS.min : LIVE_POLL_SECONDS.max;
          }
        } catch (error) {
          onProblem?.(unreachable(error));
        }
        if (!stopped) cancel = setTimer(() => void tick(), delay * 1000);
      };
      cancel = setTimer(() => void tick(), LIVE_POLL_SECONDS.min * 1000);
      return () => {
        stopped = true;
        cancel();
      };
    },
  };
}

/** The suite's stage and skill data, bundled beside the replay (the live feed carries events only). */
const liveFiles = async () => {
  const [stages, skills] = await Promise.all([import('../../../data/fsre/stages.json'), import('../../../data/fsre/skills.json')]);
  return { stages: stages.default, skills: skills.default };
};

/**
 * The live pipeline without a backend: selectable and honest, it answers
 * "not connected" rather than an empty run. The view builds the connected
 * one from src/data/fsreLiveFeed.ts (FsreBuilding's default sources).
 */
export const liveSource: FsreEventSource = createLiveSource({ call: null, files: liveFiles });

/** The live pipeline over the data layer's feed and approval calls (the view passes them). */
export function connectedLiveSource(call: LiveFeedCall | null, approval: FsreApproval | null = null): FsreEventSource {
  return createLiveSource({ call, files: liveFiles, approval });
}

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
