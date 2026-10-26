/**
 * The SAMB Project Board's feed for the owner: what they prepare, review and
 * monitor there, read-only (D-29). Served by the owner-checked edge function
 * tracker-feed, which holds the board's feed token.
 *
 * The board is another system, so its answer is checked here before anything
 * renders: an item without the expected fields is dropped, and a link that is
 * not https is dropped with it — the card renders each url as an <a href>, and
 * a javascript: url there would run in this app.
 */
import { readStoredKey } from '../components/PassphraseGate';

export interface TrackerItem {
  key: string;
  kind: string;
  ref: string;
  title: string;
  project: string;
  detail: string;
  date: string;
  url: string;
}

export interface TrackerFeed {
  person: string;
  today: string;
  prepare: TrackerItem[];
  review: TrackerItem[];
  monitor: TrackerItem[];
}

export type TrackerFeedResult =
  | { ok: true; feed: TrackerFeed }
  | { ok: false; reason: string };

const FIELDS = ['key', 'kind', 'ref', 'title', 'project', 'detail', 'date', 'url'] as const;

function item(raw: unknown): TrackerItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!FIELDS.every((f) => typeof r[f] === 'string')) return null;
  let url: URL;
  try {
    url = new URL(r.url as string);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const out = Object.fromEntries(FIELDS.map((f) => [f, r[f] as string])) as unknown as TrackerItem;
  return { ...out, url: url.href };
}

const items = (raw: unknown): TrackerItem[] =>
  Array.isArray(raw) ? raw.map(item).filter((x): x is TrackerItem => x !== null) : [];

/** The board's answer, or null when it is not a feed at all. */
export function parseTrackerFeed(raw: unknown): TrackerFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const person = r.person as Record<string, unknown> | undefined;
  if (typeof r.today !== 'string' || !Array.isArray(r.prepare) || !Array.isArray(r.review) || !Array.isArray(r.monitor)) return null;
  return {
    person: typeof person?.name === 'string' ? person.name : '',
    today: r.today,
    prepare: items(r.prepare),
    review: items(r.review),
    monitor: items(r.monitor),
  };
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export async function fetchTrackerFeed(): Promise<TrackerFeedResult> {
  if (!url || !anonKey) return { ok: false, reason: 'not-configured' };
  const appKey = readStoredKey();
  try {
    const response = await fetch(`${url}/functions/v1/tracker-feed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        ...(appKey ? { 'x-app-key': appKey } : {}),
      },
      body: '{}',
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; reason?: string; feed?: unknown } | null;
    if (!response.ok || !body?.ok) return { ok: false, reason: body?.reason ?? `http-${response.status}` };
    const feed = parseTrackerFeed(body.feed);
    return feed ? { ok: true, feed } : { ok: false, reason: 'bad-answer' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
