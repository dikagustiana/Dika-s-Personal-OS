import { Check, CircleSlash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import type { TaskEntry, TimeBlockEntry } from '../data/types';
import { getCurrentSlot, slotsForDomain } from '../logic/timebox';
import { cn } from '../lib/utils';

export interface NowStripProps {
  /** Today's blocks for the WORK domain. */
  blocks: TimeBlockEntry[];
  /** Open urgent tasks — the first one is the strip's one-click suggestion. */
  urgentTasks: TaskEntry[];
  onStartBlock: (input: { start: string; end: string; label: string; taskId?: string }) => Promise<void>;
  onSetStatus: (block: TimeBlockEntry, status: TimeBlockEntry['status']) => Promise<void>;
  disabled?: boolean;
}

/**
 * The answer to "what am I supposed to be doing right now", pinned to the top
 * of the WORK dashboard.
 *
 * Everything else on the dashboard is a list, and a list is a set of choices.
 * This strip is deliberately not one: inside working hours it names the
 * current half-hour and either shows the block that owns it or offers at most
 * two ways to claim it — one click on the top urgent task, or typing a label.
 * Outside working hours it renders nothing at all rather than a quieter
 * version of itself; a "not now" state would just be one more thing to read.
 *
 * This is also the timebox's first presence on the landing screen. Before it,
 * placing one block meant: open Today, scroll past six cards to the grid at
 * the bottom, click a slot, type a label, press Enter. The grid stayed unused
 * through fifty projects' worth of use; the cost of starting was the reason.
 */
export function NowStrip({
  blocks,
  urgentTasks,
  onStartBlock,
  onSetStatus,
  disabled = false,
}: NowStripProps) {
  // The strip is the one part of the page that must move with the clock.
  const [now, setNow] = useState(() => new Date());
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const slotStart = getCurrentSlot(now, 'work');
  if (!slotStart) return null;

  const slot = slotsForDomain('work').find((item) => item.start === slotStart);
  if (!slot) return null;

  const block = blocks.find((item) => item.start === slot.start) ?? null;
  const suggestion = urgentTasks.find((task) => !task.done) ?? null;

  const start = async (label: string, taskId?: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setDraft('');
    await onStartBlock({ start: slot.start, end: slot.end, label: trimmed, taskId });
  };

  const submitDraft = (event: FormEvent) => {
    event.preventDefault();
    void start(draft);
  };

  return (
    <section
      aria-label="Right now"
      className="mb-6 flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-accent px-4 py-2.5 shadow-card"
    >
      <span className="flex shrink-0 items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-muted">
          Now
        </span>
        <span className="font-mono text-xs tabular-nums text-foreground-secondary">
          {slot.start}–{slot.end}
        </span>
      </span>

      {block ? (
        <>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm font-semibold text-foreground',
              block.status !== 'planned' && 'text-foreground-muted line-through',
            )}
          >
            {block.label}
          </span>
          {block.status === 'planned' ? (
            <span className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={() => void onSetStatus(block, 'done')}
              >
                <Check className="size-4" />
                Done
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => void onSetStatus(block, 'skipped')}
                aria-label={`Skip ${block.label}`}
              >
                <CircleSlash2 className="size-4" />
                Skip
              </Button>
            </span>
          ) : (
            <span className="shrink-0 text-xs text-foreground-muted">
              {block.status === 'done' ? 'Done' : 'Skipped'} — next slot {slot.end}
            </span>
          )}
        </>
      ) : (
        <>
          {/* The smallest next action: one click, zero typing. The task is
              already flagged urgent, so it is the least surprising default. */}
          {suggestion && (
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => void start(suggestion.title, suggestion.id)}
              className="min-w-0 shrink"
            >
              <span className="truncate">Start: {suggestion.title}</span>
            </Button>
          )}
          <form onSubmit={submitDraft} className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                suggestion ? 'or name this half hour…' : 'Name this half hour…'
              }
              aria-label="Name a block for the current half hour"
              className="h-9 min-w-0 flex-1 bg-card text-sm"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={disabled || !draft.trim()}
            >
              Start
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
