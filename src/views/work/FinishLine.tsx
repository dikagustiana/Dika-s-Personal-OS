import { ChevronRight, Search, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { Input } from '../../components/ui/Input';
import type {
  CellState,
  DanglingLink,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  OrphanMilestone,
  Project,
} from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import { cn } from '../../lib/utils';
import {
  ancestorPath,
  buildContext,
  buildMatrix,
  resolveAll,
  resolveEdges,
  STATE_GLYPH,
  summarizeMatrix,
  type MatrixRow,
  type Resolution,
} from '../../logic/finishLine';
import { useAppStore } from '../../store/appStore';

/**
 * THE PACK AS A MATRIX — line items down, consolidation entities across.
 *
 * The grain is the CELL: one (line item x entity) pair carrying a STATE and
 * never a value. THE NUMBERS NEVER ENTER THE APP — a cell holding one renders
 * as the literal `xxx`. There is no importer, no paste path, no value field.
 *
 * FINISH LINE IS THE DESTINATION; THE PROJECTS ARE THE ROAD. The target state
 * is uniform and implicit — a figure exists and the method behind it is sound
 * — so nothing here authors a per-cell ideal. Two things are authored: the
 * cell's state (by a human, always) and the edges.
 *
 * The structure is seeded by migration 20260726000023. WHEN THAT MIGRATION HAS
 * NOT BEEN APPLIED the reads return empty rather than throwing, and this view
 * renders its ordinary empty state — the frontend ships first, and a missing
 * table must not be a crash.
 */

/** No colour literals: `input` takes the warn token, and nothing here is green. */
const RESOLUTION_STYLE: Record<Resolution, string> = {
  cycle: 'bg-destructive text-destructive-foreground',
  unplanned: 'bg-escalate/20 text-escalate',
  stuck: 'border border-destructive text-destructive',
  'in-progress': 'bg-escalate/15 text-escalate',
  contradiction: 'border border-escalate text-escalate',
  pending: 'bg-escalate/10 text-foreground-muted',
  undefined: 'bg-surface-3 text-foreground-muted',
  zero: 'text-foreground-muted',
  figure: 'text-foreground-secondary',
};

const RESOLUTION_LABEL: Record<Resolution, string> = {
  cycle: 'Dependency cycle — the seed is wrong',
  unplanned: 'Unplanned — no milestone closes this',
  stuck: 'Stuck — every linked milestone is blocked',
  'in-progress': 'In progress',
  contradiction: 'Contradiction — every linked milestone is done, the cell is still an input',
  pending: 'Waiting, with no inputs recorded',
  undefined: 'Undefined — zero divisor, not work outstanding',
  zero: 'Reported nil',
  figure: 'A number exists in Excel',
};

const ROW_STYLE: Record<string, string> = {
  det: 'pl-7 text-foreground-muted',
  sub: 'pl-4 font-semibold text-foreground-secondary',
  tot: 'pl-4 font-semibold text-foreground border-y border-border',
  lock: 'pl-4 text-foreground-muted',
  plain: 'pl-4 text-foreground-secondary',
};

const LEGEND: { glyph: string; className?: string; label: string }[] = [
  { glyph: 'xxx', label: 'angka ada, hidup di Excel' },
  { glyph: '–', label: 'nol' },
  { glyph: '', className: 'bg-surface-3', label: 'tidak terdefinisi, pembagi nol' },
  { glyph: '', className: 'bg-escalate/15', label: 'butuh input' },
  { glyph: '·', label: 'terkunci, menunggu input' },
  { glyph: '⚑', label: 'saldo kredit di akun beban' },
];

export function FinishLine() {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setProjectFocus = useAppStore((state) => state.setProjectFocus);
  const finishLineFocus = useAppStore((state) => state.finishLineFocus);
  const setFinishLineFocus = useAppStore((state) => state.setFinishLineFocus);
  const { run, isPending } = useMutation();

  const [items, setItems] = useState<FinishLineItem[]>([]);
  const [cells, setCells] = useState<FinishLineCell[]>([]);
  const [deps, setDeps] = useState<FinishLineDep[]>([]);
  const [edges, setEdges] = useState<FinishLineEdge[]>([]);
  const [entities, setEntities] = useState<FinishLineEntity[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [dangling, setDangling] = useState<DanglingLink[]>([]);
  const [orphans, setOrphans] = useState<OrphanMilestone[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [openCellId, setOpenCellId] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Every read degrades to [] when its relation is missing, so this resolves
    // even against a database that has not run the migration.
    const [
      loadedItems,
      loadedCells,
      loadedDeps,
      loadedEdges,
      loadedEntities,
      loadedProjects,
      loadedDangling,
      loadedOrphans,
    ] = await Promise.all([
      repository.listFinishLineItems(),
      repository.listFinishLineCells(),
      repository.listFinishLineDeps(),
      repository.listFinishLineEdges(),
      repository.listFinishLineEntities(),
      repository.listProjects('work'),
      repository.listDanglingLinks(),
      repository.listOrphanMilestones(),
    ]);
    setItems(loadedItems);
    setCells(loadedCells);
    setDeps(loadedDeps);
    setEdges(loadedEdges);
    setEntities(loadedEntities);
    setProjects(loadedProjects);
    setDangling(loadedDangling);
    setOrphans(loadedOrphans);
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const context = useMemo(
    () => buildContext(cells, deps, edges, projects),
    [cells, deps, edges, projects],
  );
  const resolutions = useMemo(() => resolveAll(context), [context]);
  const matrix = useMemo(
    () => buildMatrix(items, cells, entities, resolutions),
    [items, cells, entities, resolutions],
  );
  const summary = useMemo(() => summarizeMatrix(matrix), [matrix]);
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const openCell = openCellId ? context.cellsById.get(openCellId) : undefined;

  useEffect(() => {
    if (!finishLineFocus || items.length === 0) return;
    const target = items.find((item) => item.id === finishLineFocus.itemId);
    if (!target) return;
    setOpenSections((current) => {
      const next = { ...current };
      for (const id of ancestorPath(items, target.id)) next[id] = true;
      return next;
    });
    if (finishLineFocus.entityCode) {
      const cell = cells.find(
        (c) => c.itemId === target.id && c.entityCode === finishLineFocus.entityCode,
      );
      if (cell) setOpenCellId(cell.id);
    }
    setScrollTarget(target.id);
    setFinishLineFocus(null);
  }, [finishLineFocus, items, cells, setFinishLineFocus]);

  useEffect(() => {
    if (!scrollTarget) return;
    // scroll-margin on the row handles the sticky header; 'auto' keeps the
    // reduced-motion block in CSS in charge.
    document
      .getElementById(`finish-line-${scrollTarget}`)
      ?.scrollIntoView({ behavior: 'auto', block: 'start' });
    setScrollTarget(null);
  }, [scrollTarget]);

  const saveEdges = async (cellId: string, picked: { projectId: string; milestoneId: string }[]) => {
    const done = await run('Link milestones', () => repository.setCellEdges(cellId, picked));
    if (done === undefined) return;
    await load();
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">Work / Finish line</p>
        <h1 className="page-title">The pack, entity by entity</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
          Line items down, consolidation entities across. Every cell carries a state, never a
          value — the figures live in the workbook, and a cell that has one reads{' '}
          <span className="tabular-nums">xxx</span>. A figure existing does not mean it has been
          checked.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-border-subtle bg-card p-4">
        {LEGEND.map((entry) => (
          <span key={entry.label} className="flex items-center gap-2 text-xs text-foreground-muted">
            <span
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-sm border border-border-subtle tabular-nums',
                entry.className,
              )}
            >
              {entry.glyph}
            </span>
            {entry.label}
          </span>
        ))}
      </div>

      {summary.cycles > 0 && (
        <Card className="mb-5 border-destructive">
          <CardContent className="pt-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <TriangleAlert className="size-4" />
              {summary.cycles} cell{summary.cycles === 1 ? '' : 's'} sit in a dependency cycle
            </p>
            <p className="mt-1 text-xs text-foreground-muted">
              A cycle means the seeded derivation edges are wrong. Nothing downstream of one can
              be resolved.
            </p>
          </CardContent>
        </Card>
      )}

      {matrix.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-card">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[220px] bg-card px-4 py-3 text-left">
                    <span className="surface-label">Line item</span>
                  </th>
                  {entities.map((entity) => (
                    <th key={entity.code} scope="col" className="min-w-[84px] bg-card px-3 py-3 text-right">
                      <span className="surface-label">{entity.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>

              {matrix.map((section) => {
                const open = openSections[section.section.id] ?? section.defaultOpen;
                return (
                  <tbody key={section.section.id}>
                    <tr>
                      <th
                        colSpan={entities.length + 1}
                        scope="colgroup"
                        className="sticky left-0 border-y border-border-subtle bg-surface-2 p-0 text-left"
                      >
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() =>
                            setOpenSections((c) => ({ ...c, [section.section.id]: !open }))
                          }
                          className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {/* transition-transform stays — the rotation is what
                              confirms the click landed when many rows appear. */}
                          <ChevronRight
                            className={cn(
                              'size-4 shrink-0 text-foreground-muted transition-transform duration-150',
                              open && 'rotate-90',
                            )}
                          />
                          <span className="font-semibold text-foreground">
                            {section.section.item}
                          </span>
                          {section.section.tag && (
                            <span className="text-xs font-normal text-foreground-muted">
                              {section.section.tag}
                            </span>
                          )}
                        </button>
                      </th>
                    </tr>

                    {open &&
                      section.rows.map((row) => (
                        <Row
                          key={row.item.id}
                          row={row}
                          columns={entities.length}
                          openCellId={openCellId}
                          openRowId={openRowId}
                          onToggleCell={(id) => setOpenCellId((c) => (c === id ? null : id))}
                          onToggleRow={(id) => setOpenRowId((c) => (c === id ? null : id))}
                        />
                      ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        </Card>
      ) : (
        loaded && (
          <Card>
            <CardContent className="pt-5">
              <EmptyRow
                label="Matrix"
                clause="Nothing to show — the pack structure lives in the database"
              />
            </CardContent>
          </Card>
        )
      )}

      {openCell && (
        <CellPanel
          cell={openCell}
          item={itemsById.get(openCell.itemId)}
          resolution={resolutions.get(openCell.id)}
          edges={context.edgesByCell.get(openCell.id) ?? []}
          projects={projects}
          projectsById={context.projectsById}
          isPending={isPending}
          onClose={() => setOpenCellId(null)}
          onSave={(picked) => void saveEdges(openCell.id, picked)}
          onOpenProject={(projectId) => {
            setProjectFocus({ projectId, openMilestones: true });
            setWorkView('projects');
          }}
        />
      )}

      {openRowId && itemsById.get(openRowId)?.blocks && (
        <Card className="mt-5">
          <CardContent className="pt-5">
            <p className="surface-label">{itemsById.get(openRowId)?.item}</p>
            <p className="mt-1.5 text-xs leading-5 text-foreground-secondary">
              {itemsById.get(openRowId)?.blocks}
            </p>
          </CardContent>
        </Card>
      )}

      {matrix.length > 0 && (
        <p className="mt-4 text-xs tabular-nums text-foreground-muted">
          {summary.totalCells} cells · {summary.gaps} gaps · {summary.unplanned} unplanned ·{' '}
          {summary.stuck} stuck
          {summary.missing > 0 && ` · ${summary.missing} with no cell recorded`}
        </p>
      )}

      <TheTwoLists
        unplanned={matrix
          .flatMap((s) => s.rows)
          .flatMap((row) =>
            row.cells
              .filter((slot) => slot.resolution === 'unplanned' && slot.cell)
              .map((slot) => ({ row, entity: slot.entity.label, cell: slot.cell as FinishLineCell })),
          )}
        orphans={orphans}
        dangling={dangling}
        loaded={loaded}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Row({
  row,
  columns,
  openCellId,
  openRowId,
  onToggleCell,
  onToggleRow,
}: {
  row: MatrixRow;
  columns: number;
  openCellId: string | null;
  openRowId: string | null;
  onToggleCell: (id: string) => void;
  onToggleRow: (id: string) => void;
}) {
  const { item } = row;

  if (item.kind === 'note') {
    return (
      <tr id={`finish-line-${item.id}`} className="scroll-mt-24">
        <td colSpan={columns + 1} className="px-4 py-2 pl-8 text-xs italic text-foreground-muted">
          {item.item}
        </td>
      </tr>
    );
  }

  return (
    <tr id={`finish-line-${item.id}`} className="scroll-mt-24 hover:bg-surface-2">
      <th
        scope="row"
        className={cn(
          'sticky left-0 z-10 bg-card p-0 text-left font-normal',
          item.style === 'tot' && 'border-y border-border',
        )}
      >
        <button
          type="button"
          onClick={() => onToggleRow(item.id)}
          aria-expanded={openRowId === item.id}
          className={cn(
            'flex min-h-11 w-full items-center gap-1.5 py-1.5 pr-3 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            ROW_STYLE[item.style ?? 'plain'],
          )}
        >
          <span className="min-w-0 flex-1 truncate">{item.item}</span>
          {item.flag && (
            // Amber, never red: a credit balance in an expense account is a
            // thing to look at, not a failure.
            <span className="shrink-0 text-escalate" title={item.flag} aria-label={item.flag}>
              ⚑
            </span>
          )}
          {item.unit && (
            <span className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-foreground-muted">
              {item.unit}
            </span>
          )}
        </button>
      </th>

      {row.cells.map((slot) => {
        const state: CellState | undefined = slot.cell?.state;
        const resolution = slot.resolution;
        return (
          <td
            key={slot.entity.code}
            className={cn('p-0 text-right', item.style === 'tot' && 'border-y border-border')}
          >
            <button
              type="button"
              disabled={!slot.cell}
              onClick={() => slot.cell && onToggleCell(slot.cell.id)}
              aria-label={`${item.item}, ${slot.entity.label}${resolution ? `, ${RESOLUTION_LABEL[resolution]}` : ''}`}
              title={resolution ? RESOLUTION_LABEL[resolution] : undefined}
              className={cn(
                'min-h-11 w-full px-3 py-1.5 text-right tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                resolution && RESOLUTION_STYLE[resolution],
                slot.cell && 'hover:bg-surface-3',
                openCellId === slot.cell?.id && 'ring-2 ring-inset ring-ring',
                slot.cell?.note && 'underline decoration-dotted underline-offset-4',
              )}
            >
              {/* No record at all is a DATA GAP, not a state — it must not read
                  as empty-by-design. */}
              {slot.cell ? STATE_GLYPH[state as CellState] : '?'}
            </button>
          </td>
        );
      })}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// The cell panel — explanation plus the authoring control
// ---------------------------------------------------------------------------

function CellPanel({
  cell,
  item,
  resolution,
  edges,
  projects,
  projectsById,
  isPending,
  onClose,
  onSave,
  onOpenProject,
}: {
  cell: FinishLineCell;
  item?: FinishLineItem;
  resolution?: Resolution;
  edges: FinishLineEdge[];
  projects: Project[];
  projectsById: Map<string, Project>;
  isPending: boolean;
  onClose: () => void;
  onSave: (picked: { projectId: string; milestoneId: string }[]) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const resolved = resolveEdges(edges, projectsById);
  const [picking, setPicking] = useState(false);

  return (
    <Card className="mt-5">
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="surface-label">
              {item?.item ?? 'Cell'} · {cell.entityCode}
            </p>
            {resolution && (
              <p className="mt-1 text-sm text-foreground-secondary">
                {RESOLUTION_LABEL[resolution]}
              </p>
            )}
            {cell.note && (
              <p className="mt-1.5 text-xs leading-5 text-foreground-muted">{cell.note}</p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* Only an `input` cell can be closed by a milestone. A locked cell is
            closed transitively when its inputs land, and offering a picker on
            one would invite an edge the model forbids. */}
        {cell.state === 'input' ? (
          <>
            <ul className="mt-3 divide-y divide-border-subtle">
              {resolved.length === 0 && (
                <li className="py-2 text-xs text-foreground-muted">
                  No milestone closes this cell.
                </li>
              )}
              {resolved.map((r) => (
                <li key={r.edge.id} className="flex min-h-11 items-center gap-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => r.project && onOpenProject(r.project.id)}
                    disabled={!r.project}
                    className="min-w-0 flex-1 truncate text-left text-xs text-foreground-secondary hover:underline disabled:opacity-60"
                  >
                    {r.milestone?.text ?? r.project?.title ?? 'Broken link'}
                  </button>
                  {r.broken && (
                    <span className="shrink-0 rounded-sm border border-destructive px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-destructive">
                      Broken
                    </span>
                  )}
                  {r.milestone?.status === 'blocked' && !r.broken && (
                    // Blocked is outlined; overdue is filled. This is blocked.
                    <span className="shrink-0 rounded-sm border border-destructive px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-destructive">
                      Blocked
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {picking ? (
              <MilestonePicker
                entityCode={cell.entityCode}
                projects={projects}
                selected={edges
                  .filter((e) => e.milestoneId)
                  .map((e) => `${e.projectId}:${e.milestoneId}`)}
                isPending={isPending}
                onCancel={() => setPicking(false)}
                onCommit={(picked) => {
                  setPicking(false);
                  onSave(picked);
                }}
              />
            ) : (
              <div className="mt-3 flex justify-end">
                <Button onClick={() => setPicking(true)}>Link milestones</Button>
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-xs text-foreground-muted">
            {cell.state === 'locked'
              ? 'Derived. It closes when its inputs land — link the inputs, not this cell.'
              : 'Not closable by work.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * BULK BY DESIGN. ~250 candidate cells against 458 milestones, so the cell is
 * the anchor and the milestones are the list. Checkboxes, one commit, no modal
 * inside a modal — if one edge costs a form the table stays at 0 rows, exactly
 * as `timeblocks` did.
 */
function MilestonePicker({
  entityCode,
  projects,
  selected,
  isPending,
  onCancel,
  onCommit,
}: {
  entityCode: string;
  projects: Project[];
  selected: string[];
  isPending: boolean;
  onCancel: () => void;
  onCommit: (picked: { projectId: string; milestoneId: string }[]) => void;
}) {
  // A SEARCH DEFAULT, NOT A HARD FILTER. Entity is not a field on a milestone
  // or a project — it lives on the link row — so the column code is only a
  // sensible starting query, and the user can clear it.
  const [query, setQuery] = useState(entityCode);
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.flatMap((project) =>
      project.milestones
        .filter(
          (milestone) =>
            needle.length === 0 ||
            milestone.text.toLowerCase().includes(needle) ||
            project.title.toLowerCase().includes(needle),
        )
        .map((milestone) => ({ project, milestone })),
    );
  }, [projects, query]);

  return (
    <div className="mt-3 rounded-sm border border-border p-3">
      <label className="block">
        <span className="surface-label">Milestones</span>
        <span className="mt-1.5 flex items-center gap-2">
          <Search className="size-4 shrink-0 text-foreground-muted" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search milestone or project"
            aria-label="Search milestones"
          />
        </span>
      </label>
      <p className="mt-1.5 text-xs text-foreground-muted">
        Pre-filled with {entityCode} as a starting search. Clear it to see every milestone.
      </p>

      <div className="mt-2 max-h-72 overflow-y-auto rounded-sm border border-border-subtle">
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-foreground-muted">No milestone matches.</p>
        ) : (
          rows.map(({ project, milestone }) => {
            const key = `${project.id}:${milestone.id}`;
            return (
              <label
                key={key}
                className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border-subtle px-3 last:border-b-0 hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={picked.has(key)}
                  onChange={() =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1 py-1.5">
                  <span className="block truncate text-xs text-foreground-secondary">
                    {milestone.text}
                  </span>
                  <span className="block truncate text-[11px] text-foreground-muted">
                    {project.title}
                  </span>
                </span>
              </label>
            );
          })
        )}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs tabular-nums text-foreground-muted">
          {picked.size} selected
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            onCommit(
              [...picked].map((key) => {
                const [projectId, milestoneId] = key.split(':');
                return { projectId, milestoneId };
              }),
            )
          }
        >
          Save links
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The two lists that are the actual product
// ---------------------------------------------------------------------------

function TheTwoLists({
  unplanned,
  orphans,
  dangling,
  loaded,
}: {
  unplanned: { row: MatrixRow; entity: string; cell: FinishLineCell }[];
  orphans: OrphanMilestone[];
  dangling: DanglingLink[];
  loaded: boolean;
}) {
  if (!loaded) return null;
  return (
    <div className="mt-6 space-y-5">
      <Card>
        <CardContent className="pt-5">
          <h2 className="font-display text-card-heading font-semibold text-foreground">
            Unplanned cells
          </h2>
          <p className="mt-1 text-xs text-foreground-muted">
            Inputs the pack needs that no milestone closes. Holes in the plan.
          </p>
          {unplanned.length === 0 ? (
            <div className="mt-2">
              <EmptyRow label="Unplanned" clause="None" />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border-subtle">
              {unplanned.slice(0, 40).map(({ row, entity, cell }) => (
                <li key={cell.id} className="flex min-h-11 items-center gap-3 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                    {row.item.item}
                  </span>
                  <span className="shrink-0 text-foreground-muted">{entity}</span>
                </li>
              ))}
            </ul>
          )}
          {unplanned.length > 40 && (
            <p className="mt-2 text-xs tabular-nums text-foreground-muted">
              Showing 40 of {unplanned.length}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          {/* Deliberately not softened, not behind a toggle, and carrying no
              explanatory apology. */}
          <h2 className="font-display text-card-heading font-semibold text-foreground">
            Milestones that close nothing
          </h2>
          <p className="mt-1 text-xs tabular-nums text-foreground-muted">
            {orphans.length} milestones make no pack line trustworthy.
          </p>
          {orphans.length === 0 ? (
            <div className="mt-2">
              <EmptyRow label="Orphans" clause="None" />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border-subtle">
              {orphans.slice(0, 40).map((orphan) => (
                <li
                  key={`${orphan.projectId}:${orphan.milestoneId}`}
                  className="flex min-h-11 items-center gap-3 py-1.5 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                    {orphan.milestoneText}
                  </span>
                  <span className="shrink-0 truncate text-foreground-muted">
                    {orphan.projectTitle}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {orphans.length > 40 && (
            <p className="mt-2 text-xs tabular-nums text-foreground-muted">
              Showing 40 of {orphans.length}.
            </p>
          )}
        </CardContent>
      </Card>

      {dangling.length > 0 && (
        <Card className="border-destructive">
          <CardContent className="pt-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <TriangleAlert className="size-4" />
              {dangling.length} edge{dangling.length === 1 ? '' : 's'} point at a milestone that no
              longer exists
            </p>
            <p className="mt-1 text-xs text-foreground-muted">
              `milestone_id` is text into a jsonb array, so there is no foreign key to catch this.
              Nothing is deleted automatically.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
