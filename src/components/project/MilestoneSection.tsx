import { format, parseISO } from 'date-fns';
import { Check, ChevronRight, Flag, Megaphone, Pencil, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  DateConfidence,
  Domain,
  EscalateTo,
  Milestone,
  MilestoneStatus,
  ProjectDocument,
} from '../../data/types';
import {
  daysLeft,
  daysLeftLabelFor,
  resolveConfidence,
  urgencyForConfident,
} from '../../logic/deadlines';
import { appendDocument, removeDocumentAt } from '../../logic/documents';
import {
  ESCALATION_TARGETS,
  MILESTONE_STATUSES,
  milestoneEnd,
  withMilestoneDone,
  withMilestoneStatus,
} from '../../logic/milestones';
import { cn } from '../../lib/utils';
import { Input } from '../ui/Input';
import { Progress } from '../ui/Progress';
import { TbcChip } from '../ui/TbcChip';
import { DocumentLinks, DocumentUpload } from './DocumentSection';

/** `12 Aug`, `~12 Aug`, or `TBC` — confidence marking as everywhere else. */
function shortDate(value: string, confidence?: DateConfidence): string {
  const resolved = resolveConfidence(confidence);
  if (resolved === 'unknown') return 'TBC';
  const label = format(parseISO(value), 'd MMM');
  return resolved === 'estimated' ? `~${label}` : label;
}

/**
 * Days remaining against the milestone's end date.
 *
 * Never rendered for a done milestone — a finished thing has no countdown.
 * Urgency runs through `urgencyForConfident`, so a placeholder date still
 * refuses to turn red: that was settled in v5 and this badge does not reopen
 * it.
 */
function DaysLeftBadge({
  endDate,
  confidence,
  today,
}: {
  endDate: string;
  confidence?: DateConfidence;
  today: Date;
}) {
  const urgency = urgencyForConfident(endDate, today, 7, confidence);
  return (
    <span
      className={cn(
        'shrink-0 border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider tabular-nums',
        urgency === 'overdue' && 'border-destructive/40 text-destructive',
        urgency === 'due-soon' && 'border-escalate/40 text-escalate',
        urgency === 'on-track' && 'border-border text-foreground-muted',
      )}
    >
      {daysLeftLabelFor(daysLeft(endDate, today), confidence)}
    </span>
  );
}

/** The 4-state model kept visible: fill for done, colour for everything else. */
function StatusToggle({
  milestone,
  onToggle,
}: {
  milestone: Milestone;
  onToggle: () => void;
}) {
  const label = milestone.done
    ? `Mark ${milestone.text} as not done`
    : `Mark ${milestone.text} as done`;
  return (
    <button
      type="button"
      className="grid size-8 shrink-0 place-items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onToggle}
      aria-pressed={milestone.done}
      aria-label={label}
      title={MILESTONE_STATUSES.find((option) => option.value === milestone.status)?.label}
    >
      <span
        className={cn(
          'grid size-4 place-items-center rounded-sm border',
          milestone.status === 'done' && 'border-success bg-success text-success-foreground',
          milestone.status === 'blocked' && 'border-destructive',
          milestone.status === 'in-progress' && 'border-primary',
          milestone.status === 'not-started' && 'border-border',
        )}
      >
        {milestone.status === 'done' && <Check className="size-3" strokeWidth={3} />}
        {milestone.status === 'blocked' && (
          <span className="size-1.5 rounded-sm bg-destructive" />
        )}
        {milestone.status === 'in-progress' && (
          <span className="size-1.5 rounded-sm bg-primary" />
        )}
      </span>
    </button>
  );
}

export interface MilestoneSectionProps {
  milestones: Milestone[];
  domain: Domain;
  projectTitle: string;
  today: Date;
  /** Applies a change to one milestone and persists the whole array. */
  onPatch: (milestoneId: string, mutate: (milestone: Milestone) => Milestone) => Promise<void>;
  /**
   * Rollup counts when the project has children. Absent for a leaf project,
   * where the header just counts the project's own milestones.
   */
  rollup?: { done: number; total: number; childCount: number };
  /** Monthly-close cards open expanded; they are worked as checklists. */
  defaultOpen?: boolean;
  /**
   * Milestones a finish-line pack line links to. A small marker, not a badge:
   * on a 50-milestone parent these are the handful that actually move the
   * deliverable, and this is the only thing in the app that says which. The
   * list order is untouched — the marker is enough.
   */
  linkedMilestoneIds?: ReadonlySet<string>;
  /**
   * How many matrix cells each milestone closes. Present means the edges were
   * loaded, so a milestone absent from the map genuinely closes NOTHING and
   * renders a plain 0 — the zero is the uncomfortable fact, and it is not hidden.
   */
  packCellCounts?: ReadonlyMap<string, number>;
}

/**
 * The milestone list — the ONE collapsible part of a project card.
 *
 * Everything else on the card (tiles, target, this-week strip, linked chips,
 * documents) is permanent dashboard and is rendered by the card itself, above
 * and below this. Collapsing this section must never move or hide any of it.
 */
export function MilestoneSection({
  milestones,
  domain,
  projectTitle,
  today,
  onPatch,
  rollup,
  defaultOpen = false,
  linkedMilestoneIds,
  packCellCounts,
}: MilestoneSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // One-way: a defaultOpen that TURNS TRUE after mount still opens the list.
  // Cross-view navigation sets its focus flag in an effect that runs after
  // the cards have already mounted, so the initial useState seed alone would
  // silently ignore it — the deep link would land in front of a closed list,
  // which is the exact failure it exists to fix. Closing stays manual.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  // Read rows by default; the editor mounts for ONE row at a time. A
  // 56-milestone project used to mount ~170 live form controls at once —
  // reading and editing shared one surface, which is the whole reason long
  // lists were unreadable. Per-row, not a list-wide toggle: a list-wide mode
  // changes the entire surface at once, which is a cost for re-entry.
  const [editingId, setEditingId] = useState<string | null>(null);
  // All / Open / Blocked. Defaults to All so nothing is hidden by surprise;
  // 'open' is "not done", 'blocked' is the three rows the reader came for.
  const [filter, setFilter] = useState<'all' | 'open' | 'blocked'>('all');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const done = milestones.filter((milestone) => milestone.done).length;
  const progress = milestones.length ? Math.round((100 * done) / milestones.length) : 0;

  const saveNote = async (milestone: Milestone) => {
    const draft = noteDrafts[milestone.id];
    if (draft === undefined) return;
    const note = draft.trim();
    if (note === (milestone.note ?? '')) return;
    await onPatch(milestone.id, (current) => ({ ...current, note: note || undefined }));
  };

  const setDocuments = (milestoneId: string, next: ProjectDocument[]) =>
    onPatch(milestoneId, (current) => ({
      ...current,
      documents: next.length > 0 ? next : undefined,
    }));

  return (
    <section aria-label={`Milestones for ${projectTitle}`} className="scroll-mt-24">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-foreground-muted transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="surface-label">Milestones</span>
        <span className="ml-auto text-xs tabular-nums text-foreground-muted">
          {done} of {milestones.length} complete
        </span>
        {/* success is the done colour; a project at 0% must not print in it. */}
        <span
          className={cn(
            'text-xs tabular-nums',
            progress === 100 ? 'text-success' : 'text-foreground-secondary',
          )}
        >
          {progress}%
        </span>
      </button>
      <Progress value={progress} className="mt-2" />
      {rollup && rollup.childCount > 0 && (
        <p className="mt-1.5 text-[11px] tabular-nums text-foreground-muted">
          {rollup.done} of {rollup.total} including {rollup.childCount} sub-project
          {rollup.childCount === 1 ? '' : 's'}
        </p>
      )}

      {open && (
        <div className="mt-3">
          {milestones.length > 3 && (
            // Segmented filter, defaulting to All so nothing is hidden on
            // load. The rows wanted in a 56-row list are usually "the three
            // that are blocked"; the status is already on every milestone.
            <div className="mb-2 flex items-center gap-1" role="group" aria-label="Filter milestones">
              {(
                [
                  ['all', 'All', milestones.length],
                  ['open', 'Open', milestones.filter((m) => !m.done).length],
                  ['blocked', 'Blocked', milestones.filter((m) => m.status === 'blocked').length],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={cn(
                    'min-h-8 rounded-sm border px-2.5 text-[11px] font-semibold tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    filter === value
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-foreground-muted hover:text-foreground-secondary',
                  )}
                >
                  {label} · {count}
                </button>
              ))}
            </div>
          )}

          <div className="divide-y divide-border-subtle">
            {milestones.length === 0 && (
              <p className="py-3 text-xs text-foreground-muted">
                No milestones yet — add them from the edit pencil.
              </p>
            )}
            {milestones
              .filter((milestone) => {
                if (filter === 'open') return !milestone.done;
                if (filter === 'blocked') return milestone.status === 'blocked';
                return true;
              })
              .map((milestone) => {
                const escalated = (milestone.escalateTo ?? 'none') !== 'none';
                const end = milestoneEnd(milestone);
                const documents = milestone.documents ?? [];
                const editing = editingId === milestone.id;
                return (
                  <div
                    key={milestone.id}
                    className={cn(
                      'space-y-2 border-l-2 py-2 pl-3',
                      milestone.status === 'blocked'
                        ? 'border-l-destructive/60'
                        : escalated
                          ? 'border-l-escalate/60'
                          : 'border-l-transparent',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <StatusToggle
                        milestone={milestone}
                        onToggle={() =>
                          void onPatch(milestone.id, (current) =>
                            withMilestoneDone(current, !current.done),
                          )
                        }
                      />
                      <span
                        className={cn(
                          'min-w-0 flex-1 text-sm text-foreground-secondary',
                          milestone.done && 'text-foreground-muted line-through',
                        )}
                      >
                        {milestone.text}
                      </span>
                      {packCellCounts && (
                        <span
                          className="shrink-0 text-[10px] tabular-nums text-foreground-muted"
                          title={`Closes ${packCellCounts.get(milestone.id) ?? 0} pack cell(s)`}
                        >
                          {packCellCounts.get(milestone.id) ?? 0}
                        </span>
                      )}
                      {linkedMilestoneIds?.has(milestone.id) && (
                        // The finish-line marker: this milestone moves the
                        // pack. Muted and small — it must not compete with the
                        // status colouring, and the list order stays exactly
                        // as it is.
                        <Flag
                          className="size-3.5 shrink-0 text-foreground-muted"
                          aria-label="Linked to the finish line pack"
                        />
                      )}
                      {escalated && (
                        <Megaphone className="size-4 shrink-0 text-escalate" aria-label="Escalated" />
                      )}
                      {milestone.pic && (
                        <span
                          className="shrink-0 rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted"
                          title={`PIC: ${milestone.pic}`}
                        >
                          {milestone.pic}
                        </span>
                      )}
                      {/* The row's one edit affordance. Reading and editing no
                          longer share a surface: the editor below mounts for
                          this row only, so a 56-row list is text until a row
                          is actually being worked. */}
                      <button
                        type="button"
                        onClick={() => setEditingId(editing ? null : milestone.id)}
                        aria-expanded={editing}
                        aria-label={
                          editing ? `Close editor for ${milestone.text}` : `Edit ${milestone.text}`
                        }
                        className="grid size-8 shrink-0 place-items-center rounded-sm text-foreground-muted hover:bg-surface-2 hover:text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {editing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
                      </button>
                    </div>

                    {/* Line 2 — dates, countdown, note and documents AS TEXT.
                        Each part is simply absent when its data is. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-8">
                      {(milestone.startDate || end) && (
                        <span className="text-[11px] tabular-nums text-foreground-muted">
                          {milestone.startDate
                            ? shortDate(milestone.startDate, milestone.dateConfidence)
                            : '—'}
                          {' → '}
                          {end ? shortDate(end, milestone.dateConfidence) : '—'}
                        </span>
                      )}
                      {end && !milestone.done && (
                        <>
                          <DaysLeftBadge
                            endDate={end}
                            confidence={milestone.dateConfidence}
                            today={today}
                          />
                          {resolveConfidence(milestone.dateConfidence) !== 'confirmed' && (
                            <TbcChip />
                          )}
                        </>
                      )}
                      {!editing && milestone.note && (
                        <span className="min-w-0 text-[11px] italic text-foreground-muted">
                          {milestone.note}
                        </span>
                      )}
                      {documents.length > 0 && (
                        <DocumentLinks
                          className="w-full min-w-0"
                          documents={documents}
                          ariaContext={milestone.text}
                          onRemove={
                            editing
                              ? (index) =>
                                  void setDocuments(milestone.id, removeDocumentAt(documents, index))
                              : undefined
                          }
                        />
                      )}
                    </div>

                    {/* The editor — mounted for the row being edited, nowhere
                        else. This is where the ~170 always-live form controls
                        of a 56-row card went. */}
                    {editing && (
                      <div className="space-y-2 pl-8">
                        <div
                          className={cn(
                            'grid gap-2',
                            domain === 'work'
                              ? 'sm:grid-cols-[minmax(120px,0.4fr)_minmax(0,1fr)_minmax(150px,0.5fr)]'
                              : 'sm:grid-cols-[minmax(120px,0.4fr)_minmax(0,1fr)]',
                          )}
                        >
                          <select
                            className="native-select text-xs"
                            value={milestone.status}
                            onChange={(event) =>
                              void onPatch(milestone.id, (current) =>
                                withMilestoneStatus(current, event.target.value as MilestoneStatus),
                              )
                            }
                            aria-label={`Status for ${milestone.text}`}
                          >
                            {MILESTONE_STATUSES.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <Input
                            className="h-11 text-sm"
                            value={noteDrafts[milestone.id] ?? milestone.note ?? ''}
                            onChange={(event) =>
                              setNoteDrafts((current) => ({
                                ...current,
                                [milestone.id]: event.target.value,
                              }))
                            }
                            onBlur={() => void saveNote(milestone)}
                            placeholder="What's left / blocker…"
                            aria-label={`Note for ${milestone.text}`}
                          />
                          {/* WORK only, and the only place an escalation target
                              can be set — Finish line routes here for that. */}
                          {domain === 'work' && (
                            <select
                              className={cn('native-select text-xs', escalated && 'text-escalate')}
                              value={milestone.escalateTo ?? 'none'}
                              onChange={(event) =>
                                void onPatch(milestone.id, (current) => ({
                                  ...current,
                                  escalateTo: event.target.value as EscalateTo,
                                }))
                              }
                              aria-label={`Escalation for ${milestone.text}`}
                            >
                              <option value="none">None</option>
                              {ESCALATION_TARGETS.map((target) => (
                                <option key={target.value} value={target.value}>
                                  {target.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <DocumentUpload
                          variant="inline"
                          ariaContext={milestone.text}
                          onAdd={(document) =>
                            setDocuments(milestone.id, appendDocument(documents, document))
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </section>
  );
}
