/**
 * Claims: statements standing on evidence, in three layers that never blend.
 *
 * Approval is the one button that talks to G-CLAIM; the blockers render
 * BEFORE the click, each naming its record, and the database re-checks
 * everything anyway. Layer A requires its commitment source at birth and is
 * frozen after. Contradictions are recorded here and resolved only with a
 * note — a claim on each side stays individually usable; an output citing
 * both is what the gate refuses.
 */
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { EmptyRow } from '../../../components/ui/EmptyRow';
import { Input } from '../../../components/ui/Input';
import { useMutation } from '../../../hooks/useMutation';
import { claimApprovalBlockers } from '../../../data/labEvidenceGuards';
import type { LabClaimLayer, LabContradictionSeverity, LabEvidenceDirection } from '../../../data/labEvidenceTypes';
import { useAppStore } from '../../../store/appStore';
import { rowsOr } from '../labUi';
import { ClaimStatusChip, DatapointStatusChip, FIELD_LABEL, LayerChip, TEXTAREA, type EvidenceData } from './evidenceUi';

export function EvidenceClaims({ data, projectId }: { data: EvidenceData; projectId: string }) {
  const repository = useAppStore((state) => state.repository);
  const { run: mutate, isPending } = useMutation();
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    statement: '',
    layer: '' as '' | LabClaimLayer,
    commitmentSourceId: '',
    evidenceDirection: 'untested' as LabEvidenceDirection,
    inferenceStep: '',
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [linkPick, setLinkPick] = useState<Record<string, string>>({});
  const [contradictionDraft, setContradictionDraft] = useState({
    a: '',
    b: '',
    severity: '' as '' | LabContradictionSeverity,
  });
  const [resolveNotes, setResolveNotes] = useState<Record<string, string>>({});

  const claims = rowsOr(data.claims).filter((claim) => claim.projectId === projectId);
  const allClaims = rowsOr(data.claims);
  const datapoints = rowsOr(data.datapoints);
  const references = rowsOr(data.references);
  const conflicts = rowsOr(data.conflicts);
  const contradictions = rowsOr(data.contradictions);
  const commitments = rowsOr(data.commitments).filter((row) => row.projectId === projectId);
  const claimLabel = (id: string) => allClaims.find((claim) => claim.id === id)?.statement.slice(0, 60) ?? id;

  const submit = async () => {
    if (!draft.layer) return;
    const saved = await mutate('Create claim', () =>
      repository.labEvidence.createClaim({
        projectId,
        statement: draft.statement.trim(),
        layer: draft.layer as LabClaimLayer,
        commitmentSourceId: draft.layer === 'A' ? draft.commitmentSourceId || null : null,
        evidenceDirection: draft.evidenceDirection,
        inferenceStep: draft.inferenceStep.trim(),
      }),
    );
    if (!saved) return;
    setShowForm(false);
    setDraft({ statement: '', layer: '', commitmentSourceId: '', evidenceDirection: 'untested', inferenceStep: '' });
    data.reload();
  };

  return (
    <div className="grid gap-5">
      <div>
        <Button onClick={() => setShowForm((open) => !open)}>
          <Plus className="size-4" />
          New claim
        </Button>
      </div>

      {showForm && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>New claim</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className={FIELD_LABEL}>
                Statement
                <textarea
                  className={`${TEXTAREA} min-h-16`}
                  value={draft.statement}
                  onChange={(event) => setDraft({ ...draft, statement: event.target.value })}
                  required
                />
              </label>
              <div className="grid gap-3 md:grid-cols-3">
                <label className={FIELD_LABEL}>
                  Layer
                  <select
                    className="native-select"
                    value={draft.layer}
                    onChange={(event) => setDraft({ ...draft, layer: event.target.value as LabClaimLayer })}
                    required
                  >
                    <option value="" disabled>
                      pilih layer
                    </option>
                    <option value="A">A — committed publicly (frozen)</option>
                    <option value="B">B — verified finding</option>
                    <option value="C">C — hypothesis / inference</option>
                  </select>
                </label>
                {draft.layer === 'A' && (
                  <label className={FIELD_LABEL}>
                    Commitment source (wajib untuk layer A)
                    <select
                      className="native-select"
                      value={draft.commitmentSourceId}
                      onChange={(event) => setDraft({ ...draft, commitmentSourceId: event.target.value })}
                      required
                    >
                      <option value="" disabled>
                        pilih dokumen komitmen
                      </option>
                      {commitments.map((commitment) => (
                        <option key={commitment.id} value={commitment.id}>
                          {commitment.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={FIELD_LABEL}>
                  Evidence direction
                  <select
                    className="native-select"
                    value={draft.evidenceDirection}
                    onChange={(event) =>
                      setDraft({ ...draft, evidenceDirection: event.target.value as LabEvidenceDirection })
                    }
                  >
                    <option value="untested">untested</option>
                    <option value="supports">supports</option>
                    <option value="mixed">mixed</option>
                    <option value="contradicts">contradicts</option>
                  </select>
                </label>
              </div>
              {(draft.layer === 'B' || draft.layer === 'C') && (
                <label className={FIELD_LABEL}>
                  Inference step — how the evidence yields the statement (min 20 chars for approval)
                  <textarea
                    className={`${TEXTAREA} min-h-12`}
                    value={draft.inferenceStep}
                    onChange={(event) => setDraft({ ...draft, inferenceStep: event.target.value })}
                  />
                </label>
              )}
              <Button type="submit" size="sm" disabled={isPending || !draft.layer}>
                Create claim
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {claims.length === 0 ? (
        <EmptyRow label="Claims" clause="proyek ini belum punya klaim" />
      ) : (
        <div className="grid gap-3">
          {claims.map((claim) => {
            const isOpen = expanded === claim.id;
            const blockers = claimApprovalBlockers({ claim, datapoints, references, conflicts, contradictions });
            return (
              <Card key={claim.id}>
                <CardContent className="pt-5">
                  <button
                    className="flex w-full flex-wrap items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setExpanded(isOpen ? null : claim.id)}
                  >
                    <LayerChip layer={claim.layer} />
                    <ClaimStatusChip status={claim.status} />
                    <span className="text-sm text-foreground">
                      {claim.statement}
                      {/* The inference step rides INLINE with the layer tag —
                          for B and C the step is part of the claim, never an
                          implied footnote. */}
                      {claim.inferenceStep && (
                        <span className="text-foreground-muted"> — [{claim.layer}] {claim.inferenceStep}</span>
                      )}
                    </span>
                    {claim.createdByRunId && (
                      <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-foreground-muted">
                        dari run
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="mt-4 grid gap-3 border-t border-border-subtle pt-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="surface-label">Evidence</span>
                        {claim.datapointIds.length === 0 && claim.referenceIds.length === 0 && (
                          <span className="text-foreground-muted">belum ada — klaim tanpa bukti tidak akan lolos approval</span>
                        )}
                        {claim.datapointIds.map((id) => {
                          const datapoint = datapoints.find((row) => row.id === id);
                          return datapoint ? (
                            <span key={id} className="flex items-center gap-1 rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5">
                              <span className="tabular-nums">{datapoint.value} {datapoint.unit}</span>
                              <DatapointStatusChip status={datapoint.status} />
                            </span>
                          ) : null;
                        })}
                        {claim.referenceIds.map((id) => {
                          const reference = references.find((row) => row.id === id);
                          return reference ? (
                            <span key={id} className="rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5">
                              {reference.title.slice(0, 32)} · {reference.verificationLevel}
                            </span>
                          ) : null;
                        })}
                      </div>

                      <div className="flex flex-wrap items-end gap-2">
                        <label className={FIELD_LABEL}>
                          Link datapoint
                          <select
                            className="native-select text-xs"
                            value={linkPick[claim.id] ?? ''}
                            onChange={(event) => setLinkPick({ ...linkPick, [claim.id]: event.target.value })}
                          >
                            <option value="">— pilih —</option>
                            {datapoints
                              .filter((row) => !claim.datapointIds.includes(row.id))
                              .map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.value} {row.unit} — {row.definitionScope.slice(0, 40)}
                                </option>
                              ))}
                          </select>
                        </label>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isPending || !linkPick[claim.id]}
                          onClick={() =>
                            void mutate('Link evidence', () =>
                              repository.labEvidence.linkClaimDatapoint(claim.id, linkPick[claim.id]),
                            ).then(() => data.reload())
                          }
                        >
                          Link
                        </Button>
                        {claim.status !== 'approved' ? (
                          <Button
                            size="sm"
                            disabled={isPending || blockers.length > 0}
                            onClick={() =>
                              void mutate('Approve claim', () =>
                                repository.labEvidence.approveClaim(claim.id),
                              ).then((saved) => saved && data.reload())
                            }
                          >
                            Approve
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isPending}
                            onClick={() =>
                              void mutate('Demote claim', () =>
                                repository.labEvidence.demoteClaim(claim.id, 'reviewed'),
                              ).then((saved) => saved && data.reload())
                            }
                          >
                            Demote to reviewed
                          </Button>
                        )}
                      </div>

                      {claim.status !== 'approved' && blockers.length > 0 && (
                        <ul className="grid gap-1 text-xs leading-5 text-escalate">
                          {blockers.map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      )}
                      {claim.approvedByHumanAt && (
                        <p className="text-xs text-foreground-muted">
                          Disetujui manual {claim.approvedByHumanAt.slice(0, 10)} — stempel milik database, bukan klien.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Contradictions</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="mb-4 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!contradictionDraft.severity || !contradictionDraft.a || !contradictionDraft.b) return;
              void mutate('Record contradiction', () =>
                repository.labEvidence.createContradiction({
                  claimAId: contradictionDraft.a,
                  claimBId: contradictionDraft.b,
                  severity: contradictionDraft.severity as LabContradictionSeverity,
                }),
              ).then((saved) => {
                if (!saved) return;
                setContradictionDraft({ a: '', b: '', severity: '' });
                data.reload();
              });
            }}
          >
            {(['a', 'b'] as const).map((side) => (
              <label key={side} className={FIELD_LABEL}>
                Claim {side.toUpperCase()}
                {/* Cross-project on purpose: the higher-value catch is a new
                    finding contradicting something committed ELSEWHERE. */}
                <select
                  className="native-select text-xs"
                  value={contradictionDraft[side]}
                  onChange={(event) =>
                    setContradictionDraft({ ...contradictionDraft, [side]: event.target.value })
                  }
                  required
                >
                  <option value="" disabled>
                    pilih (lintas proyek)
                  </option>
                  {allClaims.map((claim) => (
                    <option key={claim.id} value={claim.id}>
                      [{claim.layer}] {claim.statement.slice(0, 50)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className={FIELD_LABEL}>
              Severity
              <select
                className="native-select text-xs"
                value={contradictionDraft.severity}
                onChange={(event) =>
                  setContradictionDraft({
                    ...contradictionDraft,
                    severity: event.target.value as LabContradictionSeverity,
                  })
                }
                required
              >
                <option value="" disabled>
                  pilih
                </option>
                <option value="direct">direct</option>
                <option value="tension">tension</option>
                <option value="scope_difference">scope_difference</option>
              </select>
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
              Record contradiction
            </Button>
          </form>
          {contradictions.length === 0 ? (
            <EmptyRow label="Contradictions" clause="tidak ada kontradiksi tercatat" />
          ) : (
            <ul className="grid gap-2">
              {contradictions.map((contradiction) => (
                <li key={contradiction.id} className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                  <p className="text-foreground-secondary">
                    {contradiction.severity} · {contradiction.status} — {claimLabel(contradiction.claimAId)} ⟷{' '}
                    {claimLabel(contradiction.claimBId)}
                    {contradiction.resolutionNote && ` — ${contradiction.resolutionNote}`}
                  </p>
                  {contradiction.status === 'open' && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className={`${FIELD_LABEL} grow`}>
                        Resolution note — tidak pernah otomatis, tidak pernah memihak yang lebih baru
                        <Input
                          value={resolveNotes[contradiction.id] ?? ''}
                          onChange={(event) =>
                            setResolveNotes({ ...resolveNotes, [contradiction.id]: event.target.value })
                          }
                        />
                      </label>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isPending || !(resolveNotes[contradiction.id] ?? '').trim()}
                        onClick={() =>
                          void mutate('Resolve contradiction', () =>
                            repository.labEvidence.resolveContradiction(
                              contradiction.id,
                              (resolveNotes[contradiction.id] ?? '').trim(),
                            ),
                          ).then((saved) => saved && data.reload())
                        }
                      >
                        Resolve
                      </Button>
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
