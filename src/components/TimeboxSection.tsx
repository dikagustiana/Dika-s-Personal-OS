import { Check, CircleSlash2, Link2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import type {
  Domain,
  TaskEntry,
  TimeBlockCategory,
  TimeBlockEntry,
} from '../data/types';
import { getCurrentSlot, slotsForDomain, type TimeSlot } from '../logic/timebox';
import { cn } from '../lib/utils';

export const CATEGORY_LABELS: Record<TimeBlockCategory, string> = {
  'deep-work': 'Deep work',
  meeting: 'Meeting',
  break: 'Break',
  admin: 'Admin',
};

function durationLabel(start: string, end: string): string {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return `${toMin(end) - toMin(start)}m`;
}

export interface TimeboxSectionProps {
  domain: Domain;
  /** The date the grid is for (YYYY-MM-DD); NOW marker shows only for today. */
  date: string;
  now: Date;
  blocks: TimeBlockEntry[];
  /** Open tasks available for linking. */
  tasks: TaskEntry[];
  onCreate: (input: Omit<TimeBlockEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onSetStatus: (block: TimeBlockEntry, status: TimeBlockEntry['status']) => Promise<void>;
  onDelete: (block: TimeBlockEntry) => Promise<void>;
  /** Category and task-link edits on an existing block — the refinements. */
  onUpdate: (
    block: TimeBlockEntry,
    patch: Partial<Pick<TimeBlockEntry, 'category' | 'taskId' | 'label'>>,
  ) => Promise<void>;
}

/**
 * The timebox grid as an in-page section. Empty slots are slim dim rows with
 * a faint "+ add" that expands into the block form; filled slots show label,
 * state, optional task link, category tag, and derived duration. The current
 * slot carries a live NOW marker.
 */
export function TimeboxSection({
  domain,
  date,
  now,
  blocks,
  tasks,
  onCreate,
  onSetStatus,
  onDelete,
  onUpdate,
}: TimeboxSectionProps) {
  const slots = useMemo(() => slotsForDomain(domain), [domain]);
  const isToday = date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentSlot = isToday ? getCurrentSlot(now, domain) : null;
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftCategory, setDraftCategory] = useState<TimeBlockCategory | ''>('');
  const currentSlotRef = useRef<HTMLDivElement | null>(null);

  // Once per date, not per slot: with currentSlot in the deps this re-fired at
  // every half-hour rollover and yanked the page back to the grid while the
  // owner was reading something else — twice an hour.
  useEffect(() => {
    if (!currentSlotRef.current) return;
    const timer = window.setTimeout(() => {
      currentSlotRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }, 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const byStart = useMemo(() => new Map(blocks.map((block) => [block.start, block])), [blocks]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const createBlock = async (slot: TimeSlot, taskId?: string) => {
    const linkedTask = taskId ? taskById.get(taskId) : undefined;
    const label = linkedTask?.title ?? draft.trim();
    if (!label) return;
    setDraft('');
    setDraftCategory('');
    setOpenSlot(null);
    await onCreate({
      type: 'timeblock',
      domain,
      date,
      start: slot.start,
      end: slot.end,
      label,
      taskId,
      status: 'planned',
      category: draftCategory || undefined,
      tags: [],
    });
  };

  const handleDraftKey = (event: KeyboardEvent<HTMLInputElement>, slot: TimeSlot) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void createBlock(slot);
    }
    // Escape backs out without reaching for the mouse — the X button was the
    // only exit before.
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpenSlot(null);
      setDraft('');
      setDraftCategory('');
    }
  };

  return (
    <div className="divide-y divide-border-subtle border border-border-subtle bg-card">
      {slots.map((slot) => {
        const block = byStart.get(slot.start);
        const isCurrent = currentSlot === slot.start;
        const isOpen = openSlot === slot.start;
        const linkedTask = block?.taskId ? taskById.get(block.taskId) : undefined;

        return (
          <div
            key={slot.start}
            ref={isCurrent ? currentSlotRef : undefined}
            className={cn('relative px-3 sm:px-4', isCurrent && 'bg-primary/[0.08]')}
          >
            {isCurrent && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}

            {block ? (
              <div className="grid min-h-14 grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-3 py-2 sm:grid-cols-[4rem_minmax(0,1fr)]">
                <div>
                  <time className={cn('text-xs tabular-nums', isCurrent ? 'text-foreground' : 'text-foreground-muted')}>
                    {slot.start}
                  </time>
                  {isCurrent && (
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-foreground-secondary">Now</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <p
                    className={cn(
                      'min-w-0 text-sm font-semibold text-foreground',
                      block.status !== 'planned' && 'text-foreground-muted line-through',
                    )}
                  >
                    {block.label}
                  </p>
                  <span className="text-[10px] tabular-nums text-foreground-muted">
                    {durationLabel(block.start, block.end)}
                  </span>
                  {/* Category and task link live HERE, on the existing block —
                      they are refinements of a block, not preconditions for
                      one, which is why the create form no longer asks. */}
                  <select
                    className="h-6 max-w-28 cursor-pointer appearance-none border border-border bg-transparent px-1.5 text-[9px] font-bold uppercase tracking-wider text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={block.category ?? ''}
                    onChange={(event) =>
                      void onUpdate(block, {
                        category: (event.target.value || undefined) as TimeBlockCategory | undefined,
                      })
                    }
                    aria-label={`Category for ${block.label}`}
                  >
                    <option value="">+ category</option>
                    {(Object.keys(CATEGORY_LABELS) as TimeBlockCategory[]).map((key) => (
                      <option key={key} value={key}>
                        {CATEGORY_LABELS[key]}
                      </option>
                    ))}
                  </select>
                  {block.taskId ? (
                    <span className="inline-flex items-center gap-1 border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-muted">
                      <Link2 className="size-2.5" />
                      {linkedTask ? 'Task' : 'Task (done)'}
                    </span>
                  ) : (
                    tasks.length > 0 && (
                      <select
                        className="h-6 max-w-32 cursor-pointer appearance-none border border-border bg-transparent px-1.5 text-[9px] font-bold uppercase tracking-wider text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value=""
                        onChange={(event) => {
                          if (event.target.value) void onUpdate(block, { taskId: event.target.value });
                        }}
                        aria-label={`Link a task to ${block.label}`}
                      >
                        <option value="">+ task</option>
                        {tasks.map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.title}
                          </option>
                        ))}
                      </select>
                    )
                  )}
                  <span className="ml-auto flex shrink-0 gap-1.5">
                    <Button
                      size="icon"
                      variant={block.status === 'done' ? 'default' : 'secondary'}
                      onClick={() => void onSetStatus(block, block.status === 'done' ? 'planned' : 'done')}
                      aria-label={`Mark ${block.label} done`}
                    >
                      {block.status === 'done' ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant={block.status === 'skipped' ? 'default' : 'secondary'}
                      onClick={() => void onSetStatus(block, block.status === 'skipped' ? 'planned' : 'skipped')}
                      aria-label={`Skip ${block.label}`}
                    >
                      <CircleSlash2 className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="danger"
                      onClick={() => void onDelete(block)}
                      aria-label={`Delete ${block.label}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </span>
                </div>
              </div>
            ) : isOpen ? (
              <div className="grid gap-2 py-2 md:grid-cols-[4rem_minmax(140px,1fr)_auto]">
                <time className="self-center text-xs tabular-nums text-foreground-muted">{slot.start}</time>
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => handleDraftKey(event, slot)}
                  placeholder="Block label — Enter to claim the slot"
                  aria-label={`Create block at ${slot.start}`}
                  autoFocus
                  className="h-11"
                />
                <span className="flex gap-1.5">
                  <Button size="icon" onClick={() => void createBlock(slot)} aria-label={`Save block at ${slot.start}`}>
                    <Check className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setOpenSlot(null);
                      setDraft('');
                      setDraftCategory('');
                    }}
                    aria-label="Cancel block"
                  >
                    <X className="size-4" />
                  </Button>
                </span>
              </div>
            ) : (
              // Empty slot: slim dim row with a faint "+ add".
              <button
                type="button"
                onClick={() => {
                  setOpenSlot(slot.start);
                  setDraft('');
                  setDraftCategory('');
                }}
                // 44px per the density rule (was 36px), hover on the WHOLE
                // row so it reads as pressable rather than only the small
                // label at its right edge.
                className="group flex min-h-11 w-full items-center gap-3 rounded-sm py-1 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Add a block at ${slot.start}`}
              >
                <time className={cn('w-[3.25rem] text-[11px] tabular-nums sm:w-16', isCurrent ? 'text-foreground' : 'text-foreground-muted')}>
                  {slot.start}
                </time>
                <span className="h-px flex-1 bg-surface-2 transition-colors group-hover:bg-surface-3" />
                <span className="inline-flex items-center gap-1 text-xs text-foreground-secondary">
                  <Plus className="size-3.5" />
                  add
                </span>
                {isCurrent && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-foreground-secondary">Now</span>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
