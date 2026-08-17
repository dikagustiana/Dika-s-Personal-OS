/**
 * F4 — the chain builder. A LINEAR ORDERED LIST, deliberately not a canvas:
 * v1 chains are sequences, and a node editor for a sequence is decoration
 * with edge cases (the deferral is recorded in TODO.md).
 *
 * Running: the browser sequences the steps — one executor call per step, the
 * council's one-stage-per-call shape — so each step streams, each failure is
 * survivable, and each row lands with chain_id / step_index / parent_run_id
 * stamped by the executor. On the first error the remaining steps are marked
 * error server-side, naming the step that sank the chain. No retries in v1;
 * failures surface.
 */
import { ArrowDown, ArrowUp, Play, Plus, ScrollText, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { Input } from '../../components/ui/Input';
import { useMutation } from '../../hooks/useMutation';
import { markChainAborted, runLabAgent } from '../../data/labModel';
import type { LabChain, LabChainStep } from '../../data/labTypes';
import { chainIssues, interpolateTemplate, moveStep } from '../../logic/lab/labChains';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils';
import { CouldNotCheck, Checking } from '../work/finishLineUi';
import { RunStatusChip, rowsOr, useLabData } from './labUi';

interface StepProgress {
  status: 'pending' | 'running' | 'ok' | 'error';
  runId?: string;
  note?: string;
}

interface ChainDraft {
  name: string;
  description: string;
  steps: LabChainStep[];
}

const EMPTY_DRAFT: ChainDraft = { name: '', description: '', steps: [] };

export function LabChains() {
  const repository = useAppStore((state) => state.repository);
  const setLabView = useAppStore((state) => state.setLabView);
  const setLabLogFocus = useAppStore((state) => state.setLabLogFocus);
  const { agents, chains, reload } = useLabData();
  const [selectedId, setSelectedId] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<ChainDraft>(EMPTY_DRAFT);
  const [initialInput, setInitialInput] = useState('');
  const [progress, setProgress] = useState<StepProgress[] | null>(null);
  const [liveOutput, setLiveOutput] = useState('');
  const [chainRunning, setChainRunning] = useState(false);
  const { run: mutate, isPending } = useMutation();

  const agentRows = rowsOr(agents).filter((agent) => agent.isActive);
  const chainRows = rowsOr(chains);
  const knownSlugs = useMemo(() => new Set(agentRows.map((agent) => agent.slug)), [agentRows]);

  const selected = selectedId !== 'new' ? chainRows.find((chain) => chain.id === selectedId) : undefined;
  const issues = chainIssues(draft.steps, knownSlugs);
  const dirty =
    selectedId === 'new'
      ? true
      : selected
        ? JSON.stringify(draftOf(selected)) !== JSON.stringify(draft)
        : false;

  function draftOf(chain: LabChain): ChainDraft {
    return {
      name: chain.name,
      description: chain.description,
      steps: chain.steps.map((step) => ({ ...step })),
    };
  }

  const select = (chain: LabChain) => {
    setSelectedId(chain.id);
    setDraft(draftOf(chain));
    setProgress(null);
    setLiveOutput('');
  };

  const save = async () => {
    const input = { name: draft.name.trim(), description: draft.description, steps: draft.steps };
    const saved = await mutate(selectedId === 'new' ? 'Create chain' : 'Update chain', () =>
      selectedId === 'new'
        ? repository.lab.createChain(input)
        : repository.lab.updateChain(selectedId as string, input),
    );
    if (!saved) return;
    setSelectedId(saved.id);
    setDraft(draftOf(saved));
    reload();
  };

  const setStep = (index: number, patch: Partial<LabChainStep>) => {
    setDraft({
      ...draft,
      steps: draft.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    });
  };

  /**
   * The sequential runner. Each step's streamed text becomes the next
   * step's {{previous_output}}; each step's runId becomes the next row's
   * parent_run_id — that is the lineage the log renders.
   */
  const runChain = async () => {
    if (!selected || dirty || issues.length > 0 || chainRunning) return;
    setChainRunning(true);
    const states: StepProgress[] = selected.steps.map(() => ({ status: 'pending' }));
    setProgress([...states]);
    let previousOutput = '';
    let parentRunId: string | undefined;

    for (let index = 0; index < selected.steps.length; index += 1) {
      const step = selected.steps[index];
      states[index] = { status: 'running' };
      setProgress([...states]);
      setLiveOutput('');
      let stepText = '';

      const outcome = await runLabAgent({
        agentSlug: step.agentSlug,
        input: interpolateTemplate(step.inputTemplate, { initialInput, previousOutput }),
        chainId: selected.id,
        stepIndex: index,
        parentRunId,
        onRunStart: (info) => {
          states[index] = { status: 'running', runId: info.runId };
          setProgress([...states]);
        },
        onDelta: (delta) => {
          stepText += delta;
          setLiveOutput(stepText);
        },
      });

      if (!outcome.ran) {
        states[index] = { status: 'error', runId: outcome.runId, note: outcome.reason };
        // The steps that never dispatched get their error rows server-side,
        // each naming this step as the one that sank the chain.
        const remaining = selected.steps
          .map((rest, restIndex) => ({ agentSlug: rest.agentSlug, stepIndex: restIndex }))
          .filter((rest) => rest.stepIndex > index);
        if (remaining.length > 0) {
          await markChainAborted({
            chainId: selected.id,
            failedStepIndex: index,
            failedAgentSlug: step.agentSlug,
            failedRunId: outcome.runId,
            remaining,
          });
          for (const rest of remaining) {
            states[rest.stepIndex] = {
              status: 'error',
              note: `Never ran — step ${index + 1} failed.`,
            };
          }
        }
        setProgress([...states]);
        setChainRunning(false);
        return;
      }

      states[index] = { status: 'ok', runId: outcome.runId };
      setProgress([...states]);
      previousOutput = stepText;
      parentRunId = outcome.runId;
    }
    setChainRunning(false);
  };

  const lastRunId = progress?.filter((step) => step.runId).at(-1)?.runId;

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">Lab / Chains</p>
          <h1 className="page-title">Chain builder</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
            An ordered list of agents, each step templating {'{{previous_output}}'} and{' '}
            {'{{initial_input}}'} into its input. Steps run one by one; the log links them by
            parent run.
          </p>
        </div>
        <Button
          className="mt-4 md:mt-0"
          onClick={() => {
            setSelectedId('new');
            setDraft({ ...EMPTY_DRAFT, steps: [] });
            setProgress(null);
          }}
        >
          <Plus className="size-4" />
          New chain
        </Button>
      </header>

      {chains === null || agents === null ? (
        <Checking label="Chains" />
      ) : !chains.ok ? (
        <Card>
          <CardContent className="pt-5">
            <CouldNotCheck label="Chains" failure={chains} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_2fr]">
          <div className="grid gap-3">
            {chainRows.length === 0 && selectedId !== 'new' ? (
              <EmptyRow
                label="Chains"
                clause="belum ada chain"
                action="New chain"
                onAction={() => {
                  setSelectedId('new');
                  setDraft(EMPTY_DRAFT);
                }}
              />
            ) : (
              chainRows.map((chain) => (
                <button
                  key={chain.id}
                  onClick={() => select(chain)}
                  className={cn(
                    'rounded-lg border bg-card p-4 text-left shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selectedId === chain.id ? 'border-primary' : 'border-border hover:bg-surface-2',
                  )}
                >
                  <p className="text-sm font-semibold text-foreground">{chain.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground-muted">
                    {chain.description || '—'}
                  </p>
                  <p className="mt-2 text-xs tabular-nums text-foreground-muted">
                    {chain.steps.length} step{chain.steps.length === 1 ? '' : 's'} ·{' '}
                    {chain.steps.map((step) => step.agentSlug).join(' → ')}
                  </p>
                </button>
              ))
            )}
          </div>

          {selectedId === null ? (
            <Card>
              <CardContent className="pt-5">
                <p className="text-sm text-foreground-muted">
                  Pilih chain di kiri, atau buat yang baru.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-5">
              <Card>
                <CardHeader>
                  <CardTitle>{selectedId === 'new' ? 'New chain' : `Edit — ${draft.name}`}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
                        Name
                        <Input
                          value={draft.name}
                          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                          required
                        />
                      </label>
                      <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
                        Description
                        <Input
                          value={draft.description}
                          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        />
                      </label>
                    </div>

                    <ol className="grid gap-3">
                      {draft.steps.map((step, index) => (
                        <li
                          key={index}
                          className="rounded-md border border-border-subtle bg-surface-2 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-foreground-muted">
                              Step {index + 1}
                            </span>
                            <select
                              className="native-select text-xs"
                              value={step.agentSlug}
                              onChange={(event) => setStep(index, { agentSlug: event.target.value })}
                              aria-label={`Step ${index + 1} agent`}
                            >
                              <option value="">— pilih agent —</option>
                              {agentRows.map((agent) => (
                                <option key={agent.id} value={agent.slug}>
                                  {agent.name} ({agent.dataClass})
                                </option>
                              ))}
                              {/* A saved step may name an agent that no longer
                                  exists; keep it selectable so the reference is
                                  visible rather than silently reassigned. */}
                              {step.agentSlug && !knownSlugs.has(step.agentSlug) && (
                                <option value={step.agentSlug}>{step.agentSlug} (missing)</option>
                              )}
                            </select>
                            <span className="ml-auto flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Move step ${index + 1} up`}
                                disabled={index === 0}
                                onClick={() => setDraft({ ...draft, steps: moveStep(draft.steps, index, -1) })}
                              >
                                <ArrowUp className="size-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Move step ${index + 1} down`}
                                disabled={index === draft.steps.length - 1}
                                onClick={() => setDraft({ ...draft, steps: moveStep(draft.steps, index, 1) })}
                              >
                                <ArrowDown className="size-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Remove step ${index + 1}`}
                                onClick={() =>
                                  setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })
                                }
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </span>
                          </div>
                          <textarea
                            className="mt-2 min-h-20 w-full rounded-md border border-border bg-card px-3 py-2 text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={step.inputTemplate}
                            onChange={(event) => setStep(index, { inputTemplate: event.target.value })}
                            aria-label={`Step ${index + 1} input template`}
                            placeholder="Boleh pakai {{initial_input}} dan {{previous_output}}"
                          />
                        </li>
                      ))}
                    </ol>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            steps: [...draft.steps, { agentSlug: '', inputTemplate: '{{previous_output}}' }],
                          })
                        }
                      >
                        <Plus className="size-4" />
                        Add step
                      </Button>
                      <Button size="sm" onClick={() => void save()} disabled={isPending || !draft.name.trim()}>
                        {selectedId === 'new' ? 'Create chain' : 'Save changes'}
                      </Button>
                    </div>

                    {issues.length > 0 && (
                      <ul className="grid gap-1 text-xs leading-5 text-escalate">
                        {issues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>

              {selected && (
                <Card>
                  <CardHeader>
                    <CardTitle>Run this chain</CardTitle>
                    {lastRunId && !chainRunning && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setLabLogFocus({ runId: lastRunId });
                          setLabView('runs');
                        }}
                      >
                        <ScrollText className="size-4" />
                        Lineage di log
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4">
                      <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
                        Initial input
                        <textarea
                          className="min-h-24 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={initialInput}
                          onChange={(event) => setInitialInput(event.target.value)}
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          onClick={() => void runChain()}
                          disabled={chainRunning || dirty || issues.length > 0 || !initialInput.trim()}
                        >
                          <Play className="size-4" />
                          Run chain
                        </Button>
                        {dirty && (
                          <span className="text-xs text-foreground-muted">
                            Simpan perubahan dulu — yang dijalankan adalah versi tersimpan.
                          </span>
                        )}
                      </div>

                      {progress && (
                        <ol className="grid gap-2">
                          {selected.steps.map((step, index) => {
                            const state = progress[index];
                            return (
                              <li
                                key={index}
                                className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs"
                              >
                                <span className="font-semibold text-foreground-secondary">
                                  {index + 1}. {step.agentSlug}
                                </span>
                                <RunStatusChip
                                  status={
                                    state.status === 'pending' ? 'queued' : state.status === 'running' ? 'running' : state.status
                                  }
                                />
                                {state.note && <span className="text-foreground-muted">{state.note}</span>}
                                {state.runId && (
                                  <button
                                    className="ml-auto text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    onClick={() => {
                                      setLabLogFocus({ runId: state.runId as string });
                                      setLabView('runs');
                                    }}
                                  >
                                    log
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}

                      {chainRunning && liveOutput && (
                        <div className="max-h-48 overflow-y-auto rounded-md border border-border-subtle bg-surface-2 px-3 py-2">
                          <p className="whitespace-pre-wrap text-xs leading-5 text-foreground-secondary">
                            {liveOutput}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
