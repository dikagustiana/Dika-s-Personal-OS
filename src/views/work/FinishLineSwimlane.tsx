/**
 * The Finish line's Swimlane tab (/finish-line/swimlane): one entity's
 * operational chain — SAMB or ARBI today, whichever ?entity= and the picker
 * say; entities appear as their chains are seeded, with no code change.
 * TEXT IS EDITABLE HERE; STRUCTURE IS NOT. Names, prose, the three list
 * columns, a step's gate reference, lane labels and phase names are edited in
 * the panels — the map is a written artefact and revising one word should not
 * cost a migration. What stays migration-only is everything that decides the
 * diagram's TOPOLOGY: no add/remove/move step, no drag, and no way to reach
 * `slot`, `lane_key`, `track`, `entity_code` or any id from the app. Those
 * cannot break loudly — the canvas would still draw, the counts would just
 * quietly stop being the pinned ones — so the write types cannot even name
 * them (logic/processTextEdit.ts).
 *
 * ENTITY IS PAGE-LEVEL CONTEXT, NOT A TOOLBAR FILTER: it decides WHICH chain
 * renders, while every toolbar control is a view option within one chain, so
 * the picker sits fused with the scope line above the toolbar. It is ONE
 * state shared with the register tab (store), while the jalur filter is
 * per-tab local state — see the store comment for why that split is a truth
 * requirement, not a style choice. Switching entity swaps lanes, phases,
 * tracks, steps, needs and bridge at once, resets the local jalur filter
 * (FORWARD means nothing under SAMB), and RE-MEASURES the canvas — a missed
 * re-measure would draw ARBI's arrows from SAMB's box positions.
 *
 * THE CANVAS SHOWS SHAPE; THE PANEL SHOWS DETAIL. That split is the design
 * decision everything else follows from. The first cut attached the whole
 * matrix to the boxes — six blocks of text per box, ~250px tall, and the
 * flow the view exists to show disappeared behind the reading material. Now
 * no density ever puts prose on the canvas: `risk`, `control` and `note`
 * live only in the panel, boxes carry at most two one-line items per matrix
 * group, and everything past the cap is a "+N" that the box-click answers.
 * The old five controls (tempel + four column toggles) collapse into one
 * three-position density switch, with column choice as a popover that only
 * exists at the densest setting.
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
  ProcessNeedStatus,
  ProcessPhase,
  ProcessReference,
  ProcessFormDef,
  ProcessStep,
  ProcessStepItem,
  ProcessTrackDef,
} from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import { cn } from '../../lib/utils';
import {
  ALL_TRACKS,
  defaultPhases,
  deriveEdges,
  duplicateChainSlots,
  groupCells,
  maxSlot,
  phaseCoverageProblems,
  processStats,
  ribbonSegments,
  scopedPhaseProblems,
  sharedTrackCodes,
  trackFilterDiscriminates,
  visibleSteps,
  type TrackFilter,
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
import { DEFAULT_PROCESS_ENTITY } from './finishLineRoute';
import {
  ReferencesPanel,
  ReferencesToggle,
  referencesState,
} from './ProcessReferences';
import { EditTrigger } from './ProcessTextEditor';
import {
  GateTextForm,
  LaneTextForm,
  NeedTextForm,
  PhaseTextForm,
  StepTextForm,
} from './ProcessTextForms';
import type {
  ProcessGateTextWrite,
  ProcessNeedTextWrite,
  ProcessStepTextWrite,
  TextHistoryRow,
} from '../../logic/processTextEdit';
import { Checking, CouldNotCheck } from './finishLineUi';
import {
  EntityScopeRow,
  GateChip,
  FormChip,
  NeedKindChip,
  NeedStatusChip,
  TrackChip,
  TrackFilterGroup,
  entityEmptyClause,
  filterButtonClass,
  processEmptyClause,
} from './processUi';

const unread = <T,>(): ReadResult<T> => ({ ok: false, reason: 'failed', detail: 'Not read yet' });

/**
 * meta.scope is not seeded — it is this view's subtitle, hardcoded per
 * entity (each seed's meta.scope, verbatim). The scope sentence IS the
 * entity's identity, so it swaps with the picker; an entity seeded later
 * renders its chain with no subtitle until one is added here.
 */
const SCOPE_SUBTITLES: Record<string, string> = {
  SAMB: 'Order ke principal → collection, plus jalur SAMB sebagai penyedia jasa logistik ke klien pihak ketiga. Intake terpisah per jalur; konvergensi mulai di put-away. Retur & klaim discount belum dipetakan.',
  ARBI: 'Rantai B2C ARBI: setup master & harga → pengadaan → inbound & penyimpanan → order marketplace → outbound → pengiriman kurir → retur → settlement & kas. Jalur retur masuk lewat pintu inbound sebagai ASN Return. Seam ke jalur LP SAMB belum ditetapkan — lihat B04.',
  KGR: 'Pengadaan live bird → lini potong sampai TITIK SPLIT-OFF di karkas → disposisi karkas jadi barang jadi atau WIP → pemrosesan lanjut jadi SKU A–J dan MDM → costing dua lapisan: alokasi joint NRV atas kategori yield, lalu separable cost per SKU → penjualan → EOD settlement → penagihan, pembayaran, pelaporan. Fresh dan frozen adalah keadaan persediaan, bukan jalur: fresh default, frozen lahir dari sisa yang tidak habis hari itu lewat blasting. Toll fee tidak ada.',
};

/** §4.6's one visible line for the pre-52 window. */
const LEGACY_NOTICE =
  'Fitur multi-entitas belum aktif — migration entity-aware belum diterapkan; yang tampil rantai SAMB, seperti sebelumnya.';

/**
 * Two causes, two sentences — never one, and never a guessed one. The wording
 * lives in processEmptyClause so this tab and the register cannot drift: a
 * contributor once read zero rows here because RLS declined, and this
 * constant announced that the seed had not landed — while the seed was intact
 * at 53 steps. The claim was free to make and expensive to disbelieve.
 */
const CANVAS_TABLES = { absent: 'os_process_*', unseeded: 'os_process_steps' };

/**
 * The density ladder. Each step ADDS a bounded amount; none adds prose.
 *   ringkas — identity, counts, markers. The default: the diagram as a shape.
 *   sedang  — plus the two highest-signal data needs (BELUM first), because
 *             the register is the reason this feature exists.
 *   lengkap — plus every selected matrix group, capped at two one-line items
 *             each. The column popover exists only here.
 */
type Density = 'ringkas' | 'sedang' | 'lengkap';

const DENSITY_OPTIONS: Array<{ id: Density; label: string }> = [
  { id: 'ringkas', label: 'Ringkas' },
  { id: 'sedang', label: 'Sedang' },
  { id: 'lengkap', label: 'Lengkap' },
];

type AttachColumn = 'docs' | 'coa' | 'drivers' | 'needs';

const ATTACH_COLUMNS: Array<{ id: AttachColumn; label: string }> = [
  { id: 'docs', label: 'Dokumen' },
  { id: 'coa', label: 'COA' },
  { id: 'drivers', label: 'Driver' },
  { id: 'needs', label: 'Kebutuhan data' },
];

/** At most this many one-line items per matrix group on the canvas — ever. */
const GROUP_ITEM_CAP = 2;

/** BELUM outranks SEBAGIAN outranks ADA when a box can only show two needs. */
const NEED_SIGNAL: Record<ProcessNeedStatus, number> = { BELUM: 0, SEBAGIAN: 1, ADA: 2 };

const ZOOM_MIN = 0.22;
const ZOOM_MAX = 1.5;
const MINIMAP_H = 88;

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
  const entity = useAppStore((state) => state.prosesEntity);
  const setEntity = useAppStore((state) => state.setProsesEntity);
  // Read only to SAY whose access produced a zero — never to decide what to
  // fetch. RLS is the boundary; this is the label on the observation.
  const viewer = useAppStore((state) => state.viewer);
  const prosesFocus = useAppStore((state) => state.prosesFocus);
  const setProsesFocus = useAppStore((state) => state.setProsesFocus);
  const { run, isPending } = useMutation();

  // The jalur filter: PER-TAB local state, default Semua, reset when the
  // entity changes — a FORWARD selection is meaningless under SAMB and would
  // silently blank the branch steps.
  const [trackChoice, setTrack] = useState<TrackFilter>(ALL_TRACKS);
  useEffect(() => {
    setTrack(ALL_TRACKS);
  }, [entity]);

  const [lanesRead, setLanesRead] = useState<ReadResult<ProcessLane>>(unread);
  const [phasesRead, setPhasesRead] = useState<ReadResult<ProcessPhase>>(unread);
  const [stepsRead, setStepsRead] = useState<ReadResult<ProcessStep>>(unread);
  const [gatesRead, setGatesRead] = useState<ReadResult<ProcessGate>>(unread);
  const [needsRead, setNeedsRead] = useState<ReadResult<ProcessNeed>>(unread);
  const [stepItemsRead, setStepItemsRead] = useState<ReadResult<ProcessStepItem>>(unread);
  const [tracksRead, setTracksRead] = useState<ReadResult<ProcessTrackDef>>(unread);
  // Decoration, not structure: an absent or failed forms read degrades to no
  // chips (the references pattern) and never gates the model.
  const [formsRead, setFormsRead] = useState<ReadResult<ProcessFormDef>>(unread);
  const [referencesRead, setReferencesRead] = useState<ReadResult<ProcessReference>>(unread);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [itemsRead, setItemsRead] = useState<ReadResult<FinishLineItem>>(unread);
  const [loaded, setLoaded] = useState(false);

  // View state — none of it persisted (§6.8).
  const [density, setDensity] = useState<Density>('ringkas');
  const [showCol, setShowCol] = useState<Record<AttachColumn, boolean>>({
    docs: true,
    coa: true,
    drivers: true,
    needs: true,
  });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [onlyGap, setOnlyGap] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  // Lanes and phases had no detail panel of their own — the brief's editable
  // list includes their text, so they get one, opened from the thing itself
  // (the sticky lane label, the phase name) rather than from an admin page.
  const [selectedLaneKey, setSelectedLaneKey] = useState<string | null>(null);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [lanes, phases, steps, gates, needs, stepItems, tracks, forms, references, items] =
      await Promise.all([
      repository.listProcessLanes(),
      repository.listProcessPhases(),
      repository.listProcessSteps(),
      repository.listProcessGates(),
      repository.listProcessNeeds(),
      repository.listProcessStepItems(),
      repository.listProcessTracks(),
      repository.listProcessForms(),
      repository.listProcessReferences(),
      repository.listFinishLineItems(),
    ]);
    setLanesRead(lanes);
    setPhasesRead(phases);
    setStepsRead(steps);
    setGatesRead(gates);
    setNeedsRead(needs);
    setStepItemsRead(stepItems);
    setTracksRead(tracks);
    setFormsRead(forms);
    setReferencesRead(references);
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
        tracks: tracksRead,
      }),
    [lanesRead, phasesRead, stepsRead, gatesRead, needsRead, stepItemsRead, tracksRead],
  );

  // EVERYTHING BELOW IS SLICED BY THE SELECTED ENTITY — lanes, phases,
  // steps, tracks; needs and the bridge inherit the slice through step ids.
  // No list is hardcoded: an entity seeded tomorrow renders today.
  const allSteps = model.kind === 'ready' ? model.steps : [];
  const needs = model.kind === 'ready' ? model.needs : [];
  const gates = model.kind === 'ready' ? model.gates : [];
  const stepItems = useMemo(() => (model.kind === 'ready' ? model.stepItems : []), [model]);
  const steps = useMemo(
    () => allSteps.filter((step) => step.entityCode === entity),
    [allSteps, entity],
  );
  const entitiesWithSteps = useMemo(() => {
    const codes = [...new Set(allSteps.map((step) => step.entityCode))];
    // The default entity leads; the rest alphabetical — a stable row of two
    // today that grows on its own as chains are seeded.
    return codes.sort((a, b) =>
      a === DEFAULT_PROCESS_ENTITY ? -1 : b === DEFAULT_PROCESS_ENTITY ? 1 : a.localeCompare(b),
    );
  }, [allSteps]);
  const lanes = useMemo(
    () =>
      model.kind === 'ready'
        ? model.lanes
            .filter((lane) => lane.entityCode === entity)
            .sort((a, b) => a.ordinal - b.ordinal)
        : [],
    [model, entity],
  );
  const phases = useMemo(
    () =>
      model.kind === 'ready'
        ? model.phases.filter((phase) => phase.entityCode === entity)
        : [],
    [model, entity],
  );
  const entityTracks = useMemo(
    () =>
      model.kind === 'ready'
        ? model.tracks.filter((trackDef) => trackDef.entityCode === entity)
        : [],
    [model, entity],
  );
  const shared = useMemo(() => sharedTrackCodes(entityTracks), [entityTracks]);
  const trackDefByCode = useMemo(
    () => new Map(entityTracks.map((trackDef) => [trackDef.code, trackDef])),
    [entityTracks],
  );
  const formDefByCode = useMemo(
    () =>
      new Map(
        rowsOf(formsRead)
          .filter((formDef) => formDef.entityCode === entity)
          .map((formDef) => [formDef.code, formDef]),
      ),
    [formsRead, entity],
  );

  // THE EFFECTIVE FILTER, not the stored one. When the jalur control is hidden
  // for this entity there is no way to clear a branch selection, so a choice
  // carried over from another chain would silently hide steps with nothing on
  // screen to explain it. Deriving `track` here rather than at each call site
  // means every consumer below — the canvas, the stats, the arrows — reads the
  // same value and none of them can be missed.
  const jalurUseful = useMemo(
    () => trackFilterDiscriminates(steps, entityTracks),
    [steps, entityTracks],
  );
  const track = jalurUseful ? trackChoice : ALL_TRACKS;

  const shown = useMemo(() => visibleSteps(steps, track, shared), [steps, track, shared]);
  const cells = useMemo(() => groupCells(shown), [shown]);
  const highestSlot = useMemo(() => maxSlot(steps), [steps]);
  const stats = useMemo(
    () => processStats(steps, needs, track, entityTracks),
    [steps, needs, track, entityTracks],
  );
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
  const brokenChains = useMemo(
    () => duplicateChainSlots(steps, entityTracks),
    [steps, entityTracks],
  );
  // Two invariants since phases learned track scope: the default (track-null)
  // ribbon still tiles 1..max exactly once; scoped rows must not overlap
  // within their track and must cover every reachable slot — gaps allowed.
  const phaseProblems = useMemo(
    () =>
      steps.length > 0
        ? [
            ...phaseCoverageProblems(defaultPhases(phases), highestSlot),
            ...scopedPhaseProblems(phases, steps, entityTracks),
          ]
        : [],
    [phases, steps, highestSlot, entityTracks],
  );
  // The ribbon under the active filter: scoped rows win their slots, the
  // default ribbon fills the rest; unfiltered, the default renders alone.
  const ribbon = useMemo(
    () => ribbonSegments(phases, track, highestSlot),
    [phases, track, highestSlot],
  );

  const wireEdges: WireEdge[] = useMemo(() => {
    if (brokenChains.length > 0) return [];
    return deriveEdges(steps, track, entityTracks).map((edge) => ({
      fromLabel: edge.from.label,
      toLabel: edge.to.label,
      cross: edge.cross,
    }));
  }, [steps, track, entityTracks, brokenChains]);

  // --- measurement (§6.6) ---------------------------------------------------
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const retryRef = useRef(0);
  const [geometry, setGeometry] = useState<{
    wires: Wire[];
    width: number;
    height: number;
    /** The measured box rects, kept for the minimap — same pass, same truth. */
    boxes: Array<{ label: string; rect: BoxRect }>;
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
    setGeometry({
      wires: computeWires(wireEdges, rects),
      width,
      height,
      boxes: [...rects.entries()].map(([label, rect]) => ({ label, rect })),
    });
  }, [wireEdges]);

  // After layout — never during render — and again on every input that can
  // change box sizes or swap the box set entirely: filter, density, column
  // choice, and THE ENTITY (§4.5) — without it, a switch would draw the new
  // chain's arrows from the old chain's box positions.
  useLayoutEffect(() => {
    retryRef.current = 0;
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [measure, density, showCol, model.kind, entity]);

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

  // --- the minimap's view of the scroll position ----------------------------
  // Tracked in UNZOOMED grid coordinates so the viewport rectangle and the
  // box rects share one space; rAF-throttled because scroll fires per frame.
  const [view, setView] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const canvas = scrollRef.current;
    if (!canvas || !geometry) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      setView({
        left: canvas.scrollLeft / zoom,
        top: canvas.scrollTop / zoom,
        width: canvas.clientWidth / zoom,
        height: canvas.clientHeight / zoom,
      });
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    canvas.addEventListener('scroll', request, { passive: true });
    const observer = new ResizeObserver(request);
    observer.observe(canvas);
    return () => {
      canvas.removeEventListener('scroll', request);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [geometry, zoom]);

  const jumpTo = useCallback(
    (gridX: number, gridY: number) => {
      const canvas = scrollRef.current;
      if (!canvas) return;
      canvas.scrollTo({
        left: gridX * zoom - canvas.clientWidth / 2,
        top: gridY * zoom - canvas.clientHeight / 2,
        behavior: 'auto',
      });
    },
    [zoom],
  );

  // --- deep link from the register / Finish line panel ----------------------
  useEffect(() => {
    if (!prosesFocus || model.kind !== 'ready') return;
    // Labels repeat across entities (ARBI '9' beside SAMB '9'), so the focus
    // resolves within the SELECTED entity's steps only.
    const target = steps.find((step) => step.label === prosesFocus.stepLabel);
    if (target) {
      setSelectedLabel(target.label);
      requestAnimationFrame(() => {
        gridRef.current
          ?.querySelector(`[data-step-label="${target.label}"]`)
          ?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
      });
    }
    setProsesFocus(null);
  }, [prosesFocus, model, steps, setProsesFocus]);

  // --- the column popover (lengkap only) ------------------------------------
  const columnsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!columnsOpen) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!columnsRef.current?.contains(event.target as Node)) setColumnsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setColumnsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [columnsOpen]);

  const shownColumnCount = ATTACH_COLUMNS.filter((column) => showCol[column.id]).length;

  // --- zoom (§6.7): scale the grid, compensate margins, never re-measure ----
  const applyZoomStyle = geometry
    ? {
        transform: `scale(${zoom})`,
        transformOrigin: '0 0',
        marginRight: `${geometry.width * (zoom - 1)}px`,
        marginBottom: `${geometry.height * (zoom - 1)}px`,
      }
    : undefined;

  const selectedStep = selectedLabel
    ? shown.find((step) => step.label === selectedLabel) ?? null
    : null;

  /**
   * THE ONE SAVE PATH for process text. Write first, THEN append the audit
   * rows: an edit must never be lost because its log could not be written,
   * and appendProcessTextHistory returns false (rather than throwing) when
   * migration 20260806000055 has not been applied yet.
   *
   * `load()` afterwards rather than patching state by hand — the canvas
   * derives arrows, cells and counts from these rows, and a hand-patched
   * copy that drifts from the database is exactly the silent kind of wrong
   * this feature keeps guarding against.
   */
  const saveText = async <T,>(
    label: string,
    write: () => Promise<T>,
    history: TextHistoryRow[],
  ): Promise<boolean> => {
    const written = await run(label, async () => {
      const result = await write();
      await repository.appendProcessTextHistory(history);
      return result;
    });
    if (written === undefined || written === null) return false;
    await load();
    return true;
  };

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

  // Absent table (pre-migration 42P01) or zero rows → the block does not
  // render at all. A real failure still shows, inline in the scope row.
  const references = referencesState(referencesRead);

  return (
    <>
      {/* Entity + scope: which chain is in view. There is no <h1> here —
          FinishLineArea owns the only one. Before data lands the picker
          shows just the selected code; it grows to every entity with steps
          the moment the read returns. */}
      <EntityScopeRow
        entities={entitiesWithSteps.length > 0 ? entitiesWithSteps : [entity]}
        value={entity}
        onChange={setEntity}
        scope={SCOPE_SUBTITLES[entity]}
        trailing={
          <ReferencesToggle
            state={references}
            open={referencesOpen}
            onToggle={() => setReferencesOpen((current) => !current)}
          />
        }
      />
      <ReferencesPanel state={references} open={referencesOpen} />

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
        <Checking label={`Proses ${entity}`} />
      ) : model.kind === 'empty' ? (
        <div className="rounded-lg border border-border-subtle bg-card px-4">
          <EmptyRow
            label="Swimlane"
            clause={processEmptyClause(model.cause, viewer, CANVAS_TABLES)}
          />
        </div>
      ) : model.kind === 'failed' ? (
        <div className="rounded-lg border border-border-subtle bg-card p-4">
          <CouldNotCheck label={`Proses ${entity}`} failure={{ reason: 'failed', detail: model.detail }} />
        </div>
      ) : steps.length === 0 ? (
        // A ready model with no steps for THIS entity — reachable through
        // ?entity=X. It used to say the entity "belum punya rantai proses",
        // which is a claim about the database made from a read that only saw
        // this session's slice of it: for a contributor holding ARBI alone,
        // ?entity=SAMB produced that sentence about a chain of 30 steps.
        // One line, never an error.
        <div className="rounded-lg border border-border-subtle bg-card px-4">
          <EmptyRow label="Swimlane" clause={entityEmptyClause(entity, viewer)} />
        </div>
      ) : (
        <>
          {model.legacyEntity && (
            <p className="mb-4 flex min-h-9 items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-4 text-xs leading-5 text-foreground-secondary">
              {LEGACY_NOTICE}
            </p>
          )}
          {/* The toolbar: four segments with real separation, not twelve
              buttons in a row. Jalur | kepadatan (+kolom) | sorot | zoom, and
              the stats line pushed to the right edge. Every control is a
              toggle — zero filled-primary buttons on this view (§9.1).

              canvas-bleed: it sits directly above the canvas and reads as its
              chrome, so it takes the canvas's width rather than the measure's
              — a 1076px toolbar over a 1380px canvas reads as a mistake. */}
          <div
            className="canvas-bleed mb-4 flex flex-wrap items-center gap-x-5 gap-y-2"
            role="group"
            aria-label="Kontrol swimlane"
          >
            <TrackFilterGroup
              tracks={entityTracks}
              steps={steps}
              value={track}
              onChange={setTrack}
            />
            <div
              className="flex items-center gap-1 border-l border-border-subtle pl-5"
              role="group"
              aria-label="Kepadatan kotak"
            >
              <span className="surface-label mr-1">Kepadatan</span>
              {DENSITY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={density === option.id}
                  onClick={() => {
                    setDensity(option.id);
                    if (option.id !== 'lengkap') setColumnsOpen(false);
                  }}
                  className={filterButtonClass(density === option.id)}
                >
                  {option.label}
                </button>
              ))}
              {density === 'lengkap' && (
                <div ref={columnsRef} className="relative">
                  <button
                    type="button"
                    aria-expanded={columnsOpen}
                    aria-haspopup="true"
                    onClick={() => setColumnsOpen((current) => !current)}
                    className={filterButtonClass(columnsOpen)}
                  >
                    Kolom · {shownColumnCount}
                  </button>
                  {columnsOpen && (
                    <div
                      role="group"
                      aria-label="Kolom yang ditampilkan"
                      className="absolute left-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-card p-1.5 shadow-card"
                    >
                      {ATTACH_COLUMNS.map((column) => (
                        <button
                          key={column.id}
                          type="button"
                          aria-pressed={showCol[column.id]}
                          onClick={() =>
                            setShowCol((current) => ({
                              ...current,
                              [column.id]: !current[column.id],
                            }))
                          }
                          className={cn(
                            'flex min-h-8 w-full items-center justify-between rounded-sm px-2 text-left text-[11px] font-semibold transition-colors duration-150',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            showCol[column.id]
                              ? 'text-foreground'
                              : 'text-foreground-muted hover:text-foreground-secondary',
                          )}
                        >
                          {column.label}
                          <span
                            aria-hidden="true"
                            className={cn(
                              'ml-2 inline-block size-1.5 rounded-full',
                              showCol[column.id] ? 'bg-primary' : 'bg-border',
                            )}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 border-l border-border-subtle pl-5">
              <button
                type="button"
                aria-pressed={onlyGap}
                onClick={() => setOnlyGap((current) => !current)}
                className={filterButtonClass(onlyGap)}
              >
                Sorot yang ada gap
              </button>
            </div>
            <div
              className="flex items-center gap-1 border-l border-border-subtle pl-5"
              role="group"
              aria-label="Zoom"
            >
              <button
                type="button"
                onClick={() => setZoom((current) => Math.max(ZOOM_MIN, current - 0.1))}
                className={filterButtonClass(false)}
                aria-label="Perkecil"
              >
                −
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
            <span className="ml-auto text-xs tabular-nums text-foreground-muted">
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

          {/* canvas-bleed: the canvas, the minimap and the detail panel. The
              PANEL's width is untouched (lg:w-[380px]); every pixel the bleed
              adds goes to flex-1, which is the canvas. With the panel open
              that is 984px of canvas at a 1700px viewport instead of 680. */}
          <div
            data-canvas-row
            className="canvas-bleed flex flex-col gap-4 lg:flex-row lg:items-start"
          >
            <div className="min-w-0 flex-1">
              {/* The minimap replaces the old `pas` zoom: the whole shape at
                  a glance without shrinking the text past legibility. Click
                  scrolls the canvas; the outline is the current viewport. */}
              {geometry && !drawFailed && (
                <Minimap
                  boxes={geometry.boxes}
                  width={geometry.width}
                  height={geometry.height}
                  view={view}
                  onJump={jumpTo}
                />
              )}
              <div
                ref={scrollRef}
                className="min-w-0 overflow-auto rounded-lg border border-border bg-card pb-10 shadow-card"
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
                            strokeWidth={wire.cross ? 2.25 : 1.5}
                            className={cn(
                              wire.cross ? 'stroke-foreground' : 'stroke-foreground-secondary',
                            )}
                            markerEnd={`url(#${wire.cross ? 'proses-arrow-handoff' : 'proses-arrow-lane'})`}
                          />
                          {/* The handoff is a graphic event now, not a text
                              capsule: an 11px diamond at the lane crossing,
                              anti-stacked by computeWires exactly as the
                              capsule was. The word lives in the legend and in
                              this hover title. */}
                          {wire.capsule && (
                            <g data-handoff-marker className="pointer-events-auto">
                              <title>{`HANDOFF · ${wire.key.replace('>', ' → ')}`}</title>
                              <path
                                d={`M${wire.capsule.x},${wire.capsule.y - 5.5} L${wire.capsule.x + 5.5},${wire.capsule.y} L${wire.capsule.x},${wire.capsule.y + 5.5} L${wire.capsule.x - 5.5},${wire.capsule.y} Z`}
                                className="fill-foreground stroke-background"
                                strokeWidth={1.5}
                              />
                            </g>
                          )}
                        </g>
                      ))}
                    </svg>
                  )}

                  {/* Phase ribbon (row 1); the top-left corner stays empty.
                      Resolved per track: a row scoped to the active filter
                      wins its slots, the default ribbon fills the rest, and a
                      shadowed default phase renders as fragments that still
                      open the real phase row. */}
                  <div style={{ gridColumn: 1, gridRow: 1 }} />
                  {ribbon.map((segment) => (
                    <div
                      key={segment.key}
                      className="z-[2] pb-2"
                      style={{
                        gridRow: 1,
                        gridColumn: `${2 + (segment.slotFrom - 1) * 2} / ${2 + (segment.slotTo - 1) * 2 + 1}`,
                      }}
                    >
                      <div className="h-1 rounded-sm bg-foreground opacity-15" />
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPhaseId(segment.phaseId);
                          setSelectedLaneKey(null);
                          setSelectedLabel(null);
                        }}
                        className="block pt-1.5 text-left text-[9px] font-bold uppercase leading-4 tracking-[0.14em] text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {segment.name}
                      </button>
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
                        trackDefByCode={trackDefByCode}
                        formDefByCode={formDefByCode}
                        density={density}
                        showCol={showCol}
                        onlyGap={onlyGap}
                        highlighted={highlighted}
                        selectedLabel={selectedLabel}
                        onSelect={(label) => {
                          setSelectedPhaseId(null);
                          setSelectedLaneKey(null);
                          setSelectedLabel((current) => (current === label ? null : label));
                        }}
                        onSelectLane={() => {
                          setSelectedLabel(null);
                          setSelectedPhaseId(null);
                          setSelectedLaneKey(lane.key);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              {/* The legend carries the words the canvas no longer does. */}
              <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] leading-4 text-foreground-muted">
                <span className="inline-flex items-center gap-1.5">
                  <svg width="18" height="8" aria-hidden="true">
                    <line
                      x1="0"
                      y1="4"
                      x2="18"
                      y2="4"
                      strokeWidth="1.5"
                      className="stroke-foreground-secondary"
                    />
                  </svg>
                  alur dalam lane
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg width="18" height="12" aria-hidden="true">
                    <line
                      x1="0"
                      y1="6"
                      x2="18"
                      y2="6"
                      strokeWidth="2.25"
                      className="stroke-foreground"
                    />
                    <path d="M9,1.5 L13,6 L9,10.5 L5,6 Z" className="fill-foreground stroke-background" strokeWidth="1" />
                  </svg>
                  handoff antar lane
                </span>
                <span>klik kotak untuk risiko, kontrol, dan detail lainnya</span>
              </p>
            </div>

            {selectedLaneKey && (
              <LanePhasePanel
                title={`Lane ${selectedLaneKey}`}
                onClose={() => setSelectedLaneKey(null)}
              >
                {(() => {
                  const lane = lanes.find((candidate) => candidate.key === selectedLaneKey);
                  if (!lane) return null;
                  return (
                    <LaneTextForm
                      lane={lane}
                      context={{
                        isPending,
                        submit: (patch, history) =>
                          saveText(
                            'Simpan lane',
                            () => repository.updateProcessLaneText(lane.entityCode, lane.key, patch),
                            history,
                          ),
                      }}
                      onDone={() => setSelectedLaneKey(null)}
                    />
                  );
                })()}
              </LanePhasePanel>
            )}

            {selectedPhaseId && (
              <LanePhasePanel title="Fase" onClose={() => setSelectedPhaseId(null)}>
                {(() => {
                  const phase = phases.find((candidate) => candidate.id === selectedPhaseId);
                  if (!phase) return null;
                  return (
                    <PhaseTextForm
                      phase={phase}
                      context={{
                        isPending,
                        submit: (patch, history) =>
                          saveText(
                            'Simpan fase',
                            () => repository.updateProcessPhaseText(phase.id, patch),
                            history,
                          ),
                      }}
                      onDone={() => setSelectedPhaseId(null)}
                    />
                  );
                })()}
              </LanePhasePanel>
            )}

            {selectedStep && (
              <StepPanel
                step={selectedStep}
                gates={gates}
                trackDefByCode={trackDefByCode}
                formDefByCode={formDefByCode}
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
                onSaveStep={(patch, history) =>
                  saveText('Simpan teks step', () => repository.updateProcessStepText(selectedStep.id, patch), history)
                }
                onSaveNeed={(id, patch, history) =>
                  saveText('Simpan kebutuhan data', () => repository.updateProcessNeedText(id, patch), history)
                }
                onSaveGate={(id, patch, history) =>
                  saveText('Simpan gate', () => repository.updateProcessGateText(id, patch), history)
                }
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

// --- minimap ----------------------------------------------------------------

/**
 * The whole diagram as a strip: every box as a small rect, the viewport as an
 * outline, click to move. It replaces fit-zoom, which shrank the canvas until
 * the text stopped being text — the minimap shows shape without pretending
 * the labels survive at 10% scale. Not focusable on purpose: it duplicates
 * the scrollbars, which remain the accessible path.
 */
function Minimap({
  boxes,
  width,
  height,
  view,
  onJump,
}: {
  boxes: Array<{ label: string; rect: BoxRect }>;
  width: number;
  height: number;
  view: { left: number; top: number; width: number; height: number } | null;
  onJump: (gridX: number, gridY: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapWidth, setWrapWidth] = useState(0);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    setWrapWidth(wrap.clientWidth);
    const observer = new ResizeObserver(() => setWrapWidth(wrap.clientWidth));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(
    MINIMAP_H / height,
    // Below ~24px of wrapper there is no strip worth drawing to; fall back to
    // the height scale rather than let the width term go negative.
    wrapWidth > 24 ? (wrapWidth - 12) / width : MINIMAP_H / height,
  );
  const mapW = Math.max(1, Math.round(width * scale));
  const mapH = Math.max(1, Math.round(height * scale));

  return (
    <div
      ref={wrapRef}
      className="mb-2 overflow-hidden rounded-md border border-border-subtle bg-surface-2 px-1.5 py-1.5"
    >
      <svg
        role="img"
        aria-label="Peta mini swimlane — klik untuk menggeser kanvas"
        width={mapW}
        height={mapH}
        className="block cursor-pointer"
        onClick={(event) => {
          const svgRect = event.currentTarget.getBoundingClientRect();
          onJump(
            (event.clientX - svgRect.left) / scale,
            (event.clientY - svgRect.top) / scale,
          );
        }}
      >
        {boxes.map(({ label, rect }) => (
          <rect
            key={label}
            x={rect.x * scale}
            y={rect.y * scale}
            width={Math.max(2, rect.w * scale)}
            height={Math.max(2, rect.h * scale)}
            rx={1.5}
            className="fill-foreground-secondary/50"
          />
        ))}
        {view && (
          <rect
            x={Math.max(0, view.left * scale)}
            y={Math.max(0, view.top * scale)}
            width={Math.min(mapW, view.width * scale)}
            height={Math.min(mapH, view.height * scale)}
            rx={2}
            className="fill-primary/10 stroke-primary"
            strokeWidth={1.5}
          />
        )}
      </svg>
    </div>
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
  trackDefByCode,
  formDefByCode,
  density,
  showCol,
  onlyGap,
  highlighted,
  selectedLabel,
  onSelect,
  onSelectLane,
}: {
  lane: ProcessLane;
  laneRow: number;
  odd: boolean;
  dimmedLabel: boolean;
  cells: Map<string, ProcessStep[]>;
  gatesById: Map<string, ProcessGate>;
  needsByStep: Map<string, ProcessNeed[]>;
  trackDefByCode: Map<string, ProcessTrackDef>;
  formDefByCode: Map<string, ProcessFormDef>;
  density: Density;
  showCol: Record<AttachColumn, boolean>;
  onlyGap: boolean;
  /** null = no pre-filter. A set = these labels stay lit, the rest dim. */
  highlighted: ReadonlySet<string> | null;
  selectedLabel: string | null;
  onSelect: (label: string) => void;
  onSelectLane: () => void;
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
          <button
            type="button"
            onClick={onSelectLane}
            className="block w-full text-left text-[11px] font-bold uppercase leading-4 tracking-[0.1em] text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {lane.label}
          </button>
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
              trackDefByCode={trackDefByCode}
              formDefByCode={formDefByCode}
              density={density}
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

/**
 * The gate, demoted to an annotation: a coloured dot and the id, no fill, no
 * words. The full red pill — with "nunggu data" and the unblock text — lives
 * in the panel, where it does not compete with the structure. Hue still says
 * type (DATA waits on someone else, DECISION on the owner), and the dot is a
 * second channel beside the G-id so the meaning never rides on colour alone.
 */
function GateMarker({ gate }: { gate: ProcessGate }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[9px] font-bold tracking-[0.08em] text-foreground-secondary">
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          gate.type === 'DATA' ? 'bg-destructive' : 'bg-primary',
        )}
      />
      {gate.id}
    </span>
  );
}

/**
 * One box. The hierarchy, heaviest first: label + name (the identity), then
 * track, then counts or capped group lines, then the gate and the presence
 * markers. NO PROSE AT ANY DENSITY — risk, control and note appear only as
 * the words "risiko/kontrol/catatan" in the marker row; their text is the
 * panel's. Every group line is one truncated line; everything past
 * GROUP_ITEM_CAP is a "+N di panel", and the whole box is the affordance
 * that opens it.
 */
function StepBox({
  step,
  gate,
  needs,
  trackDefByCode,
  formDefByCode,
  density,
  showCol,
  dim,
  selected,
  onSelect,
}: {
  step: ProcessStep;
  gate?: ProcessGate;
  needs: ProcessNeed[];
  trackDefByCode: Map<string, ProcessTrackDef>;
  formDefByCode: Map<string, ProcessFormDef>;
  density: Density;
  showCol: Record<AttachColumn, boolean>;
  dim: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const belum = needs.filter((need) => need.status === 'BELUM').length;
  const orderedNeeds = [...needs].sort(
    (a, b) => NEED_SIGNAL[a.status] - NEED_SIGNAL[b.status],
  );
  const presence = [
    step.risk && 'risiko',
    step.control && 'kontrol',
    step.note && 'catatan',
  ].filter(Boolean) as string[];

  return (
    <button
      type="button"
      data-step-label={step.label}
      data-entity={step.entityCode}
      data-dim={dim || undefined}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-md border bg-card p-2.5 text-left shadow-card',
        // The one transition on this view: the sorotan dim, plus the border
        // it shares a declaration with. Nothing else moves.
        'transition-[opacity,border-color] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary ring-2 ring-primary/25' : 'border-border hover:border-primary',
        dim && 'opacity-30',
      )}
    >
      {/* Identity first: pill + name on one line, the heaviest thing here.
          The pill is neutral inverse, deliberately NOT a lane colour: lane
          identity must never read as a status (§9.1). */}
      <span className="flex items-start gap-1.5">
        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-background">
          {step.label}
        </span>
        <span className="line-clamp-2 text-xs font-bold leading-snug text-foreground">
          {step.name}
        </span>
      </span>
      <span className="mt-1.5 flex items-center gap-1.5">
        <TrackChip code={step.track} def={trackDefByCode.get(step.track)} />
        {step.form && <FormChip code={step.form} def={formDefByCode.get(step.form)} />}
        {step.co && (
          <span className="min-w-0 truncate text-[9px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
            {step.co}
          </span>
        )}
      </span>

      {density === 'ringkas' ? (
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
        </span>
      ) : (
        <span className="mt-2 block border-t border-border-subtle pt-2">
          {density === 'lengkap' && showCol.docs && step.docs.length > 0 && (
            <BoxGroup title="Dokumen & sistem" total={step.docs.length}>
              {step.docs.slice(0, GROUP_ITEM_CAP).map((doc) => (
                <li key={doc} className="truncate" title={doc}>
                  {doc}
                </li>
              ))}
            </BoxGroup>
          )}
          {density === 'lengkap' && showCol.coa && step.coa.length > 0 && (
            <BoxGroup title="Akun COA / FSLI" total={step.coa.length}>
              {step.coa.slice(0, GROUP_ITEM_CAP).map((entry) => (
                <li
                  key={`${entry.code}-${entry.label}`}
                  className="truncate"
                  title={`${entry.code} ${entry.label}`}
                >
                  <span className="font-semibold tabular-nums text-foreground-secondary">
                    {entry.code}
                  </span>{' '}
                  {entry.label}
                </li>
              ))}
            </BoxGroup>
          )}
          {density === 'lengkap' && showCol.drivers && step.drivers.length > 0 && (
            <BoxGroup title="Driver alokasi" total={step.drivers.length}>
              {step.drivers.slice(0, GROUP_ITEM_CAP).map((driver) => (
                <li key={driver} className="truncate" title={driver}>
                  {driver}
                </li>
              ))}
            </BoxGroup>
          )}
          {(density === 'sedang' || showCol.needs) && needs.length > 0 && (
            <BoxGroup title="Kebutuhan data" total={needs.length}>
              {orderedNeeds.slice(0, GROUP_ITEM_CAP).map((need) => (
                <li key={need.id} className="flex items-center gap-1" title={need.item}>
                  <NeedStatusChip status={need.status} />
                  <span className="min-w-0 truncate">{need.item}</span>
                </li>
              ))}
            </BoxGroup>
          )}
        </span>
      )}

      {(gate && gate.type !== 'OOS') || presence.length > 0 ? (
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {gate && gate.type !== 'OOS' && <GateMarker gate={gate} />}
          {presence.length > 0 && (
            <span className="text-[9px] leading-4 text-foreground-muted">
              {presence.join(' · ')}
            </span>
          )}
        </span>
      ) : null}
    </button>
  );
}

/**
 * One matrix group inside a box: a counted title, at most GROUP_ITEM_CAP
 * one-line items, and a "+N di panel" for the rest. The cap is what keeps a
 * row of boxes reading as a row — heights converge because content cannot
 * diverge.
 */
function BoxGroup({
  title,
  total,
  children,
}: {
  title: string;
  total: number;
  children: ReactNode;
}) {
  const overflow = total - GROUP_ITEM_CAP;
  return (
    <span className="mb-2 block last:mb-0">
      <span className="block text-[8px] font-bold uppercase leading-4 tracking-[0.14em] text-foreground-muted">
        {title} · {total}
      </span>
      <ul className="mt-0.5 list-none space-y-0.5 text-[10px] leading-4 text-foreground-secondary">
        {children}
      </ul>
      {overflow > 0 && (
        <span className="mt-0.5 block text-[9px] leading-4 text-foreground-muted">
          +{overflow} di panel
        </span>
      )}
    </span>
  );
}

/**
 * The shell lanes and phases share. They carry one and two editable fields
 * respectively — far too little to justify a StepPanel of their own, and far
 * too much to justify an admin page. Same aside, same close button, opened
 * from the object itself.
 */
function LanePhasePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      className="w-full shrink-0 self-start rounded-lg border border-border bg-card shadow-card lg:sticky lg:top-4 lg:w-[380px]"
      aria-label={title}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <p className="surface-label">{title}</p>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Tutup panel">
          <X className="size-4" />
        </Button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-4 py-3">{children}</div>
    </aside>
  );
}

// --- detail panel (§6.4) ----------------------------------------------------
// Opens READING, and switches one object at a time into a form — see
// ProcessTextEditor.tsx for why nothing here is an input until asked for.
// Opens beside the canvas on
// wide screens, below it on narrow ones; no overlay, no animation — the
// drawer stays the app's only animation. This is where the prose lives:
// risk, control and note render in full here and ONLY here, and the gate
// gets its red pill back.

function StepPanel({
  step,
  gates,
  trackDefByCode,
  formDefByCode,
  laneLabel,
  needs,
  gate,
  finishLineRows,
  isPending,
  onSaveRequestedOn,
  onSaveStep,
  onSaveNeed,
  onSaveGate,
  onOpenFinishLineItem,
  onClose,
}: {
  step: ProcessStep;
  gates: ProcessGate[];
  trackDefByCode: Map<string, ProcessTrackDef>;
  formDefByCode: Map<string, ProcessFormDef>;
  laneLabel: string;
  needs: ProcessNeed[];
  gate?: ProcessGate;
  finishLineRows: FinishLineItem[];
  isPending: boolean;
  onSaveRequestedOn: (id: string, value: string) => Promise<void>;
  onSaveStep: (patch: ProcessStepTextWrite, history: TextHistoryRow[]) => Promise<boolean>;
  onSaveNeed: (
    id: string,
    patch: ProcessNeedTextWrite,
    history: TextHistoryRow[],
  ) => Promise<boolean>;
  onSaveGate: (
    id: string,
    patch: ProcessGateTextWrite,
    history: TextHistoryRow[],
  ) => Promise<boolean>;
  onOpenFinishLineItem: (itemId: string) => void;
  onClose: () => void;
}) {
  // Read first. One affordance per editable object switches that object into
  // a form; nothing becomes an input just because the panel opened.
  const [editing, setEditing] = useState<
    { kind: 'step' } | { kind: 'need'; id: string } | { kind: 'gate' } | null
  >(null);
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
            <TrackChip code={step.track} def={trackDefByCode.get(step.track)} />
            {step.form && <FormChip code={step.form} def={formDefByCode.get(step.form)} />}
            {step.co && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
                {step.co}
              </span>
            )}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          {editing === null && <EditTrigger onClick={() => setEditing({ kind: 'step' })} />}
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Tutup panel">
            <X className="size-4" />
          </Button>
        </span>
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-4 py-3 lg:max-h-[calc(100vh-8rem)]">
        {editing?.kind === 'step' ? (
          <StepTextForm
            step={step}
            gates={gates}
            context={{
              isPending,
              submit: (patch, history) => onSaveStep(patch, history),
            }}
            onDone={() => setEditing(null)}
          />
        ) : (
          <>
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
              {needs.map((need) =>
                editing?.kind === 'need' && editing.id === need.id ? (
                  <li key={need.id} className="py-2 first:pt-0 last:pb-0">
                    <NeedTextForm
                      need={need}
                      context={{
                        isPending,
                        submit: (patch, history) => onSaveNeed(need.id, patch, history),
                      }}
                      onDone={() => setEditing(null)}
                    />
                  </li>
                ) : (
                <li key={need.id} className="py-2 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-center gap-1">
                    <NeedStatusChip status={need.status} />
                    <NeedKindChip kind={need.kind} />
                    <span className="ml-auto">
                      <EditTrigger
                        onClick={() => setEditing({ kind: 'need', id: need.id })}
                        label="Edit"
                      />
                    </span>
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
                ),
              )}
            </ul>
          </PanelSection>
        )}

        {gate && editing?.kind === 'gate' && (
          <PanelSection title="Gate">
            <GateTextForm
              gate={gate}
              context={{
                isPending,
                submit: (patch, history) => onSaveGate(gate.id, patch, history),
              }}
              onDone={() => setEditing(null)}
            />
          </PanelSection>
        )}
        {gate && editing?.kind !== 'gate' && (
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
            <p className="mt-1.5">
              <EditTrigger onClick={() => setEditing({ kind: 'gate' })} label="Edit gate" />
            </p>
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
          </>
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
