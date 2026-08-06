/**
 * The Finish line's Kebutuhan data tab (/finish-line/kebutuhan-data): every
 * data item the SAMB chain needs, joined to its step, with the proportion
 * bar and the per-owner grouping that turns the list into an actual request
 * to send someone.
 *
 * What this register adds over os_finish_line_accounts — which already holds
 * the ideal data, its source and its owner for most accounts — is how ready
 * each item is and when it was asked for. It is not a second home for facts
 * that table owns.
 *
 * requested_on is THE ONLY writable field in the whole process feature.
 * Status BELUM moves nobody; "diminta tanggal X, belum dijawab" moves.
 *
 * A missing os_process_* relation renders the one-line empty state — the
 * migration lands after this view ships (§0), so that is the normal
 * pre-deploy render, not an error.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '../../components/ui/Input';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { okRows, rowsOf, type ReadResult } from '../../data/readResult';
import type { ProcessNeed, ProcessNeedKind, ProcessNeedStatus, ProcessStep } from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import {
  buildRegisterState,
  groupByOwner,
  registerRows,
  summarizeNeeds,
  type EmptyCause,
  type RegisterRow,
} from '../../logic/processModel';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils';
import { Checking, CouldNotCheck } from './finishLineUi';
import {
  NeedKindChip,
  NeedStatusChip,
  TrackFilterGroup,
  filterButtonClass,
} from './processUi';

const unread = <T,>(): ReadResult<T> => ({ ok: false, reason: 'failed', detail: 'Not read yet' });

/**
 * One sentence per cause, and they must stay different sentences. `absent` is
 * a migration that has not run; `unseeded` is a table that answered and had
 * nothing in it. Reading the second and being told the first is what sent a
 * half-applied seed looking for a frontend bug.
 */
const REGISTER_EMPTY: Record<EmptyCause, string> = {
  absent: 'Tabel os_process_needs belum ada di database — migration proses belum diterapkan.',
  unseeded:
    'Tabel os_process_needs ada dan terbaca, tapi nol baris — seed-nya belum masuk, bukan migration-nya.',
};

const STATUSES: ProcessNeedStatus[] = ['ADA', 'SEBAGIAN', 'BELUM'];
const KINDS: ProcessNeedKind[] = ['MASTER', 'TRANSAKSI', 'PARAMETER', 'REFERENSI'];

export function FinishLineNeeds({
  /** Step-label links hand off to the swimlane tab, focused on that step. */
  onOpenStep,
}: {
  onOpenStep: (stepLabel: string) => void;
}) {
  const repository = useAppStore((state) => state.repository);
  const track = useAppStore((state) => state.prosesTrack);
  const { run, isPending } = useMutation();

  const [stepsRead, setStepsRead] = useState<ReadResult<ProcessStep>>(unread);
  const [needsRead, setNeedsRead] = useState<ReadResult<ProcessNeed>>(unread);
  const [loaded, setLoaded] = useState(false);

  const [statusOn, setStatusOn] = useState<Record<ProcessNeedStatus, boolean>>({
    ADA: true,
    SEBAGIAN: true,
    BELUM: true,
  });
  const [kindOn, setKindOn] = useState<Record<ProcessNeedKind, boolean>>({
    MASTER: true,
    TRANSAKSI: true,
    PARAMETER: true,
    REFERENSI: true,
  });
  const [byOwner, setByOwner] = useState(false);

  const load = useCallback(async () => {
    const [steps, needs] = await Promise.all([
      repository.listProcessSteps(),
      repository.listProcessNeeds(),
    ]);
    setStepsRead(steps);
    setNeedsRead(needs);
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void load().catch(() => setLoaded(true));
  }, [load]);

  const steps = rowsOf(stepsRead);
  const needs = rowsOf(needsRead);
  const state = buildRegisterState(stepsRead, needsRead);

  const summary = useMemo(() => summarizeNeeds(needs, steps, track), [needs, steps, track]);
  const rows = useMemo(
    () => registerRows(needs, steps, { track, status: statusOn, kind: kindOn }),
    [needs, steps, track, statusOn, kindOn],
  );
  const ownerGroups = useMemo(() => (byOwner ? groupByOwner(rows) : []), [byOwner, rows]);

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

  return (
    <>
      {/* This tab's description, under the tab bar. No <h1> — the area owns
          the only one on the page. */}
      <p className="mb-6 max-w-2xl text-sm leading-6 text-foreground-muted">
        Apa yang harus ada supaya rantai ini bisa dijalankan — bukan apa yang dihasilkan tiap
        step. Kelompokkan per pemilik untuk mendapat daftar permintaan data.
      </p>

      {!loaded ? (
        <Checking label="Kebutuhan data" />
      ) : state.kind === 'empty' ? (
        <div className="rounded-lg border border-border-subtle bg-card px-4">
          <EmptyRow label="Kebutuhan data" clause={REGISTER_EMPTY[state.cause]} />
        </div>
      ) : state.kind === 'failed' ? (
        <div className="rounded-lg border border-border-subtle bg-card p-4">
          <CouldNotCheck
            label="Kebutuhan data"
            failure={{ reason: 'failed', detail: state.detail }}
          />
        </div>
      ) : (
        <>
          <section className="mb-5">
            <div
              className="flex h-2 max-w-lg overflow-hidden rounded-sm bg-surface-3"
              role="img"
              aria-label={`Ada ${summary.ada}, sebagian ${summary.sebagian}, belum ada ${summary.belum} dari ${summary.total}`}
            >
              {summary.total > 0 && (
                <>
                  <div className="bg-success" style={{ width: `${(summary.ada / summary.total) * 100}%` }} />
                  <div className="bg-escalate" style={{ width: `${(summary.sebagian / summary.total) * 100}%` }} />
                  <div className="bg-destructive" style={{ width: `${(summary.belum / summary.total) * 100}%` }} />
                </>
              )}
            </div>
            <p className="mt-2 text-xs tabular-nums text-foreground-muted">
              Ada <span className="font-semibold text-foreground">{summary.ada}</span> · Sebagian{' '}
              <span className="font-semibold text-foreground">{summary.sebagian}</span> · Belum ada{' '}
              <span className="font-semibold text-destructive">{summary.belum}</span> · Total{' '}
              <span className="font-semibold text-foreground">{summary.total}</span>
            </p>
            {/* Selalu tampil: pertanyaan yang paling sering muncul saat menyusun permintaan. */}
            <p className="mt-2 max-w-2xl text-xs leading-5 text-foreground-muted">
              Pemilik <span className="font-semibold text-foreground-secondary">PF</span> adalah
              turunan yang dihitung sendiri, bukan permintaan ke pihak lain — jangan dicampur ke
              daftar permintaan.
            </p>
          </section>

          <div
            className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2"
            role="group"
            aria-label="Filter register"
          >
            <div className="flex items-center gap-1">
              <span className="surface-label mr-1">Status</span>
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={statusOn[status]}
                  onClick={() => setStatusOn((current) => ({ ...current, [status]: !current[status] }))}
                  className={filterButtonClass(statusOn[status])}
                >
                  {status}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="surface-label mr-1">Jenis</span>
              {KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={kindOn[kind]}
                  onClick={() => setKindOn((current) => ({ ...current, [kind]: !current[kind] }))}
                  className={filterButtonClass(kindOn[kind])}
                >
                  {kind}
                </button>
              ))}
            </div>
            <TrackFilterGroup />
            <button
              type="button"
              aria-pressed={byOwner}
              onClick={() => setByOwner((current) => !current)}
              className={filterButtonClass(byOwner)}
            >
              Kelompokkan per pemilik
            </button>
            <span className="text-xs tabular-nums text-foreground-muted">{rows.length} baris</span>
          </div>

          <section className="rounded-lg border border-border bg-card shadow-card">
            {rows.length === 0 ? (
              <div className="px-4">
                <EmptyRow
                  label="Kebutuhan data"
                  clause="Tidak ada baris yang cocok dengan filter."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle bg-surface-2 text-left">
                      {['Data yang dibutuhkan', 'Jenis', 'Sumber', 'Pemilik', 'Status', 'Diminta', 'Step'].map(
                        (heading) => (
                          <th
                            key={heading}
                            scope="col"
                            className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground-muted"
                          >
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  {byOwner ? (
                    ownerGroups.map((group) => (
                      <tbody key={group.owner}>
                        <tr className="border-b border-border bg-surface-3">
                          <td colSpan={7} className="px-3 py-2">
                            <span className="text-xs font-bold tabular-nums text-foreground">
                              {group.owner}
                            </span>
                            <span className="ml-3 text-xs tabular-nums text-foreground-muted">
                              {group.rows.length} item
                              {group.belum > 0 && (
                                <>
                                  {' · '}
                                  <span className="font-semibold text-destructive">
                                    {group.belum} belum ada
                                  </span>
                                </>
                              )}
                            </span>
                          </td>
                        </tr>
                        {group.rows.map((row) => (
                          <NeedRow
                            key={row.need.id}
                            row={row}
                            isPending={isPending}
                            onOpenStep={onOpenStep}
                            onSaveRequestedOn={saveRequestedOn}
                          />
                        ))}
                      </tbody>
                    ))
                  ) : (
                    <tbody>
                      {rows.map((row) => (
                        <NeedRow
                          key={row.need.id}
                          row={row}
                          isPending={isPending}
                          onOpenStep={onOpenStep}
                          onSaveRequestedOn={saveRequestedOn}
                        />
                      ))}
                    </tbody>
                  )}
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function NeedRow({
  row,
  isPending,
  onOpenStep,
  onSaveRequestedOn,
}: {
  row: RegisterRow;
  isPending: boolean;
  onOpenStep: (stepLabel: string) => void;
  onSaveRequestedOn: (id: string, value: string) => Promise<void>;
}) {
  const { need, step } = row;
  return (
    <tr className="border-b border-border-subtle align-top last:border-b-0">
      <td className="px-3 py-2.5 text-sm font-medium leading-5 text-foreground">{need.item}</td>
      <td className="px-3 py-2.5">
        <NeedKindChip kind={need.kind} />
      </td>
      <td className="px-3 py-2.5 text-xs leading-5 text-foreground-secondary">{need.src ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs leading-5 text-foreground-secondary">{need.owner ?? '—'}</td>
      <td className="px-3 py-2.5">
        <NeedStatusChip status={need.status} />
      </td>
      <td className="px-3 py-2.5">
        <Input
          type="date"
          className="!h-8 !w-auto text-xs"
          value={need.requestedOn ?? ''}
          disabled={isPending}
          onChange={(event) => void onSaveRequestedOn(need.id, event.target.value)}
          aria-label={`Tanggal diminta untuk ${need.item}`}
        />
      </td>
      <td className="px-3 py-2.5">
        <button
          type="button"
          onClick={() => onOpenStep(step.label)}
          className={cn(
            'rounded-sm text-xs font-semibold tabular-nums text-primary underline-offset-4',
            'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label={`Buka step ${step.label} di swimlane`}
        >
          #{step.label}
        </button>
      </td>
    </tr>
  );
}
