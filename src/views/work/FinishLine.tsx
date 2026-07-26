import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Flag,
  Megaphone,
  OctagonAlert,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { Input } from '../../components/ui/Input';
import { Progress } from '../../components/ui/Progress';
import type { FinishLineItem, FinishLineStatus, Project } from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import { cn } from '../../lib/utils';
import {
  buildFinishLine,
  summarize,
  type FinishLineArea,
  type FinishLineGapRow,
} from '../../logic/finishLine';
import { useAppStore } from '../../store/appStore';

/**
 * The question this view answers: "What must be true for the group financial
 * pack to be trustworthy, what is it now, and which project closes the
 * difference?"
 *
 *     TARGET  ──▶  NOW  ──▶  GAP → PROJECT
 *
 * THE UNIT IS THE GAP ITEM, NOT THE PROJECT. The 21 WORK projects are
 * tributaries into one consolidated deliverable: one gap can hold up several
 * parts of the pack, and one project can close several gaps. A per-project
 * list cannot express either direction — which is why this view is keyed by
 * gap and resolves projects into it, and why the schema behind it carries a
 * real many-to-many rather than an owner column.
 *
 * WHAT THIS VIEW CANNOT SEE: the target itself lives in a workbook outside
 * Personal OS, so the list below is a hand-maintained representation of it.
 * When the pack gains a section or a gap closes in Excel, this list does not
 * know. That is acceptable rather than fatal because the items are structural
 * and slow-moving — several have been open for months — and because the list
 * already exists as a standing blocker register kept outside the app; this
 * relocates something stable rather than inventing new upkeep. There is
 * deliberately no importer and no sync: a half-working one would produce a
 * list that looks authoritative and is quietly stale.
 */

const STATUS_CHIP: Record<FinishLineStatus, { label: string; className: string }> = {
  // The app's existing three-colour vocabulary, unchanged — 383 milestones are
  // already read with it. No new colours are introduced here.
  blocked: { label: 'Blocked', className: 'border-destructive/50 text-destructive' },
  'in-progress': { label: 'In progress', className: 'border-escalate/50 text-escalate' },
  trusted: { label: 'Trusted', className: 'border-success/50 text-success' },
};

const STATUSES: FinishLineStatus[] = ['blocked', 'in-progress', 'trusted'];

const CHIP =
  'shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]';

interface Draft {
  area: string;
  item: string;
  targetState: string;
  currentState: string;
  interim: string;
  blocks: string;
  status: FinishLineStatus;
  projectIds: string[];
}

const BLANK_DRAFT: Draft = {
  area: '',
  item: '',
  targetState: '',
  currentState: '',
  interim: '',
  blocks: '',
  status: 'blocked',
  projectIds: [],
};

function draftOf(item: FinishLineItem): Draft {
  return {
    area: item.area,
    item: item.item,
    targetState: item.targetState,
    currentState: item.currentState ?? '',
    interim: item.interim ?? '',
    blocks: item.blocks ?? '',
    status: item.status,
    projectIds: [...item.projectIds],
  };
}

/** Blank text clears the column rather than storing an empty string. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function FinishLine() {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setProjectFocus = useAppStore((state) => state.setProjectFocus);
  const { run, isPending } = useMutation();

  const [items, setItems] = useState<FinishLineItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>({});
  const [showClosed, setShowClosed] = useState<Record<string, boolean>>({});
  /** Item id being edited, or 'new' for the add form. Null when neither. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);

  const load = useCallback(async () => {
    try {
      const [loadedProjects, loadedItems] = await Promise.all([
        repository.listProjects('work'),
        repository.listFinishLineItems(),
      ]);
      setProjects(loadedProjects);
      setItems(loadedItems);
      setLoadError(null);
    } catch (error) {
      // A read failure here is most likely a database that has not run
      // migration 20260726000020. Say that instead of rendering an empty list,
      // which would read as "no gaps" — the one wrong thing this view can say.
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoaded(true);
    }
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const areas = useMemo(() => buildFinishLine(items, projects), [items, projects]);
  const summary = useMemo(() => summarize(areas), [areas]);

  const isAreaOpen = (area: FinishLineArea) => openAreas[area.area] ?? area.defaultOpen;

  const toggleArea = (area: FinishLineArea) =>
    setOpenAreas((current) => ({ ...current, [area.area]: !(current[area.area] ?? area.defaultOpen) }));

  const openProject = (projectId: string) => {
    setProjectFocus({ projectId, openMilestones: true });
    setWorkView('projects');
  };

  const startAdd = () => {
    setDraft(BLANK_DRAFT);
    setEditing('new');
  };

  const startEdit = (item: FinishLineItem) => {
    setDraft(draftOf(item));
    setEditing(item.id);
  };

  const save = async () => {
    const payload = {
      area: draft.area.trim(),
      item: draft.item.trim(),
      targetState: draft.targetState.trim(),
      currentState: optional(draft.currentState),
      interim: optional(draft.interim),
      blocks: optional(draft.blocks),
      status: draft.status,
      projectIds: draft.projectIds,
    };
    const saved =
      editing === 'new'
        ? await run('Add gap item', () =>
            repository.createFinishLineItem({ ...payload, order: items.length }),
          )
        : await run('Save gap item', () =>
            repository.updateFinishLineItem(editing as string, payload),
          );
    // The draft stays on screen when the write failed, so a transient failure
    // never swallows typed text. useMutation has already raised the toast.
    if (!saved) return;
    setEditing(null);
    await load();
  };

  const remove = async (item: FinishLineItem) => {
    const done = await run('Delete gap item', () => repository.deleteFinishLineItem(item.id));
    if (done === undefined) return;
    setEditing(null);
    await load();
  };

  const canSave =
    draft.area.trim().length > 0 &&
    draft.item.trim().length > 0 &&
    draft.targetState.trim().length > 0;

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">Work / Finish line</p>
        <h1 className="page-title">The target and the gap</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
          What must be true for the pack to be trustworthy, what it currently is, and
          which project closes the difference. One gap can hold up several parts of the
          pack; one project can close several gaps.
        </p>
      </header>

      <div className="mb-5 grid gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-card p-5">
          <Flag className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4">{summary.open}</p>
          <p className="surface-label mt-1.5">Open gaps · {summary.blocked} blocked</p>
        </div>
        <div className="bg-card p-5">
          <OctagonAlert className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4">{summary.unowned}</p>
          <p className="surface-label mt-1.5">Open with no project</p>
        </div>
        <div className="bg-card p-5">
          <TriangleAlert className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4">{summary.provisional}</p>
          <p className="surface-label mt-1.5">Standing on a proxy</p>
        </div>
        <button
          className="bg-card p-5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          // Projects, not Escalations: the Escalations view deliberately shows
          // only milestones that already have a target, so silent blockers
          // would vanish on click. The escalation selector lives in Projects.
          onClick={() => setWorkView('projects')}
          aria-label="Open projects to assign an escalation target"
        >
          <Megaphone className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4">{summary.silent}</p>
          <p className="surface-label mt-1.5">
            Stuck, escalated to no one <ArrowRight className="ml-1 inline size-3" />
          </p>
        </button>
      </div>

      <div className="mb-4 flex justify-end">
        <Button onClick={startAdd} disabled={editing === 'new'}>
          <Plus className="size-4" />
          Add gap item
        </Button>
      </div>

      {editing === 'new' && (
        <Card className="mb-5">
          <CardContent className="pt-5">
            <GapEditor
              draft={draft}
              projects={projects}
              onChange={setDraft}
              onSave={() => void save()}
              onCancel={() => setEditing(null)}
              canSave={canSave}
              isPending={isPending}
            />
          </CardContent>
        </Card>
      )}

      {loadError && (
        <Card className="mb-5 border-destructive">
          <CardContent className="pt-5">
            <EmptyRow
              label="Gap items"
              clause={`Could not be read — ${loadError}`}
              action="Retry"
              onAction={() => void load()}
            />
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {areas.map((area) => {
          const open = isAreaOpen(area);
          const closedShown = showClosed[area.area] ?? false;
          return (
            <Card key={area.area}>
              <button
                type="button"
                onClick={() => toggleArea(area)}
                aria-expanded={open}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg p-5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {open ? (
                  <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-foreground-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-card-heading font-semibold text-foreground">
                    {area.area}
                  </span>
                  <span className="mt-1 block text-xs tabular-nums text-foreground-muted">
                    {area.open.length} open
                    {area.blockedCount > 0 && ` · ${area.blockedCount} blocked`}
                    {area.unownedCount > 0 && ` · ${area.unownedCount} unowned`}
                    {area.closed.length > 0 && ` · ${area.closed.length} trusted`}
                  </span>
                </span>
                {area.unownedCount > 0 && (
                  <span className={cn(CHIP, 'border-destructive bg-destructive text-destructive-foreground')}>
                    Unowned
                  </span>
                )}
              </button>

              {open && (
                <CardContent className="pt-0">
                  <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                    {area.open.map((row) => (
                      <GapRow
                        key={row.item.id}
                        row={row}
                        editing={editing === row.item.id}
                        draft={draft}
                        projects={projects}
                        isPending={isPending}
                        canSave={canSave}
                        onDraftChange={setDraft}
                        onEdit={() => startEdit(row.item)}
                        onCancel={() => setEditing(null)}
                        onSave={() => void save()}
                        onDelete={() => void remove(row.item)}
                        onOpenProject={openProject}
                      />
                    ))}
                  </ul>

                  {area.closed.length > 0 && (
                    <>
                      {/* Trusted items are what has actually been closed — the
                          only evidence of progress this view can offer — but
                          they must not compete with open items for attention,
                          so they stay behind one more click. */}
                      <button
                        type="button"
                        onClick={() =>
                          setShowClosed((current) => ({
                            ...current,
                            [area.area]: !(current[area.area] ?? false),
                          }))
                        }
                        aria-expanded={closedShown}
                        className="flex min-h-11 w-full items-center gap-2 border-t border-border-subtle text-left text-xs font-semibold text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {closedShown ? (
                          <ChevronDown className="size-3.5 text-foreground-muted" />
                        ) : (
                          <ChevronRight className="size-3.5 text-foreground-muted" />
                        )}
                        {area.closed.length} trusted
                      </button>
                      {closedShown && (
                        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                          {area.closed.map((row) => (
                            <GapRow
                              key={row.item.id}
                              row={row}
                              editing={editing === row.item.id}
                              draft={draft}
                              projects={projects}
                              isPending={isPending}
                              canSave={canSave}
                              onDraftChange={setDraft}
                              onEdit={() => startEdit(row.item)}
                              onCancel={() => setEditing(null)}
                              onSave={() => void save()}
                              onDelete={() => void remove(row.item)}
                              onOpenProject={openProject}
                            />
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}

        {loaded && !loadError && areas.length === 0 && (
          <Card>
            <CardContent className="pt-5">
              <EmptyRow
                label="Target"
                clause="Nothing recorded — no gap item has been entered yet"
                action="Add gap item"
                onAction={startAdd}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One gap item: TARGET · NOW · CLOSES VIA
// ---------------------------------------------------------------------------

interface GapRowProps {
  row: FinishLineGapRow;
  editing: boolean;
  draft: Draft;
  projects: Project[];
  isPending: boolean;
  canSave: boolean;
  onDraftChange: (draft: Draft) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  onOpenProject: (projectId: string) => void;
}

function GapRow({
  row,
  editing,
  draft,
  projects,
  isPending,
  canSave,
  onDraftChange,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  onOpenProject,
}: GapRowProps) {
  const { item } = row;
  const chip = STATUS_CHIP[item.status];
  // A closed item needs no owner, so the unowned marker is an OPEN-item
  // finding only.
  const unowned = row.unowned && item.status !== 'trusted';

  if (editing) {
    return (
      <li className="py-4">
        <GapEditor
          draft={draft}
          projects={projects}
          onChange={onDraftChange}
          onSave={onSave}
          onCancel={onCancel}
          onDelete={onDelete}
          canSave={canSave}
          isPending={isPending}
        />
      </li>
    );
  }

  return (
    <li
      className={cn(
        'border-l-2 py-4 pl-3',
        unowned ? 'border-l-destructive' : 'border-l-transparent',
      )}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.95fr)]">
        {/* TARGET */}
        <div className="min-w-0">
          <p className="surface-label">Target</p>
          <p className="mt-1.5 text-sm font-semibold text-foreground">{item.item}</p>
          <p className="mt-1 text-sm leading-6 text-foreground-secondary">{item.targetState}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn(CHIP, chip.className)}>{chip.label}</span>
            {unowned && (
              <span className={cn(CHIP, 'border-destructive bg-destructive text-destructive-foreground')}>
                No project
              </span>
            )}
          </div>
        </div>

        {/* NOW */}
        <div className="min-w-0">
          <p className="surface-label">Now</p>
          <p className="mt-1.5 text-sm leading-6 text-foreground-secondary">
            {item.currentState ?? (
              <span className="text-foreground-muted">Not recorded</span>
            )}
          </p>
          {item.interim && (
            // A proxy is NOT a value, and rendering it like one is the exact
            // failure this field exists to prevent: a figure resting on a
            // driver known to be wrong gets quoted back in a board meeting.
            <div className="mt-2 rounded-sm border border-escalate/50 bg-surface-2 p-2.5">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-escalate">
                <TriangleAlert className="size-3.5" />
                Standing in
              </p>
              <p className="mt-1 text-sm leading-6 text-foreground-secondary">{item.interim}</p>
            </div>
          )}
        </div>

        {/* CLOSES VIA */}
        <div className="min-w-0">
          <p className="surface-label">Closes via</p>
          {row.projects.length === 0 ? (
            <p className={cn('mt-1.5 text-sm', unowned ? 'text-destructive' : 'text-foreground-muted')}>
              {unowned ? 'No project closes this.' : 'Closed without a project on file.'}
            </p>
          ) : (
            <ul className="mt-1.5 space-y-2">
              {row.projects.map((project) => {
                const total = project.milestones.length;
                const done = project.milestones.filter((milestone) => milestone.done).length;
                const percent = total > 0 ? (100 * done) / total : 0;
                return (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => onOpenProject(project.id)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-sm px-1 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground-secondary">
                          {project.title}
                        </span>
                        <Progress value={percent} className="mt-1.5 h-1" />
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">
                        {done}/{total}
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-foreground-muted" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {row.silentBlockers > 0 && (
            // The silent-blocker signal, moved off the project list and onto
            // the gap: this gap is stuck AND nobody outside has been told.
            <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-escalate">
              <Megaphone className="mt-0.5 size-3.5 shrink-0" />
              {row.silentBlockers === 1
                ? 'Stuck on 1 blocked milestone, escalated to no one'
                : `Stuck on ${row.silentBlockers} blocked milestones, escalated to no one`}
            </p>
          )}
        </div>
      </div>

      {item.blocks && (
        <p
          className={cn(
            'mt-3 text-xs leading-5',
            row.provisional ? 'text-escalate' : 'text-foreground-muted',
          )}
        >
          <span className="font-semibold uppercase tracking-[0.08em]">
            {/* Downstream of a proxy is provisional, not missing — the two are
                different kinds of thing and the label says which. */}
            {row.provisional ? 'Provisional downstream' : 'Blocks'}
          </span>{' '}
          {item.blocks}
        </p>
      )}

      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" />
          Edit
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

interface GapEditorProps {
  draft: Draft;
  projects: Project[];
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  canSave: boolean;
  isPending: boolean;
}

const FIELD =
  'mt-2 w-full rounded-sm border border-border bg-surface-2 p-3 text-base text-foreground outline-none placeholder:text-foreground-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:text-sm';

function GapEditor({
  draft,
  projects,
  onChange,
  onSave,
  onCancel,
  onDelete,
  canSave,
  isPending,
}: GapEditorProps) {
  const patch = (next: Partial<Draft>) => onChange({ ...draft, ...next });

  const toggleProject = (projectId: string) =>
    patch({
      projectIds: draft.projectIds.includes(projectId)
        ? draft.projectIds.filter((id) => id !== projectId)
        : [...draft.projectIds, projectId],
    });

  const sorted = [...projects].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="surface-label">Area</span>
          <Input
            className="mt-2"
            value={draft.area}
            onChange={(event) => patch({ area: event.target.value })}
            placeholder="Free text — a block, a schedule, a ratio"
            aria-label="Gap item area"
          />
        </label>
        <label className="block">
          <span className="surface-label">Status</span>
          <select
            className="native-select mt-2"
            value={draft.status}
            onChange={(event) => patch({ status: event.target.value as FinishLineStatus })}
            aria-label="Gap item status"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_CHIP[status].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="surface-label">Item</span>
        <Input
          className="mt-2"
          value={draft.item}
          onChange={(event) => patch({ item: event.target.value })}
          aria-label="Gap item"
        />
      </label>

      <label className="block">
        <span className="surface-label">Target state</span>
        <textarea
          className={FIELD}
          rows={2}
          value={draft.targetState}
          onChange={(event) => patch({ targetState: event.target.value })}
          placeholder="What must be true for this to be trustworthy"
          aria-label="Gap item target state"
        />
      </label>

      <label className="block">
        <span className="surface-label">Current state</span>
        <textarea
          className={FIELD}
          rows={2}
          value={draft.currentState}
          onChange={(event) => patch({ currentState: event.target.value })}
          aria-label="Gap item current state"
        />
      </label>

      <label className="block">
        <span className="surface-label">Interim proxy</span>
        <textarea
          className={FIELD}
          rows={2}
          value={draft.interim}
          onChange={(event) => patch({ interim: event.target.value })}
          placeholder="What is standing in while the real input is unavailable"
          aria-label="Gap item interim proxy"
        />
        <span className="mt-1.5 block text-xs text-foreground-muted">
          Filled in, everything downstream renders as provisional rather than settled.
        </span>
      </label>

      <label className="block">
        <span className="surface-label">Blocks</span>
        <textarea
          className={FIELD}
          rows={2}
          value={draft.blocks}
          onChange={(event) => patch({ blocks: event.target.value })}
          placeholder="What else stops being trustworthy while this is open"
          aria-label="Gap item downstream consequence"
        />
      </label>

      <fieldset>
        <legend className="surface-label">Closed by</legend>
        <p className="mt-1.5 text-xs text-foreground-muted">
          Several projects can close one gap, and one project can appear under several gaps.
        </p>
        {sorted.length === 0 ? (
          <p className="mt-2 text-xs text-foreground-muted">No WORK projects to link.</p>
        ) : (
          <div className="mt-2 max-h-56 overflow-y-auto rounded-sm border border-border">
            {sorted.map((project) => (
              <label
                key={project.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border-subtle px-3 last:border-b-0 hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={draft.projectIds.includes(project.id)}
                  onChange={() => toggleProject(project.id)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground-secondary">
                  {project.title}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onDelete && (
          <Button
            variant="danger"
            size="sm"
            onClick={onDelete}
            disabled={isPending}
            className="mr-auto"
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={!canSave || isPending}>
          Save
        </Button>
      </div>
      {!canSave && (
        <p className="flex items-center justify-end gap-1.5 text-xs text-foreground-muted">
          <AlertTriangle className="size-3.5" />
          Area, item and target state are required.
        </p>
      )}
    </div>
  );
}
