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
}: TimeboxSectionProps) {
  const slots = useMemo(() => slotsForDomain(domain), [domain]);
  const isToday = date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentSlot = isToday ? getCurrentSlot(now, domain) : null;
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftCategory, setDraftCategory] = useState<TimeBlockCategory | ''>('');
  const currentSlotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!currentSlotRef.current) return;
    const timer = window.setTimeout(() => {
      currentSlotRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [currentSlot]);

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
  };

  return (
    <div className="divide-y divide-gray-800 border border-gray-800 bg-card">
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
                  <time className={cn('font-mono text-xs tabular-nums', isCurrent ? 'text-primary' : 'text-gray-600')}>
                    {slot.start}
                  </time>
                  {isCurrent && (
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-primary">Now</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <p
                    className={cn(
                      'min-w-0 text-sm font-semibold text-gray-200',
                      block.status !== 'planned' && 'text-gray-500 line-through',
                    )}
                  >
                    {block.label}
                  </p>
                  <span className="font-mono text-[10px] tabular-nums text-gray-600">
                    {durationLabel(block.start, block.end)}
                  </span>
                  {block.category && (
                    <span className="border border-gray-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                      {CATEGORY_LABELS[block.category]}
                    </span>
                  )}
                  {block.taskId && (
                    <span className="inline-flex items-center gap-1 border border-primary/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary/80">
                      <Link2 className="size-2.5" />
                      {linkedTask ? 'Task' : 'Task (done)'}
                    </span>
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
              <div className="grid gap-2 py-2 md:grid-cols-[4rem_minmax(140px,1fr)_minmax(130px,0.5fr)_minmax(150px,0.6fr)_auto]">
                <time className="self-center font-mono text-xs tabular-nums text-gray-600">{slot.start}</time>
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => handleDraftKey(event, slot)}
                  placeholder="Block label…"
                  aria-label={`Create block at ${slot.start}`}
                  autoFocus
                  className="h-11"
                />
                <select
                  className="native-select text-xs"
                  value={draftCategory}
                  onChange={(event) => setDraftCategory(event.target.value as TimeBlockCategory | '')}
                  aria-label={`Category at ${slot.start}`}
                >
                  <option value="">No category</option>
                  {(Object.keys(CATEGORY_LABELS) as TimeBlockCategory[]).map((key) => (
                    <option key={key} value={key}>
                      {CATEGORY_LABELS[key]}
                    </option>
                  ))}
                </select>
                <select
                  className="native-select text-xs"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) void createBlock(slot, event.target.value);
                    event.target.value = '';
                  }}
                  aria-label={`Assign a task at ${slot.start}`}
                >
                  <option value="">Or link an open task…</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
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
                className="group flex min-h-9 w-full items-center gap-3 py-1 text-left"
                aria-label={`Add a block at ${slot.start}`}
              >
                <time className={cn('w-[3.25rem] font-mono text-[11px] tabular-nums sm:w-16', isCurrent ? 'text-primary' : 'text-gray-700')}>
                  {slot.start}
                </time>
                <span className="h-px flex-1 bg-gray-800 transition-colors group-hover:bg-gray-700" />
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-700 transition-colors group-hover:text-gray-400">
                  <Plus className="size-3" />
                  add
                </span>
                {isCurrent && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary">Now</span>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
