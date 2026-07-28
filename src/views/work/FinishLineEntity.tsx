import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import type { CardState } from '../../data/readResult';
import type {
  CellState,
  FinishLineAccount,
  FinishLineEntity,
  FinishLineItem,
  OrphanMilestone,
  Project,
} from '../../data/types';
import { cn } from '../../lib/utils';
import {
  closesNothingForEntity,
  isGap,
  resolveEdges,
  routeForCell,
  STATE_GLYPH,
  STATE_SENTENCE,
  unplannedForEntity,
  type MatrixSection,
  type ResolveContext,
  type Resolution,
} from '../../logic/finishLine';
import {
  accountsByCell,
  accountsForEntity,
  coverageOf,
  gapCounts,
  groupUnmapped,
  latestImportedAt,
} from '../../logic/finishLineAccounts';
import { CouldNotCheck, RESOLUTION_LABEL, RESOLUTION_STYLE, ROW_STYLE } from './finishLineUi';

/**
 * ONE ENTITY'S VIEW OF THE PACK — where the pack and the work actually meet.
 *
 * The group matrix answers "what shape is the whole programme in"; this level
 * is where work gets assigned. A cell belongs to an entity, the projects are
 * entity-scoped, and "which of my work closes nothing" is an accountability
 * question that has no meaning at group level — `115 of 136` averaged three
 * situations that are not comparable (an entity mostly covered, one barely
 * started, two untouched).
 *
 * TWO COLLAPSIBLE LISTS, AND THEY ARE MIRRORS. *Unplanned* — this column's
 * gap-eligible cells with no link. *Closes nothing* — this entity's milestones
 * linked to no cell. Both DERIVED, neither stored: one link removes a row from
 * both at once, so the counts fall together and cannot contradict each other.
 * Collapsed by default; the matrix is what the view opens on.
 *
 * CELL CLICK ROUTING IS DECIDED BY THE CELL, not by a mode — see
 * logic/finishLine.routeForCell. A cell with work goes to that work through
 * the same one-shot ProjectFocus handoff the dashboard's needs-action rows
 * use; a gap-eligible cell without work expands *Unplanned* and scrolls to its
 * own row IN PLACE, the same consume-and-scroll pattern the group matrix and
 * Projects.tsx already implement. No third mechanism.
 */

const FLASH_MS = 1600;

export function FinishLineEntityView({
  entity,
  matrix,
  accounts,
  context,
  itemsById,
  orphanState,
  workProjects,
  onOpenPanel,
  onOpenProject,
}: {
  entity: FinishLineEntity;
  matrix: MatrixSection[];
  /** Account-level detail, mapped and unmapped alike. */
  accounts: FinishLineAccount[];
  context: ResolveContext;
  itemsById: Map<string, FinishLineItem>;
  orphanState: CardState<OrphanMilestone>;
  /** Every WORK project — the tag census needs the whole population. */
  workProjects: Project[];
  /** Opens the shared cell panel (explanation + linking) below this view. */
  onOpenPanel: (cellId: string) => void;
  /** The app's one go-to-milestone handoff: ProjectFocus + the Projects view. */
  onOpenProject: (projectId: string) => void;
}) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [unplannedOpen, setUnplannedOpen] = useState(false);
  const [closesOpen, setClosesOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [scrollCellId, setScrollCellId] = useState<string | null>(null);
  const [flashCellId, setFlashCellId] = useState<string | null>(null);

  const unplanned = useMemo(
    () => unplannedForEntity(matrix, entity.code),
    [matrix, entity.code],
  );

  const orphanRows = orphanState.kind === 'has-data' ? orphanState.rows : [];
  const closes = useMemo(
    () => closesNothingForEntity(orphanRows, workProjects, entity.code),
    [orphanRows, workProjects, entity.code],
  );
  const untaggedCount = useMemo(
    () => workProjects.filter((project) => !project.entityTag).length,
    [workProjects],
  );

  // --- the account level ----------------------------------------------------
  // Scoped by the entity code carried in the data, never by position in a list
  // of five: a sixth entity added to os_finish_line_entities flows through here
  // with no change.
  const entityAccounts = useMemo(
    () => accountsForEntity(accounts, entity.code, [...context.cellsById.values()]),
    [accounts, entity.code, context.cellsById],
  );
  const accountsForCell = useMemo(() => accountsByCell(entityAccounts), [entityAccounts]);
  const unmappedGroups = useMemo(() => groupUnmapped(entityAccounts), [entityAccounts]);

  /**
   * The two gap counts, carried in one object that has no total. `gapCounts`
   * refuses to produce a combined figure; this is only where they are read.
   */
  const gaps = useMemo(
    () => gapCounts(entityAccounts, unplanned.length),
    [entityAccounts, unplanned.length],
  );

  const importedLabel = useMemo(() => {
    const stamp = latestImportedAt(entityAccounts);
    return stamp ? format(parseISO(stamp), 'd MMM') : undefined;
  }, [entityAccounts]);

  const [unmappedOpen, setUnmappedOpen] = useState(false);

  // The unplanned row must exist in the DOM before it can be scrolled to, so
  // the target is consumed one render after the list opens — the same
  // consume-and-clear shape as the group matrix's scrollTarget.
  useEffect(() => {
    if (!scrollCellId) return;
    document
      .getElementById(`fl-unplanned-${entity.code}-${scrollCellId}`)
      ?.scrollIntoView({ behavior: 'auto', block: 'center' });
    setFlashCellId(scrollCellId);
    setScrollCellId(null);
    const timer = window.setTimeout(() => setFlashCellId(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [scrollCellId, entity.code]);

  const clickCell = (cellId: string) => {
    const cell = context.cellsById.get(cellId);
    if (!cell) return;
    const resolved = resolveEdges(
      context.edgesByCell.get(cellId) ?? [],
      context.projectsById,
    );
    const route = routeForCell(cell, resolved);
    if (route.kind === 'milestone') {
      onOpenProject(route.projectId);
    } else if (route.kind === 'unplanned') {
      setUnplannedOpen(true);
      setScrollCellId(cellId);
    } else {
      onOpenPanel(cellId);
    }
  };

  return (
    <div>
      {/* The header states both counts side by side because they are the two
          halves of one fact: cells with no work, and work closing no cell. */}
      <div className="mb-3 rounded-lg border border-border-subtle bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm font-semibold text-foreground">{entity.label}</p>
          <p className="text-xs tabular-nums text-foreground-muted">
            Unplanned {unplanned.length} · Closes nothing{' '}
            {closes.tagged.length === 0 || orphanState.kind === 'could-not-check'
              ? '—'
              : closes.count}
          </p>
        </div>

        {/* ================================================================
            THE TWO GAPS, SIDE BY SIDE AND NEVER ADDED.

            They are different problems needing different actions: an account
            with no driver has not been DESIGNED and the owner has to think
            about it; a cell with no milestone IS designed and has not been
            ASSIGNED, which is a conversation. Before the account level
            existed the app could only show the second, so both looked like
            one problem. There is deliberately no combined figure anywhere —
            a single number here would hide the only distinction that matters.
            ================================================================ */}
        {entityAccounts.length > 0 && (
          <dl className="mt-3 grid gap-2 border-t border-border-subtle pt-3 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-semibold text-foreground-secondary">
                <span className="tabular-nums">{gaps.undesignedAccounts}</span> accounts have no
                driver
              </dt>
              <dd className="text-[11px] text-foreground-muted">
                Not yet designed — needs thinking through
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold text-foreground-secondary">
                <span className="tabular-nums">{gaps.unassignedCells}</span> cells have no milestone
              </dt>
              <dd className="text-[11px] text-foreground-muted">
                Designed, not assigned — needs delegating
              </dd>
            </div>
          </dl>
        )}

        {/* The honesty field: a stale import that looks live is worse than no
            import at all. */}
        {importedLabel && (
          <p className="mt-2 text-[11px] text-foreground-muted">
            Account detail imported {importedLabel}. Driver, owner and target state are maintained in
            the consolidation workbook and are read-only here.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The column — 47 line items, one entity, grouped by the five stored  */}
      {/* sections in their sort_order. Value cells render the literal `xxx`; */}
      {/* the figures live in the workbook, this map holds trust state.       */}
      {/* ------------------------------------------------------------------ */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-sm">
            <thead className="sticky top-0 z-20 bg-card">
              <tr>
                <th className="min-w-[220px] bg-card px-4 py-3 text-left">
                  <span className="surface-label">Line item</span>
                </th>
                <th scope="col" className="min-w-[84px] bg-card px-3 py-3 text-right">
                  <span className="surface-label">{entity.label}</span>
                </th>
              </tr>
            </thead>

            {matrix.map((section) => {
              // Open when THIS column holds a gap in the section — the group
              // matrix's defaultOpen answers the same question for all five
              // columns at once, which is the wrong grain here.
              const hasGap = section.rows.some((row) => {
                const slot = row.cells.find((s) => s.entity.code === entity.code);
                return slot?.resolution !== undefined && isGap(slot.resolution);
              });
              const open = openSections[section.section.id] ?? hasGap;
              return (
                <tbody key={section.section.id}>
                  <tr>
                    <th
                      colSpan={2}
                      scope="colgroup"
                      className="border-y border-border-subtle bg-surface-2 p-0 text-left"
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() =>
                          setOpenSections((c) => ({ ...c, [section.section.id]: !open }))
                        }
                        className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
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
                    section.rows.map((row) => {
                      if (row.item.kind === 'note') {
                        return (
                          <tr key={row.item.id}>
                            <td
                              colSpan={2}
                              className="px-4 py-2 pl-8 text-xs italic text-foreground-muted"
                            >
                              {row.item.item}
                            </td>
                          </tr>
                        );
                      }
                      const slot = row.cells.find((s) => s.entity.code === entity.code);
                      const state: CellState | undefined = slot?.cell?.state;
                      const resolution: Resolution | undefined = slot?.resolution;
                      const cellAccounts = slot?.cell
                        ? (accountsForCell.get(slot.cell.id) ?? [])
                        : [];
                      const coverage = slot?.cell ? coverageOf(cellAccounts) : undefined;
                      return (
                        <tr key={row.item.id} className="hover:bg-surface-2">
                          <th
                            scope="row"
                            className={cn(
                              'p-0 text-left font-normal',
                              row.item.style === 'tot' && 'border-y border-border',
                            )}
                          >
                            <span
                              className={cn(
                                'flex min-h-11 w-full items-center gap-1.5 py-1.5 pr-3 text-left',
                                ROW_STYLE[row.item.style ?? 'plain'],
                              )}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{row.item.item}</span>
                                {/* ACCOUNT COVERAGE — A COUNT, NOT A DOOR.
                                    Never aggregated into a single cell-level
                                    driver: one metric-entity pair can carry
                                    dozens of accounts with different drivers,
                                    and a lone "driver" field here would let the
                                    cell claim one it does not have.

                                    This line USED to open the account detail,
                                    and that was the mistake. Detail hangs off
                                    the CELL now — the group matrix's `xxx` — so
                                    that state, driver, owner and accounts are
                                    all read against one named entity instead of
                                    a row silently picking one. The summary
                                    stays because it is a true aggregate; it is
                                    simply no longer a second way in. */}
                                {coverage && coverage.total > 0 && (
                                  <span className="mt-0.5 block text-[10px] tabular-nums text-foreground-muted">
                                    {coverage.total} accounts · {coverage.withDriver} with a driver ·{' '}
                                    {coverage.withoutDriver} without
                                    {/* Dummy is reported BESIDE driver coverage,
                                        never folded into it: a cell can be
                                        fully driver-complete and still
                                        untrustworthy because the drivers
                                        describe placeholders. */}
                                    {coverage.dummy > 0 && (
                                      <span className="text-escalate"> · {coverage.dummy} dummy</span>
                                    )}
                                  </span>
                                )}
                              </span>
                              {row.item.flag && (
                                <span
                                  className="shrink-0 text-escalate"
                                  title={row.item.flag}
                                  aria-label={row.item.flag}
                                >
                                  ⚑
                                </span>
                              )}
                              {row.item.unit && (
                                <span className="shrink-0 text-[10px] tracking-[0.06em] text-foreground-muted">
                                  {row.item.unit}
                                </span>
                              )}
                            </span>
                          </th>
                          <td
                            className={cn(
                              'p-0 text-right',
                              row.item.style === 'tot' && 'border-y border-border',
                            )}
                          >
                            <button
                              type="button"
                              disabled={!slot?.cell}
                              onClick={() => slot?.cell && clickCell(slot.cell.id)}
                              aria-label={`${row.item.item}, ${entity.label}${resolution ? `, ${RESOLUTION_LABEL[resolution]}` : ''}`}
                              /* Same STATE_SENTENCE map the cell panel reads —
                                 one definition, so the two cannot drift. */
                              title={
                                slot?.cell
                                  ? [
                                      STATE_SENTENCE[slot.cell.state],
                                      resolution && RESOLUTION_LABEL[resolution],
                                    ]
                                      .filter(Boolean)
                                      .join('\n')
                                  : undefined
                              }
                              className={cn(
                                'min-h-11 w-full px-3 py-1.5 text-right tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                                resolution && RESOLUTION_STYLE[resolution],
                                slot?.cell && 'hover:bg-surface-3',
                                slot?.cell?.note && 'underline decoration-dotted underline-offset-4',
                              )}
                            >
                              {slot?.cell ? STATE_GLYPH[state as CellState] : '?'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              );
            })}
          </table>
        </div>
      </Card>

      {/* ================================================================== */}
      {/* UNMAPPED ACCOUNTS — surfaced, never dropped.                        */}
      {/*                                                                     */}
      {/* An account whose Function x Business matches no metric has no cell   */}
      {/* to sit under. Discarding it would understate the account population  */}
      {/* behind every cell and make coverage look better than it is. So it is */}
      {/* stored with a null cell and rendered here, grouped by the pair that  */}
      {/* failed to match — because the action is "add a mapping", not "fix    */}
      {/* eighty-four accounts".                                              */}
      {/*                                                                     */}
      {/* This list is itself a finding: functions below operating income have */}
      {/* no metric in the current matrix, so it says what the pack does not   */}
      {/* yet cover.                                                          */}
      {/* ================================================================== */}
      {unmappedGroups.length > 0 && (
        <Card className="mt-5">
          <CardContent className="pt-4">
            <button
              type="button"
              onClick={() => setUnmappedOpen((open) => !open)}
              aria-expanded={unmappedOpen}
              className="flex w-full items-baseline gap-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1 font-semibold text-foreground">
                Accounts with no metric
              </span>
              <span className="shrink-0 tabular-nums text-foreground-muted">
                {unmappedGroups.reduce((sum, group) => sum + group.count, 0)}
              </span>
            </button>
            <p className="mt-1 text-[11px] text-foreground-muted">
              Their Function × Business pair maps to no metric in this pack. Not counted in any
              cell&rsquo;s coverage, and not discarded.
            </p>
            {unmappedOpen && (
              <ul className="mt-2 divide-y divide-border-subtle">
                {unmappedGroups.map((group) => (
                  <li
                    key={`${group.function}-${group.business}`}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2"
                  >
                    <span className="min-w-0 flex-1 text-xs text-foreground">
                      {group.function}
                      <span className="text-foreground-muted"> × {group.business}</span>
                    </span>
                    {group.entities.length > 0 && (
                      <span className="shrink-0 text-[10px] text-foreground-muted">
                        {group.entities.join(', ')}
                      </span>
                    )}
                    <span className="shrink-0 text-xs tabular-nums text-foreground-secondary">
                      {group.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Unplanned — this column's gap-eligible cells with nothing behind    */}
      {/* them. Each row opens the cell panel, where the linking lives.       */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mt-5">
        <CardContent className="pt-4">
          <button
            type="button"
            aria-expanded={unplannedOpen}
            onClick={() => setUnplannedOpen((current) => !current)}
            className="flex min-h-11 w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn(
                'size-4 shrink-0 text-foreground-muted transition-transform duration-150',
                unplannedOpen && 'rotate-90',
              )}
            />
            <span className="min-w-0 flex-1 font-semibold text-foreground">Unplanned</span>
            <span className="shrink-0 text-sm tabular-nums text-foreground-muted">
              {unplanned.length}
            </span>
          </button>

          {unplannedOpen &&
            (unplanned.length === 0 ? (
              <div className="mt-2">
                <EmptyRow
                  label="Unplanned"
                  clause={`Every ${entity.code} cell that needs work has some behind it`}
                />
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-border-subtle">
                {unplanned.map((gap) => {
                  const section = gap.item.parentId
                    ? itemsById.get(gap.item.parentId)
                    : undefined;
                  const broken = resolveEdges(
                    context.edgesByCell.get(gap.cell.id) ?? [],
                    context.projectsById,
                  ).filter((r) => r.broken);
                  return (
                    <li
                      key={gap.cell.id}
                      id={`fl-unplanned-${entity.code}-${gap.cell.id}`}
                      className={cn(
                        'scroll-mt-24',
                        flashCellId === gap.cell.id && 'ring-2 ring-inset ring-ring',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenPanel(gap.cell.id)}
                        className="flex min-h-11 w-full items-center gap-3 py-1.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-foreground-secondary">
                            {gap.item.item}
                          </span>
                          {section && (
                            <span className="block truncate text-[11px] text-foreground-muted">
                              {section.item}
                            </span>
                          )}
                        </span>
                        {/* A link whose milestone was deleted is NAMED here,
                            never filtered out: dropped silently, this cell
                            would look unowned when it is not — or owned after
                            the milestone that would close it was deleted. */}
                        {broken.length > 0 && (
                          <span className="shrink-0 rounded-sm border border-destructive px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-destructive">
                            {broken.length} broken link{broken.length === 1 ? '' : 's'}
                          </span>
                        )}
                        <span
                          className={cn(
                            'grid size-6 shrink-0 place-items-center rounded-sm text-[9px] tabular-nums',
                            RESOLUTION_STYLE.unplanned,
                          )}
                          title={
                            gap.cell.state === 'figure'
                              ? 'A number exists; nothing stands behind it'
                              : 'The number does not exist yet'
                          }
                        >
                          {STATE_GLYPH[gap.cell.state]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ))}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Closes nothing — this entity's milestones linked to no cell. The    */}
      {/* mirror of Unplanned: one link removes a row from both at once.      */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mt-5">
        <CardContent className="pt-4">
          <button
            type="button"
            aria-expanded={closesOpen}
            onClick={() => setClosesOpen((current) => !current)}
            className="flex min-h-11 w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn(
                'size-4 shrink-0 text-foreground-muted transition-transform duration-150',
                closesOpen && 'rotate-90',
              )}
            />
            <span className="min-w-0 flex-1 font-semibold text-foreground">Closes nothing</span>
            <span className="shrink-0 text-sm tabular-nums text-foreground-muted">
              {closes.tagged.length === 0 || orphanState.kind === 'could-not-check'
                ? '—'
                : closes.count}
            </span>
          </button>

          {closesOpen &&
            (orphanState.kind === 'could-not-check' ? (
              <div className="mt-2">
                <CouldNotCheck label="Closes nothing" failure={orphanState} />
              </div>
            ) : closes.tagged.length === 0 ? (
              /* NOT an empty state. A false zero here is the worst available
                 outcome: it would report perfect coverage on an entity with
                 dozens of unplanned cells. Attribution needs entity_tag on the
                 project, and tagging is the owner's call — `KNI · KDU` spans
                 two entities and `SAMB (parent)` may be SAMB or group-wide, so
                 nothing here guesses from titles. */
              <p className="mt-2 border-l-2 border-escalate py-2 pl-3 text-xs leading-5 text-foreground-secondary">
                No projects are tagged {entity.code}, so nothing can be attributed here — this
                is a tagging gap, not a clean bill. {untaggedCount} WORK project
                {untaggedCount === 1 ? ' carries' : 's carry'} no entity tag; tagging them is an
                owner decision made on the project itself.
              </p>
            ) : closes.count === 0 ? (
              <div className="mt-2">
                <EmptyRow
                  label="Closes nothing"
                  clause={`Every milestone in the ${closes.tagged.length} project${closes.tagged.length === 1 ? '' : 's'} tagged ${entity.code} closes some cell, and the read succeeded`}
                />
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-border-subtle">
                {closes.groups.map((group) => {
                  const isOpen = openGroups[group.projectId] ?? false;
                  return (
                    <li key={group.projectId}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() =>
                          setOpenGroups((current) => ({ ...current, [group.projectId]: !isOpen }))
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
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
