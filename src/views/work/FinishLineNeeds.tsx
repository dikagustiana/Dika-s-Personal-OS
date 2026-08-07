/**
 * The Finish line's Kebutuhan data tab (/finish-line/kebutuhan-data): every
 * data item ONE ENTITY'S chain needs — SAMB or ARBI, per the shared entity
 * state — joined to its step, with the proportion bar and the per-owner
 * grouping that turns the list into an actual request to send someone.
 *
 * The ENTITY is the one piece of state shared with the swimlane tab; the
 * JALUR filter is deliberately local here, defaulting to Semua: on this tab
 * a track selection silently narrows the request list, so when one is
 * active the bar above the table SAYS how many rows it is hiding — a
 * request list with unexplained holes is worse than a longer list.
 *
 * What this register adds over os_finish_line_accounts — which already holds
 * the ideal data, its source and its owner for most accounts — is how ready
 * each item is and when it was asked for. It is not a second home for facts
 * that table owns.
 *
 * requested_on is editable inline HERE, without opening anything: status
 * BELUM moves nobody, and "diminta tanggal X, belum dijawab" moves. The rest
 * of a need's text — item, jenis, status, sumber, pemilik — is edited from
 * the swimlane's step panel, where the step it belongs to is on screen to
 * read it against. Nothing on either tab can add or delete a row.
 *
 * A missing os_process_* relation renders the one-line empty state — the
 * migration lands after this view ships (§0), so that is the normal
 * pre-deploy render, not an error.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '../../components/ui/Input';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { okRows, rowsOf, type ReadResult } from '../../data/readResult';
import type {
  ProcessNeed,
  ProcessNeedKind,
  ProcessNeedStatus,
  ProcessReference,
  ProcessStep,
  ProcessTrackDef,
} from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import {
  buildRegisterState,
  groupByOwner,
  registerRows,
  summarizeNeeds,
  type EmptyCause,
  type RegisterRow,
} from '../../logic/processModel';
import {
  ALL_TRACKS,
  sharedTrackCodes,
  type TrackFilter,
} from '../../logic/process';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils';
import { Checking, CouldNotCheck } from './finishLineUi';
import {
  EntityScopeRow,
  NeedKindChip,
  NeedStatusChip,
  TrackFilterGroup,
  filterButtonClass,
} from './processUi';
import { DEFAULT_PROCESS_ENTITY } from './finishLineRoute';
import {
  ReferencesPanel,
  ReferencesToggle,
  referencesState,
} from './ProcessReferences';

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
  const entity = useAppStore((state) => state.prosesEntity);
  const setEntity = useAppStore((state) => state.setProsesEntity);
  const { run, isPending } = useMutation();

  // Per-tab local jalur, default Semua — never shared with the swimlane —
  // and reset on entity switch, where the old code would name a track the
  // new entity does not have.
  const [track, setTrack] = useState<TrackFilter>(ALL_TRACKS);
  useEffect(() => {
    setTrack(ALL_TRACKS);
  }, [entity]);

  const [stepsRead, setStepsRead] = useState<ReadResult<ProcessStep>>(unread);
  const [needsRead, setNeedsRead] = useState<ReadResult<ProcessNeed>>(unread);
  const [tracksRead, setTracksRead] = useState<ReadResult<ProcessTrackDef>>(unread);
  const [referencesRead, setReferencesRead] = useState<ReadResult<ProcessReference>>(unread);
  const [referencesOpen, setReferencesOpen] = useState(false);
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
    const [steps, needs, tracks, references] = await Promise.all([
      repository.listProcessSteps(),
      repository.listProcessNeeds(),
      repository.listProcessTracks(),
      repository.listProcessReferences(),
    ]);
    setStepsRead(steps);
    setNeedsRead(needs);
    setTracksRead(tracks);
    setReferencesRead(references);
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void load().catch(() => setLoaded(true));
  }, [load]);

  const allSteps = rowsOf(stepsRead);
  const needs = rowsOf(needsRead);
  const state = buildRegisterState(stepsRead, needsRead, tracksRead);

  // Entity slicing: steps directly, needs through their step ids; the track
  // vocabulary comes from the register state so the legacy (pre-52) window
  // uses the same compatibility defs as the swimlane.
  const steps = useMemo(
    () => allSteps.filter((step) => step.entityCode === entity),
    [allSteps, entity],
  );
  const entitiesWithSteps = useMemo(() => {
    const codes = [...new Set(allSteps.map((step) => step.entityCode))];
    return codes.sort((a, b) =>
      a === DEFAULT_PROCESS_ENTITY ? -1 : b === DEFAULT_PROCESS_ENTITY ? 1 : a.localeCompare(b),
    );
  }, [allSteps]);
  const entityTracks = useMemo(
    () =>
      state.kind === 'ready'
        ? state.tracks.filter((trackDef) => trackDef.entityCode === entity)
        : [],
    [state, entity],
  );
  const shared = useMemo(() => sharedTrackCodes(entityTracks), [entityTracks]);

  const summary = useMemo(
    () => summarizeNeeds(needs, steps, track, shared),
    [needs, steps, track, shared],
  );
  const rows = useMemo(
    () => registerRows(needs, steps, { track, status: statusOn, kind: kindOn }, shared),
    [needs, steps, track, statusOn, kindOn, shared],
  );
  // §4.1: an active jalur filter must SAY what it hides — the same
  // status/kind slice under Semua, minus what survives the track.
  const hiddenByTrack = useMemo(() => {
    if (track === ALL_TRACKS) return 0;
    return (
      registerRows(needs, steps, { track: ALL_TRACKS, status: statusOn, kind: kindOn }, shared)
        .length - rows.length
    );
  }, [needs, steps, track, statusOn, kindOn, shared, rows.length]);
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

  // Absent table (pre-migration 42P01) or zero rows → the block does not
  // render at all. A real failure still shows, inline in the scope row.
  const references = referencesState(referencesRead);

  return (
    <>
      {/* Entity + this tab's description. No <h1> — the area owns the only
          one on the page. The picker is the same shared entity state the
          swimlane uses; the description stays generic because the job here
          (compose the request list) is the same whichever chain is in view. */}
      <EntityScopeRow
        entities={entitiesWithSteps.length > 0 ? entitiesWithSteps : [entity]}
        value={entity}
        onChange={setEntity}
        scope="Apa yang harus ada supaya rantai ini bisa dijalankan — bukan apa yang dihasilkan tiap step. Kelompokkan per pemilik untuk mendapat daftar permintaan data."
        trailing={
          <ReferencesToggle
            state={references}
            open={referencesOpen}
            onToggle={() => setReferencesOpen((current) => !current)}
          />
        }
      />
      <ReferencesPanel state={references} open={referencesOpen} />

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
      ) : steps.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-card px-4">
          <EmptyRow
            label="Kebutuhan data"
            clause={`Entitas ${entity} belum punya rantai proses — pilih entitas lain di atas.`}
          />
        </div>
      ) : (
        <>
          {state.legacyEntity && (
            <p className="mb-4 flex min-h-9 items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-4 text-xs leading-5 text-foreground-secondary">
              Fitur multi-entitas belum aktif — migration entity-aware belum diterapkan; yang
              tampil register SAMB, seperti sebelumnya.
            </p>
          )}
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
            <TrackFilterGroup tracks={entityTracks} value={track} onChange={setTrack} />
            <button
              type="button"
              aria-pressed={byOwner}
              onClick={() => setByOwner((current) => !current)}
              className={filterButtonClass(byOwner)}
            >
              Kelompokkan per pemilik
            </button>
            <span className="text-xs tabular-nums text-foreground-muted">
              {rows.length} baris
              {hiddenByTrack > 0 && (
                <span className="text-escalate">
                  {' '}
                  · {hiddenByTrack} baris di luar jalur ini disembunyikan
                </span>
              )}
            </span>
          </div>

          {/* canvas-bleed: seven columns, and `item` is the one that carries
              the meaning — it truncates first and hardest at 1076px. Lower
              priority than the swimlane canvas but the same direction, and
              the same floor: at narrow widths this resolves to today's
              layout exactly. The filter row and the summary above stay in
              the measure; they are prose. */}
          <section
            data-needs-table
            className="canvas-bleed rounded-lg border border-border bg-card shadow-card"
          >
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
