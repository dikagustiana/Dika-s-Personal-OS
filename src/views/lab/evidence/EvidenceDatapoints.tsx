/**
 * Datapoints: the atomic unit of evidence, shared across projects.
 *
 * G-EXTRACT rides the create form (the repository and the database both
 * refuse anyway); G-VERIFY is the per-row Verifikasi act, with the reason a
 * row cannot verify shown before the button is pressed. Conflicts live here
 * too — both sides retained, resolved only with a note. The sweep button
 * applies the standing expiry policy on demand; pg_cron runs it nightly.
 */
import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { EmptyRow } from '../../../components/ui/EmptyRow';
import { Input } from '../../../components/ui/Input';
import { useMutation } from '../../../hooks/useMutation';
import { verifyBlockedReason } from '../../../data/labEvidenceGuards';
import type { LabConflictType, LabExtractionMethod, LabVolatility } from '../../../data/labEvidenceTypes';
import { pushToast } from '../../../store/toastStore';
import { useAppStore } from '../../../store/appStore';
import { rowsOr } from '../labUi';
import { DatapointStatusChip, FIELD_LABEL, TEXTAREA, type EvidenceData } from './evidenceUi';

export function EvidenceDatapoints({ data }: { data: EvidenceData }) {
  const repository = useAppStore((state) => state.repository);
  const { run: mutate, isPending } = useMutation();
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    value: '',
    unit: '',
    year: '',
    geography: '',
    definitionScope: '',
    sourceDocumentId: '',
    locator: '',
    volatilityClass: '' as '' | LabVolatility,
    extractionMethod: 'manual' as LabExtractionMethod,
    status: 'IND' as 'IND' | 'NA',
  });
  const [verifyNotes, setVerifyNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [conflictDraft, setConflictDraft] = useState({
    a: '',
    b: '',
    type: '' as '' | LabConflictType,
  });
  const [resolveNotes, setResolveNotes] = useState<Record<string, string>>({});

  const datapoints = rowsOr(data.datapoints);
  const sources = rowsOr(data.sources);
  const conflicts = rowsOr(data.conflicts);
  const sourceTitle = (id: string) => sources.find((source) => source.id === id)?.title ?? id;

  const submit = async () => {
    if (!draft.volatilityClass) return;
    const saved = await mutate('Record datapoint', () =>
      repository.labEvidence.createDatapoint({
        value: Number(draft.value),
        unit: draft.unit.trim(),
        year: draft.year ? Number(draft.year) : null,
        geography: draft.geography.trim(),
        definitionScope: draft.definitionScope,
        sourceDocumentId: draft.sourceDocumentId,
        locator: draft.locator.trim(),
        volatilityClass: draft.volatilityClass as LabVolatility,
        extractionMethod: draft.extractionMethod,
        status: draft.status,
      }),
    );
    if (!saved) return;
    setShowForm(false);
    setDraft({ value: '', unit: '', year: '', geography: '', definitionScope: '', sourceDocumentId: '', locator: '', volatilityClass: '', extractionMethod: 'manual', status: 'IND' });
    data.reload();
  };

  const runSweep = async () => {
    const reverted = await mutate('Stale sweep', () => repository.labEvidence.staleSweep());
    if (reverted === undefined) return;
    pushToast({
      tone: 'info',
      message:
        reverted === 0
          ? 'Sweep: tidak ada source-match yang kedaluwarsa.'
          : `Sweep: ${reverted} datapoint kehilangan source-match (kembali ke IND) — klaim terkait turun ke reviewed.`,
    });
    data.reload();
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setShowForm((open) => !open)}>
          <Plus className="size-4" />
          New datapoint
        </Button>
        <Button variant="secondary" onClick={() => void runSweep()} disabled={isPending}>
          <RefreshCw className="size-4" />
          Run stale sweep
        </Button>
        <span className="text-xs text-foreground-muted">
          volatile kedaluwarsa 180 hari, slow 365, static tidak pernah
        </span>
      </div>

      {showForm && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>New datapoint</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="grid gap-3 md:grid-cols-4">
                <label className={FIELD_LABEL}>
                  Value
                  <Input type="number" step="any" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} required />
                </label>
                <label className={FIELD_LABEL}>
                  Unit
                  <Input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} />
                </label>
                <label className={FIELD_LABEL}>
                  Year
                  <Input type="number" value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })} />
                </label>
                <label className={FIELD_LABEL}>
                  Geography
                  <Input value={draft.geography} onChange={(event) => setDraft({ ...draft, geography: event.target.value })} />
                </label>
              </div>
              <label className={FIELD_LABEL}>
                Definition scope — the exact concept measured, min 20 characters ({draft.definitionScope.trim().length}/20)
                <textarea
                  className={`${TEXTAREA} min-h-16`}
                  value={draft.definitionScope}
                  onChange={(event) => setDraft({ ...draft, definitionScope: event.target.value })}
                  placeholder="Basis kelembagaan, cakupan sektor, perlakuan komponen, konvensi vintage — dua sumber dengan nama sama sering mengukur hal berbeda."
                  required
                />
              </label>
              <div className="grid gap-3 md:grid-cols-4">
                <label className={`${FIELD_LABEL} md:col-span-2`}>
                  Source document
                  <select className="native-select" value={draft.sourceDocumentId} onChange={(event) => setDraft({ ...draft, sourceDocumentId: event.target.value })} required>
                    <option value="" disabled>
                      pilih sumber (snapshot wajib ada)
                    </option>
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={FIELD_LABEL}>
                  Locator
                  <Input value={draft.locator} onChange={(event) => setDraft({ ...draft, locator: event.target.value })} placeholder="tab 2.1 / p.12" required />
                </label>
                <label className={FIELD_LABEL}>
                  Volatility
                  <select
                    className="native-select"
                    value={draft.volatilityClass}
                    onChange={(event) => setDraft({ ...draft, volatilityClass: event.target.value as LabVolatility })}
                    required
                  >
                    {/* No default: assigning volatility is part of ingestion.
                        Current institutional/market state is volatile;
                        historical outturns and constants are static. */}
                    <option value="" disabled>
                      pilih kelas
                    </option>
                    <option value="volatile">volatile — keadaan saat ini</option>
                    <option value="slow">slow</option>
                    <option value="static">static — outturn historis</option>
                  </select>
                </label>
                <label className={FIELD_LABEL}>
                  Status
                  <select
                    className="native-select"
                    value={draft.status}
                    onChange={(event) =>
                      setDraft({ ...draft, status: event.target.value as 'IND' | 'NA' })
                    }
                  >
                    {/* 1.9: NA is a real answer — sought and not available —
                        worth recording, never a blank. A status with no
                        entry path is a paper feature. */}
                    <option value="IND">IND — extracted, belum di-match</option>
                    <option value="NA">NA — dicari dan tidak tersedia</option>
                  </select>
                </label>
              </div>
              <Button type="submit" size="sm" disabled={isPending || !draft.volatilityClass}>
                Record datapoint
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {data.datapoints === null ? null : !data.datapoints.ok ? null : datapoints.length === 0 ? (
        <EmptyRow label="Datapoints" clause="belum ada datapoint" />
      ) : (
        <section className="canvas-bleed rounded-lg border border-border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2">
                  {['Value', 'Definition scope', 'Source · locator', 'Status', 'Volatility', 'Method'].map((heading) => (
                    <th key={heading} scope="col" className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-foreground-muted">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datapoints.map((datapoint) => {
                  const isOpen = expanded === datapoint.id;
                  const blocked = verifyBlockedReason(datapoint, verifyNotes[datapoint.id] ?? '');
                  return [
                    <tr
                      key={datapoint.id}
                      className="cursor-pointer border-b border-border-subtle align-top last:border-b-0 hover:bg-surface-2"
                      onClick={() => setExpanded(isOpen ? null : datapoint.id)}
                    >
                      <td className="px-3 py-2.5 text-xs tabular-nums text-foreground">
                        {datapoint.value} {datapoint.unit}
                        {datapoint.year !== null ? ` · ${datapoint.year}` : ''}
                      </td>
                      <td className="max-w-72 px-3 py-2.5 text-xs leading-5 text-foreground-secondary">
                        {datapoint.definitionScope}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-foreground-muted">
                        {sourceTitle(datapoint.sourceDocumentId)} · {datapoint.locator}
                      </td>
                      <td className="px-3 py-2.5">
                        <DatapointStatusChip status={datapoint.status} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-foreground-muted">{datapoint.volatilityClass}</td>
                      <td className="px-3 py-2.5 text-xs text-foreground-muted">{datapoint.extractionMethod}</td>
                    </tr>,
                    isOpen ? (
                      <tr key={`${datapoint.id}-detail`} className="border-b border-border-subtle last:border-b-0">
                        <td colSpan={6} className="bg-surface-2/60 px-4 py-3">
                          {datapoint.status === 'V' ? (
                            <p className="text-xs leading-5 text-foreground-secondary">
                              Source-matched {datapoint.verifiedAt?.slice(0, 10)} — {datapoint.verificationNote}
                            </p>
                          ) : (
                            <div onClick={(event) => event.stopPropagation()}>
                              {/* 1.11: the three things the owner must
                                  actually consult to match this value are ON
                                  the surface where the match happens —
                                  nothing pre-filled, nothing to rubber-stamp
                                  past without seeing. */}
                              <dl className="mb-2 grid gap-x-5 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                                <dt className="surface-label">Locator</dt>
                                <dd className="text-foreground-secondary">{datapoint.locator}</dd>
                                <dt className="surface-label">Source</dt>
                                <dd className="text-foreground-secondary">{sourceTitle(datapoint.sourceDocumentId)}</dd>
                                <dt className="surface-label">Definition scope</dt>
                                <dd className="leading-5 text-foreground-secondary">{datapoint.definitionScope}</dd>
                              </dl>
                              <div className="flex flex-wrap items-end gap-2">
                                <label className={`${FIELD_LABEL} grow`}>
                                  Match note — apa yang dibandingkan terhadap apa
                                  <Input
                                    value={verifyNotes[datapoint.id] ?? ''}
                                    onChange={(event) =>
                                      setVerifyNotes({ ...verifyNotes, [datapoint.id]: event.target.value })
                                    }
                                  />
                                </label>
                                <Button
                                  size="sm"
                                  disabled={isPending || Boolean(blocked)}
                                  onClick={() =>
                                    void mutate('Source-match datapoint', () =>
                                      repository.labEvidence.verifyDatapoint(
                                        datapoint.id,
                                        (verifyNotes[datapoint.id] ?? '').trim(),
                                      ),
                                    ).then((saved) => saved && data.reload())
                                  }
                                >
                                  Source-match
                                </Button>
                                {blocked && <span className="text-xs text-foreground-muted">{blocked}</span>}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Conflicts</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="mb-4 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!conflictDraft.type || !conflictDraft.a || !conflictDraft.b) return;
              void mutate('Record conflict', () =>
                repository.labEvidence.createConflict({
                  datapointAId: conflictDraft.a,
                  datapointBId: conflictDraft.b,
                  conflictType: conflictDraft.type as LabConflictType,
                }),
              ).then((saved) => {
                if (!saved) return;
                setConflictDraft({ a: '', b: '', type: '' });
                data.reload();
              });
            }}
          >
            {(['a', 'b'] as const).map((side) => (
              <label key={side} className={FIELD_LABEL}>
                Datapoint {side.toUpperCase()}
                <select
                  className="native-select text-xs"
                  value={conflictDraft[side]}
                  onChange={(event) => setConflictDraft({ ...conflictDraft, [side]: event.target.value })}
                  required
                >
                  <option value="" disabled>
                    pilih
                  </option>
                  {datapoints.map((datapoint) => (
                    <option key={datapoint.id} value={datapoint.id}>
                      {datapoint.value} {datapoint.unit} — {datapoint.definitionScope.slice(0, 40)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className={FIELD_LABEL}>
              Type
              <select
                className="native-select text-xs"
                value={conflictDraft.type}
                onChange={(event) => setConflictDraft({ ...conflictDraft, type: event.target.value as LabConflictType })}
                required
              >
                <option value="" disabled>
                  pilih
                </option>
                <option value="value_mismatch">value_mismatch</option>
                <option value="definition_mismatch">definition_mismatch</option>
                <option value="vintage_mismatch">vintage_mismatch</option>
              </select>
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
              Record conflict
            </Button>
          </form>
          {conflicts.length === 0 ? (
            <EmptyRow label="Conflicts" clause="tidak ada konflik tercatat" />
          ) : (
            <ul className="grid gap-2">
              {conflicts.map((conflict) => (
                <li key={conflict.id} className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                  <p className="text-foreground-secondary">
                    {conflict.conflictType} · {conflict.resolutionStatus}
                    {conflict.resolutionNote && ` — ${conflict.resolutionNote}`}
                  </p>
                  {conflict.resolutionStatus === 'unresolved' && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className={`${FIELD_LABEL} grow`}>
                        Resolution note — kedua baris tetap tersimpan; katakan mana yang berlaku dan kenapa
                        <Input
                          value={resolveNotes[conflict.id] ?? ''}
                          onChange={(event) => setResolveNotes({ ...resolveNotes, [conflict.id]: event.target.value })}
                        />
                      </label>
                      {(['resolved_prefer_a', 'resolved_prefer_b', 'resolved_both_valid'] as const).map((resolution) => (
                        <Button
                          key={resolution}
                          size="sm"
                          variant="secondary"
                          disabled={isPending || !(resolveNotes[conflict.id] ?? '').trim()}
                          onClick={() =>
                            void mutate('Resolve conflict', () =>
                              repository.labEvidence.resolveConflict(
                                conflict.id,
                                resolution,
                                (resolveNotes[conflict.id] ?? '').trim(),
                              ),
                            ).then((saved) => saved && data.reload())
                          }
                        >
                          {resolution.replace('resolved_', '')}
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
