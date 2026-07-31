import { useMemo, useState } from 'react';
import { Check, Copy, Link2, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { rowsOf, type ReadResult } from '../../data/readResult';
import type { FinishLineEntity, ShareLink, ShareView } from '../../data/types';
import { cn } from '../../lib/utils';
import {
  DEFAULT_TTL_DAYS,
  describeLastSeen,
  describeScope,
  newShareToken,
  shareDate,
  shareStatus,
  shareTerms,
  shareUrl,
  TTL_CHOICES,
} from '../../logic/shareLinks';
import { CouldNotCheck } from './finishLineUi';

/**
 * ===========================================================================
 * SHARE ONE PAGE, NOT THE APP — the owner's end of it.
 * ===========================================================================
 * THE SCOPE IS THE LEVEL YOU ARE LOOKING AT. There is no scope picker here,
 * and that is deliberate: a second control for "which entity" would let the
 * owner mint a link for a column he is not looking at, from a screen showing
 * a different one. The level selector above already answers the question, so
 * the card follows it and says so.
 *
 * THE SENTENCE COMES BEFORE THE BUTTON, ALWAYS. Anything a recipient can see
 * they can screenshot; no mechanism prevents that, so the only thing that
 * makes sharing safe is the owner having understood the scope. The words are
 * built by shareTerms in logic/shareLinks — the same function the recipient's
 * own page renders from, so the promise made here and the page delivered
 * there cannot drift apart.
 *
 * THE TOKEN IS SHOWN ONCE. The database stores a digest; there is no call
 * that returns a link, and this card holds the value in component state only
 * until the owner navigates away. Losing it means revoke and reissue, which
 * is the same contract the passphrase has.
 */
export function ShareLinkCard({
  /** 'group', or the entity code the level selector is currently on. */
  level: activeLevel,
  entity,
  links,
  loaded,
  isPending,
  onCreate,
  onRevoke,
  onExtend,
}: {
  level: string;
  /** The entity being viewed, when the level is not 'group'. */
  entity?: FinishLineEntity;
  links: ReadResult<ShareLink>;
  /** False before the first response. "None yet" and "not asked" differ. */
  loaded: boolean;
  isPending: boolean;
  onCreate: (input: {
    token: string;
    view: ShareView;
    scope: { entity?: string };
    label?: string;
    ttlDays: number;
  }) => Promise<boolean>;
  onRevoke: (id: string) => Promise<boolean>;
  onExtend: (id: string, ttlDays: number) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [ttlDays, setTtlDays] = useState<number>(DEFAULT_TTL_DAYS);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const view: ShareView = activeLevel === 'group' ? 'finish-line-group' : 'finish-line-entity';
  const now = useMemo(() => new Date(), []);
  // The expiry the sentence describes is the one the database will compute,
  // to the day. Days are the unit on both sides, so this is the same date and
  // not an estimate of it.
  const willExpireAt = useMemo(
    () => new Date(now.getTime() + ttlDays * 86_400_000).toISOString(),
    [now, ttlDays],
  );
  const terms = shareTerms({
    view,
    entityLabel: entity?.label,
    expiresAt: willExpireAt,
    now,
  });

  const rows = rowsOf(links);
  const live = rows.filter((link) => shareStatus(link, now) === 'active');

  // A code with no entity row behind it cannot be shared: the database would
  // refuse the scope anyway, and offering the button would be a lie.
  const canCreate = view === 'finish-line-group' || Boolean(entity);

  async function create() {
    const token = newShareToken();
    const done = await onCreate({
      token,
      view,
      scope: view === 'finish-line-entity' ? { entity: entity?.code } : {},
      label: label.trim() || undefined,
      ttlDays,
    });
    if (!done) return;
    // Held here and nowhere else. Nothing reads it back.
    setIssued(shareUrl(window.location.origin, token));
    setCopied(false);
    setLabel('');
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // A denied clipboard is not a failure worth a toast: the link is on
      // screen and selectable, which is the fallback.
      setCopied(false);
    }
  }

  return (
    <Card className="mt-5">
      <CardContent className="pt-5">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="surface-label flex items-center gap-2">
            <Link2 className="size-3.5" />
            Share links
          </span>
          {/* No count before the read lands, and none if it failed: a card
              that counts live credentials has no honest zero to show. */}
          <span className="text-xs tabular-nums text-foreground-muted">
            {!loaded ? 'Checking…' : links.ok ? `${live.length} live of ${rows.length}` : ''}
          </span>
        </div>

        <p className="mt-1 text-xs leading-5 text-foreground-muted">
          A link shows one view, read-only, until it expires. It cannot change anything, and it
          cannot be pointed at a different entity — the filter lives with the link, not in its
          URL.
        </p>

        {!links.ok && (
          <div className="mt-3">
            <CouldNotCheck label="Share links" failure={links} />
          </div>
        )}

        {/* ------------------------------------------------------------------
            THE CREATE PATH. The sentence sits above the button, not beside
            it, so it is read on the way to the click rather than after.
        ------------------------------------------------------------------ */}
        {!open && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={!canCreate}
            onClick={() => {
              setOpen(true);
              setIssued(null);
            }}
          >
            Create a link for {activeLevel === 'group' ? 'the whole Finish line' : entity?.label}
          </Button>
        )}

        {open && (
          <div className="mt-3 rounded-sm border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 basis-48">
                <span className="mb-1 block text-[11px] font-semibold text-foreground-secondary">
                  Who is this for? (your note — the recipient never sees it)
                </span>
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. board pack"
                />
              </label>
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-foreground-secondary">
                  Expires in
                </span>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Expires in">
                  {TTL_CHOICES.map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setTtlDays(days)}
                      aria-pressed={ttlDays === days}
                      className={cn(
                        'min-h-8 rounded-sm border px-2.5 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        ttlDays === days
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-foreground-muted hover:text-foreground-secondary',
                      )}
                    >
                      {days} days
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* WHAT THE LINK EXPOSES, IN WORDS, BEFORE IT EXISTS. */}
            <p className="mt-3 rounded-sm border border-escalate/40 bg-escalate/10 px-3 py-2 text-xs font-semibold leading-5 text-escalate">
              {terms.grants}
            </p>
            <p className="mt-1 px-3 text-xs leading-5 text-foreground-muted">{terms.withholds}</p>
            <p className="mt-1 px-3 text-xs leading-5 text-foreground-muted">
              Anything they can see, they can screenshot. Nothing stops that — expiring and
              revoking control access from here on, not what has already been read.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={isPending || !canCreate} onClick={create}>
                Create link
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setLabel('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* The one moment the token exists outside the recipient's browser. */}
        {issued && (
          <div className="mt-3 rounded-sm border border-primary/40 bg-primary/10 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-primary">
              <TriangleAlert className="size-3.5" />
              Copy this now — it is not shown again
            </p>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              Only a fingerprint of the link is stored, so it cannot be looked up later. If it is
              lost, revoke this one and make another.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 basis-56 overflow-x-auto whitespace-nowrap rounded-sm border border-border bg-card px-2 py-1.5 text-[11px] text-foreground">
                {issued}
              </code>
              <Button variant="secondary" size="sm" onClick={() => copy(issued)}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------
            THE EXISTING LINKS. Expired and revoked stay listed rather than
            disappearing: "did I ever share this, and did I cut it off" is a
            question about the past, and a list that only shows live links
            cannot answer it.
        ------------------------------------------------------------------ */}
        {rows.length > 0 && (
          <ul className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
            {rows.map((link) => {
              const status = shareStatus(link, now);
              return (
                <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span
                    className={cn(
                      'rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      status === 'active'
                        ? 'border-success/40 bg-success/10 text-success'
                        : status === 'expired'
                          ? 'border-border bg-surface-3 text-foreground-muted'
                          : 'border-destructive/40 bg-destructive/10 text-destructive',
                    )}
                  >
                    {status}
                  </span>
                  <span className="text-xs font-semibold text-foreground">
                    {describeScope(link.view, link.scope)}
                  </span>
                  {link.label && (
                    <span className="text-xs text-foreground-secondary">{link.label}</span>
                  )}
                  <span className="text-xs tabular-nums text-foreground-muted">
                    {status === 'revoked'
                      ? `cut off ${shareDate(link.revokedAt ?? link.expiresAt, now)}`
                      : `${status === 'expired' ? 'ran out' : 'until'} ${shareDate(link.expiresAt, now)}`}
                  </span>
                  <span className="text-xs text-foreground-muted">
                    {describeLastSeen(link.lastSeenAt, now)}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {status !== 'revoked' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={() => onExtend(link.id, DEFAULT_TTL_DAYS)}
                      >
                        Extend
                      </Button>
                    )}
                    {status !== 'revoked' && (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={isPending}
                        onClick={() => onRevoke(link.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
