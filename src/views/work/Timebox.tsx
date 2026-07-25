import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleSlash2,
  Clock3,
  Link2,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { addDays, format, isToday, parseISO } from 'date-fns';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import type {
  DailyLog,
  HabitEntry,
  TaskEntry,
  TimeBlockEntry,
} from '../../data/types';
import { cn } from '../../lib/utils';
import { scoreFromSnapshot, scoredTasks } from '../../logic/dailyLog';
import { useMutation } from '../../hooks/useMutation';
import { DOMAIN_HOURS, getCurrentSlot, minutesToTime, slotsForDomain } from '../../logic/timebox';
import { useAppStore } from '../../store/appStore';

export function Timebox() {
  const repository = useAppStore((state) => state.repository);
  const domain = useAppStore((state) => state.workspace);
  const { run } = useMutation();
  const slots = useMemo(() => slotsForDomain(domain), [domain]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [blocks, setBlocks] = useState<TimeBlockEntry[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(new Date());
  const currentSlotRef = useRef<HTMLDivElement | null>(null);

  const currentSlot = isToday(parseISO(selectedDate)) ? getCurrentSlot(now, domain) : null;

  const load = useCallback(async () => {
    const [blockEntries, taskEntries] = await Promise.all([
      repository.listEntries({ type: 'timeblock', date: selectedDate, domain }),
      repository.listEntries({ type: 'task', domain }),
    ]);
    setBlocks(
      blockEntries
        .filter((entry): entry is TimeBlockEntry => entry.type === 'timeblock')
        .sort((a, b) => a.start.localeCompare(b.start)),
    );
    setTasks(
      taskEntries
        .filter((entry): entry is TaskEntry => entry.type === 'task' && !entry.done)
        .sort((a, b) => a.title.localeCompare(b.title)),
    );
  }, [domain, repository, selectedDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!currentSlotRef.current) return;
    const timer = window.setTimeout(() => {
      currentSlotRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [currentSlot, selectedDate]);

  const byStart = useMemo(
    () => new Map(blocks.map((block) => [block.start, block])),
    [blocks],
  );
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const createBlock = async (slot: { start: string; end: string }, taskId?: string) => {
    const linkedTask = taskId ? tasks.find((task) => task.id === taskId) : undefined;
    const label = linkedTask?.title ?? drafts[slot.start]?.trim();
    if (!label) return;
    const input: Omit<TimeBlockEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      type: 'timeblock',
      domain,
      date: selectedDate,
      start: slot.start,
      end: slot.end,
      label,
      taskId,
      status: 'planned',
      tags: [],
    };
    const created = await run('Add timeblock', () => repository.createEntry(input));
    if (!created) return;
    // The draft is only cleared once the write is confirmed.
    setDrafts((current) => ({ ...current, [slot.start]: '' }));
    const nextBlocks = [...blocks, created as TimeBlockEntry].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    setBlocks(nextBlocks);
    await recomputeAndPersistDailyLog(nextBlocks);
  };

  const handleDraftKey = (
    event: KeyboardEvent<HTMLInputElement>,
    slot: { start: string; end: string },
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void createBlock(slot);
    }
  };

  /**
   * This view can show any date, so rather than mirroring state it re-reads
   * the day it is about to score. Same single derivation as everywhere else
   * (scoreFromSnapshot); only the source of the inputs differs.
   */
  const recomputeAndPersistDailyLog = async (nextBlocks: TimeBlockEntry[]) => {
    if (!isToday(parseISO(selectedDate))) return;
    const [allEntries, currentLog] = await Promise.all([
      repository.listEntries({ domain }),
      repository.getDailyLog(selectedDate, domain),
    ]);
    const habits = allEntries.filter(
      (entry): entry is HabitEntry => entry.type === 'habit' && entry.active,
    );
    const allTasks = allEntries.filter((entry): entry is TaskEntry => entry.type === 'task');
    const log: DailyLog = currentLog ?? {
      date: selectedDate,
      domain,
      habits: {},
      score: 0,
    };
    const score = scoreFromSnapshot({
      habits,
      tasks: scoredTasks(allTasks, selectedDate),
      blocks: nextBlocks,
      log,
    });
    await repository.upsertDailyLog({ ...log, score });
  };

  const setStatus = async (
    block: TimeBlockEntry,
    status: TimeBlockEntry['status'],
  ) => {
    const updated = (await repository.updateEntry(block.id, { status })) as TimeBlockEntry;
    const nextBlocks = blocks.map((item) => (item.id === block.id ? updated : item));
    setBlocks(nextBlocks);
    if (status === 'done' && block.taskId) {
      await repository.updateEntry(block.taskId, {
        done: true,
        completedAt: new Date().toISOString(),
      });
      setTasks((current) => current.filter((task) => task.id !== block.taskId));
    }
    await recomputeAndPersistDailyLog(nextBlocks);
  };

  const deleteBlock = async (block: TimeBlockEntry) => {
    await repository.deleteEntry(block.id);
    const nextBlocks = blocks.filter((item) => item.id !== block.id);
    setBlocks(nextBlocks);
    await recomputeAndPersistDailyLog(nextBlocks);
  };

  const shiftDate = (days: number) => {
    setSelectedDate((current) => format(addDays(parseISO(current), days), 'yyyy-MM-dd'));
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">{domain} / Timebox</p>
          <h1 className="page-title">Shape the day</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-muted">
            Give attention a place to land. Each block is deliberately short and finishable.
          </p>
        </div>
        <div className="mt-5 flex items-center gap-2 md:mt-0">
          <Button variant="secondary" size="icon" onClick={() => shiftDate(-1)} aria-label="Previous day">
            <ChevronLeft className="size-4" />
          </Button>
          <div className="grid min-h-11 min-w-40 place-items-center border border-border-subtle bg-muted px-4 text-center">
            <span className="text-sm font-semibold">
              {isToday(parseISO(selectedDate)) ? 'Today' : format(parseISO(selectedDate), 'EEE, MMM d')}
            </span>
          </div>
          <Button variant="secondary" size="icon" onClick={() => shiftDate(1)} aria-label="Next day">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </header>

      <div className="mb-4 grid gap-3 border border-border-subtle bg-card p-4 text-xs text-foreground-muted sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <Clock3 className="size-4 text-foreground-muted" />
          {minutesToTime(DOMAIN_HOURS[domain].startMinutes)}–
          {minutesToTime(DOMAIN_HOURS[domain].endMinutes)} · 30 min
        </div>
        <div className="flex items-center gap-2">
          <Plus className="size-4 text-foreground-muted" />
          Type or link a task
        </div>
        <div className="flex items-center gap-2">
          <Link2 className="size-4 text-foreground-muted" />
          Linked completion cascades
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="divide-y divide-border-subtle">
          {slots.map((slot) => {
            const block = byStart.get(slot.start);
            const isCurrent = currentSlot === slot.start;
            const linkedTask = block?.taskId
              ? taskById.get(block.taskId) ?? tasks.find((task) => task.id === block.taskId)
              : undefined;
            return (
              <div
                key={slot.start}
                ref={isCurrent ? currentSlotRef : undefined}
                className={cn(
                  'relative grid min-h-[88px] grid-cols-[3.75rem_minmax(0,1fr)] gap-3 px-3 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:px-5',
                  isCurrent && 'bg-primary/[0.08]',
                )}
              >
                {isCurrent && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                <div className="pt-1">
                  <time className={cn('font-mono text-xs tabular-nums', isCurrent ? 'text-foreground' : 'text-foreground-muted')}>
                    {slot.start}
                  </time>
                  {isCurrent && <span className="mt-1 block text-[9px] font-bold uppercase tracking-wider text-foreground-secondary">Now</span>}
                </div>

                {block ? (
                  <div className="min-w-0 md:flex md:items-center md:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn('font-semibold text-foreground', block.status !== 'planned' && 'text-foreground-muted line-through')}>
                          {block.label}
                        </p>
                        {block.taskId && (
                          <span className="inline-flex items-center gap-1 border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-muted">
                            <Link2 className="size-2.5" />
                            Task
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-foreground-muted">
                        {slot.start}–{slot.end}
                        {linkedTask ? ` · ${linkedTask.priority}` : ' · standalone'}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 md:mt-0 md:justify-end">
                      <Button
                        size="icon"
                        variant={block.status === 'done' ? 'default' : 'secondary'}
                        onClick={() => void setStatus(block, block.status === 'done' ? 'planned' : 'done')}
                        aria-label={`Mark ${block.label} done`}
                      >
                        {block.status === 'done' ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant={block.status === 'skipped' ? 'default' : 'secondary'}
                        onClick={() => void setStatus(block, block.status === 'skipped' ? 'planned' : 'skipped')}
                        aria-label={`Skip ${block.label}`}
                      >
                        <CircleSlash2 className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="danger"
                        onClick={() => void deleteBlock(block)}
                        aria-label={`Delete ${block.label}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(160px,1fr)_minmax(200px,0.9fr)]">
                    <Input
                      value={drafts[slot.start] ?? ''}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [slot.start]: event.target.value }))
                      }
                      onKeyDown={(event) => handleDraftKey(event, slot)}
                      placeholder="Type a standalone block…"
                      aria-label={`Create block at ${slot.start}`}
                    />
                    <select
                      className="native-select"
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
