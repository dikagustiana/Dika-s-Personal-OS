import { useState } from 'react';
import { TriangleAlert, UserRound, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { ReadFailure } from '../../data/readResult';
import type { CellState, FinishLineAccount, FinishLineCell, FinishLineItem } from '../../data/types';
import { cn } from '../../lib/utils';
import { contradictionNoun, stateClauses } from '../../logic/finishLine';
import {
  coverageOf,
  distinctFieldValues,
  hasDriver,
  sortAccounts,
  type WorkbookField,
} from '../../logic/finishLineAccounts';
import { STATE_TONE } from './finishLineUi';

/**
 * ===========================================================================
 * THE DETAIL HANGS OFF THE CELL, NOT OFF THE ROW.
 * ===========================================================================
 * A row spans every entity and cell state is per entity: one metric is
 * routinely a trustworthy figure in two columns and a reported nil in the
 * rest. So a row-level panel has to pick one entity's state to show, or
 * average them, and it does so silently. The accounts are worse: each entity
 * carries its own set under that metric, with different drivers and owners.
 *
 * A row-level panel therefore cannot state anything true about the accounts
 * without naming an entity. The cell is the only place where state, accounts,
 * driver, owner and target state are all unambiguous — so the panel is opened
 * BY a cell and headed with both the metric and the entity, every time.
 *
 * THE WORKBOOK FIELDS ARE READ-ONLY. `data_ideal`, `driver_type`,
 * `driver_source`, `pic`, `business` and `is_dummy` are maintained in the
 * consolidation workbook, and no control here touches them: a second place to
 * change them would be a second source of truth.
 *
 * THE CELL'S OWN STATE AND NOTE ARE THE APP'S, AND THIS PANEL IS WHERE THEY
 * ARE EDITED — the first state-edit affordance the app has had; until now the
 * owner set states through direct database access. Who can do what is decided
 * by the SQL trigger and re-stated here only so the unavailable options are
 * VISIBLY unavailable rather than present-and-failing:
 *   owner        any state, any direction, plus the note
 *   contributor  input → figure on their own entities, plus the note
 * A contributor-written figure is marked as such until the owner touches the
 * cell — that mark is the verification signal that replaces the sixth state
 * the schema deliberately refuses.
 */

/** How many accounts show before the list collapses. */
const VISIBLE_ACCOUNTS = 6;

const ALL_STATES: CellState[] = ['input', 'figure', 'zero', 'undefined', 'locked'];

/** Sentence fragments for why a state button is disabled, per audience. */
const CONTRIBUTOR_STATE_HINT =
  'Kontributor hanya bisa memajukan input → figure. Nil, undefined, locked, dan mundur adalah keputusan pemilik — pakai catatan untuk mengusulkannya.';

export function CellDetailPanel({
  cell,
  item,
  entityLabel,
  accounts,
  accountsKnown,
  accountsFailure,
  viewerKind,
  canWrite,
  isPending,
  onSetState,
  onSetNote,
  onClose,
}: {
  cell: FinishLineCell;
  item?: FinishLineItem;
  entityLabel: string;
  /** This cell's accounts. Empty is meaningful ONLY when `accountsKnown`. */
  accounts: FinishLineAccount[];
  /**
   * Did the account read actually return? An empty array from a failed read
   * must never render as "this metric has no accounts" — that is the project's
   * most-repeated failure, and it is invisible by construction.
   */
  accountsKnown: boolean;
  /**
   * The failure itself, when the read FAILED rather than merely not having
   * returned yet. This is the diagnostic ReadResult exists to preserve: the
   * production 500 rendered only as "Belum termuat", which reads as a normal
   * state, and the owner could not tell a failure from a slow load. When set,
   * the panel says the read failed and shows the detail.
   */
  accountsFailure?: ReadFailure;
  /** Cosmetic gating only — the trigger re-decides from the credential. */
  viewerKind: 'owner' | 'contributor';
  /** Whether THIS viewer may write THIS cell (contributor: own entity only). */
  canWrite: boolean;
  isPending: boolean;
  onSetState: (state: CellState) => void;
  onSetNote: (note: string | undefined) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // null = not editing. The draft holds the textarea between open and save.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  const state: CellState = cell.state;
  const tone = STATE_TONE[state];
  const StateIcon = tone.icon;
  const { label, consequence } = stateClauses(state);

  /**
   * The same table the trigger enforces. A target is offered when the viewer
   * could actually land it: the owner anywhere, a contributor only forward
   * from input to figure — everything else renders disabled WITH the reason,
   * because a control that is present-and-failing teaches people the app is
   * broken rather than the rule exists.
   */
  const stateAllowed = (target: CellState): boolean => {
    if (!canWrite || target === state) return false;
    if (viewerKind === 'owner') return true;
    return state === 'input' && target === 'figure';
  };
  const submitted = cell.actorKind === 'contributor';

  const coverage = coverageOf(accounts);
  const ordered = sortAccounts(accounts);
  const shown = expanded ? ordered : ordered.slice(0, VISIBLE_ACCOUNTS);
  const hidden = ordered.length - shown.length;

  // The contradiction is computed from THIS cell's real accounts. No count is
  // ever hardcoded — the day a state is corrected the line disappears on its
  // own, because nothing here stores the finding. A cell whose accounts have
  // not loaded cannot contradict anything: absence of a list is not evidence.
  const noun = contradictionNoun(state);
  const contradicts = accountsKnown && coverage.total > 0 && noun !== undefined;

  return (
    <div className="border-l-2 border-primary bg-surface-2 px-4 py-4">
      {/* --- header: metric AND entity, because neither alone is enough ----- */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-5 text-foreground">
            <span className="break-words">{item?.item ?? 'Cell'}</span>
            <span className="px-1.5 text-foreground-muted" aria-hidden="true">
              ›
            </span>
            <span className="break-words">{entityLabel}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
              tone.line,
            )}
          >
            <StateIcon className="size-3" />
            {label}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close this cell">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* THE STATE AND THE ACCOUNTS DISAGREE.                                 */}
      {/*                                                                      */}
      {/* Above the state sentence on purpose: it changes how that sentence    */}
      {/* should be read. It does NOT replace it — both statements are true at */}
      {/* once and the reader needs both to see the shape of the problem.      */}
      {/* Nothing is resolved here. Which fact is wrong — the cell's state or  */}
      {/* the account mapping — is a decision the owner has not made, so this  */}
      {/* reports and stops.                                                   */}
      {/* ==================================================================== */}
      {contradicts && (
        <p className="mt-3 rounded-sm border border-destructive bg-destructive/10 px-2.5 py-2 text-[11px] leading-5 text-destructive">
          <span className="font-semibold">
            Ditandai {noun}, tapi ada <span className="tabular-nums">{coverage.total}</span> akun di
            baliknya.
          </span>{' '}
          Salah satunya keliru — entah state selnya, entah pemetaan akunnya.
        </p>
      )}

      {/* The sentence the badge cannot carry. Rendered here rather than only
          in a tooltip because a tooltip does not exist on a phone. */}
      <p
        className={cn(
          'mt-2 flex items-start gap-2 rounded-sm border px-2.5 py-2 text-[11px] leading-5',
          tone.line,
        )}
      >
        <StateIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <span className="font-semibold">{label}</span>
          {consequence && <span> — {consequence}</span>}
        </span>
      </p>

      {/* THE SUBMISSION MARK. A contributor-written state is a claim the owner
          has not looked at yet, and any owner touch clears it (the trigger
          resets actor_kind). Distinct, not decorative: this is the
          verification signal that replaces the sixth state the schema
          deliberately refuses. */}
      {submitted && (
        <p className="mt-2 flex items-start gap-2 rounded-sm border border-primary/40 bg-primary/10 px-2.5 py-2 text-[11px] leading-5 text-primary">
          <UserRound className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-semibold">Diisi kontributor</span> — belum disentuh pemilik
            sejak diubah.
          </span>
        </p>
      )}

      {/* Attribution, straight off the trigger-written columns. */}
      {cell.changedAt && (
        <p className="mt-2 text-[10px] tabular-nums text-foreground-muted">
          Terakhir diubah oleh{' '}
          {cell.actorKind === 'contributor'
            ? `kontributor${cell.actor ? ` · ${cell.actor.slice(0, 8)}` : ''}`
            : 'pemilik'}{' '}
          · {cell.changedAt.slice(0, 16).replace('T', ' ')} UTC
        </p>
      )}

      {cell.note && noteDraft === null && (
        <p className="mt-2 text-[11px] leading-5 text-foreground-muted">{cell.note}</p>
      )}

      {/* --- the editors: the cell's own two authored fields ----------------- */}
      {canWrite && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
            Ubah state
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ALL_STATES.map((target) => {
              const targetTone = STATE_TONE[target];
              const TargetIcon = targetTone.icon;
              const current = target === state;
              const allowed = stateAllowed(target);
              return (
                <button
                  key={target}
                  type="button"
                  disabled={!allowed || isPending}
                  aria-pressed={current}
                  onClick={() => onSetState(target)}
                  title={
                    current
                      ? 'State saat ini'
                      : allowed
                        ? stateClauses(target).label
                        : viewerKind === 'contributor'
                          ? CONTRIBUTOR_STATE_HINT
                          : undefined
                  }
                  className={cn(
                    'inline-flex min-h-8 items-center gap-1 rounded-sm border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    current
                      ? targetTone.line
                      : allowed
                        ? 'border-border text-foreground-secondary hover:bg-surface-3'
                        : 'cursor-not-allowed border-border-subtle text-foreground-muted opacity-40',
                  )}
                >
                  <TargetIcon className="size-3" />
                  {stateClauses(target).label}
                </button>
              );
            })}
          </div>
          {viewerKind === 'contributor' && (
            <p className="mt-1.5 text-[10px] leading-4 text-foreground-muted">
              {CONTRIBUTOR_STATE_HINT}
            </p>
          )}

          {noteDraft === null ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setNoteDraft(cell.note ?? '')}
            >
              {cell.note ? 'Ubah catatan' : 'Tulis catatan'}
            </Button>
          ) : (
            <div className="mt-2">
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                rows={2}
                placeholder="Satu baris: apa yang kurang untuk entitas ini"
                aria-label="Catatan sel"
                className="w-full rounded-sm border border-border bg-background px-2.5 py-2 text-[11px] leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="mt-1.5 flex gap-2">
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    onSetNote(noteDraft.trim() || undefined);
                    setNoteDraft(null);
                  }}
                >
                  Simpan catatan
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setNoteDraft(null)}>
                  Batal
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- the four workbook facts, all scoped to THIS cell --------------- */}
      <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-border-subtle pt-3 sm:grid-cols-2">
        <Fact label="Kondisi ideal" accounts={accounts} field="dataIdeal" known={accountsKnown} />
        <Fact label="Cara ke sana" accounts={accounts} field="driverType" known={accountsKnown} />
        <Fact label="Pemilik data" accounts={accounts} field="pic" known={accountsKnown} />
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
            Akun di {entityLabel}
          </dt>
          <dd className="mt-0.5 text-[11px] leading-5 text-foreground-secondary">
            {accountsKnown ? (
              <span className="tabular-nums">
                {coverage.total} akun · {coverage.withDriver} punya driver
                {/* Dummy sits BESIDE driver coverage, never folded into it: a
                    cell can be fully driver-complete and still untrustworthy
                    because the drivers describe placeholder accounts. */}
                {coverage.dummy > 0 && (
                  <span className="text-escalate"> · {coverage.dummy} dummy</span>
                )}
              </span>
            ) : (
              <span className="text-foreground-muted">Belum termuat</span>
            )}
          </dd>
        </div>
      </dl>

      {/* --- the accounts themselves --------------------------------------- */}
      <div className="mt-3 border-t border-border-subtle pt-3">
        {accountsFailure ? (
          /* THE READ FAILED. Named as a failure, with the diagnostic, in the
             same red-vs-amber split CouldNotCheck uses — a failure that reads
             as a normal state is how the production 500 went undiagnosed. */
          <div>
            <p
              className={cn(
                'flex items-center gap-2 text-[11px] font-semibold',
                accountsFailure.reason === 'failed' ? 'text-destructive' : 'text-escalate',
              )}
            >
              <TriangleAlert className="size-3.5 shrink-0" />
              Could not read the account detail
            </p>
            <p className="mt-1 text-[11px] leading-5 text-foreground-muted">
              {accountsFailure.reason === 'missing-relation'
                ? 'The accounts relation is not in this database yet — not a zero, and not a clean bill.'
                : 'The read did not complete, so what sits behind this cell is unknown — not none.'}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-foreground-muted">
              {accountsFailure.detail}
            </p>
          </div>
        ) : !accountsKnown ? (
          /* NOT a zero. The read did not return, so there is no count to give
             and no clean bill either — saying "no accounts" here would turn a
             failed read into good news. */
          <p className="text-[11px] leading-5 text-foreground-muted">
            Account detail is not loaded, so what sits behind this cell is unknown — not none.
          </p>
        ) : ordered.length === 0 ? (
          <p className="text-[11px] leading-5 text-foreground-muted">
            No accounts are mapped to this cell.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border-subtle">
              {shown.map((account) => (
                <li key={account.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
                  {account.coaConsol && (
                    <span className="shrink-0 text-[10px] tabular-nums text-foreground-muted">
                      {account.coaConsol}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 break-words text-[11px] font-medium text-foreground">
                    {account.accountName}
                  </span>
                  {account.isDummy && (
                    <span className="shrink-0 border border-escalate px-1 text-[9px] font-bold uppercase tracking-wider text-escalate">
                      Dummy
                    </span>
                  )}
                  {/* The marker that matters: an account with no driver has not
                      been designed, and that is the thing to act on. */}
                  {hasDriver(account) ? (
                    <span className="shrink-0 text-[10px] text-foreground-muted">
                      {account.driverType}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] font-semibold text-destructive">
                      Belum ada driver
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="mt-1.5 min-h-8 text-[11px] font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                + {hidden} akun lagi
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One workbook fact for a cell.
 *
 * SHOWS THE DISTINCT SET, NEVER THE FIRST VALUE. A cell can hold accounts that
 * genuinely disagree — two mapping rows can point at one metric — and printing
 * `accounts[0].driverType` would assert a single driver the cell does not
 * have, chosen by sort order. Beyond two, the count is stated and the list
 * below carries the detail rather than the panel growing a wall of text.
 */
function Fact({
  label,
  accounts,
  field,
  known,
}: {
  label: string;
  accounts: FinishLineAccount[];
  field: WorkbookField;
  known: boolean;
}) {
  const values = distinctFieldValues(accounts, field);
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[11px] leading-5 text-foreground-secondary">
        {!known ? (
          <span className="text-foreground-muted">Belum termuat</span>
        ) : values.length === 0 ? (
          <span className="text-foreground-muted">—</span>
        ) : values.length <= 2 ? (
          <ul className={cn(values.length > 1 && 'list-disc pl-4')}>
            {values.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        ) : (
          <span className="text-foreground-muted">
            <span className="tabular-nums font-semibold text-foreground-secondary">
              {values.length}
            </span>{' '}
            nilai berbeda — lihat daftar akun di bawah
          </span>
        )}
      </dd>
    </div>
  );
}
