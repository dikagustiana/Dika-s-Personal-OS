import { describe, expect, it } from 'vitest';
import { parseTrackerFeed } from './trackerFeed';

const row = (over: Record<string, unknown> = {}) => ({
  key: 'kMB02',
  kind: 'commit',
  ref: 'MB02',
  title: 'Define contribution layers',
  project: 'Project Margin Bridge',
  detail: 'Komit tanggal',
  date: '2026-10-05',
  url: 'https://board.example/#/p/MB/t/MB02',
  ...over,
});

describe('parseTrackerFeed', () => {
  it('keeps a well-formed feed', () => {
    const feed = parseTrackerFeed({ person: { id: 'x', name: 'Dika' }, today: '2026-10-26', prepare: [row()], review: [], monitor: [] });
    expect(feed?.person).toBe('Dika');
    expect(feed?.prepare).toHaveLength(1);
  });

  it('refuses an answer that is not a feed', () => {
    expect(parseTrackerFeed(null)).toBeNull();
    expect(parseTrackerFeed({ error: 'Token tidak dikenal.' })).toBeNull();
    expect(parseTrackerFeed({ today: '2026-10-26', prepare: [], review: [] })).toBeNull();
  });

  it('drops rows with missing fields or a link that is not https', () => {
    const feed = parseTrackerFeed({
      today: '2026-10-26',
      prepare: [row({ title: 3 }), row({ url: 'javascript:alert(1)' }), row({ url: 'http://board.example/' }), row({ url: 'not a url' }), row()],
      review: [{}],
      monitor: [null],
    });
    expect(feed?.prepare.map((x) => x.key)).toEqual(['kMB02']);
    expect(feed?.review).toEqual([]);
    expect(feed?.monitor).toEqual([]);
  });

  it('keeps only the known fields of a row', () => {
    const feed = parseTrackerFeed({ today: '2026-10-26', prepare: [row({ extra: '<script>' })], review: [], monitor: [] });
    expect(Object.keys(feed?.prepare[0] ?? {}).sort()).toEqual(['date', 'detail', 'key', 'kind', 'project', 'ref', 'title', 'url']);
  });
});
