/**
 * The council panel: confirm → run → transcript, plus history.
 *
 * RESULT LAYOUT PORTED from the website's src/components/admin/CouncilPanel.tsx
 * — the verdict card with labelled sections and first_step as a callout, the
 * per-advisor and per-peer CollapsibleBlocks closed by default, each titled
 * with the persona name and subtitled `Response {letter}`, and history below.
 * That layout was already solved; only the theming is ours.
 *
 * DELIBERATELY NOT PORTED: the website's indeterminate spinner with "usually
 * 20-40 seconds". Eleven completions take minutes, and a spinner for minutes
 * is indistinguishable from a hang. Stage counts instead.
 */
import { AlertTriangle, ChevronDown, Gavel, MessageSquareQuote, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import {
  councilAvailable,
  councilBlockedReason,
  runCouncil,
  type CouncilCapabilities,
  type CouncilProgress,
  type CouncilTranscript,
} from '../../../data/researchCouncil';
import type { CouncilSessionRow } from '../../../data/researchRepository';
import { advisorsForMode, completionCount } from '../../../logic/research/council/personas';
import type { CouncilMode } from '../../../logic/research/council/personas';
import { useAppStore } from '../../../store/appStore';
import { cn } from '../../../lib/utils';

export interface CouncilPanelProps {
  mode: CouncilMode;
  capabilities: CouncilCapabilities;
  /** Read lazily so the panel always sends the current state, not a stale copy. */
  getContent: () => string;
  topic?: string;
  projectId?: string;
  className?: string;
}

const MODE_LABEL: Record<CouncilMode, string> = {
  method: 'method review',
  scope: 'scoping',
  contra: 'contradiction',
};

function CollapsibleBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-sm border border-border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{title}</span>
          {subtitle && (
            <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">
              {subtitle}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

function VerdictCard({ transcript }: { transcript: CouncilTranscript }) {
  const verdict = transcript.verdict;

  if (!verdict) {
    return (
      <Card className="border-escalate">
        <CardContent className="pt-5">
          <p className="text-sm font-semibold text-foreground">No verdict</p>
          <p className="mt-1 text-xs text-foreground-secondary">
            The chairman stage failed. The advisor and peer responses below are intact and were
            still paid for — retry the chairman alone rather than re-running the council.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (transcript.verdictUnparsed) {
    // Never render five empty sections: an empty panel reads as "the council
    // had nothing to say", which is the opposite of what happened.
    return (
      <Card className="border-escalate">
        <CardContent className="pt-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="size-4 text-escalate" />
            The chairman did not answer in the expected shape
          </p>
          <p className="mt-1 text-xs text-foreground-muted">
            Raw output below, unparsed. Nothing was discarded.
          </p>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words border border-border-subtle bg-surface-2 p-3 font-mono text-[11px] leading-5 text-foreground-secondary">
            {verdict.raw}
          </pre>
        </CardContent>
      </Card>
    );
  }

  const sections: Array<[string, string]> = [
    ['Where the council agrees', verdict.consensus],
    ['Where the council disagrees', verdict.disagreements],
    ['Blind spots caught', verdict.blindSpots],
    ['Recommendation', verdict.recommendation],
  ];

  return (
    <Card className="border-primary bg-primary/[0.04]">
      <CardContent className="space-y-3 pt-5">
        <p className="flex items-center gap-2 font-display text-card-heading font-semibold text-foreground">
          <Gavel className="size-4 text-primary" />
          Chairman&apos;s verdict
        </p>

        {sections.map(([label, body]) =>
          body ? (
            <div key={label}>
              <span className="surface-label">{label}</span>
              <p className="mt-0.5 text-sm leading-6 text-foreground-secondary">{body}</p>
            </div>
          ) : null,
        )}

        {verdict.firstStep && (
          <p className="border-l-2 border-primary bg-surface-2 px-3 py-2 text-sm font-semibold text-foreground">
            First step: {verdict.firstStep}
          </p>
        )}

        {/* §9. The verdict is the most authoritative-sounding thing on the
            screen and the most likely to be treated as settled. It is not. */}
        <p className="border-t border-border-subtle pt-3 text-xs text-foreground-muted">
          This verdict is layer (c) — your own inference — until you act on it. It has not ticked a
          gate, verified an item, or recorded a cycle, and it cannot.
        </p>
      </CardContent>
    </Card>
  );
}

function TranscriptView({ transcript }: { transcript: CouncilTranscript }) {
  return (
    <div className="space-y-4">
      <VerdictCard transcript={transcript} />

      {transcript.failedSeats.length > 0 && (
        <p className="border-l-2 border-escalate px-3 py-2 text-xs text-foreground-secondary">
          Ran without {transcript.failedSeats.map((s) => s.name).join(', ')} — that seat failed.
        </p>
      )}

      <div className="space-y-2">
        <p className="surface-label flex items-center gap-1.5">
          <Users className="size-3.5" /> Advisor responses
        </p>
        {transcript.advisorResponses.map((response) => (
          <CollapsibleBlock
            key={response.advisorId}
            title={response.advisorName}
            subtitle={`Response ${response.letter}`}
          >
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground-secondary">
              {response.text}
            </p>
          </CollapsibleBlock>
        ))}
      </div>

      <div className="space-y-2">
        <p className="surface-label flex items-center gap-1.5">
          <MessageSquareQuote className="size-3.5" /> Peer reviews (anonymised during the run)
        </p>
        {transcript.peerReviews.map((peer) => (
          <CollapsibleBlock key={peer.reviewerId} title={`Review by ${peer.reviewerName}`}>
            <div className="space-y-1.5 text-sm text-foreground-secondary">
              {peer.review.raw ? (
                <p className="whitespace-pre-wrap">{peer.review.raw}</p>
              ) : (
                <>
                  {peer.review.strongest && (
                    <p>
                      <span className="mr-2 rounded-sm border border-success px-1.5 py-0.5 font-mono text-[10px] text-success">
                        Strongest {peer.review.strongest.letter}
                      </span>
                      {peer.review.strongest.reason}
                    </p>
                  )}
                  {peer.review.biggestBlindSpot && (
                    <p>
                      <span className="mr-2 rounded-sm border border-escalate px-1.5 py-0.5 font-mono text-[10px] text-escalate">
                        Blind spot {peer.review.biggestBlindSpot.letter}
                      </span>
                      {peer.review.biggestBlindSpot.reason}
                    </p>
                  )}
                  {peer.review.missedByAll && (
                    <p>
                      <span className="mr-2 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">
                        Missed by all
                      </span>
                      {peer.review.missedByAll}
                    </p>
                  )}
                </>
              )}
            </div>
          </CollapsibleBlock>
        ))}
      </div>

      {!transcript.persisted && (
        <p className="border-l-2 border-destructive px-3 py-2 text-xs text-foreground-secondary">
          The run finished but the transcript could not be saved. Copy anything you need.
        </p>
      )}
    </div>
  );
}

/** Counts, never a percentage: seats run in parallel and finish unevenly. */
function StageProgress({ progress }: { progress: CouncilProgress }) {
  const dots = (done: number, total: number) =>
    Array.from({ length: total }, (_, i) => (i < done ? '●' : '○')).join('');

  const rows: Array<[string, string, string]> = [
    [
      'Advisors',
      dots(progress.advisorsDone, progress.advisorsTotal),
      `${progress.advisorsDone} of ${progress.advisorsTotal}`,
    ],
    [
      'Peer review',
      dots(progress.peersDone, progress.peersTotal),
      progress.advisorsDone === 0
        ? 'waiting'
        : `${progress.peersDone} of ${progress.peersTotal}`,
    ],
    [
      'Chairman',
      progress.chairmanDone ? '●' : '○',
      progress.peersDone === 0 ? 'waiting' : progress.chairmanDone ? 'done' : 'running',
    ],
  ];

  return (
    <div className="space-y-1 border border-border-subtle bg-surface-2 p-3 font-mono text-xs">
      {rows.map(([label, dotted, status]) => (
        <div key={label} className="flex gap-3">
          <span className="w-24 shrink-0 text-foreground-muted">{label}</span>
          <span className="tracking-[0.2em] text-primary">{dotted}</span>
          <span className="text-foreground-muted">{status}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A stored row back into the render shape. jsonb comes back untyped, so each
 * field is defaulted rather than asserted — a transcript written by an older
 * version of the seats must still open, not throw.
 */
function rowToTranscript(row: CouncilSessionRow): CouncilTranscript {
  const verdict = (row.verdict ?? null) as CouncilTranscript['verdict'];
  return {
    mode: row.mode as CouncilMode,
    projectId: row.projectId ?? undefined,
    inputSnapshot: row.inputSnapshot,
    advisorsConfig: (row.advisorsConfig ?? []) as CouncilTranscript['advisorsConfig'],
    advisorResponses: (row.advisorResponses ?? []) as CouncilTranscript['advisorResponses'],
    peerReviews: (row.peerReviews ?? []) as CouncilTranscript['peerReviews'],
    verdict,
    // A stored verdict that is present but has no recommendation is the same
    // unparsed case as at run time, and must render the same way.
    verdictUnparsed: Boolean(verdict) && !verdict?.recommendation && !verdict?.consensus,
    failedSeats: [],
    persisted: true,
  };
}

export function CouncilPanel({
  mode,
  capabilities,
  getContent,
  topic,
  projectId,
  className,
}: CouncilPanelProps) {
  const repository = useAppStore((state) => state.repository);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<CouncilProgress | null>(null);
  const [transcript, setTranscript] = useState<CouncilTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CouncilSessionRow[]>([]);

  const blocked = councilBlockedReason(mode, capabilities);
  const available = councilAvailable(mode, capabilities);
  const seats = advisorsForMode(mode);
  const completions = completionCount(mode);
  const running = progress !== null && !transcript;

  useEffect(() => {
    void repository.research
      .listCouncilSessions(projectId ? { projectId, mode } : { mode })
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [mode, projectId, repository]);

  // The council button is ABSENT when unavailable, not disabled — a button
  // that is always refused teaches the owner to ignore the panel.
  if (!available) {
    return blocked ? (
      <p className={cn('text-xs text-foreground-muted', className)}>{blocked}</p>
    ) : null;
  }

  const start = async () => {
    setConfirming(false);
    setError(null);
    setTranscript(null);
    setProgress({
      advisorsDone: 0,
      advisorsTotal: seats.length,
      peersDone: 0,
      peersTotal: seats.length,
      chairmanDone: false,
      failedSeats: [],
    });

    const result = await runCouncil({
      mode,
      content: getContent(),
      topic,
      projectId,
      confirmed: true,
      onProgress: setProgress,
    });

    if (!result.ok) {
      setError(
        result.failedSeats?.length
          ? `${result.reason} Failed: ${result.failedSeats.map((s) => s.name).join(', ')}.`
          : result.reason,
      );
      setProgress(null);
      return;
    }

    // Persist once, and tolerate failure: the transcript is already in hand.
    let persisted = false;
    try {
      await repository.research.appendCouncilSession({
        projectId: projectId ?? null,
        mode,
        inputSnapshot: result.transcript.inputSnapshot,
        advisorsConfig: result.transcript.advisorsConfig,
        advisorResponses: result.transcript.advisorResponses,
        peerReviews: result.transcript.peerReviews,
        verdict: result.transcript.verdict,
      });
      persisted = true;
      setHistory(
        await repository.research.listCouncilSessions(
          projectId ? { projectId, mode } : { mode },
        ),
      );
    } catch {
      persisted = false;
    }
    setTranscript({ ...result.transcript, persisted });
  };

  return (
    <div className={cn('space-y-3', className)}>
      <Button variant="secondary" onClick={() => setConfirming(true)} disabled={running}>
        <Users className="size-4" />
        {running ? 'Council running…' : 'Run council'}
      </Button>

      {confirming && (
        <div className="border border-escalate bg-escalate/10 p-3">
          <p className="text-xs leading-5 text-foreground-secondary">
            Convene the {MODE_LABEL[mode]} council on{' '}
            {capabilities.model || 'the configured model'}? {seats.length} seats
            {' → '}anonymised peer review{' → '}chairman ={' '}
            <strong>{completions} completions</strong>. The input carries the full text below and
            these are not small calls.
          </p>
          <p className="mt-1 text-xs text-foreground-muted">
            Seats: {seats.map((s) => s.name).join(', ')}.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void start()}>
              Yes, spend {completions} completions
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {progress && !transcript && <StageProgress progress={progress} />}

      {error && (
        <p className="border-l-2 border-destructive px-3 py-2 text-xs text-foreground-secondary">
          {error} Nothing was retried automatically — a retry doubles the spend, and that is your
          call.
        </p>
      )}

      {transcript && <TranscriptView transcript={transcript} />}

      {history.length > 0 && (
        <div className="space-y-2">
          <p className="surface-label">Past {MODE_LABEL[mode]} sessions ({history.length})</p>
          {history.slice(0, 5).map((row) => (
            <CollapsibleBlock
              key={row.id}
              title={row.createdAt.slice(0, 16).replace('T', ' ')}
              subtitle={row.mode}
            >
              <div className="space-y-3">
                <p className="whitespace-pre-wrap border-l-2 border-border-subtle pl-2 text-xs text-foreground-muted">
                  {row.inputSnapshot.slice(0, 400)}
                  {row.inputSnapshot.length > 400 && '…'}
                </p>
                {/* The whole transcript, not just the input. Eleven completions
                    were paid for; if they are unreadable after a reload the
                    stored row is a receipt rather than a record. */}
                <TranscriptView transcript={rowToTranscript(row)} />
              </div>
            </CollapsibleBlock>
          ))}
        </div>
      )}
    </div>
  );
}
