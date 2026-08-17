/**
 * Models — the MODELER surface (phase 4). Specs are declarative JSON, never
 * code; the only thing that ever executes one is the version-pinned
 * first-party evaluator. Every run's checks render as rows — a failed run
 * is a recorded failure, not an absence — and a figure enters a draft only
 * as [sim:<result id>] naming a result that earned it.
 */
import { Play, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { useMutation } from '../../../hooks/useMutation';
import { useAppStore } from '../../../store/appStore';
import { cn } from '../../../lib/utils';
import { proposeModelSpec, runModel } from '../../../data/labEvidenceAgents';
import { LAB_CHIP, rowsOr } from '../labUi';
import { FIELD_LABEL, TEXTAREA, type EvidenceData } from './evidenceUi';

export function EvidenceModels({ data, projectId }: { data: EvidenceData; projectId: string }) {
  const repository = useAppStore((state) => state.repository);
  const { run: mutate, isPending } = useMutation();

  const specs = rowsOr(data.modelSpecs).filter((spec) => spec.projectId === projectId);
  const params = rowsOr(data.modelParams);
  const results = rowsOr(data.modelResults);
  const datapoints = rowsOr(data.datapoints);

  const [brief, setBrief] = useState('');
  const [note, setNote] = useState('');
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [externalDraft, setExternalDraft] = useState<{ specId: string; value: string; unit: string; note: string } | null>(null);

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="pt-5">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Propose a model</h2>
          <p className="mb-3 text-xs leading-5 text-foreground-muted">
            The modeler proposes a DECLARATIVE spec — one arithmetic expression over named
            parameters, distributions, scenarios. Never code: anything that does not parse under
            the first-party grammar is refused before a row exists. It lands as a draft; the
            rationale, the approval and every run are yours.
          </p>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setNote('');
              void proposeModelSpec({ projectId, brief }).then((result) => {
                if (result.ok) {
                  setNote(`Draft spec proposed (${result.params.length} params; ${result.skipped.length} skipped).`);
                  setBrief('');
                  data.reload();
                } else setNote(result.reason);
              });
            }}
          >
            <label className={FIELD_LABEL}>
              Brief — what should the model estimate, from which evidence?
              <textarea
                className={`${TEXTAREA} min-h-16`}
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
              />
            </label>
            <div>
              <Button type="submit" size="sm" variant="secondary" disabled={!brief.trim()}>
                <Sparkles className="size-4" />
                Propose (draft only)
              </Button>
            </div>
          </form>
          {note && <p className="mt-2 text-xs text-foreground-secondary">{note}</p>}
        </CardContent>
      </Card>

      {specs.length === 0 && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-foreground-muted">Belum ada model spec untuk proyek ini.</p>
          </CardContent>
        </Card>
      )}

      {specs.map((spec) => {
        const myParams = params.filter((param) => param.specId === spec.id);
        const myResults = results.filter((result) => result.specId === spec.id);
        return (
          <Card key={spec.id}>
            <CardContent className="pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{spec.name}</span>
                <span className={cn(LAB_CHIP, 'border border-border text-foreground-muted')}>{spec.kind}</span>
                <span
                  className={cn(
                    LAB_CHIP,
                    spec.status === 'approved'
                      ? 'border border-success/40 text-success'
                      : 'border border-border-subtle text-foreground-muted',
                  )}
                >
                  {spec.status}
                </span>
                <span className="text-[10px] text-foreground-muted">hash {spec.specHash.slice(0, 12)}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-foreground-secondary">
                {String((spec.spec as { expression?: unknown }).expression ?? '')} →{' '}
                {String((spec.spec as { outputUnit?: unknown }).outputUnit ?? '(dimensionless)')}
              </p>
              {spec.rationale && (
                <p className="mt-1 text-xs leading-5 text-foreground-muted">
                  <span className="font-semibold">Rationale (owner):</span> {spec.rationale}
                </p>
              )}

              {myParams.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                  {myParams.map((param) => {
                    const datapoint = param.datapointId
                      ? datapoints.find((row) => row.id === param.datapointId)
                      : undefined;
                    return (
                      <li key={param.id} className="rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5">
                        <span className="font-mono">{param.name}</span> ·{' '}
                        {param.kind === 'datapoint'
                          ? `datapoint ${datapoint ? `${datapoint.value} ${datapoint.unit}` : param.datapointId}`
                          : `assumption ${param.value}`}{' '}
                        {param.unit && <span className="text-foreground-muted">[{param.unit}]</span>}
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-3 flex flex-wrap items-end gap-2">
                {spec.status === 'draft' ? (
                  <>
                    <label className={`${FIELD_LABEL} grow`}>
                      Rationale — your reasoning, not the model's echo (min 20 chars)
                      <Input
                        value={rationales[spec.id] ?? ''}
                        onChange={(event) => setRationales({ ...rationales, [spec.id]: event.target.value })}
                      />
                    </label>
                    <Button
                      size="sm"
                      disabled={isPending || (rationales[spec.id] ?? '').trim().length < 20}
                      onClick={() =>
                        void mutate('Approve spec', () =>
                          repository.labEvidence.approveModelSpec(spec.id, (rationales[spec.id] ?? '').trim()),
                        ).then((saved) => saved && data.reload())
                      }
                    >
                      Approve
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      void mutate('Demote spec', () =>
                        repository.labEvidence.demoteModelSpec(spec.id),
                      ).then((saved) => saved && data.reload())
                    }
                  >
                    Demote to draft
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => {
                    setNote('');
                    void runModel({ specId: spec.id, seed: 1 }).then((result) => {
                      if (result.ok) {
                        setNote(
                          `Run ${result.resultId.slice(0, 8)}: value ${result.value ?? '—'} ${result.unit} · checks ${result.checksPassed ? 'PASSED' : 'FAILED (recorded)'} · sensitivity ${result.sensitivityPassed ? 'passed' : 'failed'}`,
                        );
                        data.reload();
                      } else setNote(result.reason);
                    });
                  }}
                >
                  <Play className="size-4" />
                  Run (evaluator)
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setExternalDraft({ specId: spec.id, value: '', unit: '', note: '' })}
                >
                  <Plus className="size-4" />
                  Register external result
                </Button>
              </div>

              {externalDraft?.specId === spec.id && (
                <form
                  className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-border-subtle p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate('Register external result', () =>
                      repository.labEvidence.registerExternalModelResult({
                        specId: spec.id,
                        value: Number(externalDraft.value),
                        unit: externalDraft.unit.trim(),
                        note: externalDraft.note.trim(),
                      }),
                    ).then((saved) => {
                      if (!saved) return;
                      setExternalDraft(null);
                      data.reload();
                    });
                  }}
                >
                  <label className={FIELD_LABEL}>
                    Value
                    <Input
                      value={externalDraft.value}
                      onChange={(event) => setExternalDraft({ ...externalDraft, value: event.target.value })}
                      required
                    />
                  </label>
                  <label className={FIELD_LABEL}>
                    Unit
                    <Input
                      value={externalDraft.unit}
                      onChange={(event) => setExternalDraft({ ...externalDraft, unit: event.target.value })}
                    />
                  </label>
                  <label className={`${FIELD_LABEL} grow`}>
                    Where computed + how to reproduce (min 20 chars)
                    <Input
                      value={externalDraft.note}
                      onChange={(event) => setExternalDraft({ ...externalDraft, note: event.target.value })}
                      required
                    />
                  </label>
                  <Button type="submit" size="sm" disabled={isPending}>Register</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setExternalDraft(null)}>
                    Cancel
                  </Button>
                </form>
              )}

              {myResults.length > 0 && (
                <ul className="mt-3 grid gap-2">
                  {myResults.map((result) => (
                    <li key={result.id} className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-foreground">
                          {result.resultValue ?? '—'} {result.resultUnit}
                        </span>
                        <span
                          className={cn(
                            LAB_CHIP,
                            result.checksPassed
                              ? 'border border-success/40 text-success'
                              : 'border border-escalate/40 text-escalate',
                          )}
                        >
                          checks {result.checksPassed ? 'passed' : 'FAILED'}
                        </span>
                        {result.staleInput && (
                          <span className={cn(LAB_CHIP, 'border border-escalate/40 text-escalate')}>stale input</span>
                        )}
                        {result.external && (
                          <span className={cn(LAB_CHIP, 'border border-border text-foreground-muted')}>external</span>
                        )}
                        <span className="text-foreground-muted">
                          {result.evaluatorVersion}
                          {result.seed !== null && ` · seed ${result.seed}`} · tag: [sim:{result.id}]
                        </span>
                      </div>
                      {result.checks.length > 0 && (
                        <ul className="mt-1 grid gap-0.5 text-[11px] leading-4 text-foreground-muted">
                          {result.checks.map((check, index) => (
                            <li key={index}>
                              {check.passed ? '✓' : '✗'} {check.name}: {check.detail}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
