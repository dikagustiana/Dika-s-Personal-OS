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
  ProcessStep,
  ProcessTrackDef,
} from '../../data/types';
import {
  ALL_TRACKS,
  branchTracks,
  trackFilterDiscriminates,
  type TrackFilter,
} from '../../logic/process';
import type { EmptyCause } from '../../logic/processModel';
import type { Viewer } from '../../store/appStore';

// --- empty states -----------------------------------------------------------

/**
 * ===========================================================================
 * ZERO ROWS DESCRIBES WHAT WAS SEEN. IT NEVER NAMES A CAUSE.
 * ===========================================================================
 * This pattern has now cost this project three separate investigations, and
 * the second one is the reason this function exists rather than two string
 * constants:
 *
 *   1. Kebutuhan data read zero. A guard swallowed a non-42P01 error and it
 *      rendered as a legitimate empty list. No message at all.
 *   2. A contributor's swimlane read zero because RLS declined, and the app
 *      announced that the seed had not landed — while the seed was intact at
 *      53 steps. Two people spent minutes chasing a data problem that was a
 *      permissions problem, because the screen told them which one it was.
 *   3. `permission denied for function os_member_entities` reached the screen
 *      verbatim. That one was diagnosed in seconds — and it is the model.
 *
 * The rule that falls out: A SUCCESSFUL READ RETURNING ZERO ROWS IS
 * AMBIGUOUS. It can mean the table is genuinely empty or that RLS filtered
 * every row, and the frontend cannot tell those apart — the database returns
 * an empty set for both, with no error either way. So the sentence states the
 * observation and stops. No "belum di-seed", no "belum diterapkan", no guess.
 *
 * What it CAN say, because the app does know it, is whose access produced the
 * zero: §10.2's "kalau app bisa membedakan pemilik dari anggota". The viewer
 * is in the store, so the reader learns that zero rows is the answer FOR THIS
 * SESSION rather than a fact about the database — which is the single most
 * useful thing to know when the answer is wrong, and it is an observation
 * rather than a diagnosis.
 *
 * `absent` keeps a cause because it HAS one that the read proved: the
 * relation itself answered 42P01. That is not an inference.
 *
 * Shared by both tabs on purpose. The swimlane and the register disagreeing
 * about what zero rows means is exactly how (2) happened.
 */
export function accessLabel(viewer: Viewer): string {
  if (viewer.kind === 'owner') return 'akses pemilik';
  const codes = viewer.entityCodes;
  if (codes.length === 0) return 'akses kontributor (tanpa entitas)';
  if (codes.length > 3) {
    return `akses kontributor (${codes.slice(0, 3).join(', ')} +${codes.length - 3})`;
  }
  return `akses kontributor (${codes.join(', ')})`;
}

export function processEmptyClause(
  cause: EmptyCause,
  viewer: Viewer,
  tables: { absent: string; unseeded: string },
): string {
  return cause === 'absent'
    ? `Tabel ${tables.absent} belum ada di database (42P01) — migration proses belum diterapkan di lingkungan ini.`
    : `${tables.unseeded} terbaca tanpa error dan mengembalikan nol baris untuk ${accessLabel(viewer)}.`;
}

/**
 * The per-entity zero: reads succeeded and carried rows, but none for the
 * entity in view.
 *
 * This one said "Entitas SAMB belum punya rantai proses", and for a
 * contributor holding only ARBI that sentence is FALSE — SAMB has 30 steps,
 * they are simply not readable with that membership. It is the same failure
 * as (2) above wearing different words, reachable through ?entity=SAMB, and
 * it was missed the first time because it does not look like an empty state
 * about the database.
 *
 * For a contributor the honest sentence names the memberships they hold; the
 * suggestion to switch entity only makes sense when another entity is
 * actually reachable, so it is dropped when it is not.
 */
export function entityEmptyClause(entity: string, viewer: Viewer): string {
  if (viewer.kind === 'owner') {
    return `Nol step terbaca untuk entitas ${entity} — pilih entitas lain di atas.`;
  }
  const codes = viewer.entityCodes;
  if (!codes.includes(entity)) {
    return `Nol step terbaca untuk entitas ${entity} dengan ${accessLabel(viewer)} — entitas ini di luar keanggotaan sesi ini.`;
  }
  return `Nol step terbaca untuk entitas ${entity} dengan ${accessLabel(viewer)}.`;
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
/**
 * Renders NOTHING when the entity's branches do not narrow anything — see
 * trackFilterDiscriminates. The decision is made here rather than at each call
 * site so the two tabs cannot disagree about whether KGR has a jalur filter,
 * and so a caller cannot forget.
 *
 * What is removed is the CONTROL, not the information: TrackChip still marks
 * every step's track on the canvas and in the step panel. An excursion of four
 * steps is worth seeing; it is not worth a button that hides three boxes.
 */
export function TrackFilterGroup({
  tracks,
  steps,
  value,
  onChange,
}: {
  tracks: ProcessTrackDef[];
  /** The entity's steps — coverage is measured against these. */
  steps: ProcessStep[];
  value: TrackFilter;
  onChange: (next: TrackFilter) => void;
}) {
  if (!trackFilterDiscriminates(steps, tracks)) return null;
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
