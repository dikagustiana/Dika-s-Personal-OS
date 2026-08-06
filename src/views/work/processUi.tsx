/**
 * Shared presentation for the process tabs of the Finish line, so the
 * swimlane and the register cannot drift apart on chips or filter buttons —
 * the finishLineUi precedent.
 *
 * Colour semantics (§9.1): ADA = success (data exists — the one correct use
 * of green), SEBAGIAN = escalate (needs input, same amber as the matrix's
 * `input`), BELUM = destructive. A gate chip shares the need chip's hue but
 * differs by SHAPE: statuses are outlined, gates are filled — the same
 * filled-vs-outlined split the dashboard uses for overdue vs blocked.
 * DECISION gates take primary (waiting on the process owner's action);
 * adding a new token for them was not needed. Lane identity is deliberately
 * NEUTRAL — no per-lane colour ramp: lanes are told apart by the sticky
 * label, the alternating band and the dashed border on external lanes, so a
 * lane colour can never be misread as a status.
 *
 * SINCE THE VOCABULARY MOVED INTO os_process_tracks, nothing here knows a
 * track name: chips render the def's label (KEDUANYA arrives as BERSAMA from
 * the table), the filter group builds its buttons from the defs by ordinal,
 * and SAMB showing Trade/LP while ARBI shows Forward/Reverse is data, not a
 * branch.
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type {
  ProcessGate,
  ProcessNeedKind,
  ProcessNeedStatus,
  ProcessTrackDef,
} from '../../data/types';
import { ALL_TRACKS, branchTracks, type TrackFilter } from '../../logic/process';

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

/**
 * The track chip renders the DEF — its label and its shared-ness — never the
 * raw code: the shared backbone (KEDUANYA) displays as its table label
 * BERSAMA, in the slightly recessed tone that has always marked it. A step
 * whose track def is missing falls back to the bare code; the model layer
 * treats that state as a failure, so the fallback exists for render safety,
 * not as a path.
 */
export function TrackChip({ code, def }: { code: string; def?: ProcessTrackDef }) {
  return (
    <span
      className={cn(
        CHIP,
        def?.isShared
          ? 'border border-border bg-surface-3 text-foreground-secondary'
          : 'border border-border bg-surface-2 text-foreground-secondary',
      )}
    >
      {def?.label ?? code}
    </span>
  );
}

const GATE_TONE: Record<ProcessGate['type'], string> = {
  // Filled where statuses are outlined — shape carries the distinction.
  DATA: 'bg-destructive text-destructive-foreground',
  DECISION: 'bg-primary text-primary-foreground',
  // OOS stays dimmed: outside the entity's scope, kept only for numbering.
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

/**
 * The jalur selector: 'Semua' plus the entity's BRANCH tracks by ordinal —
 * the shared backbone is not a filter, it belongs to every walk. State is
 * the CALLER'S, per tab and never shared: on the swimlane this decides which
 * branches are drawn; on the register it narrows the request list, and a
 * selection travelling between those two jobs is how rows go missing without
 * a trace.
 */
export function TrackFilterGroup({
  tracks,
  value,
  onChange,
}: {
  tracks: ProcessTrackDef[];
  value: TrackFilter;
  onChange: (next: TrackFilter) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Filter jalur">
      <span className="surface-label mr-1">Jalur</span>
      <button
        type="button"
        onClick={() => onChange(ALL_TRACKS)}
        aria-pressed={value === ALL_TRACKS}
        className={filterButtonClass(value === ALL_TRACKS)}
      >
        Semua
      </button>
      {branchTracks(tracks).map((track) => (
        <button
          key={track.code}
          type="button"
          onClick={() => onChange(track.code)}
          aria-pressed={value === track.code}
          className={filterButtonClass(value === track.code)}
        >
          {track.label}
        </button>
      ))}
    </div>
  );
}

// --- the entity scope row ---------------------------------------------------

/**
 * The entity picker, FUSED WITH THE SCOPE LINE and deliberately not in the
 * toolbar: every toolbar control is a view option WITHIN one chain, while
 * the entity decides WHICH chain — putting them in one row would make two
 * different kinds of thing look like peers. The scope sentence beside it is
 * the entity's identity and changes with the selection, so the pair reads as
 * "which chain am I looking at", not as a display filter.
 *
 * Offers ONLY entities that have process steps (today SAMB and ARBI). No
 * dead options: ASI/KNI/KDU have no chain yet, and when one is seeded its
 * code appears here without a code change. The primary road to another
 * entity's chain remains the Matrix — every cell is already a (row, entity)
 * pair — so this picker carries small visual weight by design.
 */
export function EntityScopeRow({
  entities,
  value,
  onChange,
  scope,
  trailing,
}: {
  entities: string[];
  value: string;
  onChange: (code: string) => void;
  scope?: string;
  /**
   * Lighter-weight controls that ride in this row rather than claiming one of
   * their own — today the Referensi toggle. The rule this exists to keep: a
   * collapsed block must not push the process map down to announce itself, so
   * anything that is closed by default belongs HERE and not between the rows.
   */
  trailing?: ReactNode;
}) {
  return (
    <div
      data-scope-row
      className="mb-6 flex flex-wrap items-start gap-x-4 gap-y-2"
    >
      <div className="flex items-center gap-1" role="group" aria-label="Pilih entitas">
        <span className="surface-label mr-1">Entitas</span>
        {entities.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => onChange(code)}
            aria-pressed={value === code}
            className={filterButtonClass(value === code)}
          >
            {code}
          </button>
        ))}
      </div>
      {trailing}
      {scope && (
        <p className="min-w-0 max-w-2xl flex-1 basis-full text-sm leading-6 text-foreground-muted lg:basis-auto">
          {scope}
        </p>
      )}
    </div>
  );
}
