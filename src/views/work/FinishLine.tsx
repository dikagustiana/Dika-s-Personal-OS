import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Flag,
  Megaphone,
  OctagonAlert,
  Pencil,
  Plus,
  ShieldCheck,
  TriangleAlert,
  Unlink,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { Progress } from '../../components/ui/Progress';
import type {
  FinishLineItem,
  FinishLineLinkInput,
  FinishLineStatus,
  Project,
} from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import { cn } from '../../lib/utils';
import {
  ancestorPath,
  buildPack,
  summarizePack,
  type PackLine,
  type PackNode,
  type ResolvedLink,
} from '../../logic/finishLine';
import { useAppStore } from '../../store/appStore';

/**
 * THE PACK, RENDERED — not a register describing it.
 *
 * One consolidated group pack: five business blocks running NET SALES →
 * GROSS PROFIT → OPERATING PROFIT → NIBT → NPAT, volume & capacity inputs, a
 * balance sheet, ratios. This view renders that document with every value
 * replaced by `xxx` and every untrusted line clickable: click it and it says
 * what is missing, what would fix it, and which work closes it.
 *
 * The mental model is GateMap: rows, one state per cell, refusing to become a
 * progress bar. THE NUMBERS NEVER ENTER THE APP — the workbook holds the
 * figures; this holds the structure and whether each line can be trusted yet.
 * `xxx` is the deliberate marker that this is a coverage map, not a report.
 * There is no importer, no paste path, no value field, anywhere.
 *
 * The structure itself is seeded from the workbook by a session with database
 * access (§4 of the brief) — this view renders and annotates it, and never
 * invents a line.
 */

const STATUS_CHIP: Record<FinishLineStatus, { label: string; className: string }> = {
  // The app's existing three-colour vocabulary, unchanged. No new colours.
  blocked: { label: 'Blocked', className: 'border-destructive/50 text-destructive' },
  'in-progress': { label: 'In progress', className: 'border-escalate/50 text-escalate' },
  trusted: { label: 'Trusted', className: 'border-success/50 text-success' },
};

const STATUSES: FinishLineStatus[] = ['blocked', 'in-progress', 'trusted'];

const CHIP =
  'shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]';

/**
 * Subtotal weight comes from the workbook's own labels: NET SALES, GROSS
 * PROFIT, NIBT are written in caps there, and those are the lines that get
 * quoted. Deriving weight from the label keeps "the weight the workbook gives
 * them" literal — no second field to maintain, nothing to drift.
 */
function isSubtotalLabel(label: string): boolean {
  return /[A-Z]/.test(label) && label === label.toUpperCase();
}

export function FinishLine() {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setProjectFocus = useAppStore((state) => state.setProjectFocus);
  const finishLineFocus = useAppStore((state) => state.finishLineFocus);
  const setFinishLineFocus = useAppStore((state) => state.setFinishLineFocus);

  const [items, setItems] = useState<FinishLineItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Block collapse. Keyed by item id; absent falls back to defaultOpen. */
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({});
  /** Untrusted lines whose annotation panel is open. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

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
      // A read failure must not render as an empty pack — "no structure" and
      // "could not read the structure" are different statements, and the
      // second one must not masquerade as the first.
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoaded(true);
    }
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const pack = useMemo(() => buildPack(items, projects), [items, projects]);
  const summary = useMemo(() => summarizePack(pack), [pack]);

  // The cross-view handoff: a project card's "Makes trustworthy" row lands
  // here. Same clear→expand→scroll shape Projects.tsx uses — expand the
  // ancestor blocks, open the line's panel, then scroll once it is in the DOM.
  useEffect(() => {
    if (!finishLineFocus || items.length === 0) return;
    const target = items.find((item) => item.id === finishLineFocus.itemId);
    if (!target) return;
    const path = ancestorPath(items, target.id);
    setOpenBlocks((current) => {
      const next = { ...current };
      for (const id of path) next[id] = true;
      return next;
    });
    if (target.status !== 'trusted') {
      setExpanded((current) => new Set(current).add(target.id));
    }
    setScrollTarget(target.id);
    setFinishLineFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishLineFocus, items]);

  useEffect(() => {
    if (!scrollTarget) return;
    document
      .getElementById(`finish-line-${scrollTarget}`)
      // 'auto', never 'smooth': an explicit behavior overrides CSS
      // scroll-behavior, which is where the reduced-motion block lives.
      ?.scrollIntoView({ behavior: 'auto', block: 'start' });
    setScrollTarget(null);
  }, [scrollTarget]);

  const toggleLine = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openProject = (projectId: string) => {
    setProjectFocus({ projectId, openMilestones: true });
    setWorkView('projects');
  };

  const onSaved = async () => {
    setEditingId(null);
    await load();
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">Work / Finish line</p>
        <h1 className="page-title">The pack, line by line</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
          The consolidated deliverable as a document: every value is <code>xxx</code> because the
          figures live in the workbook — this map holds whether each line can be trusted yet, and
          which work closes the ones that cannot.
        </p>
      </header>

      <div className="mb-5 grid gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-5">
        <div className="bg-card p-5">
          <ShieldCheck className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4 tabular-nums">
            {summary.trusted}
            <span className="text-foreground-muted">/{summary.totalLines}</span>
          </p>
          {/* Trusted lines over total lines — the only progress number this
              view can honestly offer. */}
          <p className="surface-label mt-1.5">Of the pack trustworthy</p>
        </div>
        <div className="bg-card p-5">
          <Flag className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4">{summary.needsWork}</p>
          <p className="surface-label mt-1.5">Lines need work · {summary.blocked} blocked</p>
        </div>
        <div className="bg-card p-5">
          <OctagonAlert className="size-4 text-foreground-muted" />
          <p className="metric-hero mt-4">{summary.unowned}</p>
          <p className="surface-label mt-1.5">With no project</p>
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

      {loadError && (
        <Card className="mb-5 border-destructive">
          <CardContent className="pt-5">
            <EmptyRow
              label="Pack structure"
              clause={`Could not be read — ${loadError}`}
              action="Retry"
              onAction={() => void load()}
            />
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {pack.map((block) => (
          <BlockCard
            key={block.item.id}
            block={block}
            open={openBlocks[block.item.id] ?? block.defaultOpen}
            onToggle={() =>
              setOpenBlocks((current) => ({
                ...current,
                [block.item.id]: !(current[block.item.id] ?? block.defaultOpen),
              }))
            }
            expanded={expanded}
            onToggleLine={toggleLine}
            editingId={editingId}
            onEdit={setEditingId}
            onSaved={onSaved}
            projects={projects}
            onOpenProject={openProject}
          />
        ))}

        {loaded && !loadError && pack.length === 0 && (
          <Card>
            <CardContent className="pt-5">
              {/* No structure is the state until the skeleton is loaded from
                  the workbook by a session with database access — a fact, not
                  a call to action, so there is no button here. */}
              <EmptyRow
                label="Pack structure"
                clause="Nothing loaded yet — the skeleton comes from the workbook"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One block — a collapsible card holding sections and lines
// ---------------------------------------------------------------------------

interface BlockCardProps {
  block: PackNode;
  open: boolean;
  onToggle: () => void;
  expanded: ReadonlySet<string>;
  onToggleLine: (id: string) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onSaved: () => void;
  projects: Project[];
  onOpenProject: (projectId: string) => void;
}

function BlockCard({
  block,
  open,
  onToggle,
  expanded,
  onToggleLine,
  editingId,
  onEdit,
  onSaved,
  projects,
  onOpenProject,
}: BlockCardProps) {
  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
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
            {block.item.item}
          </span>
        </span>
        {block.needsWork > 0 ? (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-escalate">
            ● {block.needsWork} {block.needsWork === 1 ? 'line needs' : 'lines need'} work
          </span>
        ) : (
          block.totalLines > 0 && (
            <Check aria-label="All lines trusted" className="size-4 shrink-0 text-success" />
          )
        )}
      </button>

      {open && (
        <CardContent className="pt-0">
          <div className="border-t border-border-subtle pt-2">
            {block.children.map((child) => (
              <PackRows
                key={child.item.id}
                node={child}
                depth={0}
                expanded={expanded}
                onToggleLine={onToggleLine}
                editingId={editingId}
                onEdit={onEdit}
                onSaved={onSaved}
                projects={projects}
                onOpenProject={onOpenProject}
              />
            ))}
            {block.children.length === 0 && (
              <EmptyRow label={block.item.item} clause="No lines under this block yet" />
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recursive rows — sections as subheads, lines as document rows
// ---------------------------------------------------------------------------

interface PackRowsProps {
  node: PackNode;
  depth: number;
  expanded: ReadonlySet<string>;
  onToggleLine: (id: string) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onSaved: () => void;
  projects: Project[];
  onOpenProject: (projectId: string) => void;
}

function PackRows(props: PackRowsProps) {
  const { node, depth } = props;

  if (node.item.kind !== 'line') {
    // A section (or a nested block) is a subhead, not a row: no value cell,
    // no state marker — its state is its lines'.
    return (
      <div className="mt-2">
        <p
          className="surface-label truncate py-1.5"
          style={{ paddingLeft: depth > 0 ? depth * 16 : undefined }}
        >
          {node.item.item}
        </p>
        {node.children.map((child) => (
          <PackRows key={child.item.id} {...props} node={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <>
      <LineRow {...props} />
      {node.children.map((child) => (
        <PackRows key={child.item.id} {...props} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

function LineRow({
  node,
  depth,
  expanded,
  onToggleLine,
  editingId,
  onEdit,
  onSaved,
  projects,
  onOpenProject,
}: PackRowsProps) {
  const { item } = node;
  const line = node.line as PackLine;
  const trusted = item.status === 'trusted';
  const isOpen = expanded.has(item.id);
  const subtotal = isSubtotalLabel(item.item);

  const label = (
    <span
      className={cn(
        'min-w-0 flex-1 truncate text-sm',
        subtotal ? 'font-semibold text-foreground' : 'text-foreground-secondary',
      )}
    >
      {item.item}
    </span>
  );

  // The value column is ALWAYS the literal xxx — scaffolding, not data. It is
  // muted so it cannot read as a number; the figures live in the workbook.
  const value = (
    <span className="w-10 shrink-0 text-right font-sans text-sm tabular-nums text-foreground-muted">
      xxx
    </span>
  );

  const rowPadding = { paddingLeft: depth > 0 ? depth * 16 : undefined };

  if (trusted) {
    // NOT A BUTTON, ON PURPOSE — no click target, no hover, no chrome. Most
    // lines are trusted; if each carried an affordance, the ones that matter
    // would stop standing out. This is the density decision of the view.
    return (
      <div
        id={`finish-line-${item.id}`}
        className="flex min-h-8 items-center gap-3 py-1 scroll-mt-24"
        style={rowPadding}
      >
        {label}
        {value}
        <Check aria-label="Trusted" className="size-3.5 shrink-0 text-success" />
      </div>
    );
  }

  const marker =
    item.status === 'blocked' ? (
      <OctagonAlert aria-label="Blocked" className="size-3.5 shrink-0 text-destructive" />
    ) : (
      <TriangleAlert aria-label="In progress" className="size-3.5 shrink-0 text-escalate" />
    );

  return (
    <div id={`finish-line-${item.id}`} className="scroll-mt-24">
      <button
        type="button"
        onClick={() => onToggleLine(item.id)}
        aria-expanded={isOpen}
        className="flex min-h-11 w-full items-center gap-3 rounded-sm py-1 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={rowPadding}
      >
        {label}
        {value}
        {marker}
      </button>
      {isOpen && (
        <LinePanel
          line={line}
          editing={editingId === item.id}
          onEdit={() => onEdit(item.id)}
          onCancelEdit={() => onEdit(null)}
          onSaved={onSaved}
          projects={projects}
          onOpenProject={onOpenProject}
          depth={depth}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The annotation panel — the register, relocated behind the line
// ---------------------------------------------------------------------------

interface LinePanelProps {
  line: PackLine;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  projects: Project[];
  onOpenProject: (projectId: string) => void;
  depth: number;
}

function LinePanel({
  line,
  editing,
  onEdit,
  onCancelEdit,
  onSaved,
  projects,
  onOpenProject,
  depth,
}: LinePanelProps) {
  const { item } = line;

  if (editing) {
    return (
      <div
        className="mb-2 rounded-sm border border-border bg-surface-2 p-4"
        style={{ marginLeft: depth > 0 ? depth * 16 : undefined }}
      >
        <LineEditor line={line} projects={projects} onSaved={onSaved} onCancel={onCancelEdit} />
      </div>
    );
  }

  return (
    <div
      className="mb-2 rounded-sm border border-border-subtle bg-surface-2 p-4"
      style={{ marginLeft: depth > 0 ? depth * 16 : undefined }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <p className="surface-label">What is missing</p>
          <p className="mt-1.5 text-sm leading-6 text-foreground-secondary">
            {item.currentState ?? <span className="text-foreground-muted">Not recorded</span>}
          </p>

          <p className="surface-label mt-4">What it would take</p>
          <p className="mt-1.5 text-sm leading-6 text-foreground-secondary">
            {item.targetState ?? <span className="text-foreground-muted">Not recorded</span>}
          </p>

          {item.interim && (
            // A proxy is NOT a value, and rendering it like one is the exact
            // failure this field exists to prevent: a figure resting on a
            // driver known to be wrong gets quoted back in a board meeting.
            <div className="mt-4 rounded-sm border border-escalate/50 bg-card p-2.5">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-escalate">
                <TriangleAlert className="size-3.5" />
                Standing in meanwhile
              </p>
              <p className="mt-1 text-sm leading-6 text-foreground-secondary">{item.interim}</p>
            </div>
          )}

          {item.blocks && (
            <p className="mt-4 text-xs leading-5 text-foreground-muted">
              <span
                className={cn(
                  'font-semibold uppercase tracking-[0.08em]',
                  line.provisional && 'text-escalate',
                )}
              >
                {line.provisional ? 'Provisional downstream' : 'Holds up'}
              </span>{' '}
              {item.blocks}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className="surface-label">Closes via</p>
          {line.links.length === 0 ? (
            // A known-broken line nobody owns is the most expensive state in
            // the view; it does not get to whisper.
            <p className="mt-1.5 text-sm font-semibold text-destructive">
              Nothing assigned — no work closes this.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {line.links.map((resolved) => (
                <LinkRow key={resolved.link.id} resolved={resolved} onOpenProject={onOpenProject} />
              ))}
            </ul>
          )}

          {line.silentBlockers > 0 && (
            // The silent-blocker flag, survived from the register: this line
            // is stuck AND nobody outside has been told.
            <p className="mt-3 flex items-start gap-1.5 text-xs font-semibold text-escalate">
              <Megaphone className="mt-0.5 size-3.5 shrink-0" />
              {line.silentBlockers === 1
                ? 'Stuck on 1 blocked milestone, escalated to no one'
                : `Stuck on ${line.silentBlockers} blocked milestones, escalated to no one`}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={cn(CHIP, STATUS_CHIP[item.status].className)}>
          {STATUS_CHIP[item.status].label}
        </span>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" />
          Edit
        </Button>
      </div>
    </div>
  );
}

function LinkRow({
  resolved,
  onOpenProject,
}: {
  resolved: ResolvedLink;
  onOpenProject: (projectId: string) => void;
}) {
  const { project, milestone, broken } = resolved;

  if (broken) {
    // THE BROKEN LINK, NAMED AND VISIBLE. The milestone this line pointed at
    // no longer exists on the project — without this row the line would look
    // owned while nothing closes it, or the link would vanish and the line
    // would look unowned while someone believes it is covered.
    return (
      <li>
        <button
          type="button"
          onClick={() => onOpenProject(project.id)}
          className="flex min-h-11 w-full items-center gap-2 rounded-sm border border-destructive/50 bg-destructive/5 px-2 text-left transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Unlink className="size-3.5 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-destructive">
              Broken link — milestone no longer on {project.title}
            </span>
            <span className="block text-[11px] text-foreground-muted">
              It was deleted or rewritten. Re-link this line or clear the entry.
            </span>
          </span>
          <ArrowRight className="size-3.5 shrink-0 text-foreground-muted" />
        </button>
      </li>
    );
  }

  if (milestone) {
    const chip = STATUS_CHIP[milestone.status === 'blocked' ? 'blocked' : 'in-progress'];
    return (
      <li>
        <button
          type="button"
          onClick={() => onOpenProject(project.id)}
          className="flex min-h-11 w-full items-center gap-2 rounded-sm px-1 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-foreground-secondary">
              {milestone.text}
            </span>
            <span className="block truncate text-[11px] text-foreground-muted">
              {project.title}
            </span>
          </span>
          {milestone.done ? (
            <Check aria-label="Done" className="size-3.5 shrink-0 text-success" />
          ) : (
            <span className={cn(CHIP, chip.className)}>
              {milestone.status === 'blocked' ? 'Blocked' : 'Open'}
            </span>
          )}
          <ArrowRight className="size-3.5 shrink-0 text-foreground-muted" />
        </button>
      </li>
    );
  }

  const total = project.milestones.length;
  const done = project.milestones.filter((candidate) => candidate.done).length;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenProject(project.id)}
        className="flex min-h-11 w-full items-center gap-2 rounded-sm px-1 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground-secondary">{project.title}</span>
          <Progress value={total > 0 ? (100 * done) / total : 0} className="mt-1.5 h-1" />
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">
          {done}/{total}
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-foreground-muted" />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The annotation editor — status, gap fields, and links at milestone precision
// ---------------------------------------------------------------------------

const FIELD =
  'mt-2 w-full rounded-sm border border-border bg-card p-3 text-base text-foreground outline-none placeholder:text-foreground-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:text-sm';

interface LineEditorProps {
  line: PackLine;
  projects: Project[];
  onSaved: () => void;
  onCancel: () => void;
}

function LineEditor({ line, projects, onSaved, onCancel }: LineEditorProps) {
  const repository = useAppStore((state) => state.repository);
  const { run, isPending } = useMutation();
  const { item } = line;

  const [status, setStatus] = useState<FinishLineStatus>(item.status);
  const [targetState, setTargetState] = useState(item.targetState ?? '');
  const [currentState, setCurrentState] = useState(item.currentState ?? '');
  const [interim, setInterim] = useState(item.interim ?? '');
  const [blocks, setBlocks] = useState(item.blocks ?? '');
  // Broken links load as-is: saving without touching them keeps them, so a
  // save made to fix a typo cannot silently discard the evidence of a gap
  // that looks owned. Removing one is an explicit click.
  const [links, setLinks] = useState<FinishLineLinkInput[]>(
    item.links.map((link) =>
      link.milestoneId
        ? { projectId: link.projectId, milestoneId: link.milestoneId }
        : { projectId: link.projectId },
    ),
  );
  const [addProject, setAddProject] = useState('');
  const [addMilestone, setAddMilestone] = useState('');

  const sorted = useMemo(
    () => [...projects].sort((a, b) => a.title.localeCompare(b.title)),
    [projects],
  );
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const addable = addProject ? byId.get(addProject) : undefined;

  const optional = (value: string) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const addLink = () => {
    if (!addProject) return;
    const next: FinishLineLinkInput = addMilestone
      ? { projectId: addProject, milestoneId: addMilestone }
      : { projectId: addProject };
    const key = `${next.projectId}:${next.milestoneId ?? ''}`;
    if (links.some((link) => `${link.projectId}:${link.milestoneId ?? ''}` === key)) return;
    setLinks((current) => [...current, next]);
    setAddMilestone('');
  };

  const save = async () => {
    const saved = await run('Save pack line', () =>
      repository.updateFinishLineItem(item.id, {
        status,
        targetState: optional(targetState),
        currentState: optional(currentState),
        interim: optional(interim),
        blocks: optional(blocks),
        links,
      }),
    );
    if (!saved) return;
    onSaved();
  };

  const describeLink = (link: FinishLineLinkInput): { title: string; sub?: string; broken: boolean } => {
    const project = byId.get(link.projectId);
    if (!project) return { title: 'Unknown project', broken: true };
    if (!link.milestoneId) return { title: project.title, broken: false };
    const milestone = project.milestones.find((candidate) => candidate.id === link.milestoneId);
    if (!milestone)
      return { title: `Broken link — milestone no longer on ${project.title}`, broken: true };
    return { title: milestone.text, sub: project.title, broken: false };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">{item.item}</p>
        <label className="block">
          <span className="sr-only">Line status</span>
          <select
            className="native-select text-xs"
            value={status}
            onChange={(event) => setStatus(event.target.value as FinishLineStatus)}
            aria-label="Line status"
          >
            {STATUSES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {STATUS_CHIP[candidate].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="surface-label">What is missing</span>
          <textarea
            className={FIELD}
            rows={2}
            value={currentState}
            onChange={(event) => setCurrentState(event.target.value)}
            aria-label="What is missing"
          />
        </label>
        <label className="block">
          <span className="surface-label">What it would take</span>
          <textarea
            className={FIELD}
            rows={2}
            value={targetState}
            onChange={(event) => setTargetState(event.target.value)}
            aria-label="What it would take"
          />
        </label>
        <label className="block">
          <span className="surface-label">Standing in meanwhile</span>
          <textarea
            className={FIELD}
            rows={2}
            value={interim}
            onChange={(event) => setInterim(event.target.value)}
            placeholder="The proxy in use while the real input is unavailable"
            aria-label="Interim proxy"
          />
        </label>
        <label className="block">
          <span className="surface-label">What else this holds up</span>
          <textarea
            className={FIELD}
            rows={2}
            value={blocks}
            onChange={(event) => setBlocks(event.target.value)}
            aria-label="Downstream consequence"
          />
        </label>
      </div>

      <fieldset>
        <legend className="surface-label">Closes via</legend>
        {links.length > 0 && (
          <ul className="mt-2 space-y-1">
            {links.map((link) => {
              const described = describeLink(link);
              return (
                <li
                  key={`${link.projectId}:${link.milestoneId ?? ''}`}
                  className="flex min-h-11 items-center gap-2 rounded-sm border border-border-subtle bg-card px-2"
                >
                  {described.broken && <Unlink className="size-3.5 shrink-0 text-destructive" />}
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-sm',
                        described.broken ? 'font-semibold text-destructive' : 'text-foreground-secondary',
                      )}
                    >
                      {described.title}
                    </span>
                    {described.sub && (
                      <span className="block truncate text-[11px] text-foreground-muted">
                        {described.sub}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setLinks((current) =>
                        current.filter(
                          (candidate) =>
                            `${candidate.projectId}:${candidate.milestoneId ?? ''}` !==
                            `${link.projectId}:${link.milestoneId ?? ''}`,
                        ),
                      )
                    }
                    aria-label={`Remove link to ${described.title}`}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="native-select min-w-0 flex-1 text-xs"
            value={addProject}
            onChange={(event) => {
              setAddProject(event.target.value);
              setAddMilestone('');
            }}
            aria-label="Project to link"
          >
            <option value="">Link a project…</option>
            {sorted.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
          {addable && addable.milestones.length > 0 && (
            <select
              className="native-select min-w-0 flex-1 text-xs"
              value={addMilestone}
              onChange={(event) => setAddMilestone(event.target.value)}
              aria-label="Milestone to link"
            >
              {/* The precise pairing is the milestone; whole-project is the
                  fallback for gaps that genuinely need all of it. */}
              <option value="">Whole project</option>
              {addable.milestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.text}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" size="sm" onClick={addLink} disabled={!addProject}>
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={isPending}>
          Save
        </Button>
      </div>
    </div>
  );
}
