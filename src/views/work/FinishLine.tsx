import { ChevronRight, Link2, Search, TriangleAlert } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  FinishLineAccount,
  FinishLineAccountMapRow,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  Milestone,
  OrphanMilestone,
  ProcessNeed,
  ProcessStep,
  ProcessStepItem,
  Project,
  ShareLink,
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
  STATE_SENTENCE,
  summarizeMatrix,
  type MatrixFilter,
  type MatrixRow,
  type MatrixSection,
  type Resolution,
} from '../../logic/finishLine';
import { accountsByCell, accountsWithNoEntity } from '../../logic/finishLineAccounts';
import { closingConditionsForItem, type ClosingConditions } from '../../logic/processModel';
import { isSupabaseConfigured } from '../../data/supabaseRepository';
import { useAppStore } from '../../store/appStore';
import { NeedStatusChip } from './processUi';
import { AccountPasteCard } from './AccountPasteCard';
import { CellDetailPanel } from './CellDetailPanel';
import { CollaboratorCard } from './CollaboratorCard';
import { ShareLinkCard } from './ShareLinkCard';
import { FinishLineEntityView } from './FinishLineEntity';
import {
  Checking,
  CouldNotCheck,
  RESOLUTION_LABEL,
  RESOLUTION_STYLE,
  ROW_STYLE,
  STATE_TONE,
} from './finishLineUi';

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

// RESOLUTION_STYLE, RESOLUTION_LABEL and ROW_STYLE moved to finishLineUi.tsx,
// shared with the per-entity level — one copy so the two levels cannot drift
// into rendering one resolution two ways.

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
  { glyph: '•', className: 'text-primary', label: 'diisi kolaborator, belum disentuh pemilik' },
];

export function FinishLine({
  /**
   * Hand-off to the swimlane tab, pre-filtered to a row (§2). The step label
   * is optional and only decides which box opens on arrival — the URL is
   * `?item=` either way, because the filter is the row, not the step.
   */
  onOpenSwimlane,
}: {
  onOpenSwimlane: (itemId: string, stepLabel: string | undefined, entityCode: string) => void;
}) {
  const repository = useAppStore((state) => state.repository);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setProjectFocus = useAppStore((state) => state.setProjectFocus);
  const finishLineFocus = useAppStore((state) => state.finishLineFocus);
  const setFinishLineFocus = useAppStore((state) => state.setFinishLineFocus);
  const viewer = useAppStore((state) => state.viewer);
  const { run, isPending } = useMutation();

  // COSMETIC GATING ONLY. Every restriction below is enforced in SQL (member
  // policies + the cell trigger); the viewer merely decides which controls
  // are worth rendering. Owner-only surfaces — edges, the account paste,
  // share links, the orphan/dangling audits — simply do not mount for a
  // contributor, whose world is their cells and the note beside them.
  const isOwnerViewer = viewer.kind === 'owner';
  const contributorEntities = viewer.kind === 'contributor' ? viewer.entityCodes : null;
  const canWriteCell = (cell: FinishLineCell): boolean =>
    isOwnerViewer || (contributorEntities?.includes(cell.entityCode) ?? false);

  /**
   * Reads are held as RESULTS, not arrays: a card that counts problems has to
   * be able to say "could not check" without inventing a zero.
   *
   * THE SEED IS A FAILURE, NOT AN EMPTY SUCCESS. Seeding these with
   * `{ok: true, rows: []}` would make the very first render — before any
   * request has come back — say "Every pack line has work behind it. Checked".
   * That is the identical defect this whole change exists to remove, just
   * arriving a few hundred milliseconds earlier: not-yet-checked presented as
   * checked-and-clean. The cards are additionally gated on `loaded`, so this
   * seed is belt and braces; it is the belt.
   */
  const unread = <T,>(): ReadResult<T> => ({
    ok: false,
    reason: 'failed',
    detail: 'Not read yet',
  });
  const [items, setItems] = useState<ReadResult<FinishLineItem>>(unread);
  const [cells, setCells] = useState<ReadResult<FinishLineCell>>(unread);
  const [deps, setDeps] = useState<ReadResult<FinishLineDep>>(unread);
  const [edges, setEdges] = useState<ReadResult<FinishLineEdge>>(unread);
  const [entities, setEntities] = useState<ReadResult<FinishLineEntity>>(unread);
  const [projects, setProjects] = useState<ReadResult<Project>>(unread);
  const [dangling, setDangling] = useState<ReadResult<DanglingLink>>(unread);
  const [orphans, setOrphans] = useState<ReadResult<OrphanMilestone>>(unread);
  // The account level. A read failure here must NOT blank the matrix — the
  // pack is readable without account detail — so it degrades to no accounts
  // and the coverage line simply does not render.
  const [accounts, setAccounts] = useState<ReadResult<FinishLineAccount>>(unread);
  // The mapping, loaded for the paste path: a commit without it would resolve
  // every pasted row to unmapped and quietly strip cells, so no map, no commit.
  const [accountMap, setAccountMap] = useState<ReadResult<FinishLineAccountMapRow>>(unread);
  // Share links. A failure here must not blank anything either: the pack is
  // readable whether or not the list of who can see it came back, and the card
  // says COULD NOT CHECK rather than showing an empty list that would read as
  // "nothing is shared".
  const [shareLinks, setShareLinks] = useState<ReadResult<ShareLink>>(unread);
  // The process register (§8.1) — READ relation only: it feeds the
  // "Kondisi tutup dari proses" block in the cell panel and never writes a
  // cell state. Its tables ship after this frontend, so a missing relation
  // degrades to no rows and the block simply does not render — exactly what
  // "no mapped needs" renders, which is the correct pre-migration state.
  const [processNeeds, setProcessNeeds] = useState<ReadResult<ProcessNeed>>(unread);
  const [processSteps, setProcessSteps] = useState<ReadResult<ProcessStep>>(unread);
  const [processStepItems, setProcessStepItems] = useState<ReadResult<ProcessStepItem>>(unread);
  const [loaded, setLoaded] = useState(false);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [openCellId, setOpenCellId] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState<MatrixFilter>('all');
  const [linking, setLinking] = useState(false);
  const [cellFocus, setCellFocus] = useState<ReadonlySet<string> | null>(null);
  // 'group' or an entity code. The group matrix answers "what shape is the
  // whole programme in"; the entity level is where work gets assigned. A
  // second LEVEL, not a replacement — the matrix is untouched.
  const [level, setLevel] = useState<string>('group');

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
      loadedAccounts,
      loadedAccountMap,
      loadedShareLinks,
      loadedProcessNeeds,
      loadedProcessSteps,
      loadedProcessStepItems,
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
      repository.listFinishLineAccounts(),
      repository.listFinishLineAccountMap(),
      repository.listShareLinks(),
      repository.listProcessNeeds(),
      repository.listProcessSteps(),
      repository.listProcessStepItems(),
    ]);
    setItems(loadedItems);
    setCells(loadedCells);
    setDeps(loadedDeps);
    setEdges(loadedEdges);
    setEntities(loadedEntities);
    setProjects(loadedProjects);
    setDangling(loadedDangling);
    setOrphans(loadedOrphans);
    setAccounts(loadedAccounts);
    setAccountMap(loadedAccountMap);
    setShareLinks(loadedShareLinks);
    setProcessNeeds(loadedProcessNeeds);
    setProcessSteps(loadedProcessSteps);
    setProcessStepItems(loadedProcessStepItems);
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    // An unexpected throw must land as a FAILURE, not as a page stuck before
    // `loaded`. Left unguarded, a rejection would freeze every card in
    // whatever it was showing, which is the one situation where a stale
    // "checked and clean" could sit on screen indefinitely.
    void load().catch((error: unknown) => {
      const failure = readThrew('finish line', error);
      setItems(failure);
      setCells(failure);
      setDeps(failure);
      setEdges(failure);
      setEntities(failure);
      setProjects(failure);
      setDangling(failure);
      setOrphans(failure);
      setAccounts(failure);
      setAccountMap(failure);
      setShareLinks(failure);
      setProcessNeeds(failure);
      setProcessSteps(failure);
      setProcessStepItems(failure);
      setLoaded(true);
    });
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
   * The cell's two authored fields, written through the guarded repository
   * path. Origin says who is at the keyboard; the trigger re-decides from the
   * credential either way, so a wrong origin can only make the failure
   * earlier, never wider. Reload after: state, resolution, attribution and
   * history all changed together and are all derived on read.
   */
  const saveCellState = async (cellId: string, next: CellState) => {
    const done = await run('Update cell state', () =>
      repository.setFinishLineCellState(cellId, next, isOwnerViewer ? 'human' : 'contributor'),
    );
    if (done !== undefined) await load();
  };

  const saveCellNote = async (cellId: string, note: string | undefined) => {
    const done = await run('Update cell note', () =>
      repository.setFinishLineCellNote(cellId, note),
    );
    if (done !== undefined) await load();
  };

  /**
   * The accounts behind each cell, and whether we actually know.
   *
   * `accounts.ok` is carried separately and never collapsed into "the map is
   * empty": a failed read and a genuinely empty cell produce the same map, and
   * the cell panel has to be able to tell a reader which of the two it is.
   */
  const accountsByCellId = useMemo(() => accountsByCell(rowsOf(accounts)), [accounts]);
  const accountsKnown = accounts.ok;
  const entityLabelByCode = useMemo(
    () => new Map(entityRows.map((entity) => [entity.code, entity.label])),
    [entityRows],
  );

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
  const sortedEntities = useMemo(
    () => [...entityRows].sort((a, b) => a.order - b.order),
    [entityRows],
  );
  const activeEntity = sortedEntities.find((entity) => entity.code === level);

  useEffect(() => {
    if (!finishLineFocus || itemRows.length === 0) return;
    // Deep links target the group matrix; an entity tab left open must not
    // swallow the handoff.
    setLevel('group');
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

  // Both setters resolve void, so the action returns an explicit sentinel —
  // `run` signals failure with undefined, and a void success WAS undefined
  // too, which made `if (done === undefined) return` swallow every success:
  // the links saved and the view never reloaded to show them. Found by
  // driving the picker in a real browser; invisible to the repository tests.
  const saveCellEdges = async (
    cellId: string,
    picked: { projectId: string; milestoneId: string }[],
  ) => {
    const done = await run('Link milestones', async () => {
      await repository.setCellEdges(cellId, picked);
      return true as const;
    });
    if (!done) return;
    await load();
  };

  const saveMilestoneEdges = async (
    projectId: string,
    milestoneId: string,
    cellIds: string[],
  ) => {
    const done = await run('Link pack lines', async () => {
      await repository.setMilestoneEdges(projectId, milestoneId, cellIds);
      return true as const;
    });
    if (!done) return;
    await load();
  };

  return (
    // A tab of FinishLineArea, which owns page-shell, the header and the one
    // <h1>. What follows the description is the matrix exactly as it was
    // before the tabs existed.
    <>
      <p className="mb-7 max-w-2xl text-sm leading-6 text-foreground-muted">
        The pack, entity by entity: line items down, consolidation entities across. Every cell
        carries a state, never a value — the figures live in the workbook, and a cell that has
        one reads <span className="tabular-nums">xxx</span>. A number existing is only half the
        target: the other half is work standing behind it, and a cell without that is marked
        here however finished it looks.
      </p>

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

      {/* THE LEVEL SELECTOR — the group matrix, or one entity's own view.
          Adds a level; replaces nothing. Same segmented shape as the matrix
          filter. Entities come from the database, in their sort_order. */}
      {entityRows.length > 0 && (
        <div
          className="mb-5 flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Choose the level"
        >
          {['group', ...sortedEntities.map((entity) => entity.code)].map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                setLevel(code);
                // A panel opened at one level must not linger into another.
                setOpenCellId(null);
              }}
              aria-pressed={level === code}
              className={cn(
                'min-h-8 rounded-sm border px-2.5 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                level === code
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-foreground-muted hover:text-foreground-secondary',
              )}
            >
              {code === 'group' ? 'Group' : code}
            </button>
          ))}
        </div>
      )}

      {level === 'group' && summary.cycles > 0 && (
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

      {/* THE ENTITY LEVEL. One column, its two mirror lists, and the same
          shared cell panel and linking anchor below. */}
      {activeEntity && (
        <FinishLineEntityView
          accounts={rowsOf(accounts)}
          // Keyed by entity so switching REMOUNTS: open lists, section state
          // and scroll targets are one entity's, and carrying them across —
          // ASI's expanded Unplanned arriving already-open on SAMB — reads as
          // state about the wrong column. Same pattern as key={workspace} in
          // App.tsx.
          key={activeEntity.code}
          entity={activeEntity}
          matrix={matrix}
          context={context}
          itemsById={itemsById}
          orphanState={orphanCard}
          workProjects={projectRows}
          onOpenPanel={(cellId) => setOpenCellId(cellId)}
          onOpenProject={(projectId) => {
            setProjectFocus({ projectId, openMilestones: true });
            setWorkView('projects');
          }}
        />
      )}

      {/* Gated on `loaded`: before the first response there is no count and no
          clean bill, and "checking" must not be spelled as either. */}
      {level === 'group' &&
        (loaded ? (
          <GapFilterRow
            state={unplannedCard}
            stuckCount={stuckRows.length}
            gapEligible={summary.gapEligible}
            totalCells={summary.totalCells}
            filter={filter}
            onFilter={setFilter}
          />
        ) : (
          <Checking label="Unplanned" />
        ))}

      {level === 'group' && cellFocus && (
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

      {/* ==================================================================
          THE ACCOUNT READ GETS A FAILURE SURFACE OF ITS OWN.
          It failed silently in production: the 500 rendered only as the
          neutral phrase "Belum termuat", which reads as a normal state, and
          the diagnostic the ReadResult deliberately preserved was never
          shown to anyone. The matrix read has had this card from the start —
          the accounts read simply never got one. Rendered at BOTH levels,
          because the entity view consumes accounts too. Gated on `loaded` so
          the not-read-yet seed does not flash as a failure during load.
          ================================================================== */}
      {loaded && !accounts.ok && (
        <Card className={cn('mb-5', accounts.reason === 'failed' && 'border-destructive')}>
          <CardContent className="pt-5">
            <CouldNotCheck label="Account detail" failure={accounts} />
          </CardContent>
        </Card>
      )}

      {level !== 'group' ? null : matrixFailure ? (
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
                          accountsByCellId={accountsByCellId}
                          accountsKnown={accountsKnown}
                          onToggleCell={(id) => setOpenCellId((c) => (c === id ? null : id))}
                          onToggleRow={(id) => setOpenRowId((c) => (c === id ? null : id))}
                          renderPanel={(cell) => (
                            <CellDetailPanel
                              cell={cell}
                              item={itemsById.get(cell.itemId)}
                              entityLabel={entityLabelByCode.get(cell.entityCode) ?? cell.entityCode}
                              accounts={accountsByCellId.get(cell.id) ?? []}
                              accountsKnown={accountsKnown}
                              accountsFailure={loaded && !accounts.ok ? accounts : undefined}
                              viewerKind={viewer.kind}
                              canWrite={canWriteCell(cell)}
                              isPending={isPending}
                              onSetState={(next) => void saveCellState(cell.id, next)}
                              onSetNote={(note) => void saveCellNote(cell.id, note)}
                              onClose={() => setOpenCellId(null)}
                            />
                          )}
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

      {openCell && isOwnerViewer && (
        <CellPanel
          cell={openCell}
          item={itemsById.get(openCell.itemId)}
          resolution={resolutions.get(openCell.id)}
          edges={context.edgesByCell.get(openCell.id) ?? []}
          projects={linkableProjects}
          projectsById={context.projectsById}
          // Same hazard as the milestone anchor, same answer: this picker also
          // REPLACES the cell's edge set, so offering it over a failed edge
          // read would let a save delete links we simply could not see.
          canLink={!matrixFailure}
          isPending={isPending}
          // §4.3: the closing-conditions block follows THE CELL'S OWN
          // entity — a SAMB cell reads SAMB's chain, an ARBI cell ARBI's,
          // and a cell of an entity with no chain gets null (no block)
          // without any special case. The old `=== 'SAMB'` guard is gone;
          // the entity scoping lives in the join through the step.
          closing={closingConditionsForItem(
            openCell.itemId,
            openCell.entityCode,
            rowsOf(processStepItems),
            rowsOf(processNeeds),
            rowsOf(processSteps),
          )}
          onOpenStep={(stepLabel) =>
            onOpenSwimlane(openCell.itemId, stepLabel, openCell.entityCode)
          }
          onClose={() => setOpenCellId(null)}
          onSave={(picked) => void saveCellEdges(openCell.id, picked)}
          onOpenProject={(projectId) => {
            setProjectFocus({ projectId, openMilestones: true });
            setWorkView('projects');
          }}
        />
      )}

      {level === 'group' && openRowId && itemsById.get(openRowId)?.blocks && (
        <Card className="mt-5">
          <CardContent className="pt-5">
            <p className="surface-label">{itemsById.get(openRowId)?.item}</p>
            <p className="mt-1.5 text-xs leading-5 text-foreground-secondary">
              {itemsById.get(openRowId)?.blocks}
            </p>
          </CardContent>
        </Card>
      )}

      {level === 'group' && !matrixFailure && summary.totalCells > 0 && (
        <p className="mt-4 text-xs tabular-nums text-foreground-muted">
          {summary.totalCells} cells · {summary.gapEligible} need work behind them ·{' '}
          {summary.gaps} are gaps · {summary.backed} backed
          {summary.lockedGaps > 0 && ` · ${summary.lockedGaps} derived cells inherit a gap`}
          {summary.missing > 0 && ` · ${summary.missing} with no cell recorded`}
        </p>
      )}

      {/* THE AUTHORING ANCHOR. From a milestone, tick the cells it makes
          trustworthy — see MilestoneAnchor for why this direction and not the
          other. Collapsed by default so it never pushes the matrix down.
          =====================================================================
          CLOSED WHENEVER A READ BEHIND IT FAILED, and the edge read especially.
          =====================================================================
          `edgeRows` degrades to [] on a failed read, so the picker would open
          with every box unticked — not because the milestone closes nothing,
          but because we could not see what it closes. Saving that view is a
          DELETE of every real link the user never knew was there. The failure
          is silent, destructive, and indistinguishable from ordinary use. So
          the control is not offered at all until every read behind it landed. */}
      {!isOwnerViewer ? null : (
      <section className="mt-6">
        {!loaded ? (
          <Checking label="Link work to the pack" />
        ) : matrixFailure ? (
          <Card className={cn(matrixFailure.reason === 'failed' && 'border-destructive')}>
            <CardContent className="py-4">
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="surface-label">Link work to the pack</span>
                <span
                  className={cn(
                    'flex items-center gap-2 text-xs font-semibold',
                    matrixFailure.reason === 'failed' ? 'text-destructive' : 'text-escalate',
                  )}
                >
                  <TriangleAlert className="size-3.5" />
                  Closed while the pack cannot be read
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-foreground-muted">
                Linking is a replace, and a picker built on a read that did not land would
                arrive showing no existing links — saving it would delete the ones already
                there. It reopens when the reads succeed.
              </p>
              <p className="mt-1 text-[11px] leading-5 text-foreground-muted">
                {matrixFailure.detail}
              </p>
            </CardContent>
          </Card>
        ) : linking ? (
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
      )}

      {/* ==================================================================
          ACCOUNTS WITH NEITHER A METRIC NOR AN ENTITY.
          These reach NO entity view — that is what having no entity means —
          so the per-entity unmapped list cannot show them and only the group
          level can. Their entity exists solely in the workbook; guessing it
          from the chart-of-accounts number would embed a guess in data that
          then looks authoritative, so it is asked for rather than invented.
          Not an error, and not hidden.
          ================================================================== */}
      {isOwnerViewer && level === 'group' && loaded && accounts.ok && accountsWithNoEntity(rowsOf(accounts)).length > 0 && (
        <Card className="mt-5">
          <CardContent className="pt-4">
            <p className="text-sm font-semibold text-foreground">
              <span className="tabular-nums">
                {accountsWithNoEntity(rowsOf(accounts)).length}
              </span>{' '}
              accounts have neither a metric nor an entity
            </p>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              They sit under no cell and in no column, so no entity view can show them. Classify
              them in the workbook — give each one an Entity, a Function and a Business — then
              paste those rows to place them. Until then they are counted here and nowhere else.
            </p>
            <ul className="mt-2 space-y-0.5">
              {accountsWithNoEntity(rowsOf(accounts)).map((account) => (
                <li key={account.id} className="text-[11px] text-foreground-secondary">
                  {account.accountName}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* The one write path into the account level: paste from the sheet,
          preview, commit. Group-only — the paste concerns the whole account
          population, and the entity views read what it writes. */}
      {isOwnerViewer && level === 'group' && loaded && (
        <AccountPasteCard
          accounts={rowsOf(accounts)}
          accountsKnown={accounts.ok}
          mapResult={accountMap}
          cells={cellRows}
          items={itemRows}
          isPending={isPending}
          onCommit={async (input) => {
            // The action resolves a sentinel because the repository call is
            // void — and run() signals failure with undefined, which a void
            // success would be indistinguishable from.
            const done = await run('Update account detail', async () => {
              await repository.applyFinishLineAccountPaste(input);
              return true;
            });
            if (done === undefined) return false;
            // Coverage and both gap counts are computed, never stored — the
            // reload re-derives them from what was just written.
            await load();
            return true;
          }}
        />
      )}

      {/* Group-only: the entity level carries its own Closes-nothing list,
          scoped by entity_tag, so repeating the global card there would be a
          second, unscoped answer to the same question. */}
      {isOwnerViewer && level === 'group' &&
        (loaded ? (
          <>
            <OrphanCard
              state={orphanCard}
              onOpenProject={(projectId) => {
                setProjectFocus({ projectId, openMilestones: true });
                setWorkView('projects');
              }}
            />

            <DanglingCard state={danglingCard} />
          </>
        ) : (
          <div className="mt-5">
            <Checking label="Milestones that close nothing" />
          </div>
        ))}

      {/* SHARING, SCOPED TO THE LEVEL BEING VIEWED. Rendered at both levels
          because the scope IS the level: on group it offers the whole Finish
          line, on an entity it offers that column and nothing else. No scope
          picker — see the note in ShareLinkCard. */}
      {isOwnerViewer && (
      <ShareLinkCard
        level={level}
        entity={activeEntity}
        links={shareLinks}
        loaded={loaded}
        isPending={isPending}
        onCreate={async (input) => {
          const created = await run('Create share link', () =>
            repository.createShareLink(input),
          );
          if (created === undefined) return false;
          setShareLinks(await repository.listShareLinks());
          return true;
        }}
        onRevoke={async (id) => {
          const done = await run('Revoke share link', () => repository.revokeShareLink(id));
          if (done === undefined) return false;
          setShareLinks(await repository.listShareLinks());
          return true;
        }}
        onExtend={async (id, ttlDays) => {
          const done = await run('Extend share link', () =>
            repository.extendShareLink(id, ttlDays),
          );
          if (done === undefined) return false;
          setShareLinks(await repository.listShareLinks());
          return true;
        }}
      />
      )}

      {/* Collaborator provisioning — owner only, group level, live database
          only: the panel drives an Edge Function, which the mock has no
          equivalent of. Entity chips come from the same read as the matrix. */}
      {isOwnerViewer && level === 'group' && isSupabaseConfigured && loaded && (
        <CollaboratorCard entities={entityRows} />
      )}
    </>
  );
}

// Checking and CouldNotCheck moved to finishLineUi.tsx — shared with the
// per-entity level, same one-copy reasoning as the resolution styles.

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
  accountsByCellId,
  accountsKnown,
  onToggleCell,
  onToggleRow,
  renderPanel,
}: {
  row: MatrixRow;
  columns: number;
  filter: MatrixFilter;
  cellFocus: ReadonlySet<string> | null;
  openCellId: string | null;
  openRowId: string | null;
  /** Accounts per cell, so a cell knows whether anything sits behind it. */
  accountsByCellId: Map<string, FinishLineAccount[]>;
  /** False before the account read returns — an empty map is then not a zero. */
  accountsKnown: boolean;
  onToggleCell: (id: string) => void;
  onToggleRow: (id: string) => void;
  /**
   * The open cell's panel, built by the parent where the linking props live
   * and placed HERE, in the table, directly beneath this row. Passing the node
   * rather than eight props keeps the panel's dependencies out of the matrix.
   */
  renderPanel: (cell: FinishLineCell) => ReactNode;
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

  // Which of this row's five cells, if any, is the open one. The panel is
  // placed under the row it belongs to, so only that row renders it.
  const openSlot = row.cells.find((slot) => slot.cell && slot.cell.id === openCellId);

  return (
    <Fragment>
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
        const cellAccounts = slot.cell ? (accountsByCellId.get(slot.cell.id) ?? []) : [];
        /**
         * A NIL WITH NOTHING BEHIND IT HAS NOTHING TO OPEN — the state is the
         * whole story, so it gets no click target. A nil WITH accounts is a
         * different case entirely and stays open: such cells hold a substantial
         * share of the mapped account population, and making them inert would
         * put every one of those accounts out of reach. Before the read
         * returns `accountsKnown` is false and nothing is disabled — an
         * unloaded list is not proof of zero.
         */
        const nothingBehind =
          accountsKnown && slot.cell?.state === 'zero' && cellAccounts.length === 0;
        const isOpen = Boolean(slot.cell && slot.cell.id === openCellId);
        return (
          <td
            key={slot.entity.code}
            className={cn('p-0 text-right', item.style === 'tot' && 'border-y border-border')}
          >
            <button
              type="button"
              disabled={!slot.cell || nothingBehind}
              onClick={() => slot.cell && onToggleCell(slot.cell.id)}
              aria-expanded={slot.cell && !nothingBehind ? isOpen : undefined}
              aria-label={`${item.item}, ${slot.entity.label}${resolution ? `, ${RESOLUTION_LABEL[resolution]}` : ''}`}
              /* The tooltip keeps the state sentence for the matrix, where no
                 panel is open. Same map the panel reads — see STATE_SENTENCE. */
              title={
                slot.cell
                  ? [
                      STATE_SENTENCE[slot.cell.state],
                      resolution && RESOLUTION_LABEL[resolution],
                      slot.cell.actorKind === 'contributor' &&
                        'Diisi kontributor — belum disentuh pemilik',
                    ]
                      .filter(Boolean)
                      .join('\n')
                  : undefined
              }
              className={cn(
                'min-h-11 w-full px-3 py-1.5 text-right tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                resolution && RESOLUTION_STYLE[resolution],
                slot.cell && !nothingBehind && 'hover:bg-surface-3',
                /* WHICH of the five is open has to be answerable at a glance —
                   tinted in the cell's own state hue, so the mark on the cell
                   and the tint on the panel's sentence read as one fact. */
                isOpen && slot.cell && STATE_TONE[slot.cell.state].cell,
                slot.cell?.note && 'underline decoration-dotted underline-offset-4',
                dimmed && 'opacity-30',
              )}
            >
              {/* No record at all is a DATA GAP, not a state — it must not read
                  as empty-by-design. */}
              {/* THE SUBMISSION DOT: a contributor wrote this cell and the
                  owner has not touched it since. Its own hue (primary), so it
                  survives every wash the resolutions apply — distinct, not
                  decorative. Cleared automatically: any owner write resets
                  actor_kind. */}
              {slot.cell?.actorKind === 'contributor' && (
                <span className="mr-0.5 text-primary" aria-hidden="true">
                  •
                </span>
              )}
              {slot.cell ? STATE_GLYPH[state as CellState] : '?'}
            </button>
          </td>
        );
      })}
    </tr>

    {/* THE PANEL, IN PLACE. Directly beneath the row it belongs to and
        spanning the table — not a modal, not a drawer, not a route. One at a
        time: `openCellId` holds a single id, so clicking a different cell
        moves the panel rather than opening a second one. */}
    {openSlot?.cell && (
      <tr>
        <td colSpan={columns + 1} className="p-0">
          {/* The matrix scrolls sideways at 640px minimum; the panel must not.
              Sticky to the scroller's left edge and never wider than the
              viewport, so a phone reads the panel by scrolling DOWN only —
              half the reason a tooltip was not good enough for the state
              sentence in the first place. On a wide screen the min() picks the
              table width and this is a no-op. */}
          <div className="sticky left-0 w-[min(100%,calc(100vw-2rem))]">
            {renderPanel(openSlot.cell)}
          </div>
        </td>
      </tr>
    )}
    </Fragment>
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
  canLink,
  isPending,
  closing,
  onOpenStep,
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
  /** False when a read behind the edges failed — see the caller. */
  canLink: boolean;
  isPending: boolean;
  /**
   * §5 "Kondisi tutup dari proses": every need of every step that feeds this
   * row, grouped BELUM → SEBAGIAN → ADA. PURELY READ — this block never
   * writes a cell state; a row whose needs are all ADA still waits for its
   * human edit, a decision that is locked. null = the block does not mount.
   */
  closing: ClosingConditions | null;
  onOpenStep: (stepLabel: string) => void;
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
            ) : canLink ? (
              <div className="mt-3 flex justify-end">
                {/* SECONDARY, deliberately. This is the inverse of the primary
                    authoring path and must not be the page's filled button. */}
                <Button variant="secondary" onClick={() => setPicking(true)}>
                  Link milestones to this cell
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-foreground-muted">
                Linking is closed while the pack cannot be read — the list above may be
                incomplete, and saving over it would delete links nobody can see.
              </p>
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

        {/* Below the milestone section: cells whose row is fed by at least
            one step OF THE CELL'S ENTITY (the caller passes null otherwise).
            Read-only by construction: nothing here can reach a cell state. */}
        {closing && (
          <div className="mt-3 border-t border-border-subtle pt-3">
            <p className="surface-label">Kondisi tutup dari proses</p>
            <p className="mt-1 text-xs tabular-nums text-foreground-muted">
              {closing.stepCount} step penyuap ·{' '}
              <span className="font-semibold text-destructive">{closing.counts.BELUM}</span> belum
              ada · <span className="font-semibold text-escalate">{closing.counts.SEBAGIAN}</span>{' '}
              sebagian · <span className="font-semibold text-success">{closing.counts.ADA}</span>{' '}
              ada
            </p>
            {closing.groups.map((group) => (
              <div key={group.status} className="mt-2">
                <NeedStatusChip status={group.status} />
                <ul className="mt-1 divide-y divide-border-subtle">
                  {group.rows.map(({ need, stepLabel }) => (
                    <li
                      key={need.id}
                      className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-0.5 py-1"
                    >
                      <span className="min-w-0 flex-1 text-xs leading-5 text-foreground">
                        {need.item}
                      </span>
                      {need.owner && (
                        <span className="shrink-0 text-[11px] text-foreground-muted">
                          {need.owner}
                        </span>
                      )}
                      {need.requestedOn && (
                        <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">
                          diminta {need.requestedOn}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenStep(stepLabel)}
                        className="shrink-0 rounded-sm text-xs font-semibold tabular-nums text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Buka step ${stepLabel} di swimlane`}
                      >
                        #{stepLabel}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
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
