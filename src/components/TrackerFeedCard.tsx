import { ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { EmptyRow } from './ui/EmptyRow';
import { fetchTrackerFeed, type TrackerFeedResult, type TrackerItem } from '../data/trackerFeed';

const GROUPS = [
  { id: 'prepare', label: 'Prepare', empty: 'Nothing of yours is due or waiting on you to send' },
  { id: 'review', label: 'Review', empty: 'Nobody is waiting on your judgement' },
  { id: 'monitor', label: 'Monitor', empty: 'Nothing you wait on, nothing late in your projects' },
] as const;

const REASONS: Record<string, string> = {
  'not-configured': 'The tracker link is not set up yet (TRACKER_FEED_URL / TRACKER_FEED_TOKEN).',
  'tracker-refused': 'The board refused the feed token. Mint a new one (tracker docs/deploy.md §23).',
  'tracker-unreachable': 'The board did not answer.',
  unreachable: 'The tracker feed could not be reached.',
  Unauthorized: 'Unlock with the passphrase to read the tracker.',
};

/**
 * The SAMB Project Board, read-only (D-29): what the owner prepares, reviews
 * and monitors there. Read fresh on every visit, never copied into os_entries,
 * so it cannot go stale or touch the daily score. Every row opens the board,
 * where the work itself is done.
 */
export function TrackerFeedCard() {
  const [result, setResult] = useState<TrackerFeedResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setResult(await fetchTrackerFeed());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const feed = result?.ok ? result.feed : null;
  const total = feed ? feed.prepare.length + feed.review.length + feed.monitor.length : 0;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Project tracker</CardTitle>
          <p className="mt-2 text-sm text-foreground-muted">From the SAMB Project Board, read-only.</p>
        </div>
        <div className="flex items-center gap-2">
          {feed && <span className="text-xs tabular-nums text-foreground-muted">{total}</span>}
          <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading} aria-label="Refresh the tracker feed">
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {result && !result.ok && (
          <p className="text-sm text-foreground-muted">{REASONS[result.reason] ?? `The tracker feed failed (${result.reason}).`}</p>
        )}
        {!result && <p className="text-sm text-foreground-muted">Reading the board…</p>}
        {feed &&
          GROUPS.map((group) => (
            <section key={group.id} className="mb-4 last:mb-0">
              <p className="surface-label mb-1">
                {group.label} <span className="tabular-nums">· {feed[group.id].length}</span>
              </p>
              <div className="divide-y divide-border-subtle">
                {feed[group.id].map((item) => (
                  <TrackerRow key={item.key} item={item} />
                ))}
                {feed[group.id].length === 0 && <EmptyRow label={group.label} clause={group.empty} />}
              </div>
            </section>
          ))}
      </CardContent>
    </Card>
  );
}

function TrackerRow({ item }: { item: TrackerItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-11 items-center gap-3 py-1.5 transition-colors duration-150 hover:bg-surface-2/50"
    >
      <span className="w-12 shrink-0 text-xs tabular-nums text-foreground-muted">{item.ref}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{item.title}</p>
        <p className="truncate text-xs text-foreground-muted">
          {item.project} · {item.detail} · <span className="tabular-nums">{item.date}</span>
        </p>
      </div>
      <ExternalLink className="size-4 shrink-0 text-foreground-muted" aria-hidden />
    </a>
  );
}
