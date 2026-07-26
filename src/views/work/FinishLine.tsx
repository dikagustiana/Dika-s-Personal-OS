import { ChevronRight, Link2, Search, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { Input } from '../../components/ui/Input';
import { isGapEligible } from '../../data/finishLineGuards';
import {
  cardState,
  derivedCardState,
  firstFailure,
  okRows,
  readThrew,
  rowsOf,
  type CardState,
  type ReadResult,
} from '../../data/readResult';
import type {
  CellState,
  DanglingLink,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  Milestone,
  OrphanMilestone,
  Project,
} from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import { cn } from '../../lib/utils';
import {
  ancestorPath,
  buildContext,
  buildMatrix,
  cellsForMilestone,
  filterMatrix,
  gapCells,
  groupOrphans,
  resolveAll,
  resolveEdges,
  slotMatches,
  STATE_GLYPH,
  summarizeMatrix,
  type MatrixFilter,
  type MatrixRow,
  type MatrixSection,
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
 * is uniform and implicit — a figure exists AND the method behind it is sound
 * — so nothing here authors a per-cell ideal. Two things are authored: the
 * cell's state (by a human, always) and the edges.
 *
 * ===========================================================================
 * TWO KINDS OF `xxx`, AND THE DIFFERENCE HAS TO SURVIVE A THREE-SECOND SCAN.
 * ===========================================================================
 * 92 cells render `xxx`. Every one is unbacked today. Once edges exist some
 * will be backed and some will not, and if the matrix cannot show that
 * difference at a glance it goes on doing what it does now: making
 * unevidenced numbers look finished.
 *
 * The marking goes on the UNBACKED one, not the backed one. Marking the
 * backed one would have been legal — `backed` genuinely means done, so green
 * would be honest — but with zero edges live it changes nothing on day one,
 * and "count the green ones" is counting zero things. The app already marks
 * the exception rather than the healthy case: the milestone list borders
 * blocked rows and leaves the rest alone.
 *
 * So an unbacked cell takes the amber wash, and the GLYPH says which kind of
 * problem it is:
 *   `xxx` on amber   the number exists, nothing stands behind it
 *   blank on amber   the number does not exist yet
 * Two channels, two facts. Scanning a column for three seconds, you count the
 * amber; among the amber, the ones reading `xxx` are the deceptive ones.
 */

/**
 * No colour literals. Amber (`escalate`) is the gap tone throughout; red
 * (`destructive`) is reserved for data that is WRONG rather than missing.
 *
 * Filled vs outlined follows the app's existing convention — blocked is
 * outlined, and `stuck` is the blocked case — so nothing new is invented here.
 */
const RESOLUTION_STYLE: Record<Resolution, string> = {
  cycle: 'bg-destructive text-destructive-foreground',
  // No road exists: you must create a milestone. Filled.
  unplanned: 'bg-escalate/20 text-escalate',
  // A road exists and is blocked: you must unblock one. Outlined.
  stuck: 'border border-escalate text-escalate',
  'in-progress': 'bg-escalate/10 text-escalate',
  contradiction: 'border border-destructive text-destructive',
  pending: 'bg-escalate/10 text-foreground-muted',
  // Finished. Deliberately unmarked — the absence of amber IS the signal.
  backed: 'text-foreground-secondary',
  undefined: 'bg-surface-3 text-foreground-muted',
  zero: 'text-foreground-muted',
};

/**
 * Tooltips explain the RESOLUTION. They are English, as every other tooltip
 * in the app is, and they no longer restate what the legend already glosses in
 * Indonesian — `zero: 'Reported nil'` sat directly beside a legend reading
 * `nol` and made one view speak two languages about one glyph. The legend owns
 * the glyph gloss; these own the explanation.
 */
const RESOLUTION_LABEL: Record<Resolution, string> = {
  cycle: 'Dependency cycle — the seed is wrong',
  unplanned: 'Unplanned — nothing stands behind this yet',
  stuck: 'Stuck — every linked milestone is blocked',
  'in-progress': 'In progress — work is under way',
  contradiction:
    'Contradiction — every linked milestone is done, yet the number still does not exist',
  pending: 'Waiting, with no inputs recorded',
  backed: 'Backed — every linked milestone is done',
  undefined: 'Undefined — zero divisor, not work outstanding',
  zero: 'Nil, and deferred — nil is not treated as a gap yet',
};

const ROW_STYLE: Record<string, string> = {
  det: 'pl-7 text-foreground-muted',
  sub: 'pl-4 font-semibold text-foreground-secondary',
  tot: 'pl-4 font-semibold text-foreground border-y border-border',
  lock: 'pl-4 text-foreground-muted',
  plain: 'pl-4 text-foreground-secondary',
};

/**
 * REWRITTEN, not extended. `xxx angka ada, hidup di Excel` described one thing
 * and there are now two — that single entry was the legend telling the reader
 * the 92 unbacked figures were finished. Indonesian throughout, as before.
 */
const LEGEND: { glyph: string; className?: string; label: string }[] = [
  { glyph: 'xxx', className: 'text-foreground-secondary', label: 'angka ada, ada kerja di belakangnya' },
  {
    glyph: 'xxx',
    className: 'bg-escalate/20 text-escalate',
    label: 'angka ada, belum ada kerja yang menjaminnya',
  },
  { glyph: '', className: 'bg-escalate/20 text-escalate', label: 'butuh input, belum ada rencana' },
  { glyph: '', className: 'border-escalate text-escalate', label: 'ada rencana tapi mandek' },
  { glyph: '–', label: 'nol' },
  { glyph: '', className: 'bg-surface-3', label: 'tidak terdefinisi, pembagi nol' },
  { glyph: '·', label: 'terkunci, mengikuti inputnya' },
  { glyph: '⚑', label: 'saldo kredit di akun beban' },
];

export function FinishLine() {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setProjectFocus = useAppStore((state) => state.setProjectFocus);
  const finishLineFocus = useAppStore((state) => state.finishLineFocus);
  const setFinishLineFocus = useAppStore((state) => state.setFinishLineFocus);
  const { run, isPending } = useMutation();

  // Reads are held as RESULTS, not arrays: a card that counts problems has to
  // be able to say "could not check" without inventing a zero.
  const empty = <T,>(): ReadResult<T> => okRows<T>([]);
  const [items, setItems] = useState<ReadResult<FinishLineItem>>(empty);
  const [cells, setCells] = useState<ReadResult<FinishLineCell>>(empty);
  const [deps, setDeps] = useState<ReadResult<FinishLineDep>>(empty);
  const [edges, setEdges] = useState<ReadResult<FinishLineEdge>>(empty);
  const [entities, setEntities] = useState<ReadResult<FinishLineEntity>>(empty);
  const [projects, setProjects] = useState<ReadResult<Project>>(empty);
  const [dangling, setDangling] = useState<ReadResult<DanglingLink>>(empty);
  const [orphans, setOrphans] = useState<ReadResult<OrphanMilestone>>(empty);
  const [loaded, setLoaded] = useState(false);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [openCellId, setOpenCellId] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState<MatrixFilter>('all');
  const [linking, setLinking] = useState(false);
  const [cellFocus, setCellFocus] = useState<ReadonlySet<string> | null>(null);

  const load = useCallback(async () => {
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
      // The only read here that is not already a ReadResult — os_projects has
      // existed since migration 1, so it throws rather than degrading. Caught
      // into the same shape so a project-read failure cannot render as a zero
      // either, and so it does not leave the page permanently blank.
      repository
        .listProjects('work')
        .then((rows) => okRows(rows))
        .catch((error: unknown) => readThrew('listProjects', error)),
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

  const itemRows = rowsOf(items);
  const cellRows = rowsOf(cells);
  const edgeRows = rowsOf(edges);
  const entityRows = rowsOf(entities);
  const projectRows = rowsOf(projects);

  const context = useMemo(
    () => buildContext(cellRows, rowsOf(deps), edgeRows, projectRows),
    [cellRows, deps, edgeRows, projectRows],
  );
  const resolutions = useMemo(() => resolveAll(context), [context]);
  const matrix = useMemo(
    () => buildMatrix(itemRows, cellRows, entityRows, resolutions),
    [itemRows, cellRows, entityRows, resolutions],
  );
  const summary = useMemo(() => summarizeMatrix(matrix), [matrix]);
  const itemsById = useMemo(() => new Map(itemRows.map((i) => [i.id, i])), [itemRows]);
  const openCell = openCellId ? context.cellsById.get(openCellId) : undefined;

  /**
   * The matrix as a whole is only trustworthy if EVERY read behind it landed.
   * A missing `cells` read with a present `items` read would render rows full
   * of `?` and a gap count of zero — a confident, wrong, quiet answer.
   */
  const matrixFailure = firstFailure(items, cells, deps, edges, entities, projects);

  const unplannedRows = useMemo(() => gapCells(matrix, 'unplanned'), [matrix]);
  const stuckRows = useMemo(() => gapCells(matrix, 'stuck'), [matrix]);

  const unplannedCard = derivedCardState(matrixFailure, unplannedRows);
  const orphanCard = cardState(orphans);
  const danglingCard = cardState(dangling);

  // Projects whose milestones can reach a column at all: WORK, monthly close
  // excluded — the same scope the orphan view uses as its denominator.
  const linkableProjects = useMemo(
    () => projectRows.filter((project) => project.recurring !== 'monthly'),
    [projectRows],
  );

  const visible = useMemo(() => filterMatrix(matrix, filter), [matrix, filter]);

  useEffect(() => {
    if (!finishLineFocus || itemRows.length === 0) return;
    if (finishLineFocus.cellIds) {
      // Arriving from a project: show exactly the cells that project closes.
      setCellFocus(new Set(finishLineFocus.cellIds));
      setOpenSections(Object.fromEntries(itemRows.map((item) => [item.id, true])));
      setFinishLineFocus(null);
      return;
    }
    const target = itemRows.find((item) => item.id === finishLineFocus.itemId);
    if (!target) return;
    setOpenSections((current) => {
      const next = { ...current };
      for (const id of ancestorPath(itemRows, target.id)) next[id] = true;
      return next;
    });
    if (finishLineFocus.entityCode) {
      const cell = cellRows.find(
        (c) => c.itemId === target.id && c.entityCode === finishLineFocus.entityCode,
      );
      if (cell) setOpenCellId(cell.id);
    }
    setScrollTarget(target.id);
    setFinishLineFocus(null);
  }, [finishLineFocus, itemRows, cellRows, setFinishLineFocus]);

  useEffect(() => {
    if (!scrollTarget) return;
    // scroll-margin on the row handles the sticky header; 'auto' keeps the
    // reduced-motion block in CSS in charge.
    document
      .getElementById(`finish-line-${scrollTarget}`)
      ?.scrollIntoView({ behavior: 'auto', block: 'start' });
    setScrollTarget(null);
  }, [scrollTarget]);

  const saveCellEdges = async (
    cellId: string,
    picked: { projectId: string; milestoneId: string }[],
  ) => {
    const done = await run('Link milestones', () => repository.setCellEdges(cellId, picked));
    if (done === undefined) return;
    await load();
  };

  const saveMilestoneEdges = async (
    projectId: string,
    milestoneId: string,
    cellIds: string[],
  ) => {
    const done = await run('Link pack lines', () =>
      repository.setMilestoneEdges(projectId, milestoneId, cellIds),
    );
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
          <span className="tabular-nums">xxx</span>. A number existing is only half the target:
          the other half is work standing behind it, and a cell without that is marked here
          however finished it looks.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-border-subtle bg-card p-4">
        {LEGEND.map((entry) => (
          <span
            key={`${entry.glyph}-${entry.label}`}
            className="flex items-center gap-2 text-xs text-foreground-muted"
          >
            <span
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-sm border border-border-subtle text-[9px] tabular-nums',
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

      <GapFilterRow
        state={unplannedCard}
        stuckCount={stuckRows.length}
        gapEligible={summary.gapEligible}
        totalCells={summary.totalCells}
        filter={filter}
        onFilter={setFilter}
      />

      {cellFocus && (
        <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-sm border border-border bg-surface-2 px-3">
          <span className="text-xs tabular-nums text-foreground-secondary">
            Showing the {cellFocus.size} cell{cellFocus.size === 1 ? '' : 's'} one project makes
            trustworthy
          </span>
          <Button variant="ghost" size="sm" onClick={() => setCellFocus(null)}>
            Show the whole pack
          </Button>
        </div>
      )}

      {matrixFailure ? (
        <Card className={cn(matrixFailure.reason === 'failed' && 'border-destructive')}>
          <CardContent className="pt-5">
            <CouldNotCheck label="Matrix" failure={matrixFailure} />
          </CardContent>
        </Card>
      ) : visible.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-card">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[220px] bg-card px-4 py-3 text-left">
                    <span className="surface-label">Line item</span>
                  </th>
                  {entityRows.map((entity) => (
                    <th
                      key={entity.code}
                      scope="col"
                      className="min-w-[84px] bg-card px-3 py-3 text-right"
                    >
                      <span className="surface-label">{entity.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>

              {visible.map((section) => {
                const open = openSections[section.section.id] ?? section.defaultOpen;
                return (
                  <tbody key={section.section.id}>
                    <tr>
                      <th
                        colSpan={entityRows.length + 1}
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
                          columns={entityRows.length}
                          filter={filter}
                          cellFocus={cellFocus}
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
                clause={
                  filter === 'all'
                    ? 'Nothing to show — the pack structure lives in the database'
                    : 'No cell matches this filter'
                }
                action={filter === 'all' ? undefined : 'Show everything'}
                onAction={filter === 'all' ? undefined : () => setFilter('all')}
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
          projects={linkableProjects}
          projectsById={context.projectsById}
          isPending={isPending}
          onClose={() => setOpenCellId(null)}
          onSave={(picked) => void saveCellEdges(openCell.id, picked)}
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

      {!matrixFailure && summary.totalCells > 0 && (
        <p className="mt-4 text-xs tabular-nums text-foreground-muted">
          {summary.totalCells} cells · {summary.gapEligible} need work behind them ·{' '}
          {summary.gaps} are gaps · {summary.backed} backed
          {summary.lockedGaps > 0 && ` · ${summary.lockedGaps} derived cells inherit a gap`}
          {summary.missing > 0 && ` · ${summary.missing} with no cell recorded`}
        </p>
      )}

      {/* THE AUTHORING ANCHOR. From a milestone, tick the cells it makes
          trustworthy — see MilestoneAnchor for why this direction and not the
          other. Collapsed by default so it never pushes the matrix down. */}
      <section className="mt-6">
        {linking ? (
          <MilestoneAnchor
            projects={linkableProjects}
            matrix={matrix}
            edges={edgeRows}
            isPending={isPending}
            onClose={() => setLinking(false)}
            onSave={saveMilestoneEdges}
          />
        ) : (
          <Card>
            <CardContent className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
              <div className="min-w-0">
                <p className="surface-label">Link work to the pack</p>
                <p className="mt-1 text-xs text-foreground-muted">
                  Pick a milestone, tick every cell it makes trustworthy, save once.
                </p>
              </div>
              {/* The page's ONE filled primary button. The cell-side picker is
                  the inverse and secondary, so this stays unique whatever else
                  is open. */}
              <Button onClick={() => setLinking(true)}>
                <Link2 className="size-4" />
                Link a milestone
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      <OrphanCard
        state={orphanCard}
        onOpenProject={(projectId) => {
          setProjectFocus({ projectId, openMilestones: true });
          setWorkView('projects');
        }}
      />

      <DanglingCard state={danglingCard} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Could not check — the third state, everywhere
// ---------------------------------------------------------------------------

/**
 * ===========================================================================
 * THIS RENDERS NO NUMBER. NOT EVEN ZERO.
 * ===========================================================================
 * An empty state is safe for a card that displays data and a LIE for a card
 * that counts problems. `0 milestones make no pack line trustworthy — None`
 * shipped while the truth was 458. The wording is also deliberately unlike the
 * confirmed-zero wording: "could not check" and "none" must never be
 * mistakable for one another at a glance.
 */
function CouldNotCheck({
  label,
  failure,
}: {
  label: string;
  failure: { reason: 'missing-relation' | 'failed'; detail: string };
}) {
  return (
    <div>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="surface-label">{label}</span>
        <span
          className={cn(
            'flex items-center gap-2 text-xs font-semibold',
            failure.reason === 'failed' ? 'text-destructive' : 'text-escalate',
          )}
        >
          <TriangleAlert className="size-3.5" />
          Could not check
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-foreground-muted">
        {failure.reason === 'missing-relation'
          ? 'This relation is not in the database yet, so there is no count to report — not a zero, and not a clean bill.'
          : 'The read did not complete, so there is no count to report — not a zero, and not a clean bill.'}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-foreground-muted">{failure.detail}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The gap count, as a filter on the matrix rather than a second list
// ---------------------------------------------------------------------------

/**
 * ONE ROW CARRYING THE COUNT, WHICH TURNS THE FILTER ON.
 *
 * This replaces a card that listed the gaps flat — `Payroll` twice, `Volume
 * delivered` five times. Two costs: the flat list made one problem look like
 * n unrelated small ones, and a second view of the same data means the reader
 * has to keep track of which one they are looking at.
 *
 * The segmented control follows the milestone list's All / Open / Blocked
 * exactly, and splits the two sub-states that need different responses:
 * `unplanned` means no road exists and you must create a milestone; `stuck`
 * means a road exists and is blocked and you must unblock one.
 */
function GapFilterRow({
  state,
  stuckCount,
  gapEligible,
  totalCells,
  filter,
  onFilter,
}: {
  state: CardState<unknown>;
  stuckCount: number;
  gapEligible: number;
  totalCells: number;
  filter: MatrixFilter;
  onFilter: (filter: MatrixFilter) => void;
}) {
  if (state.kind === 'could-not-check') {
    return (
      <Card className={cn('mb-3', state.reason === 'failed' && 'border-destructive')}>
        <CardContent className="py-4">
          <CouldNotCheck label="Unplanned" failure={state} />
        </CardContent>
      </Card>
    );
  }

  const unplanned = state.kind === 'has-data' ? state.count : 0;

  return (
    <div className="mb-3 rounded-lg border border-border-subtle bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-foreground-secondary">
          {state.kind === 'confirmed-zero' ? (
            <>
              <span className="font-semibold text-foreground">
                Every pack line has work behind it.
              </span>{' '}
              Checked, and there is genuinely nothing outstanding.
            </>
          ) : (
            <>
              <span className="font-semibold tabular-nums text-foreground">{unplanned}</span> of{' '}
              <span className="tabular-nums">{gapEligible}</span> cells that need work behind
              them have none.
            </>
          )}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Filter the matrix">
        {(
          [
            ['all', 'All', totalCells],
            ['unplanned', 'Unplanned', unplanned],
            ['stuck', 'Stuck', stuckCount],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => onFilter(value)}
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
    </div>
  );
}

// ---------------------------------------------------------------------------

function Row({
  row,
  columns,
  filter,
  cellFocus,
  openCellId,
  openRowId,
  onToggleCell,
  onToggleRow,
}: {
  row: MatrixRow;
  columns: number;
  filter: MatrixFilter;
  cellFocus: ReadonlySet<string> | null;
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
            // NO `uppercase`. It rendered `Rp jt` as `RP JT` and would have
            // done the same to `IDR k`. A unit is a unit as the workbook
            // writes it; casing is part of its meaning, not decoration.
            <span className="shrink-0 text-[10px] tracking-[0.06em] text-foreground-muted">
              {item.unit}
            </span>
          )}
        </button>
      </th>

      {row.cells.map((slot) => {
        const state: CellState | undefined = slot.cell?.state;
        const resolution = slot.resolution;
        // Under a filter the row keeps every column — a row that hid its other
        // four entities would stop being a row of the pack. The non-matching
        // ones simply step back.
        const dimmed =
          (filter !== 'all' && !slotMatches(slot, filter)) ||
          (cellFocus !== null && !(slot.cell && cellFocus.has(slot.cell.id)));
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
                dimmed && 'opacity-30',
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
// The cell panel — explanation plus the INVERSE authoring control
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

        {/* A gap-eligible cell can be closed by a milestone — `figure` as well
            as `input`. A locked cell is closed transitively when its inputs
            land, and offering a picker on one would invite an edge the model
            forbids. */}
        {isGapEligible(cell.state) ? (
          <>
            <ul className="mt-3 divide-y divide-border-subtle">
              {resolved.length === 0 && (
                <li className="py-2 text-xs text-foreground-muted">
                  {cell.state === 'figure'
                    ? 'A number exists here, and nothing in the plan attests that its method is sound.'
                    : 'No milestone closes this cell.'}
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
              <CellSidePicker
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
                {/* SECONDARY, deliberately. This is the inverse of the primary
                    authoring path and must not be the page's filled button. */}
                <Button variant="secondary" onClick={() => setPicking(true)}>
                  Link milestones to this cell
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-xs text-foreground-muted">
            {cell.state === 'locked'
              ? 'Derived. It closes when its inputs land — link the inputs, not this cell.'
              : cell.state === 'zero'
                ? 'Nil. Whether a reported nil needs work behind it is deferred until entities carry a trading flag.'
                : 'Arithmetic, not work outstanding.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * THE INVERSE, AND SECONDARY. One cell, many milestones.
 *
 * Kept because arriving from a single cell and asking "what would close this"
 * is a real question. It is not the primary path: see MilestoneAnchor.
 */
function CellSidePicker({
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
          variant="secondary"
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
// The authoring anchor — from a milestone, tick the cells it makes trustworthy
// ---------------------------------------------------------------------------

/**
 * ===========================================================================
 * THE MILESTONE IS THE ANCHOR, AND THIS REVERSES THE EARLIER INSTRUCTION.
 * ===========================================================================
 * The reversal follows from arithmetic. The earlier version anchored on the
 * cell because there were said to be fewer cells than milestones; both numbers
 * were wrong. The real comparison is 136 linkable cells against the in-scope
 * milestones, so the milestone side is the smaller one.
 *
 * It is also the better fit for the work. `Split akun Storing Cost` is ONE
 * milestone that makes `Storing cost` trustworthy across four entities plus
 * the derived percentage row — six cells in one action. From the cell side
 * that is six separate pickers.
 *
 * COUNTED HONESTLY, COLD START TO SIX CELLS ATTACHED:
 *   1 nav to Finish line · 2 open this panel · 3 type a query · 4 pick the
 *   milestone · 5-10 six ticks · 11 save.  = 11
 * Against the cell-anchored path: (click cell, open picker, search, tick,
 * save) x 6 + navigation = 31. Six of the eleven are the ticks themselves and
 * are irreducible — fewer would mean guessing which cells were meant.
 *
 * The right pane is the MATRIX'S OWN SHAPE — item rows down, entity checkboxes
 * across — so `Storing cost` is one row carrying four boxes rather than four
 * rows to hunt for. A flat list of 136 checkboxes would have cost the same
 * clicks and far more scrolling.
 *
 * BULK IS THE REQUIREMENT, NOT A NICETY. If one edge costs a form, the table
 * stays at 0 rows, exactly as `timeblocks` did.
 */
function MilestoneAnchor({
  projects,
  matrix,
  edges,
  isPending,
  onClose,
  onSave,
}: {
  projects: Project[];
  matrix: MatrixSection[];
  edges: FinishLineEdge[];
  isPending: boolean;
  onClose: () => void;
  onSave: (projectId: string, milestoneId: string, cellIds: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<{ project: Project; milestone: Milestone } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const candidates = useMemo(() => {
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

  // Re-opening shows what is already linked, so an unchanged commit is a
  // genuine no-op rather than a delete-and-reinsert of identical rows.
  const choose = (project: Project, milestone: Milestone) => {
    setChosen({ project, milestone });
    setPicked(new Set(cellsForMilestone(edges, project.id, milestone.id)));
  };

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="surface-label">Link work to the pack</p>
            <p className="mt-1 text-xs text-foreground-muted">
              One milestone often makes the same line trustworthy in several columns at once.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Left — the milestone */}
          <div className="min-w-0">
            <label className="block">
              <span className="surface-label">Milestone</span>
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

            <div className="mt-2 max-h-80 overflow-y-auto rounded-sm border border-border-subtle">
              {candidates.length === 0 ? (
                <p className="px-3 py-3 text-xs text-foreground-muted">No milestone matches.</p>
              ) : (
                candidates.map(({ project, milestone }) => {
                  const active =
                    chosen?.project.id === project.id && chosen.milestone.id === milestone.id;
                  const closes = cellsForMilestone(edges, project.id, milestone.id).size;
                  return (
                    <button
                      key={`${project.id}:${milestone.id}`}
                      type="button"
                      onClick={() => choose(project, milestone)}
                      aria-pressed={active}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-3 border-b border-border-subtle px-3 py-1.5 text-left last:border-b-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        active ? 'bg-primary/10' : 'hover:bg-surface-2',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-foreground-secondary">
                          {milestone.text}
                        </span>
                        <span className="block truncate text-[11px] text-foreground-muted">
                          {project.title}
                        </span>
                      </span>
                      {/* The zero is printed plainly. A milestone that closes
                          nothing is the uncomfortable fact this view exists
                          for, and it is not hidden. */}
                      <span className="shrink-0 text-[10px] tabular-nums text-foreground-muted">
                        {closes}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right — the cells, in the matrix's own shape */}
          <div className="min-w-0">
            <p className="surface-label">Cells it makes trustworthy</p>
            {!chosen ? (
              <p className="mt-3 text-xs text-foreground-muted">
                Pick a milestone on the left.
              </p>
            ) : (
              <>
                <p className="mt-1.5 truncate text-xs text-foreground-secondary">
                  {chosen.milestone.text}
                </p>
                <div className="mt-2 max-h-80 overflow-y-auto rounded-sm border border-border-subtle">
                  <CellPickerGrid
                    matrix={matrix}
                    picked={picked}
                    onToggle={(cellId) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (next.has(cellId)) next.delete(cellId);
                        else next.add(cellId);
                        return next;
                      })
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs tabular-nums text-foreground-muted">
            {picked.size} cell{picked.size === 1 ? '' : 's'} selected
          </span>
          <Button
            disabled={isPending || !chosen}
            onClick={() =>
              chosen && onSave(chosen.project.id, chosen.milestone.id, [...picked])
            }
          >
            Save links
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The mini-matrix: item rows down, entity checkboxes across.
 *
 * A checkbox appears only where the cell is GAP-ELIGIBLE — the same predicate
 * the guard enforces in the mutation path, so the UI cannot offer something
 * the write would reject. Non-eligible cells render their glyph greyed, which
 * keeps the row's shape recognisable as the matrix rather than turning it into
 * a ragged list.
 */
function CellPickerGrid({
  matrix,
  picked,
  onToggle,
}: {
  matrix: MatrixSection[];
  picked: ReadonlySet<string>;
  onToggle: (cellId: string) => void;
}) {
  return (
    <table className="w-full border-collapse text-xs">
      {matrix.map((section) => (
        <tbody key={section.section.id}>
          <tr>
            <th
              colSpan={(section.rows[0]?.cells.length ?? 0) + 1}
              scope="colgroup"
              className="border-y border-border-subtle bg-surface-2 px-3 py-1.5 text-left text-[11px] font-semibold text-foreground-secondary"
            >
              {section.section.item}
            </th>
          </tr>
          {section.rows
            .filter((row) => row.item.kind !== 'note')
            .map((row) => (
              <tr key={row.item.id} className="border-b border-border-subtle last:border-b-0">
                <th
                  scope="row"
                  className="max-w-[180px] truncate px-3 py-1 text-left font-normal text-foreground-muted"
                >
                  {row.item.item}
                </th>
                {row.cells.map((slot) => {
                  const eligible = slot.cell !== undefined && isGapEligible(slot.cell.state);
                  return (
                    <td key={slot.entity.code} className="px-1 py-1 text-center">
                      {eligible && slot.cell ? (
                        <label className="flex min-h-8 cursor-pointer items-center justify-center">
                          <span className="sr-only">
                            {row.item.item}, {slot.entity.label}
                          </span>
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={picked.has(slot.cell.id)}
                            onChange={() => onToggle(slot.cell!.id)}
                          />
                        </label>
                      ) : (
                        <span
                          className="block min-h-8 pt-1.5 text-foreground-muted opacity-40"
                          title={
                            slot.cell
                              ? 'Not closable by work — it follows its inputs, or it is nil or arithmetic'
                              : 'No cell recorded here'
                          }
                        >
                          {slot.cell ? STATE_GLYPH[slot.cell.state] || '·' : '?'}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
        </tbody>
      ))}
    </table>
  );
}

// ---------------------------------------------------------------------------
// Milestones that close nothing — grouped, not a flat scroll
// ---------------------------------------------------------------------------

/**
 * The heading states the count and nothing else: not softened, not behind a
 * toggle, carrying no explanatory apology.
 *
 * Grouped by project because a flat list made one problem look like many
 * unrelated small ones — the same failure the unplanned card had. Rows that
 * open, not rows that scroll. NOTHING here hardcodes a count.
 */
function OrphanCard({
  state,
  onOpenProject,
}: {
  state: CardState<OrphanMilestone>;
  onOpenProject: (projectId: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(
    () => (state.kind === 'has-data' ? groupOrphans(state.rows) : []),
    [state],
  );

  return (
    <Card className={cn('mt-5', state.kind === 'could-not-check' && state.reason === 'failed' && 'border-destructive')}>
      <CardContent className="pt-5">
        <h2 className="font-display text-card-heading font-semibold text-foreground">
          Milestones that close nothing
        </h2>

        {state.kind === 'could-not-check' ? (
          <div className="mt-2">
            <CouldNotCheck label="Orphans" failure={state} />
          </div>
        ) : state.kind === 'confirmed-zero' ? (
          <>
            <p className="mt-1 text-xs text-foreground-muted">
              Every milestone in scope makes some pack line trustworthy. Checked.
            </p>
            <div className="mt-2">
              <EmptyRow label="Orphans" clause="None, and the read succeeded" />
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs tabular-nums text-foreground-muted">
              {state.count} milestones across {groups.length} projects make no pack line
              trustworthy.
            </p>
            <ul className="mt-2 divide-y divide-border-subtle">
              {groups.map((group) => {
                const isOpen = open[group.projectId] ?? false;
                return (
                  <li key={group.projectId}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() =>
                        setOpen((current) => ({ ...current, [group.projectId]: !isOpen }))
                      }
                      className="flex min-h-11 w-full items-center gap-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight
                        className={cn(
                          'size-4 shrink-0 text-foreground-muted transition-transform duration-150',
                          isOpen && 'rotate-90',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground-secondary">
                        {group.projectTitle}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-foreground-muted">
                        {group.milestones.length}
                      </span>
                    </button>
                    {isOpen && (
                      <ul className="mb-1.5 ml-6 divide-y divide-border-subtle border-l border-border-subtle pl-3">
                        {group.milestones.map((orphan) => (
                          <li
                            key={orphan.milestoneId}
                            className="flex min-h-11 items-center gap-3 py-1.5 text-xs"
                          >
                            <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                              {orphan.milestoneText}
                            </span>
                            {orphan.status === 'blocked' && (
                              <span className="shrink-0 rounded-sm border border-destructive px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-destructive">
                                Blocked
                              </span>
                            )}
                          </li>
                        ))}
                        <li className="py-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenProject(group.projectId)}
                            className="rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Open {group.projectTitle}
                          </button>
                        </li>
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function DanglingCard({ state }: { state: CardState<DanglingLink> }) {
  if (state.kind === 'confirmed-zero') return null;

  return (
    <Card className="mt-5 border-destructive">
      <CardContent className="pt-5">
        {state.kind === 'could-not-check' ? (
          <CouldNotCheck label="Broken links" failure={state} />
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <TriangleAlert className="size-4" />
              {state.count} edge{state.count === 1 ? '' : 's'} point at a milestone that no longer
              exists
            </p>
            <p className="mt-1 text-xs text-foreground-muted">
              `milestone_id` is text into a jsonb array, so there is no foreign key to catch this.
              Nothing is deleted automatically.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
