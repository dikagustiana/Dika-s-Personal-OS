import { ChevronRight, Flag } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import type {
  CellState,
  FinishLineCell,
  FinishLineEntity,
  FinishLineItem,
  Project,
} from '../../data/types';
import { cn } from '../../lib/utils';
import {
  ancestorPath,
  buildMatrix,
  linksForCell,
  STATE_GLYPH,
  summarizeMatrix,
  type MatrixRow,
} from '../../logic/finishLine';
import { useAppStore } from '../../store/appStore';

/**
 * THE PACK AS A MATRIX — line items down, consolidation entities across.
 *
 * The grain is the CELL: one (line item x entity) pair, carrying a STATE and
 * never a value. THE NUMBERS NEVER ENTER THE APP — they live in the Excel
 * pack, and a cell that holds one renders as the literal `xxx`. That is the
 * point of the marker: this is a coverage map, not a report. There is no
 * importer, no paste path and no value field anywhere in this feature.
 *
 * `figure` means A NUMBER EXISTS. Not verified, not agreed, not trusted —
 * nothing in this view may suggest otherwise.
 *
 * The structure is seeded from the workbook by migration 20260726000022. This
 * view renders and annotates it and never invents a line.
 */

/**
 * How each state renders.
 *
 * `zero` and `locked` MUST stay visually distinct — they rendered identically
 * once, which made "reported nil" and "waiting on its inputs" look like the
 * same fact. The glyphs live in the logic module for the same reason.
 *
 * Nothing here is green: green means done in this app, and no cell state means
 * done. `input` takes the amber warn token, which is the one actionable state.
 */
const CELL_STYLE: Record<CellState, string> = {
  figure: 'text-foreground-secondary',
  zero: 'text-foreground-muted',
  undefined: 'bg-surface-3',
  input: 'bg-escalate/15',
  locked: 'text-foreground-muted',
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

  const [items, setItems] = useState<FinishLineItem[]>([]);
  const [cells, setCells] = useState<FinishLineCell[]>([]);
  const [entities, setEntities] = useState<FinishLineEntity[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  /** The one open explanation: a cell, or a row label. */
  const [openCell, setOpenCell] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [loadedItems, loadedCells, loadedEntities, loadedProjects] = await Promise.all([
        repository.listFinishLineItems(),
        repository.listFinishLineCells(),
        repository.listFinishLineEntities(),
        repository.listProjects('work'),
      ]);
      setItems(loadedItems);
      setCells(loadedCells);
      setEntities(loadedEntities);
      setProjects(loadedProjects);
      setLoadError(null);
    } catch (error) {
      // "No structure" and "could not read the structure" are different
      // statements, and the second must not masquerade as the first.
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoaded(true);
    }
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  const matrix = useMemo(
    () => buildMatrix(items, cells, entities),
    [items, cells, entities],
  );
  const summary = useMemo(() => summarizeMatrix(matrix), [matrix]);
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  // The cross-view handoff: a project card's "Makes trustworthy" row lands
  // here, now repointed at the cell. Expand the section, open the explanation,
  // then scroll once it is in the DOM.
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
      setOpenCell(`${target.id}:${finishLineFocus.entityCode}`);
    } else {
      setOpenRow(target.id);
    }
    setScrollTarget(target.id);
    setFinishLineFocus(null);
  }, [finishLineFocus, items, setFinishLineFocus]);

  useEffect(() => {
    if (!scrollTarget) return;
    // scroll-margin on the row handles the sticky header offset; 'auto' rather
    // than 'smooth' so the reduced-motion block in CSS stays in charge.
    document
      .getElementById(`finish-line-${scrollTarget}`)
      ?.scrollIntoView({ behavior: 'auto', block: 'start' });
    setScrollTarget(null);
  }, [scrollTarget]);

  const openProject = (projectId: string) => {
    setProjectFocus({ projectId, openMilestones: true });
    setWorkView('projects');
  };

  const isOpen = (sectionId: string, fallback: boolean) =>
    openSections[sectionId] ?? fallback;

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">Work / Finish line</p>
        <h1 className="page-title">The pack, entity by entity</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
          Line items down, consolidation entities across. Every cell carries a state, never a
          value — the figures live in the workbook, and a cell that has one reads{' '}
          <span className="tabular-nums">xxx</span>. A figure existing does not mean it has
          been checked.
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

      {loadError && (
        <Card className="mb-5 border-destructive">
          <CardContent className="pt-5">
            <EmptyRow
              label="Matrix"
              clause={`Could not be read — ${loadError}`}
              action="Retry"
              onAction={() => void load()}
            />
          </CardContent>
        </Card>
      )}

      {loaded && !loadError && matrix.length === 0 && (
        <Card>
          <CardContent className="pt-5">
            <EmptyRow
              label="Matrix"
              clause="Nothing seeded — the pack structure lives in the database"
            />
          </CardContent>
        </Card>
      )}

      {matrix.length > 0 && (
        <Card className="overflow-hidden">
          {/* Horizontal scroll on the body; the label column is sticky left and
              the header row sticky top, so a wide entity set stays readable. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-card">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[220px] bg-card px-4 py-3 text-left">
                    <span className="surface-label">Line item</span>
                  </th>
                  {entities.map((entity) => (
                    <th
                      key={entity.code}
                      className="min-w-[84px] bg-card px-3 py-3 text-right"
                      scope="col"
                    >
                      <span className="surface-label">{entity.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>

              {matrix.map((section) => {
                const open = isOpen(section.section.id, section.defaultOpen);
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
                            setOpenSections((current) => ({
                              ...current,
                              [section.section.id]: !open,
                            }))
                          }
                          className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {/* transition-transform stays: the rotation is what
                              confirms the click landed when many rows appear
                              at once. */}
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
                          openCell={openCell}
                          openRow={openRow}
                          onToggleCell={(key) =>
                            setOpenCell((current) => (current === key ? null : key))
                          }
                          onToggleRow={(id) =>
                            setOpenRow((current) => (current === id ? null : id))
                          }
                          projectsById={projectsById}
                          onOpenProject={openProject}
                        />
                      ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        </Card>
      )}

      {matrix.length > 0 && (
        <p className="mt-4 text-xs tabular-nums text-foreground-muted">
          {summary.totalCells} cells · {summary.figure} with a figure in Excel ·{' '}
          {summary.input} awaiting an input · {summary.locked} locked
          {summary.missing > 0 && ` · ${summary.missing} with no cell recorded`}
        </p>
      )}
    </div>
  );
}

interface RowProps {
  row: MatrixRow;
  columns: number;
  openCell: string | null;
  openRow: string | null;
  onToggleCell: (key: string) => void;
  onToggleRow: (id: string) => void;
  projectsById: Map<string, Project>;
  onOpenProject: (projectId: string) => void;
}

function Row({
  row,
  columns,
  openCell,
  openRow,
  onToggleCell,
  onToggleRow,
  projectsById,
  onOpenProject,
}: RowProps) {
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

  const expandedKey = row.cells.find(
    (slot) => openCell === `${item.id}:${slot.entity.code}`,
  );

  return (
    <>
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
            aria-expanded={openRow === item.id}
            className={cn(
              'flex min-h-11 w-full items-center gap-1.5 py-1.5 pr-3 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              ROW_STYLE[item.style ?? 'plain'],
            )}
          >
            <span className="min-w-0 flex-1 truncate">{item.item}</span>
            {item.flag && (
              // The anomaly marker. Amber, never red: a credit balance in an
              // expense account is a thing to look at, not a failure.
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
          const key = `${item.id}:${slot.entity.code}`;
          const state = slot.cell?.state;
          return (
            <td
              key={slot.entity.code}
              className={cn(
                'p-0 text-right',
                item.style === 'tot' && 'border-y border-border',
                state && CELL_STYLE[state],
              )}
            >
              <button
                type="button"
                onClick={() => onToggleCell(key)}
                aria-expanded={openCell === key}
                aria-label={`${item.item}, ${slot.entity.label}`}
                className={cn(
                  'min-h-11 w-full px-3 py-1.5 text-right tabular-nums transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  slot.cell?.note && 'underline decoration-dotted underline-offset-4',
                )}
              >
                {/* A cell with no record at all is a data gap, not a state —
                    it must not read as "empty by design". */}
                {slot.cell ? STATE_GLYPH[slot.cell.state] : '?'}
              </button>
            </td>
          );
        })}
      </tr>

      {openRow === item.id && item.blocks && (
        <tr>
          <td colSpan={columns + 1} className="bg-surface-2 px-4 py-3 pl-8 text-xs leading-5 text-foreground-secondary">
            {item.blocks}
          </td>
        </tr>
      )}

      {expandedKey && (
        <tr>
          <td colSpan={columns + 1} className="bg-surface-2 px-4 py-3 pl-8">
            <p className="surface-label">
              {item.item} · {expandedKey.entity.label}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-foreground-secondary">
              {expandedKey.cell?.note ?? 'No note recorded for this cell.'}
            </p>
            <CellWork
              links={linksForCell(item, expandedKey.entity.code)}
              projectsById={projectsById}
              onOpenProject={onOpenProject}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function CellWork({
  links,
  projectsById,
  onOpenProject,
}: {
  links: ReturnType<typeof linksForCell>;
  projectsById: Map<string, Project>;
  onOpenProject: (projectId: string) => void;
}) {
  if (links.length === 0) {
    return <p className="mt-2 text-xs text-foreground-muted">No work is linked to this cell.</p>;
  }
  return (
    <ul className="mt-2 space-y-1">
      {links.map((link) => {
        const project = projectsById.get(link.projectId);
        const milestone = link.milestoneId
          ? project?.milestones.find((m) => m.id === link.milestoneId)
          : undefined;
        // A dangling id is NAMED, never silently dropped — a link that quietly
        // disappears is worse than one that says it is broken.
        const broken = !project || (link.milestoneId !== undefined && !milestone);
        return (
          <li key={link.id}>
            <button
              type="button"
              onClick={() => project && onOpenProject(project.id)}
              disabled={!project}
              className="flex min-h-11 w-full items-center gap-2 rounded-sm px-1 text-left text-xs transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {broken && <Flag className="size-3.5 shrink-0 text-destructive" />}
              <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                {milestone?.text ?? project?.title ?? 'Broken link — the target no longer exists'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
