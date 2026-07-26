import { ChevronDown, ChevronRight, Lock, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Input } from '../../../components/ui/Input';
import type {
  ClaimLayer,
  ResearchClaim,
  ResearchItem,
  ResearchItemStatus,
  ResearchItemType,
  ResearchProject,
  ResearchSettings,
} from '../../../data/types';
import {
  canTickGate,
  citeCount,
  critIND,
  curStage,
  cyclesOf,
  gatePass,
  loopDue,
  stageStatus,
  staleItems,
} from '../../../logic/research/pipeline';
import { LOOPS, LOOP_KEYS, type LoopKey } from '../../../logic/research/loops';
import { templateOf } from '../../../logic/research/templates';
import { cn } from '../../../lib/utils';

const ITEM_TYPES: ResearchItemType[] = [
  'parameter',
  'dataset',
  'dokumen',
  'paper',
  'wawancara',
  'baseline',
];
const ITEM_STATUSES: ResearchItemStatus[] = ['IND', 'V', 'NA'];
const LAYERS: Array<{ value: ClaimLayer; label: string }> = [
  { value: 'a', label: '(a) baseline in use' },
  { value: 'b', label: '(b) verified with source' },
  { value: 'c', label: '(c) hypothesis / inference' },
];

export interface RecordCycleInput {
  loop: LoopKey;
  verdict: 'clean' | 'rework';
  findings: string;
  /** Stage to invalidate from, only meaningful for a rework verdict. */
  from: number;
}

export interface ProjectTabProps {
  research: ResearchProject;
  settings: ResearchSettings;
  onToggleGate: (stage: number, criterion: number, next: boolean) => Promise<void>;
  onRecordCycle: (input: RecordCycleInput) => Promise<void>;
  onCreateItem: (input: Omit<ResearchItem, 'id'>) => Promise<void>;
  onUpdateItem: (id: string, patch: Partial<ResearchItem>) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onPromoteItem: (item: ResearchItem) => Promise<void>;
  onCreateClaim: (input: Omit<ResearchClaim, 'id'>) => Promise<void>;
  onDeleteClaim: (id: string) => Promise<void>;
  onAppendLog: (text: string) => Promise<void>;
  isPending: boolean;
}

function StageBadge({ state, text }: { state: string; text: string }) {
  const base =
    'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider';
  if (state === 'passed') {
    return <span className={cn(base, 'bg-success text-success-foreground')}>{text}</span>;
  }
  if (state === 'blocked') {
    return <span className={cn(base, 'bg-destructive text-destructive-foreground')}>{text}</span>;
  }
  if (state === 'locked') {
    return (
      <span className={cn(base, 'border border-border text-foreground-muted')}>
        <Lock className="mr-1 inline size-2.5" />
        {text}
      </span>
    );
  }
  return <span className={cn(base, 'border border-primary text-primary')}>{text}</span>;
}

export function ProjectTab({
  research,
  settings,
  onToggleGate,
  onRecordCycle,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onPromoteItem,
  onCreateClaim,
  onDeleteClaim,
  onAppendLog,
  isPending,
}: ProjectTabProps) {
  const template = templateOf(research.meta.template);
  const current = curStage(research);
  const [openStage, setOpenStage] = useState<number | null>(current);
  const [itemFilter, setItemFilter] = useState<'all' | ResearchItemStatus>('all');
  const [newItemName, setNewItemName] = useState('');
  const [claimText, setClaimText] = useState('');
  const [claimLayer, setClaimLayer] = useState<ClaimLayer>('c');
  const [logText, setLogText] = useState('');
  const [cycleDraft, setCycleDraft] = useState<Record<string, { verdict: 'clean' | 'rework'; findings: string; from: number }>>({});

  const blockers = critIND(research);
  const stale = useMemo(() => staleItems(research, settings), [research, settings]);
  const visibleItems = research.items.filter(
    (item) => itemFilter === 'all' || item.status === itemFilter,
  );

  const addItem = async () => {
    const name = newItemName.trim();
    if (!name) return;
    setNewItemName('');
    await onCreateItem({
      projectId: research.project.id,
      name,
      unit: '',
      type: 'parameter',
      crit: false,
      status: 'IND',
      value: '',
      source: '',
      asof: '',
      note: '',
      order: research.items.length + 1,
    });
  };

  const addClaim = async () => {
    const text = claimText.trim();
    if (!text) return;
    setClaimText('');
    await onCreateClaim({
      projectId: research.project.id,
      text,
      layer: claimLayer,
      ev: '',
      order: research.claims.length + 1,
    });
  };

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* Pipeline                                                          */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardContent className="pt-5">
          <h2 className="font-display text-card-heading font-semibold text-foreground">Pipeline</h2>
          <p className="mb-4 mt-1 text-xs text-foreground-muted">
            {template.name} · a stage stays locked until the stage above it passes in full. That is
            deliberate and is the one place in this app where something genuinely blocks.
          </p>

          <ul className="divide-y divide-border-subtle">
            {template.stages.map((stage, index) => {
              const status = stageStatus(research, index);
              const gate = research.meta.gates[index] ?? [];
              const tickable = canTickGate(research, index);
              const isOpen = openStage === index;

              return (
                <li key={stage.n}>
                  <button
                    type="button"
                    onClick={() => setOpenStage(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    className="flex min-h-11 w-full items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isOpen ? (
                      <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-foreground-muted" />
                    )}
                    <span className="shrink-0 font-mono text-xs tabular-nums text-foreground-muted">
                      {stage.n}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                      {stage.t}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground-muted">
                      {gate.filter(Boolean).length}/{gate.length}
                    </span>
                    <StageBadge state={status.state} text={status.txt} />
                  </button>

                  {isOpen && (
                    <div className="space-y-3 pb-4 pl-7">
                      <dl className="grid gap-1 text-xs sm:grid-cols-[4rem_minmax(0,1fr)]">
                        <dt className="surface-label">Tag</dt>
                        <dd className="text-foreground-secondary">{stage.tag}</dd>
                        <dt className="surface-label">In</dt>
                        <dd className="text-foreground-secondary">{stage.i}</dd>
                        <dt className="surface-label">Process</dt>
                        <dd className="text-foreground-secondary">{stage.p}</dd>
                        <dt className="surface-label">Out</dt>
                        <dd className="text-foreground-secondary">{stage.o}</dd>
                      </dl>

                      {stage.w && (
                        <p className="border-l-2 border-escalate bg-escalate/10 px-3 py-2 text-xs text-foreground-secondary">
                          {stage.w}
                        </p>
                      )}

                      {!tickable && (
                        <p className="text-xs text-foreground-muted">
                          {index === 0
                            ? `Cannot be ticked: ${blockers.length} critical register item${blockers.length === 1 ? '' : 's'} still IND.`
                            : `Locked until stage ${template.stages[index - 1].n} passes in full.`}
                        </p>
                      )}

                      <ul className="space-y-1.5">
                        {stage.g.map((criterion, criterionIndex) => (
                          <li key={criterionIndex}>
                            <label
                              className={cn(
                                'flex items-start gap-2.5 text-xs',
                                !tickable && 'opacity-55',
                              )}
                            >
                              <Checkbox
                                checked={Boolean(gate[criterionIndex])}
                                disabled={!tickable || isPending}
                                onCheckedChange={(next) =>
                                  void onToggleGate(index, criterionIndex, Boolean(next))
                                }
                              />
                              <span className="text-foreground-secondary">{criterion}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Review loops                                                      */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid gap-4 xl:grid-cols-3">
        {LOOP_KEYS.map((loop) => {
          const meta = LOOPS[loop];
          const due = loopDue(research, loop, settings);
          const history = cyclesOf(research, loop);
          const draft = cycleDraft[loop] ?? { verdict: 'clean' as const, findings: '', from: 0 };

          return (
            <Card key={loop} className={cn(due.due && 'border-escalate')}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-foreground">
                    {meta.name}
                  </h3>
                  <span
                    className={cn(
                      'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                      due.due
                        ? 'bg-escalate text-escalate-foreground'
                        : 'border border-border text-foreground-muted',
                    )}
                  >
                    {due.due ? 'Due' : 'Clean'}
                  </span>
                </div>

                <p className="text-xs text-foreground-muted">{due.why}</p>
                <p className="text-xs leading-5 text-foreground-secondary">{meta.why}</p>
                <p className="text-xs leading-5 text-foreground-muted">{meta.trig}</p>

                {loop === 'data' && stale.length > 0 && (
                  <p className="border-l-2 border-escalate px-2 py-1 text-xs text-foreground-secondary">
                    {stale.length} verified item{stale.length === 1 ? '' : 's'} past{' '}
                    {settings.staleMonths} months: {stale.map((item) => item.name).join(', ')}
                  </p>
                )}

                <details className="text-xs">
                  <summary className="cursor-pointer text-foreground-secondary">
                    Cycle checklist ({meta.check.length})
                  </summary>
                  <ul className="mt-2 space-y-1.5 pl-1">
                    {meta.check.map((check, index) => (
                      <li key={index} className="text-foreground-muted">
                        · {check}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-foreground-muted">{meta.ref}</p>
                </details>

                <div className="space-y-2 border-t border-border-subtle pt-3">
                  <span className="surface-label">Record a cycle</span>
                  <select
                    className="native-select text-xs"
                    value={draft.verdict}
                    onChange={(event) =>
                      setCycleDraft((current) => ({
                        ...current,
                        [loop]: {
                          ...draft,
                          verdict: event.target.value as 'clean' | 'rework',
                        },
                      }))
                    }
                    aria-label={`Verdict for ${meta.name}`}
                  >
                    <option value="clean">Clean</option>
                    <option value="rework">Rework</option>
                  </select>

                  {draft.verdict === 'rework' && (
                    <label className="block">
                      <span className="surface-label">Invalidate from stage</span>
                      <select
                        className="native-select mt-1 text-xs"
                        value={draft.from}
                        onChange={(event) =>
                          setCycleDraft((current) => ({
                            ...current,
                            [loop]: { ...draft, from: Number(event.target.value) },
                          }))
                        }
                      >
                        {template.stages.map((stage, index) => (
                          <option key={stage.n} value={index}>
                            {stage.n} {stage.t}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <Input
                    value={draft.findings}
                    onChange={(event) =>
                      setCycleDraft((current) => ({
                        ...current,
                        [loop]: { ...draft, findings: event.target.value },
                      }))
                    }
                    placeholder="Findings…"
                    aria-label={`Findings for ${meta.name}`}
                    className="text-xs"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isPending}
                    onClick={() =>
                      void onRecordCycle({
                        loop,
                        verdict: draft.verdict,
                        findings: draft.findings.trim(),
                        from: draft.from,
                      }).then(() =>
                        setCycleDraft((current) => ({
                          ...current,
                          [loop]: { verdict: 'clean', findings: '', from: 0 },
                        })),
                      )
                    }
                  >
                    Record {draft.verdict}
                  </Button>
                </div>

                {history.length > 0 && (
                  <ul className="space-y-1 border-t border-border-subtle pt-3 text-xs">
                    {history
                      .slice()
                      .reverse()
                      .map((cycle) => (
                        <li key={cycle.id} className="text-foreground-muted">
                          <span className="font-mono tabular-nums">#{cycle.n}</span> {cycle.date} ·{' '}
                          <span
                            className={
                              cycle.verdict === 'rework' ? 'text-destructive' : 'text-success'
                            }
                          >
                            {cycle.verdict}
                          </span>
                          {cycle.invalidated > 0 && ` · ${cycle.invalidated} gates cleared`}
                          {cycle.findings && ` — ${cycle.findings}`}
                        </li>
                      ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Evidence register                                                 */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardContent className="pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-card-heading font-semibold text-foreground">
                Evidence register
              </h2>
              <p className="mt-1 text-xs text-foreground-muted">
                {research.items.length} items · {citeCount(research)} carry a source ·{' '}
                {blockers.length} critical still IND. Only a direct edit here can set V.
              </p>
            </div>
            <select
              className="native-select w-auto text-xs"
              value={itemFilter}
              onChange={(event) =>
                setItemFilter(event.target.value as 'all' | ResearchItemStatus)
              }
              aria-label="Filter register by status"
            >
              <option value="all">All statuses</option>
              {ITEM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          {visibleItems.length === 0 ? (
            <p className="text-xs text-foreground-muted">Nothing in the register yet.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {visibleItems.map((item) => (
                <li
                  key={item.id}
                  className={cn('py-3', item.crit && item.status === 'IND' && 'bg-destructive/[0.04]')}
                >
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8.5rem_6rem_auto]">
                    <Input
                      value={item.name}
                      onChange={(event) => void onUpdateItem(item.id, { name: event.target.value })}
                      aria-label={`Name of ${item.name}`}
                      className="h-9 text-sm"
                    />
                    <Input
                      value={item.value}
                      onChange={(event) => void onUpdateItem(item.id, { value: event.target.value })}
                      placeholder="Value"
                      aria-label={`Value of ${item.name}`}
                      className="h-9 text-sm"
                    />
                    <select
                      className="native-select h-9 text-xs"
                      value={item.type}
                      onChange={(event) =>
                        void onUpdateItem(item.id, {
                          type: event.target.value as ResearchItemType,
                        })
                      }
                      aria-label={`Type of ${item.name}`}
                    >
                      {ITEM_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <select
                      className="native-select h-9 text-xs"
                      value={item.status}
                      onChange={(event) =>
                        void onUpdateItem(item.id, {
                          status: event.target.value as ResearchItemStatus,
                        })
                      }
                      aria-label={`Status of ${item.name}`}
                    >
                      {ITEM_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <span className="flex items-center gap-1.5">
                      <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                        <Checkbox
                          checked={item.crit}
                          onCheckedChange={(next) =>
                            void onUpdateItem(item.id, { crit: Boolean(next) })
                          }
                        />
                        Crit
                      </label>
                      <Button
                        size="icon"
                        variant="secondary"
                        disabled={item.status !== 'V' || isPending}
                        onClick={() => void onPromoteItem(item)}
                        aria-label={`Promote ${item.name} to the library`}
                        title={
                          item.status === 'V'
                            ? 'Promote to the cross-project library'
                            : 'Only verified items can be promoted'
                        }
                      >
                        <Upload className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="danger"
                        onClick={() => void onDeleteItem(item.id)}
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1.2fr)]">
                    <Input
                      value={item.source}
                      onChange={(event) =>
                        void onUpdateItem(item.id, { source: event.target.value })
                      }
                      placeholder="Source"
                      aria-label={`Source of ${item.name}`}
                      className="h-9 text-xs"
                    />
                    <Input
                      value={item.asof}
                      onChange={(event) => void onUpdateItem(item.id, { asof: event.target.value })}
                      placeholder="As of (2024, Q3 2025)"
                      aria-label={`As of for ${item.name}`}
                      className="h-9 text-xs"
                    />
                    <Input
                      value={item.note}
                      onChange={(event) => void onUpdateItem(item.id, { note: event.target.value })}
                      placeholder="Note"
                      aria-label={`Note on ${item.name}`}
                      className="h-9 text-xs"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
            <Input
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addItem();
                }
              }}
              placeholder="New register item…"
              aria-label="New register item"
              className="min-w-[14rem] flex-1"
            />
            <Button variant="secondary" onClick={() => void addItem()} disabled={isPending}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Claims ledger                                                     */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardContent className="pt-5">
          <h2 className="mb-3 font-display text-card-heading font-semibold text-foreground">
            Claims
          </h2>
          {research.claims.length === 0 ? (
            <p className="text-xs text-foreground-muted">No claims recorded.</p>
          ) : (
            <ul className="space-y-2">
              {research.claims.map((claim) => (
                <li
                  key={claim.id}
                  className={cn(
                    'flex items-start gap-3 border-l-2 py-1.5 pl-3',
                    claim.layer === 'a' && 'border-success',
                    claim.layer === 'b' && 'border-primary',
                    claim.layer === 'c' && 'border-escalate',
                  )}
                >
                  <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-foreground-muted">
                    {claim.layer}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-foreground-secondary">
                    {claim.text}
                    {claim.ev && (
                      <span className="mt-0.5 block text-xs text-foreground-muted">{claim.ev}</span>
                    )}
                  </span>
                  <Button
                    size="icon"
                    variant="danger"
                    onClick={() => void onDeleteClaim(claim.id)}
                    aria-label="Delete claim"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
            <Input
              value={claimText}
              onChange={(event) => setClaimText(event.target.value)}
              placeholder="New claim…"
              aria-label="New claim"
              className="min-w-[14rem] flex-1"
            />
            <select
              className="native-select w-auto text-xs"
              value={claimLayer}
              onChange={(event) => setClaimLayer(event.target.value as ClaimLayer)}
              aria-label="Claim layer"
            >
              {LAYERS.map((layer) => (
                <option key={layer.value} value={layer.value}>
                  {layer.label}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => void addClaim()} disabled={isPending}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Decision log — append-only, newest first                          */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardContent className="pt-5">
          <h2 className="font-display text-card-heading font-semibold text-foreground">
            Decision log
          </h2>
          <p className="mb-3 mt-1 text-xs text-foreground-muted">
            Append-only. There is no edit and no delete, here or in the repository — a decision log
            stops being evidence the moment it can be rewritten.
          </p>

          <div className="flex flex-wrap gap-2">
            <Input
              value={logText}
              onChange={(event) => setLogText(event.target.value)}
              placeholder="What was decided, and why…"
              aria-label="New decision log entry"
              className="min-w-[14rem] flex-1"
            />
            <Button
              variant="secondary"
              disabled={isPending || !logText.trim()}
              onClick={() =>
                void onAppendLog(logText.trim()).then(() => setLogText(''))
              }
            >
              Append
            </Button>
          </div>

          {research.log.length > 0 && (
            <ul className="mt-4 divide-y divide-border-subtle">
              {research.log
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
                .map((entry) => (
                  <li key={entry.id} className="flex gap-3 py-2 text-sm">
                    <span className="shrink-0 font-mono text-xs tabular-nums text-foreground-muted">
                      {entry.date}
                    </span>
                    <span className="text-foreground-secondary">{entry.text}</span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-foreground-muted">
        Gate coverage: {template.stages.filter((_, index) => gatePass(research, index)).length} of{' '}
        {template.stages.length} stages passed.
      </p>
    </div>
  );
}
