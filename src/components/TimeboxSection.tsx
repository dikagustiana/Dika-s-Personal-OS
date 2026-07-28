import {
  AlertTriangle,
  Check,
  CircleSlash2,
  CornerUpRight,
  Link2,
  Megaphone,
  Plus,
  RotateCcw,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import type {
  Domain,
  Project,
  TaskEntry,
  TimeBlockCategory,
  TimeBlockEntry,
} from '../data/types';
import { ESCALATION_TARGETS, type EscalationTarget } from '../logic/milestones';
import { blockMinutes, formatDuration } from '../logic/timeBlockCarry';
import { getCurrentSlot, slotsForDomain, type TimeSlot } from '../logic/timebox';
import { cn } from '../lib/utils';

export const CATEGORY_LABELS: Record<TimeBlockCategory, string> = {
  'deep-work': 'Deep work',
  meeting: 'Meeting',
  break: 'Break',
  admin: 'Admin',
};

// Duration derivation lives in logic/timeBlockCarry — the carry-over chain
// sums the same minutes, and two spellings of "how long was this block" is
// exactly the duplicate-derivation class that had two screens disagreeing
// about a closed period.
const durationLabel = (start: string, end: string) =>
  formatDuration(blockMinutes({ start, end } as TimeBlockEntry));

export interface TimeboxSectionProps {
  domain: Domain;
  /** The date the grid is for (YYYY-MM-DD); NOW marker shows only for today. */
  date: string;
  now: Date;
  blocks: TimeBlockEntry[];
  /** Open tasks available for linking. */
  tasks: TaskEntry[];
  /**
   * WORK projects, for milestone attribution and the escalation offer. Empty
   * in GROWTH, where the milestone route simply does not appear.
   */
  projects?: Project[];
  onCreate: (input: Omit<TimeBlockEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  /**
   * `detail` carries the reason on a blocked close and the optional note on a
   * carried one. Blocked without `blockedOn` is rejected by the repository
   * guard, so the UI never sends one.
   */
  onSetStatus: (
    block: TimeBlockEntry,
    status: TimeBlockEntry['status'],
    detail?: Pick<TimeBlockEntry, 'blockedOn' | 'carryNote'>,
  ) => Promise<void>;
  onDelete: (block: TimeBlockEntry) => Promise<void>;
  /** Category, attribution and label edits on an existing block. */
  onUpdate: (
    block: TimeBlockEntry,
    patch: Partial<
      Pick<TimeBlockEntry, 'category' | 'taskId' | 'label' | 'projectId' | 'milestoneId'>
    >,
  ) => Promise<void>;
  /**
   * Offered — never automatic — when a milestone-attributed block closes as
   * blocked. Writes the milestone's own note and escalateTo.
   */
  onEscalateMilestone?: (
    projectId: string,
    milestoneId: string,
    target: EscalationTarget,
    reason: string,
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
  projects = [],
  onEscalateMilestone,
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

  // Which block has an inline prompt open, and for what. Never a modal: the
  // timebox sat unused for weeks because creating a block cost five controls,
  // and closing one must not repeat that.
  const [prompt, setPrompt] = useState<
    | { blockId: string; kind: 'blocked' | 'carried' | 'attribute' | 'escalate'; reason?: string }
    | null
  >(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [milestoneQuery, setMilestoneQuery] = useState('');

  const closePrompt = () => {
    setPrompt(null);
    setReasonDraft('');
    setMilestoneQuery('');
  };

  /** Every milestone across the passed projects, flattened for the picker. */
  const milestoneOptions = useMemo(
    () =>
      projects.flatMap((project) =>
        project.milestones
          .filter((milestone) => !milestone.done)
          .map((milestone) => ({ project, milestone })),
      ),
    [projects],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  /**
   * Commits a blocked close, then — only when the block is attributed to a
   * milestone and a handler exists — leaves the escalation offer open. The
   * status write and the offer are separate: declining the offer must leave
   * the milestone untouched.
   */
  const commitBlocked = async (block: TimeBlockEntry) => {
    const reason = reasonDraft.trim();
    if (!reason) return; // guard rejects it anyway; do not send a doomed write
    await onSetStatus(block, 'blocked', { blockedOn: reason });
    if (block.milestoneId && block.projectId && onEscalateMilestone) {
      setPrompt({ blockId: block.id, kind: 'escalate', reason });
      setMilestoneQuery('');
      setReasonDraft('');
      return;
    }
    closePrompt();
  };

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
        const linkedProject = block?.projectId ? projectById.get(block.projectId) : undefined;
        const linkedMilestone = block?.milestoneId
          ? linkedProject?.milestones.find((item) => item.id === block.milestoneId)
          : undefined;
        const openPrompt = block && prompt?.blockId === block.id ? prompt : null;

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
                  {/* Struck through only when the block is CLOSED OUT — done
                      or skipped. A carried or blocked block is live work that
                      continues tomorrow; striking it through would read as
                      finished-or-abandoned, which is the confusion the two new
                      statuses exist to end. */}
                  <p
                    className={cn(
                      'min-w-0 text-sm font-semibold text-foreground',
                      (block.status === 'done' || block.status === 'skipped') &&
                        'text-foreground-muted line-through',
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
                  {/* EXACTLY ONE ATTRIBUTION renders, because only one can be
                      stored — the repository guard rejects a block holding
                      both. */}
                  {block.milestoneId ? (
                    linkedMilestone ? (
                      <span
                        className="inline-flex min-w-0 items-center gap-1 border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-muted"
                        title={`${linkedProject?.title ?? ''} — ${linkedMilestone.text}`}
                      >
                        <Link2 className="size-2.5 shrink-0" />
                        <span className="truncate">{linkedMilestone.text}</span>
                      </span>
                    ) : (
                      // NAMED, never blank. A block that quietly loses its
                      // attribution reads as unattributed time, which is worse
                      // than an obvious error.
                      <span className="inline-flex min-w-0 items-center gap-1 border border-destructive/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-destructive">
                        <Unlink className="size-2.5 shrink-0" />
                        <span className="truncate">
                          {linkedProject?.title
                            ? `${linkedProject.title} — milestone no longer exists`
                            : 'milestone no longer exists'}
                        </span>
                      </span>
                    )
                  ) : block.taskId ? (
                    <span className="inline-flex items-center gap-1 border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-muted">
                      <Link2 className="size-2.5" />
                      {linkedTask ? 'Task' : 'Task (done)'}
                    </span>
                  ) : (
                    (milestoneOptions.length > 0 || tasks.length > 0) && (
                      <button
                        type="button"
                        className="h-6 shrink-0 border border-border px-1.5 text-[9px] font-bold uppercase tracking-wider text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          setMilestoneQuery('');
                          setPrompt({ blockId: block.id, kind: 'attribute' });
                        }}
                        aria-label={`Attribute ${block.label} to a milestone or task`}
                      >
                        + link
                      </button>
                    )
                  )}
                  {/* FOUR OUTCOMES, ONE ROW. `skipped` no longer absorbs
                      "didn't finish" — carried and blocked both mean real work
                      happened, and the only difference between them is whether
                      someone else is needed. */}
                  <span className="ml-auto flex shrink-0 gap-1.5">
                    <Button
                      size="icon"
                      variant={block.status === 'done' ? 'default' : 'secondary'}
                      onClick={() => {
                        closePrompt();
                        void onSetStatus(block, block.status === 'done' ? 'planned' : 'done');
                      }}
                      aria-label={`Mark ${block.label} done`}
                    >
                      {block.status === 'done' ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant={block.status === 'carried' ? 'default' : 'secondary'}
                      onClick={() => {
                        if (block.status === 'carried') {
                          closePrompt();
                          void onSetStatus(block, 'planned');
                          return;
                        }
                        // One tap sets it. The note is optional, so it opens
                        // beneath and may simply be ignored.
                        void onSetStatus(block, 'carried');
                        setReasonDraft(block.carryNote ?? '');
                        setPrompt({ blockId: block.id, kind: 'carried' });
                      }}
                      aria-label={`Carry ${block.label} to another day`}
                    >
                      <CornerUpRight className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant={block.status === 'blocked' ? 'default' : 'secondary'}
                      onClick={() => {
                        if (block.status === 'blocked') {
                          closePrompt();
                          void onSetStatus(block, 'planned');
                          return;
                        }
                        // Status is NOT written yet: blocked without a reason
                        // is rejected by the repository guard, and is worthless
                        // tomorrow, which is exactly when it gets read.
                        setReasonDraft('');
                        setPrompt({ blockId: block.id, kind: 'blocked' });
                      }}
                      aria-label={`Mark ${block.label} blocked`}
                    >
                      <AlertTriangle className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant={block.status === 'skipped' ? 'default' : 'secondary'}
                      onClick={() => {
                        closePrompt();
                        void onSetStatus(block, block.status === 'skipped' ? 'planned' : 'skipped');
                      }}
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

                  {/* A blocked block always shows what it is waiting on: the
                      row is unreadable tomorrow without it. */}
                  {block.status === 'blocked' && block.blockedOn && !openPrompt && (
                    <p className="w-full text-[11px] text-destructive">
                      Waiting on {block.blockedOn}
                    </p>
                  )}
                  {block.status === 'carried' && block.carryNote && !openPrompt && (
                    <p className="w-full text-[11px] text-foreground-muted">
                      Remaining: {block.carryNote}
                    </p>
                  )}

                  {/* ---- inline prompts. Never a modal, never a second screen. ---- */}
                  {openPrompt?.kind === 'blocked' && (
                    <div className="flex w-full flex-wrap items-center gap-2 pb-1">
                      <Input
                        value={reasonDraft}
                        onChange={(event) => setReasonDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void commitBlocked(block);
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            closePrompt();
                          }
                        }}
                        placeholder="What are you waiting on? — required"
                        aria-label={`What is ${block.label} waiting on?`}
                        autoFocus
                        className="h-9 min-w-0 flex-1 text-sm"
                      />
                      <Button
                        size="sm"
                        disabled={!reasonDraft.trim()}
                        onClick={() => void commitBlocked(block)}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={closePrompt}>
                        Cancel
                      </Button>
                    </div>
                  )}

                  {openPrompt?.kind === 'carried' && (
                    <div className="flex w-full flex-wrap items-center gap-2 pb-1">
                      <Input
                        value={reasonDraft}
                        onChange={(event) => setReasonDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void onSetStatus(block, 'carried', {
                              carryNote: reasonDraft.trim() || undefined,
                            });
                            closePrompt();
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            closePrompt();
                          }
                        }}
                        placeholder="What's left? — optional, already carried"
                        aria-label={`What remains on ${block.label}?`}
                        autoFocus
                        className="h-9 min-w-0 flex-1 text-sm"
                      />
                      <Button size="sm" variant="ghost" onClick={closePrompt}>
                        Done
                      </Button>
                    </div>
                  )}

                  {/* THE ESCALATION OFFER. Offered, never automatic: a silent
                      status change on a milestone is surprising, and the
                      milestone may be blocked for a broader reason than this
                      block. Declining changes nothing. */}
                  {openPrompt?.kind === 'escalate' && (
                    <div className="w-full border border-border-subtle bg-surface-2 p-2">
                      <p className="text-[11px] text-foreground-secondary">
                        Mark <span className="font-semibold">{linkedMilestone?.text ?? 'the milestone'}</span>{' '}
                        blocked too, and escalate to…
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {ESCALATION_TARGETS.map((target) => (
                          <Button
                            key={target.value}
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              if (block.projectId && block.milestoneId) {
                                void onEscalateMilestone?.(
                                  block.projectId,
                                  block.milestoneId,
                                  target.value,
                                  openPrompt.reason ?? '',
                                );
                              }
                              closePrompt();
                            }}
                          >
                            <Megaphone className="mr-1 size-3" />
                            {target.label}
                          </Button>
                        ))}
                        <Button size="sm" variant="ghost" onClick={closePrompt}>
                          Not now
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Attribution picker: searches every open milestone across
                      projects by text, and shows which project each belongs
                      to — the milestone text alone is ambiguous across 38
                      projects. */}
                  {openPrompt?.kind === 'attribute' && (
                    <div className="w-full border border-border-subtle bg-surface-2 p-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={milestoneQuery}
                          onChange={(event) => setMilestoneQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              closePrompt();
                            }
                          }}
                          placeholder="Find a milestone…"
                          aria-label={`Find a milestone for ${block.label}`}
                          autoFocus
                          className="h-9 min-w-0 flex-1 text-sm"
                        />
                        <Button size="sm" variant="ghost" onClick={closePrompt}>
                          Cancel
                        </Button>
                      </div>
                      <ul className="mt-1.5 max-h-44 overflow-y-auto">
                        {milestoneOptions
                          .filter(({ project, milestone }) => {
                            const q = milestoneQuery.trim().toLowerCase();
                            if (!q) return true;
                            return (
                              milestone.text.toLowerCase().includes(q) ||
                              project.title.toLowerCase().includes(q)
                            );
                          })
                          .slice(0, 40)
                          .map(({ project, milestone }) => (
                            <li key={`${project.id}:${milestone.id}`}>
                              <button
                                type="button"
                                className="block w-full px-1 py-1.5 text-left text-xs hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => {
                                  // Setting milestoneId clears taskId in one
                                  // write — two writes would leave a window
                                  // where a failure strands the block with
                                  // neither attribution.
                                  void onUpdate(block, {
                                    projectId: project.id,
                                    milestoneId: milestone.id,
                                    taskId: undefined,
                                  });
                                  closePrompt();
                                }}
                              >
                                <span className="text-foreground">{milestone.text}</span>
                                <span className="ml-1.5 text-foreground-muted">{project.title}</span>
                              </button>
                            </li>
                          ))}
                        {milestoneOptions.length === 0 && (
                          <li className="px-1 py-1.5 text-xs text-foreground-muted">
                            No open milestones to attribute to.
                          </li>
                        )}
                      </ul>
                      {tasks.length > 0 && (
                        <select
                          className="mt-1.5 h-7 w-full cursor-pointer appearance-none border border-border bg-transparent px-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value=""
                          onChange={(event) => {
                            if (!event.target.value) return;
                            void onUpdate(block, {
                              taskId: event.target.value,
                              projectId: undefined,
                              milestoneId: undefined,
                            });
                            closePrompt();
                          }}
                          aria-label={`Link a task to ${block.label}`}
                        >
                          <option value="">…or a task</option>
                          {tasks.map((task) => (
                            <option key={task.id} value={task.id}>
                              {task.title}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
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
