import { format, parseISO } from 'date-fns';
import { Check, ChevronDown, ChevronRight, Pencil, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProjectTaskWrite } from '../../data/repository';
import type { ProjectTask, TaskStatus } from '../../data/types';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

/**
 * THE TASK LIST + PER-PROJECT TIMELINE (slice 1) — the first surface where a
 * collaborator CREATES rows rather than only moving a cell forward.
 *
 * Everything here is the fast failure only: membership, the project_id lock,
 * the assignee rule and attribution stamping are all re-decided by the
 * os_tasks trigger from the credential. This component simply does not offer
 * what SQL would reject — a contributor's assignee picker holds only
 * themselves because RLS lets them enumerate nobody else, and there is no
 * delete control anywhere because no delete path exists in the interface or
 * the database. A task ends as done or cancelled.
 *
 * The timeline is DERIVED from task due dates plus status, on read, the same
 * way every other derived number in this app works. No milestone data is
 * involved (os_projects.milestones is untouched by slice 1).
 */
export interface TaskSectionData {
  /** This project's tasks, already filtered by the view. */
  tasks: ProjectTask[];
  /** userIds holding membership on THIS project — the owner's assignee pool. */
  memberIds: string[];
  /** The contributor's own uid; undefined means the owner is viewing. */
  viewerUserId?: string;
  /** uuid → label (email when known). Falls back inside the component. */
  resolveUser: (userId: string) => string;
  onCreate: (input: {
    projectId: string;
    title: string;
    detail?: string;
    dueDate?: string;
    assignee?: string;
  }) => Promise<boolean>;
  onUpdate: (id: string, patch: ProjectTaskWrite) => Promise<boolean>;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Terbuka',
  in_progress: 'Berjalan',
  blocked: 'Terhambat',
  done: 'Selesai',
  cancelled: 'Dibatalkan',
};

const STATUS_DOT: Record<TaskStatus, string> = {
  open: 'bg-foreground-muted',
  in_progress: 'bg-primary',
  blocked: 'bg-destructive',
  done: 'bg-border',
  cancelled: 'bg-border',
};

/** done and cancelled are terminal: they leave the open count and the
 *  timeline's urgency colouring alone. */
const TERMINAL: ReadonlySet<TaskStatus> = new Set(['done', 'cancelled']);

function AssigneeSelect({
  value,
  data,
  ariaLabel,
  onChange,
}: {
  value: string;
  data: TaskSectionData;
  ariaLabel: string;
  onChange: (next: string) => void;
}) {
  // The owner assigns any member of the project; a contributor can only
  // enumerate themself (RLS: own membership rows only), so the picker offers
  // exactly that. A foreign assignee set by someone else still renders, as a
  // disabled option, so the row never lies about its current value.
  const options = data.viewerUserId ? [data.viewerUserId] : data.memberIds;
  const foreign = value && !options.includes(value);
  return (
    <select
      className="native-select !h-8 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
    >
      <option value="">— tanpa PIC</option>
      {options.map((userId) => (
        <option key={userId} value={userId}>
          {data.viewerUserId === userId ? 'saya' : data.resolveUser(userId)}
        </option>
      ))}
      {foreign && (
        <option value={value} disabled>
          {data.resolveUser(value)}
        </option>
      )}
    </select>
  );
}

function Attribution({ task, data }: { task: ProjectTask; data: TaskSectionData }) {
  if (!task.changedAt) return null;
  const contributor = task.actorKind === 'contributor';
  const who = contributor
    ? task.actor === data.viewerUserId
      ? 'saya'
      : data.resolveUser(task.actor ?? '')
    : 'pemilik';
  return (
    <span className="text-[10px] tabular-nums text-foreground-muted">
      {/* Same submission dot as the matrix — one meaning everywhere: the last
          touch was a contributor's and the owner has not been over it. */}
      {contributor && (
        <span className="mr-0.5 text-primary" aria-hidden="true">
          •
        </span>
      )}
      {who} · {format(parseISO(task.changedAt), 'd MMM HH:mm')}
    </span>
  );
}

function TaskRow({
  task,
  data,
  busy,
  onBusy,
}: {
  task: ProjectTask;
  data: TaskSectionData;
  busy: boolean;
  onBusy: (next: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [detail, setDetail] = useState(task.detail);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');

  const patch = async (change: ProjectTaskWrite) => {
    onBusy(true);
    await data.onUpdate(task.id, change);
    onBusy(false);
  };

  const saveEdits = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onBusy(true);
    const saved = await data.onUpdate(task.id, {
      title: trimmed,
      detail,
      dueDate: dueDate || null,
    });
    onBusy(false);
    if (saved) setEditing(false);
  };

  const terminal = TERMINAL.has(task.status);

  if (editing) {
    return (
      <li className="rounded-md border border-border bg-surface-2/50 p-2.5">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label={`Judul tugas ${task.title}`}
        />
        <textarea
          className="mt-2 w-full rounded-sm border border-border bg-background px-2.5 py-2 text-[11px] leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={2}
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder="Detail (opsional)"
          aria-label={`Detail tugas ${task.title}`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            type="date"
            className="!w-auto"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            aria-label={`Tenggat tugas ${task.title}`}
          />
          <Button size="sm" onClick={() => void saveEdits()} disabled={busy || !title.trim()}>
            <Check className="size-3.5" />
            Simpan
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
            Batal
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <span
        className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[task.status])}
        aria-hidden="true"
      />
      <span
        className={cn(
          'min-w-0 flex-1 break-words text-xs text-foreground',
          terminal && 'text-foreground-muted line-through',
        )}
      >
        {task.title}
        {task.detail && (
          <span className="mt-0.5 block whitespace-pre-wrap text-[11px] leading-4 text-foreground-muted">
            {task.detail}
          </span>
        )}
      </span>
      {task.dueDate && (
        <span className="shrink-0 text-[10px] tabular-nums text-foreground-muted">
          {format(parseISO(task.dueDate), 'd MMM')}
        </span>
      )}
      <select
        className="native-select !h-8 !w-auto text-xs"
        value={task.status}
        onChange={(event) => void patch({ status: event.target.value as TaskStatus })}
        aria-label={`Status tugas ${task.title}`}
        disabled={busy}
      >
        {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </select>
      <AssigneeSelect
        value={task.assignee ?? ''}
        data={data}
        ariaLabel={`PIC tugas ${task.title}`}
        onChange={(next) => void patch({ assignee: next || null })}
      />
      <Attribution task={task} data={data} />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setTitle(task.title);
          setDetail(task.detail);
          setDueDate(task.dueDate ?? '');
          setEditing(true);
        }}
        aria-label={`Ubah tugas ${task.title}`}
      >
        <Pencil className="size-3.5" />
      </Button>
    </li>
  );
}

/** The dated slice of the list, in date order — the project's timeline. */
function Timeline({ tasks, today }: { tasks: ProjectTask[]; today: Date }) {
  const dated = useMemo(
    () =>
      tasks
        .filter((task) => task.dueDate)
        .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string)),
    [tasks],
  );
  if (dated.length === 0) return null;
  const todayKey = format(today, 'yyyy-MM-dd');
  return (
    <ol className="mb-3 space-y-1 border-l-2 border-border-subtle pl-3">
      {dated.map((task) => {
        const overdue = !TERMINAL.has(task.status) && (task.dueDate as string) < todayKey;
        return (
          <li key={task.id} className="flex items-center gap-2 text-[11px]">
            <span
              className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[task.status])}
              aria-hidden="true"
            />
            <span
              className={cn(
                'w-14 shrink-0 tabular-nums',
                overdue ? 'font-semibold text-destructive' : 'text-foreground-muted',
              )}
            >
              {format(parseISO(task.dueDate as string), 'd MMM')}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                TERMINAL.has(task.status)
                  ? 'text-foreground-muted line-through'
                  : 'text-foreground-secondary',
              )}
            >
              {task.title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function TaskSection({
  projectId,
  projectTitle,
  data,
  today,
  defaultOpen = false,
}: {
  projectId: string;
  projectTitle: string;
  data: TaskSectionData;
  today?: Date;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const now = today ?? new Date();

  const openCount = data.tasks.filter((task) => !TERMINAL.has(task.status)).length;

  const create = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    const created = await data.onCreate({
      projectId,
      title: trimmed,
      ...(dueDate ? { dueDate } : {}),
    });
    setBusy(false);
    if (created) {
      setTitle('');
      setDueDate('');
      setAdding(false);
    }
  };

  return (
    <section aria-label={`Tugas untuk ${projectTitle}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-9 w-full items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-foreground-muted" />
        )}
        <span className="surface-label">Tugas</span>
        <span className="text-[11px] tabular-nums text-foreground-muted">
          {data.tasks.length === 0
            ? 'belum ada'
            : `${openCount} terbuka · ${data.tasks.length} total`}
        </span>
      </button>

      {open && (
        <div className="mt-2">
          <Timeline tasks={data.tasks} today={now} />

          {data.tasks.length === 0 ? (
            <p className="text-xs text-foreground-muted">
              Belum ada tugas di proyek ini.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {data.tasks.map((task) => (
                <TaskRow key={task.id} task={task} data={data} busy={busy} onBusy={setBusy} />
              ))}
            </ul>
          )}

          {adding ? (
            <div className="mt-2 rounded-md border border-border bg-surface-2/50 p-2.5">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Apa yang harus selesai?"
                aria-label={`Judul tugas baru untuk ${projectTitle}`}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  className="!w-auto"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  aria-label={`Tenggat tugas baru untuk ${projectTitle}`}
                />
                <Button size="sm" onClick={() => void create()} disabled={busy || !title.trim()}>
                  <Plus className="size-3.5" />
                  Tambah
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                  <X className="size-3.5" />
                  Batal
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1.5"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-3.5" />
              Tambah tugas
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
