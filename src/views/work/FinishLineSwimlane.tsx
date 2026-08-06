/**
 * The Finish line's Swimlane tab (/finish-line/swimlane): the SAMB
 * operational chain. Read-only — no add/remove/move step, no lane edit, no
 * drag; the structure changes often and is revised OUTSIDE the app. The one
 * writable field anywhere in the feature is a need's requested_on, edited in
 * the detail panel.
 *
 * THE SILENT FAILURE THIS FILE GUARDS AGAINST (§6.6): if measurement fails,
 * nothing throws — the arrows just vanish and the swimlane degrades into a
 * grid of boxes that LOOKS fine. Hence: boxes are measured with
 * offsetLeft/offsetTop RELATIVE TO THE GRID, which requires that no cell and
 * no box carries any `position` (z-index works on grid/flex items without
 * it); a measurement pass whose scrollWidth is 0 or whose boxes all sit at
 * offsetLeft 0 is retried once on the next frame and then surfaces a
 * VISIBLE warning row instead of quietly rendering no arrows.
 */
import { TriangleAlert, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { Input } from '../../components/ui/Input';
import { okRows, rowsOf, type ReadResult } from '../../data/readResult';
import type {
  FinishLineItem,
  ProcessGate,
  ProcessLane,
  ProcessNeed,
  ProcessPhase,
  ProcessStep,
  ProcessStepItem,
} from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import { cn } from '../../lib/utils';
import {
  deriveEdges,
  duplicateChainSlots,
  groupCells,
  maxSlot,
  phaseCoverageProblems,
  processStats,
  visibleSteps,
} from '../../logic/process';
import {
  buildProcessModel,
  finishLineRowsForStep,
  stepLabelsForItem,
} from '../../logic/processModel';
import {
  BOX_W,
  GAP_W,
  LABEL_W,
  computeWires,
  type BoxRect,
  type Wire,
  type WireEdge,
} from '../../logic/processWires';
import { useAppStore } from '../../store/appStore';
import { Checking, CouldNotCheck } from './finishLineUi';
import {
  GateChip,
  NeedKindChip,
  NeedStatusChip,
  TrackChip,
  TrackFilterGroup,
  filterButtonClass,
} from './processUi';

const unread = <T,>(): ReadResult<T> => ({ ok: false, reason: 'failed', detail: 'Not read yet' });

/** §4: meta.scope is not seeded — it is this view's subtitle, hardcoded. */
const SCOPE_SUBTITLE =
  'Order ke principal → collection, plus jalur SAMB sebagai penyedia jasa logistik ke klien pihak ketiga. Intake terpisah per jalur; konvergensi mulai di put-away. Retur & klaim discount belum dipetakan.';

type AttachColumn = 'docs' | 'coa' | 'drivers' | 'needs';

const ATTACH_COLUMNS: Array<{ id: AttachColumn; label: string }> = [
  { id: 'docs', label: 'Dokumen' },
  { id: 'coa', label: 'COA' },
  { id: 'drivers', label: 'Driver' },
  { id: 'needs', label: 'Kebutuhan data' },
];

const ZOOM_MIN = 0.22;
const ZOOM_MAX = 1.5;

export function FinishLineSwimlane({
  /**
   * §2's pre-filter: a Finish line row id, arriving from a cell panel. The
   * steps feeding that row are HIGHLIGHTED and the rest dimmed — never
   * removed. Dropping them would cut the arrows and the diagram would stop
   * being a flow, which is the one thing this view exists to show.
   */
  itemFilter,
  onClearItemFilter,
  onOpenMatrix,
}: {
  itemFilter?: string;
  onClearItemFilter: () => void;
  onOpenMatrix: (itemId: string) => void;
}) {
  const repository = useAppStore((state) => state.repository);
  const track = useAppStore((state) => state.prosesTrack);
  const prosesFocus = useAppStore((state) => state.prosesFocus);
  const setProsesFocus = useAppStore((state) => state.setProsesFocus);
  const { run, isPending } = useMutation();

  const [lanesRead, setLanesRead] = useState<ReadResult<ProcessLane>>(unread);
  const [phasesRead, setPhasesRead] = useState<ReadResult<ProcessPhase>>(unread);
  const [stepsRead, setStepsRead] = useState<ReadResult<ProcessStep>>(unread);
  const [gatesRead, setGatesRead] = useState<ReadResult<ProcessGate>>(unread);
  const [needsRead, setNeedsRead] = useState<ReadResult<ProcessNeed>>(unread);
  const [stepItemsRead, setStepItemsRead] = useState<ReadResult<ProcessStepItem>>(unread);
  const [itemsRead, setItemsRead] = useState<ReadResult<FinishLineItem>>(unread);
  const [loaded, setLoaded] = useState(false);

  // View state — none of it persisted (§6.8).
  const [attach, setAttach] = useState(false);
  const [showCol, setShowCol] = useState<Record<AttachColumn, boolean>>({
    docs: true,
    coa: true,
    drivers: true,
    needs: true,
  });
  const [onlyGap, setOnlyGap] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [lanes, phases, steps, gates, needs, stepItems, items] = await Promise.all([
      repository.listProcessLanes(),
      repository.listProcessPhases(),
      repository.listProcessSteps(),
      repository.listProcessGates(),
      repository.listProcessNeeds(),
      repository.listProcessStepItems(),
      repository.listFinishLineItems(),
    ]);
    setLanesRead(lanes);
    setPhasesRead(phases);
    setStepsRead(steps);
    setGatesRead(gates);
    setNeedsRead(needs);
    setStepItemsRead(stepItems);
    setItemsRead(items);
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void load().catch(() => setLoaded(true));
  }, [load]);

  const model = useMemo(
    () =>
      buildProcessModel({
        lanes: lanesRead,
        phases: phasesRead,
        steps: stepsRead,
        gates: gatesRead,
        needs: needsRead,
        stepItems: stepItemsRead,
      }),
    [lanesRead, phasesRead, stepsRead, gatesRead, needsRead, stepItemsRead],
  );

  const steps = model.kind === 'ready' ? model.steps : [];
  const needs = model.kind === 'ready' ? model.needs : [];
  const gates = model.kind === 'ready' ? model.gates : [];
  const stepItems = useMemo(() => (model.kind === 'ready' ? model.stepItems : []), [model]);
  const lanes = useMemo(
    () =>
      model.kind === 'ready' ? [...model.lanes].sort((a, b) => a.ordinal - b.ordinal) : [],
    [model],
  );
  const phases = model.kind === 'ready' ? model.phases : [];

  const shown = useMemo(() => visibleSteps(steps, track), [steps, track]);
  const cells = useMemo(() => groupCells(shown), [shown]);
  const highestSlot = useMemo(() => maxSlot(steps), [steps]);
  const stats = useMemo(() => processStats(steps, needs, track), [steps, needs, track]);
  const gatesById = useMemo(() => new Map(gates.map((gate) => [gate.id, gate])), [gates]);
  const needsByStep = useMemo(() => {
    const grouped = new Map<string, ProcessNeed[]>();
    for (const need of needs) {
      const group = grouped.get(need.stepId);
      if (group) group.push(need);
      else grouped.set(need.stepId, [need]);
    }
    return grouped;
  }, [needs]);

  // The pre-filter (§2). Highlighting is a RENDER decision only: `shown`
  // above is untouched, so the arrow set, the cell grouping and the stats
  // line are all identical with and without a filter — only the boxes not
  // feeding this row are dimmed.
  const highlighted = useMemo(
    () => (itemFilter ? stepLabelsForItem(itemFilter, stepItems, steps) : null),
    [itemFilter, stepItems, steps],
  );
  const filteredItem = useMemo(
    () => (itemFilter ? rowsOf(itemsRead).find((item) => item.id === itemFilter) : undefined),
    [itemFilter, itemsRead],
  );

  // §6.5's tripwire: a duplicated slot inside one walk means the seed is
  // broken and the order would be a guess — refuse to draw arrows, loudly.
  const brokenChains = useMemo(() => duplicateChainSlots(steps), [steps]);
  const phaseProblems = useMemo(
    () => (steps.length > 0 ? phaseCoverageProblems(phases, highestSlot) : []),
    [phases, steps.length, highestSlot],
  );

  const wireEdges: WireEdge[] = useMemo(() => {
    if (brokenChains.length > 0) return [];
    return deriveEdges(steps, track).map((edge) => ({
      fromLabel: edge.from.label,
      toLabel: edge.to.label,
      cross: edge.cross,
    }));
  }, [steps, track, brokenChains]);

  // --- measurement (§6.6) ---------------------------------------------------
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const retryRef = useRef(0);
  const [geometry, setGeometry] = useState<{
    wires: Wire[];
    width: number;
    height: number;
  } | null>(null);
  const [drawFailed, setDrawFailed] = useState(false);

  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const width = grid.scrollWidth;
    const height = grid.scrollHeight;
    const boxes = grid.querySelectorAll<HTMLElement>('[data-step-label]');
    const rects = new Map<string, BoxRect>();
    let allAtZero = boxes.length > 0;
    boxes.forEach((element) => {
      if (element.offsetLeft !== 0) allAtZero = false;
      rects.set(element.dataset.stepLabel ?? '', {
        x: element.offsetLeft,
        y: element.offsetTop,
        w: element.offsetWidth,
        h: element.offsetHeight,
      });
    });
    if (width === 0 || allAtZero) {
      // Draw nothing and retry once next frame; a second failure becomes a
      // visible warning, never a quietly arrowless diagram.
      if (retryRef.current < 1) {
        retryRef.current += 1;
        requestAnimationFrame(measure);
      } else {
        setGeometry(null);
        setDrawFailed(true);
      }
      return;
    }
    retryRef.current = 0;
    setDrawFailed(false);
    setGeometry({ wires: computeWires(wireEdges, rects), width, height });
  }, [wireEdges]);

  // After layout — never during render — and again on every input that can
  // change box sizes: filter, tempel mode, column toggles.
  useLayoutEffect(() => {
    retryRef.current = 0;
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [measure, attach, showCol, model.kind]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(grid);
    return () => observer.disconnect();
  }, [measure, model.kind]);

  // Fonts change box heights; measuring before they load lands arrows in the
  // wrong place with no error.
  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) measure();
    });
    return () => {
      active = false;
    };
  }, [measure]);

  // --- deep link from the register / Finish line panel ----------------------
  useEffect(() => {
    if (!prosesFocus || model.kind !== 'ready') return;
    const target = model.steps.find((step) => step.label === prosesFocus.stepLabel);
    if (target) {
      setSelectedLabel(target.label);
      requestAnimationFrame(() => {
        gridRef.current
          ?.querySelector(`[data-step-label="${target.label}"]`)
          ?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
      });
    }
    setProsesFocus(null);
  }, [prosesFocus, model, setProsesFocus]);

  // --- zoom (§6.7): scale the grid, compensate margins, never re-measure ----
  const applyZoomStyle = geometry
    ? {
        transform: `scale(${zoom})`,
        transformOrigin: '0 0',
        marginRight: `${geometry.width * (zoom - 1)}px`,
        marginBottom: `${geometry.height * (zoom - 1)}px`,
      }
    : undefined;

  const fitZoom = () => {
    const canvas = scrollRef.current;
    if (!canvas || !geometry) return;
    setZoom(Math.min(1, Math.max(ZOOM_MIN, (canvas.clientWidth - 44) / geometry.width)));
  };

  const toggleColumn = (column: AttachColumn) => {
    setShowCol((current) => ({ ...current, [column]: !current[column] }));
    // Turning a column on while tempel is off must turn tempel on — the
    // button would otherwise appear to do nothing (§6.8).
    if (!attach) setAttach(true);
  };

  const selectedStep = selectedLabel
    ? shown.find((step) => step.label === selectedLabel) ?? null
    : null;

  const saveRequestedOn = async (id: string, value: string) => {
    const saved = await run('Simpan tanggal diminta', () =>
      repository.setProcessNeedRequestedOn(id, value || null),
    );
    if (!saved) return;
    setNeedsRead((current) =>
      current.ok
        ? okRows(current.rows.map((need) => (need.id === saved.id ? saved : need)))
        : current,
    );
  };

  const gridTemplateColumns = `${LABEL_W}px repeat(${highestSlot}, ${BOX_W}px ${GAP_W}px)`;

  return (
    <>
      {/* meta.scope from the seed, as this tab's description under the tab
          bar. There is no <h1> here — FinishLineArea owns the only one. */}
      <p className="mb-6 max-w-2xl text-sm leading-6 text-foreground-muted">{SCOPE_SUBTITLE}</p>

      {itemFilter && (
        <div className="mb-4 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2">
          <span className="text-xs leading-5 text-foreground">
            Disorot: step yang menyuapi{' '}
            <span className="font-semibold">{filteredItem?.item ?? 'baris Finish line ini'}</span>
            {highlighted && (
              <span className="tabular-nums text-foreground-muted">
                {' '}
                · {highlighted.size} dari {steps.length} step
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onClearItemFilter}
            className="ml-auto rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Lepas sorotan
          </button>
        </div>
      )}

      {!loaded ? (
        <Checking label="Proses SAMB" />
      ) : model.kind === 'empty' ? (
        <div className="rounded-lg border border-border-subtle bg-card px-4">
          <EmptyRow
            label="Swimlane"
            clause="Kanvas belum bisa digambar — migration proses belum diterapkan."
          />
        </div>
      ) : model.kind === 'failed' ? (
        <div className="rounded-lg border border-border-subtle bg-card p-4">
          <CouldNotCheck label="Proses SAMB" failure={{ reason: 'failed', detail: model.detail }} />
        </div>
      ) : (
        <>
          <div
            className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2"
            role="group"
            aria-label="Kontrol swimlane"
          >
            <TrackFilterGroup />
            <button
              type="button"
              aria-pressed={attach}
              onClick={() => setAttach((current) => !current)}
              className={filterButtonClass(attach)}
            >
              Tempel matriks
            </button>
            <div className="flex items-center gap-1">
              <span className="surface-label mr-1">Yang ditempel</span>
              {ATTACH_COLUMNS.map((column) => (
                <button
                  key={column.id}
                  type="button"
                  aria-pressed={attach && showCol[column.id]}
                  onClick={() => toggleColumn(column.id)}
                  className={filterButtonClass(attach && showCol[column.id])}
                >
                  {column.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-pressed={onlyGap}
              onClick={() => setOnlyGap((current) => !current)}
              className={filterButtonClass(onlyGap)}
            >
              Sorot yang ada gap
            </button>
            <div className="flex items-center gap-1" role="group" aria-label="Zoom">
              <button
                type="button"
                onClick={() => setZoom((current) => Math.max(ZOOM_MIN, current - 0.1))}
                className={filterButtonClass(false)}
                aria-label="Perkecil"
              >
                −
              </button>
              <button type="button" onClick={fitZoom} className={filterButtonClass(false)}>
                pas
              </button>
              <button
                type="button"
                onClick={() => setZoom((current) => Math.min(ZOOM_MAX, current + 0.1))}
                className={filterButtonClass(false)}
                aria-label="Perbesar"
              >
                +
              </button>
            </div>
            <span className="text-xs tabular-nums text-foreground-muted">
              {stats.visible}/{stats.total} step ·{' '}
              <span className="font-semibold text-foreground">{stats.handoffCount}</span> handoff ·{' '}
              {stats.needCount} kebutuhan data ·{' '}
              <span className="font-semibold text-destructive">{stats.needBelum}</span> belum ada
            </span>
          </div>

          {brokenChains.length > 0 && (
            <p className="mb-2 flex min-h-9 items-center gap-2 text-xs font-semibold text-destructive">
              <TriangleAlert className="size-3.5 shrink-0" />
              Alur tidak dapat digambar — seed memiliki slot ganda dalam satu jalur (
              {brokenChains.map((problem) => `${problem.track} slot ${problem.slot}`).join(', ')}
              ). Urutan tidak akan ditebak; perbaiki seed-nya.
            </p>
          )}
          {phaseProblems.length > 0 && (
            <p className="mb-2 flex min-h-9 items-center gap-2 text-xs font-semibold text-destructive">
              <TriangleAlert className="size-3.5 shrink-0" />
              Pita fase tidak menutup rentang slot dengan tepat: {phaseProblems.join('; ')}.
            </p>
          )}
          {drawFailed && (
            <p className="mb-2 flex min-h-9 items-center gap-2 text-xs font-semibold text-escalate">
              <TriangleAlert className="size-3.5 shrink-0" />
              Alur tidak dapat digambar — pengukuran kanvas gagal, panah tidak ditampilkan.
            </p>
          )}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div
              ref={scrollRef}
              className="min-w-0 flex-1 overflow-auto rounded-lg border border-border bg-card pb-10 shadow-card"
            >
              <div
                ref={gridRef}
                className="relative grid items-start px-4 pt-3"
                style={{ gridTemplateColumns, ...applyZoomStyle }}
              >
                {/* Wires overlay: absolute inside the grid so it scales with
                    zoom; z-3 sits above lane bands and boxes so an arrow is
                    visible up to the box edge. */}
                {geometry && (
                  <svg
                    className="pointer-events-none absolute left-0 top-0 z-[3]"
                    style={{ overflow: 'visible' }}
                    width={geometry.width}
                    height={geometry.height}
                    aria-hidden="true"
                  >
                    <defs>
                      <marker
                        id="proses-arrow-lane"
                        viewBox="0 0 9 9"
                        refX="8"
                        refY="4.5"
                        markerWidth="8"
                        markerHeight="8"
                        orient="auto"
                      >
                        <path d="M0,1 L8,4.5 L0,8 z" className="fill-foreground-secondary" />
                      </marker>
                      <marker
                        id="proses-arrow-handoff"
                        viewBox="0 0 9 9"
                        refX="8"
                        refY="4.5"
                        markerWidth="9"
                        markerHeight="9"
                        orient="auto"
                      >
                        <path d="M0,1 L8,4.5 L0,8 z" className="fill-foreground" />
                      </marker>
                    </defs>
                    {geometry.wires.map((wire) => (
                      <g key={wire.key}>
                        <path
                          d={wire.d}
                          fill="none"
                          strokeWidth={wire.cross ? 2 : 1.5}
                          className={cn(
                            wire.cross
                              ? 'stroke-foreground'
                              : 'stroke-foreground-secondary opacity-70',
                          )}
                          markerEnd={`url(#${wire.cross ? 'proses-arrow-handoff' : 'proses-arrow-lane'})`}
                        />
                        {wire.capsule && (
                          <g>
                            <rect
                              x={wire.capsule.x - 27}
                              y={wire.capsule.y - 8}
                              width={54}
                              height={16}
                              rx={8}
                              className="fill-foreground"
                            />
                            <text
                              x={wire.capsule.x}
                              y={wire.capsule.y + 3}
                              textAnchor="middle"
                              className="fill-background text-[8px] font-bold"
                              style={{ letterSpacing: '0.13em' }}
                            >
                              HANDOFF
                            </text>
                          </g>
                        )}
                      </g>
                    ))}
                  </svg>
                )}

                {/* Phase ribbon (row 1); the top-left corner stays empty. */}
                <div style={{ gridColumn: 1, gridRow: 1 }} />
                {phases.map((phase) => (
                  <div
                    key={phase.id}
                    className="z-[2] pb-2"
                    style={{
                      gridRow: 1,
                      gridColumn: `${2 + (phase.slotFrom - 1) * 2} / ${2 + (phase.slotTo - 1) * 2 + 1}`,
                    }}
                  >
                    <div className="h-1 rounded-sm bg-foreground opacity-15" />
                    <p className="pt-1.5 text-[9px] font-bold uppercase leading-4 tracking-[0.14em] text-foreground-secondary">
                      {phase.name}
                    </p>
                  </div>
                ))}

                {lanes.map((lane, laneIndex) => {
                  const laneRow = laneIndex + 2;
                  const hasVisibleStep = shown.some((step) => step.laneKey === lane.key);
                  return (
                    <LaneRow
                      key={lane.key}
                      lane={lane}
                      laneRow={laneRow}
                      odd={laneIndex % 2 === 1}
                      dimmedLabel={!hasVisibleStep}
                      cells={cells}
                      gatesById={gatesById}
                      needsByStep={needsByStep}
                      attach={attach}
                      showCol={showCol}
                      onlyGap={onlyGap}
                      highlighted={highlighted}
                      selectedLabel={selectedLabel}
                      onSelect={(label) =>
                        setSelectedLabel((current) => (current === label ? null : label))
                      }
                    />
                  );
                })}
              </div>
            </div>

            {selectedStep && (
              <StepPanel
                step={selectedStep}
                laneLabel={
                  lanes.find((lane) => lane.key === selectedStep.laneKey)?.label ??
                  selectedStep.laneKey
                }
                needs={needsByStep.get(selectedStep.id) ?? []}
                gate={selectedStep.gateId ? gatesById.get(selectedStep.gateId) : undefined}
                finishLineRows={finishLineRowsForStep(
                  selectedStep.id,
                  stepItems,
                  rowsOf(itemsRead),
                )}
                isPending={isPending}
                onSaveRequestedOn={saveRequestedOn}
                onOpenFinishLineItem={onOpenMatrix}
                onClose={() => setSelectedLabel(null)}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

// --- lane -------------------------------------------------------------------

function LaneRow({
  lane,
  laneRow,
  odd,
  dimmedLabel,
  cells,
  gatesById,
  needsByStep,
  attach,
  showCol,
  onlyGap,
  highlighted,
  selectedLabel,
  onSelect,
}: {
  lane: ProcessLane;
  laneRow: number;
  odd: boolean;
  dimmedLabel: boolean;
  cells: Map<string, ProcessStep[]>;
  gatesById: Map<string, ProcessGate>;
  needsByStep: Map<string, ProcessNeed[]>;
  attach: boolean;
  showCol: Record<AttachColumn, boolean>;
  onlyGap: boolean;
  /** null = no pre-filter. A set = these labels stay lit, the rest dim. */
  highlighted: ReadonlySet<string> | null;
  selectedLabel: string | null;
  onSelect: (label: string) => void;
}) {
  const laneCells = [...cells.entries()].filter(([key]) => key.startsWith(`${lane.key}:`));
  return (
    <>
      {/* Band: full row, behind everything, top divider; odd lanes get a
          slightly different wash so rows stay readable far to the right. */}
      <div
        className={cn(
          'z-0 self-stretch border-t border-border-subtle',
          odd && 'bg-surface-2',
        )}
        style={{ gridColumn: '1 / -1', gridRow: laneRow }}
        aria-hidden="true"
      />
      {/* Sticky label: the diagram is far wider than the viewport, and a lane
          must stay identifiable mid-scroll. A lane with no visible step dims
          but never disappears — a vanished lane reads as "not involved". */}
      <div
        className="sticky left-0 z-[4] py-3 pr-3"
        style={{ gridColumn: 1, gridRow: laneRow }}
      >
        <div
          className={cn(
            'rounded-md border bg-card px-3 py-2.5',
            lane.isExternal
              ? 'border-dashed border-border bg-surface-3'
              : 'border-border-subtle',
            dimmedLabel && 'opacity-40',
          )}
        >
          <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.1em] text-foreground">
            {lane.label}
          </p>
          {lane.description && (
            <p className="mt-1 text-[11px] leading-4 text-foreground-muted">{lane.description}</p>
          )}
        </div>
      </div>
      {laneCells.map(([key, group]) => (
        // NO `position` ON THE CELL, EVER: the boxes inside are measured with
        // offsetLeft relative to the grid, and a positioned cell would become
        // their offsetParent — every coordinate collapses toward the top-left
        // and the arrows degrade into a small scribble. z-index works on grid
        // items without position.
        <div
          key={key}
          className="z-[2] flex flex-col gap-[11px] py-3"
          style={{
            gridRow: laneRow,
            gridColumn: 2 + (group[0].slot - 1) * 2,
          }}
        >
          {group.map((step) => (
            <StepBox
              key={step.id}
              step={step}
              gate={step.gateId ? gatesById.get(step.gateId) : undefined}
              needs={needsByStep.get(step.id) ?? []}
              attach={attach}
              showCol={showCol}
              // Two independent reasons to recede, and either is enough:
              // the gap spotlight, and the row pre-filter.
              dim={(onlyGap && !step.gateId) || (highlighted !== null && !highlighted.has(step.label))}
              selected={selectedLabel === step.label}
              onSelect={() => onSelect(step.label)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

// --- box --------------------------------------------------------------------

const COUNT_CHIP =
  'inline-flex shrink-0 items-center rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground-muted';

function StepBox({
  step,
  gate,
  needs,
  attach,
  showCol,
  dim,
  selected,
  onSelect,
}: {
  step: ProcessStep;
  gate?: ProcessGate;
  needs: ProcessNeed[];
  attach: boolean;
  showCol: Record<AttachColumn, boolean>;
  dim: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const belum = needs.filter((need) => need.status === 'BELUM').length;
  return (
    <button
      type="button"
      data-step-label={step.label}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-md border bg-card p-2.5 text-left shadow-card transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary ring-2 ring-primary/25' : 'border-border hover:border-primary',
        dim && 'opacity-30',
      )}
    >
      <span className="flex items-center gap-1.5">
        {/* Step identity pill — neutral inverse, deliberately NOT a lane
            colour: lane identity must never read as a status (§9.1). */}
        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-background">
          {step.label}
        </span>
        <TrackChip track={step.track} />
        {step.co && (
          <span className="ml-auto truncate text-[9px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
            {step.co}
          </span>
        )}
      </span>
      <span className="mt-1.5 block text-xs font-bold leading-snug text-foreground">
        {step.name}
      </span>
      {!attach ? (
        <span className="mt-2 flex flex-wrap items-center gap-1">
          {step.docs.length > 0 && <span className={COUNT_CHIP}>{step.docs.length} dok</span>}
          {step.coa.length > 0 && <span className={COUNT_CHIP}>{step.coa.length} akun</span>}
          {step.drivers.length > 0 && (
            <span className={COUNT_CHIP}>{step.drivers.length} driver</span>
          )}
          {needs.length > 0 && <span className={COUNT_CHIP}>{needs.length} data</span>}
          {belum > 0 && (
            <span className="inline-flex shrink-0 items-center rounded-sm border border-destructive/40 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-destructive">
              {belum} belum
            </span>
          )}
          {gate && gate.type !== 'OOS' && <GateChip gate={gate} />}
        </span>
      ) : (
        <span className="mt-2 block border-t border-border-subtle pt-2">
          {showCol.docs && step.docs.length > 0 && (
            <AttachGroup title="Dokumen & sistem">
              {step.docs.map((doc) => (
                <li key={doc}>{doc}</li>
              ))}
            </AttachGroup>
          )}
          {showCol.coa && step.coa.length > 0 && (
            <AttachGroup title="Akun COA / FSLI">
              {step.coa.map((entry) => (
                <li key={`${entry.code}-${entry.label}`}>
                  <span className="font-semibold tabular-nums text-foreground-secondary">
                    {entry.code}
                  </span>{' '}
                  {entry.label}
                </li>
              ))}
            </AttachGroup>
          )}
          {showCol.drivers && step.drivers.length > 0 && (
            <AttachGroup title="Driver alokasi">
              {step.drivers.map((driver) => (
                <li key={driver}>{driver}</li>
              ))}
            </AttachGroup>
          )}
          {showCol.needs && needs.length > 0 && (
            <AttachGroup title="Data yang dibutuhkan">
              {needs.map((need) => (
                <li key={need.id}>
                  <span className="mr-1 inline-flex flex-wrap gap-1 align-middle">
                    <NeedStatusChip status={need.status} />
                    <NeedKindChip kind={need.kind} />
                  </span>
                  {need.item}
                  {(need.owner || need.src) && (
                    <span className="block text-foreground-muted">
                      {[need.owner, need.src].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </li>
              ))}
            </AttachGroup>
          )}
          {step.risk && (
            <AttachProse title="Risiko" body={step.risk} />
          )}
          {step.control && (
            <AttachProse title="Kontrol" body={step.control} />
          )}
          {gate && gate.type !== 'OOS' && (
            <span className="mt-2 block">
              <GateChip gate={gate} detail />
            </span>
          )}
          {step.note && (
            <span className="mt-2 block border-l-2 border-border pl-2 text-[10px] leading-4 text-foreground-secondary">
              {step.note}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function AttachGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="mb-2 block last:mb-0">
      <span className="block text-[8px] font-bold uppercase leading-4 tracking-[0.14em] text-foreground-muted">
        {title}
      </span>
      <ul className="mt-0.5 list-none space-y-0.5 text-[10px] leading-4 text-foreground-secondary">
        {children}
      </ul>
    </span>
  );
}

function AttachProse({ title, body }: { title: string; body: string }) {
  return (
    <span className="mb-2 block last:mb-0">
      <span className="block text-[8px] font-bold uppercase leading-4 tracking-[0.14em] text-foreground-muted">
        {title}
      </span>
      <span className="mt-0.5 block text-[10px] leading-4 text-foreground-secondary">{body}</span>
    </span>
  );
}

// --- detail panel (§6.4) ----------------------------------------------------
// Read-only except requested_on per need row. Opens beside the canvas on
// wide screens, below it on narrow ones; no overlay, no animation — the
// drawer stays the app's only animation.

function StepPanel({
  step,
  laneLabel,
  needs,
  gate,
  finishLineRows,
  isPending,
  onSaveRequestedOn,
  onOpenFinishLineItem,
  onClose,
}: {
  step: ProcessStep;
  laneLabel: string;
  needs: ProcessNeed[];
  gate?: ProcessGate;
  finishLineRows: FinishLineItem[];
  isPending: boolean;
  onSaveRequestedOn: (id: string, value: string) => Promise<void>;
  onOpenFinishLineItem: (itemId: string) => void;
  onClose: () => void;
}) {
  return (
    <aside
      className="w-full shrink-0 self-start rounded-lg border border-border bg-card shadow-card lg:sticky lg:top-4 lg:w-[380px]"
      aria-label={`Detail step ${step.label}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div>
          <p className="surface-label">
            Step {step.label} · lane {laneLabel}
          </p>
          <h2 className="mt-1 text-sm font-semibold leading-5 text-foreground">{step.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-1">
            <TrackChip track={step.track} />
            {step.co && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
                {step.co}
              </span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Tutup panel">
          <X className="size-4" />
        </Button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-4 py-3 lg:max-h-[calc(100vh-8rem)]">
        {step.risk && <PanelProse title="Risiko" body={step.risk} />}
        {step.control && <PanelProse title="Kontrol" body={step.control} />}
        {step.note && <PanelProse title="Catatan" body={step.note} />}

        {step.docs.length > 0 && (
          <PanelSection title="Dokumen & sistem">
            <ul className="space-y-1 text-xs leading-5 text-foreground-secondary">
              {step.docs.map((doc) => (
                <li key={doc}>{doc}</li>
              ))}
            </ul>
          </PanelSection>
        )}
        {step.coa.length > 0 && (
          <PanelSection title="Akun COA / FSLI">
            <ul className="space-y-1 text-xs leading-5 text-foreground-secondary">
              {step.coa.map((entry) => (
                <li key={`${entry.code}-${entry.label}`}>
                  <span className="font-semibold tabular-nums text-foreground">{entry.code}</span>{' '}
                  {entry.label}
                </li>
              ))}
            </ul>
          </PanelSection>
        )}
        {step.drivers.length > 0 && (
          <PanelSection title="Driver alokasi">
            <ul className="space-y-1 text-xs leading-5 text-foreground-secondary">
              {step.drivers.map((driver) => (
                <li key={driver}>{driver}</li>
              ))}
            </ul>
          </PanelSection>
        )}

        {needs.length > 0 && (
          <PanelSection title="Data yang dibutuhkan">
            <ul className="divide-y divide-border-subtle">
              {needs.map((need) => (
                <li key={need.id} className="py-2 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-center gap-1">
                    <NeedStatusChip status={need.status} />
                    <NeedKindChip kind={need.kind} />
                  </p>
                  <p className="mt-1 text-xs font-medium leading-5 text-foreground">{need.item}</p>
                  {(need.owner || need.src) && (
                    <p className="text-[11px] leading-4 text-foreground-muted">
                      {[need.owner, need.src].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <label className="mt-1.5 flex items-center gap-2 text-[11px] text-foreground-muted">
                    Diminta
                    <Input
                      type="date"
                      className="!h-8 !w-auto text-xs"
                      value={need.requestedOn ?? ''}
                      disabled={isPending}
                      onChange={(event) => void onSaveRequestedOn(need.id, event.target.value)}
                      aria-label={`Tanggal diminta untuk ${need.item}`}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </PanelSection>
        )}

        {gate && (
          <PanelSection title="Gate">
            <p className="flex flex-wrap items-center gap-1.5">
              <GateChip gate={gate} detail />
              <span className="text-xs font-semibold leading-5 text-foreground">{gate.title}</span>
            </p>
            {gate.sub && <p className="mt-1 text-[11px] leading-4 text-foreground-muted">{gate.sub}</p>}
            {gate.owner && (
              <p className="mt-1 text-[11px] leading-4 text-foreground-muted">
                Pemilik: {gate.owner}
              </p>
            )}
            {gate.unblock && (
              <p className="mt-1.5 text-xs leading-5 text-foreground-secondary">{gate.unblock}</p>
            )}
          </PanelSection>
        )}

        {finishLineRows.length > 0 && (
          <PanelSection title="Menyuapi baris Finish line">
            <ul className="divide-y divide-border-subtle">
              {finishLineRows.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenFinishLineItem(item.id)}
                    className="flex min-h-9 w-full items-center justify-between gap-2 rounded-sm text-left text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.item}
                  </button>
                </li>
              ))}
            </ul>
          </PanelSection>
        )}
      </div>
    </aside>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-border-subtle pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <p className="surface-label mb-1.5">{title}</p>
      {children}
    </div>
  );
}

function PanelProse({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-3 border-t border-border-subtle pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <p className="surface-label mb-1">{title}</p>
      <p className="text-xs leading-5 text-foreground-secondary">{body}</p>
    </div>
  );
}
