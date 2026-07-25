import { format, parseISO } from 'date-fns';
import { Check, ChevronRight, Megaphone } from 'lucide-react';
import { useState } from 'react';
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
}: MilestoneSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
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
    <section aria-label={`Milestones for ${projectTitle}`}>
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
        <span className="font-mono text-xs tabular-nums text-success">{progress}%</span>
      </button>
      <Progress value={progress} className="mt-2" />
      {rollup && rollup.childCount > 0 && (
        <p className="mt-1.5 text-[11px] tabular-nums text-foreground-muted">
          {rollup.done} of {rollup.total} including {rollup.childCount} sub-project
          {rollup.childCount === 1 ? '' : 's'}
        </p>
      )}

      {open && (
        <div className="mt-3 divide-y divide-border-subtle">
          {milestones.length === 0 && (
            <p className="py-3 text-xs text-foreground-muted">
              No milestones yet — add them from the edit pencil.
            </p>
          )}
          {milestones.map((milestone) => {
            const escalated = (milestone.escalateTo ?? 'none') !== 'none';
            const end = milestoneEnd(milestone);
            const documents = milestone.documents ?? [];
            return (
              <div
                key={milestone.id}
                className={cn(
                  'space-y-2 border-l-2 py-3 pl-3',
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
                </div>

                {/* Line 2 — dates, countdown, documents. Each part is simply
                    absent when its data is: a milestone with no dates shows no
                    range rather than a row of em dashes. */}
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
                  {documents.length > 0 ? (
                    <DocumentLinks
                      className="w-full min-w-0"
                      documents={documents}
                      ariaContext={milestone.text}
                      onRemove={(index) =>
                        void setDocuments(milestone.id, removeDocumentAt(documents, index))
                      }
                    />
                  ) : null}
                  <DocumentUpload
                    variant="inline"
                    ariaContext={milestone.text}
                    onAdd={(document) =>
                      setDocuments(milestone.id, appendDocument(documents, document))
                    }
                  />
                </div>

                <div
                  className={cn(
                    'grid gap-2 pl-8',
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
                  {/* WORK only, and the only place an escalation target can be
                      set — the Finish line view routes here for exactly that. */}
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
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
