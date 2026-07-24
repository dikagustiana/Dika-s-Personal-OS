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
import { calculateDailyScore } from '../../logic/score';
import { useAppStore } from '../../store/appStore';

function minutesToTime(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const SLOTS = Array.from({ length: 36 }, (_, index) => {
  const startMinutes = 5 * 60 + 30 + index * 30;
  return {
    start: minutesToTime(startMinutes),
    end: minutesToTime(startMinutes + 30),
  };
});

function getCurrentSlot(now: Date): string | null {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const start = 5 * 60 + 30;
  const end = 23 * 60 + 30;
  if (currentMinutes < start || currentMinutes >= end) return null;
  return minutesToTime(start + Math.floor((currentMinutes - start) / 30) * 30);
}

export function Timebox() {
  const repository = useAppStore((state) => state.repository);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [blocks, setBlocks] = useState<TimeBlockEntry[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(new Date());
  const currentSlotRef = useRef<HTMLDivElement | null>(null);

  const currentSlot = isToday(parseISO(selectedDate)) ? getCurrentSlot(now) : null;

  const load = useCallback(async () => {
    const [blockEntries, taskEntries] = await Promise.all([
      repository.listEntries({ type: 'timeblock', date: selectedDate }),
      repository.listEntries({ type: 'task' }),
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
  }, [repository, selectedDate]);

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
    setDrafts((current) => ({ ...current, [slot.start]: '' }));
    const input: Omit<TimeBlockEntry, 'id' | 'createdAt' | 'updatedAt'> = {
      type: 'timeblock',
      date: selectedDate,
      start: slot.start,
      end: slot.end,
      label,
      taskId,
      status: 'planned',
      tags: [],
    };
    const created = (await repository.createEntry(input)) as TimeBlockEntry;
    setBlocks((current) => [...current, created].sort((a, b) => a.start.localeCompare(b.start)));
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

  const snapshotTodayScore = async (nextBlocks: TimeBlockEntry[]) => {
    if (!isToday(parseISO(selectedDate))) return;
    const [allEntries, currentLog] = await Promise.all([
      repository.listEntries(),
      repository.getDailyLog(selectedDate),
    ]);
    const habits = allEntries.filter(
      (entry): entry is HabitEntry => entry.type === 'habit' && entry.active,
    );
    const urgentTasks = allEntries.filter(
      (entry): entry is TaskEntry =>
        entry.type === 'task' &&
        entry.priority === 'urgent' &&
        (!entry.done || Boolean(entry.completedAt?.startsWith(selectedDate))),
    );
    const log: DailyLog = currentLog ?? { date: selectedDate, habits: {}, score: 0 };
    const score = calculateDailyScore({
      habits: {
        completed: habits.filter((habit) => log.habits[habit.id]).length,
        total: habits.length,
      },
      tasks: {
        completed: urgentTasks.filter((task) => task.done).length,
        total: urgentTasks.length,
      },
      timeblocks: {
        completed: nextBlocks.filter((block) => block.status === 'done').length,
        total: nextBlocks.length,
      },
    }).score;
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
    await snapshotTodayScore(nextBlocks);
  };

  const deleteBlock = async (block: TimeBlockEntry) => {
    await repository.deleteEntry(block.id);
    const nextBlocks = blocks.filter((item) => item.id !== block.id);
    setBlocks(nextBlocks);
    await snapshotTodayScore(nextBlocks);
  };

  const shiftDate = (days: number) => {
    setSelectedDate((current) => format(addDays(parseISO(current), days), 'yyyy-MM-dd'));
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">Work / Timebox</p>
          <h1 className="page-title">Shape the day</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-gray-500">
            Give attention a place to land. Each block is deliberately short and finishable.
          </p>
        </div>
        <div className="mt-5 flex items-center gap-2 md:mt-0">
          <Button variant="secondary" size="icon" onClick={() => shiftDate(-1)} aria-label="Previous day">
            <ChevronLeft className="size-4" />
          </Button>
          <div className="grid min-h-11 min-w-40 place-items-center border border-gray-800 bg-muted px-4 text-center">
            <span className="text-sm font-semibold">
              {isToday(parseISO(selectedDate)) ? 'Today' : format(parseISO(selectedDate), 'EEE, MMM d')}
            </span>
          </div>
          <Button variant="secondary" size="icon" onClick={() => shiftDate(1)} aria-label="Next day">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </header>

      <div className="mb-4 grid gap-3 border border-gray-800 bg-card p-4 text-xs text-gray-500 sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <Clock3 className="size-4 text-primary" />
          05:30–23:30 · 30 min
        </div>
        <div className="flex items-center gap-2">
          <Plus className="size-4 text-primary" />
          Type or link a task
        </div>
        <div className="flex items-center gap-2">
          <Link2 className="size-4 text-gold" />
          Linked completion cascades
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="divide-y divide-gray-800">
          {SLOTS.map((slot) => {
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
                  <time className={cn('font-mono text-xs tabular-nums', isCurrent ? 'text-primary' : 'text-gray-600')}>
                    {slot.start}
                  </time>
                  {isCurrent && <span className="mt-1 block text-[9px] font-bold uppercase tracking-wider text-primary">Now</span>}
                </div>

                {block ? (
                  <div className="min-w-0 md:flex md:items-center md:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn('font-semibold text-gray-200', block.status !== 'planned' && 'text-gray-500 line-through')}>
                          {block.label}
                        </p>
                        {block.taskId && (
                          <span className="inline-flex items-center gap-1 border border-gold/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gold/80">
                            <Link2 className="size-2.5" />
                            Task
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-600">
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
