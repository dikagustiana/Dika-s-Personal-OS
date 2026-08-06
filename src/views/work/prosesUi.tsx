/**
 * Shared presentation for the two SAMB process views, so the swimlane and
 * the register cannot drift apart on chips, tabs or filter buttons — the
 * finishLineUi precedent.
 *
 * Colour semantics (§9.1): ADA = success (data exists — the one correct use
 * of green), SEBAGIAN = escalate (needs input, same amber as the matrix's
 * `input`), BELUM = destructive. A gate chip shares the need chip's hue but
 * differs by SHAPE: statuses are outlined, gates are filled — the same
 * filled-vs-outlined split the dashboard uses for overdue vs blocked.
 * DECISION gates take primary (waiting on the process owner's action);
 * adding a new token for them was not needed. Lane identity is deliberately
 * NEUTRAL — no six-colour ramp: lanes are told apart by the sticky label,
 * the alternating band and the dashed border on the external lane, so a
 * lane colour can never be misread as a status.
 */
import { cn } from '../../lib/utils';
import { useAppStore, type WorkView } from '../../store/appStore';
import type {
  ProcessGate,
  ProcessNeedKind,
  ProcessNeedStatus,
  ProcessTrack,
} from '../../data/types';
import type { TrackFilter } from '../../logic/process';

// --- tabs between the two views --------------------------------------------

const TABS: Array<{ id: WorkView; label: string }> = [
  { id: 'proses', label: 'Swimlane' },
  { id: 'proses-kebutuhan-data', label: 'Kebutuhan data' },
];

/** The house underline-tab pattern (ResearchArea), navigating the pair. */
export function ProsesTabs({ active }: { active: WorkView }) {
  const setWorkView = useAppStore((state) => state.setWorkView);
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-border-subtle">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setWorkView(tab.id)}
          aria-current={active === tab.id ? 'page' : undefined}
          className={cn(
            'min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active === tab.id
              ? 'border-primary text-foreground'
              : 'border-transparent text-foreground-muted hover:text-foreground-secondary',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// --- chips ------------------------------------------------------------------

const CHIP =
  'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]';

const STATUS_TONE: Record<ProcessNeedStatus, string> = {
  ADA: 'border border-success/40 text-success',
  SEBAGIAN: 'border border-escalate/40 text-escalate',
  BELUM: 'border border-destructive/40 text-destructive',
};

export function NeedStatusChip({ status }: { status: ProcessNeedStatus }) {
  return <span className={cn(CHIP, STATUS_TONE[status])}>{status}</span>;
}

export function NeedKindChip({ kind }: { kind: ProcessNeedKind }) {
  return (
    <span className={cn(CHIP, 'border border-border-subtle bg-surface-2 text-foreground-muted')}>
      {kind}
    </span>
  );
}

/** KEDUANYA renders as BERSAMA — shared backbone, cost pool split not doubled. */
export function TrackChip({ track }: { track: ProcessTrack }) {
  return (
    <span
      className={cn(
        CHIP,
        track === 'KEDUANYA'
          ? 'border border-border bg-surface-3 text-foreground-secondary'
          : 'border border-border bg-surface-2 text-foreground-secondary',
      )}
    >
      {track === 'KEDUANYA' ? 'BERSAMA' : track}
    </span>
  );
}

const GATE_TONE: Record<ProcessGate['type'], string> = {
  // Filled where statuses are outlined — shape carries the distinction.
  DATA: 'bg-destructive text-destructive-foreground',
  DECISION: 'bg-primary text-primary-foreground',
  // OOS stays dimmed: outside SAMB scope, kept only for numbering.
  OOS: 'bg-surface-3 text-foreground-muted',
};

export function GateChip({
  gate,
  detail = false,
}: {
  gate: ProcessGate;
  detail?: boolean;
}) {
  return (
    <span className={cn(CHIP, GATE_TONE[gate.type])}>
      {gate.id}
      {detail && gate.type !== 'OOS' && (
        <span className="ml-1 normal-case tracking-normal">
          · {gate.type === 'DATA' ? 'nunggu data' : 'nunggu keputusan'}
        </span>
      )}
    </span>
  );
}

// --- filter buttons ---------------------------------------------------------

/** The segmented-filter button classes (FinishLine's GapFilterRow pattern). */
export function filterButtonClass(active: boolean): string {
  return cn(
    'min-h-8 rounded-sm border px-2.5 text-[11px] font-semibold tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-primary bg-primary/10 text-foreground'
      : 'border-border text-foreground-muted hover:text-foreground-secondary',
  );
}

export const TRACK_LABEL: Record<TrackFilter, string> = {
  ALL: 'Semua',
  TRADE: 'Trade',
  LP: 'LP',
};

/** The jalur selector both views share, backed by the store. */
export function TrackFilterGroup() {
  const track = useAppStore((state) => state.prosesTrack);
  const setTrack = useAppStore((state) => state.setProsesTrack);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Filter jalur">
      <span className="surface-label mr-1">Jalur</span>
      {(['ALL', 'TRADE', 'LP'] as TrackFilter[]).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setTrack(value)}
          aria-pressed={track === value}
          className={filterButtonClass(track === value)}
        >
          {TRACK_LABEL[value]}
        </button>
      ))}
    </div>
  );
}
