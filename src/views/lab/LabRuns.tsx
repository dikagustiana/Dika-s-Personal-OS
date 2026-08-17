/**
 * F3 — the run log. What ran, on which model, at what cost, chained to what.
 *
 * COST IS STORED IN USD AND DISPLAYED IN IDR — the conversion happens at
 * render through the one rate in labConfig, and the strip says which rate it
 * used, because a converted figure with an unstated rate is a figure nobody
 * can check.
 *
 * Lineage: where parent_run_id is set the expanded row renders the chain as
 * a breadcrumb, oldest first, each crumb expanding its own row. That column
 * is the whole reason chains are inspectable after the fact.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import type { LabRun } from '../../data/labTypes';
import { USD_TO_IDR_DISPLAY_RATE } from '../../logic/lab/labConfig';
import {
  formatDuration,
  formatIdr,
  formatTokens,
  formatUsd,
  spendThisMonthByProvider,
} from '../../logic/lab/labCost';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils';
import { CouldNotCheck, Checking } from '../work/finishLineUi';
import { ProviderChip, RunStatusChip, rowsOr, useLabData } from './labUi';

export function LabRuns() {
  const labLogFocus = useAppStore((state) => state.labLogFocus);
  const setLabLogFocus = useAppStore((state) => state.setLabLogFocus);
  const { providers, agents, runs } = useLabData();
  const [agentFilter, setAgentFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const focusRowRef = useRef<HTMLTableRowElement | null>(null);

  const providerRows = rowsOr(providers);
  const agentRows = rowsOr(agents);
  const runRows = rowsOr(runs);

  const agentsById = useMemo(() => new Map(agentRows.map((agent) => [agent.id, agent])), [agentRows]);
  const providersById = useMemo(
    () => new Map(providerRows.map((provider) => [provider.id, provider])),
    [providerRows],
  );
  const runsById = useMemo(() => new Map(runRows.map((run) => [run.id, run])), [runRows]);

  // One-shot arrival from the run screen or a lineage crumb: expand the run,
  // then scroll it into view once it exists in the DOM.
  useEffect(() => {
    if (!labLogFocus) return;
    if (runs === null) return; // wait for the rows before consuming
    setExpanded(labLogFocus.runId);
    setLabLogFocus(null);
  }, [labLogFocus, runs, setLabLogFocus]);

  useEffect(() => {
    focusRowRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [expanded]);

  const spend = useMemo(
    () => spendThisMonthByProvider(runRows, providerRows, new Date()),
    [runRows, providerRows],
  );

  const visible = runRows.filter((run) => {
    if (agentFilter !== 'all' && run.agentId !== agentFilter) return false;
    if (providerFilter !== 'all' && run.providerId !== providerFilter) return false;
    if (statusFilter !== 'all' && run.status !== statusFilter) return false;
    return true;
  });
  const hidden = runRows.length - visible.length;

  /** The chain of ancestors, oldest first, ending at this run. */
  const lineageOf = (run: LabRun): LabRun[] => {
    const chain: LabRun[] = [run];
    let current = run;
    // Bounded walk: a cycle cannot be created through the executor, but a
    // log renderer must not hang on hostile data either.
    for (let hops = 0; hops < 32; hops += 1) {
      if (!current.parentRunId) break;
      const parent = runsById.get(current.parentRunId);
      if (!parent) break;
      chain.unshift(parent);
      current = parent;
    }
    return chain;
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">Lab / Run log</p>
        <h1 className="page-title">Run log</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
          Every dispatch, streamed or aborted, is a row here — written by the executor, not the
          browser. Spend is stored in USD and shown in IDR at Rp{' '}
          {USD_TO_IDR_DISPLAY_RATE.toLocaleString('id-ID')}/$.
        </p>
      </header>

      {/* The aggregate strip: this month, by provider. Zeroes render — a
          zero beside Anthropic while DeepSeek shows spend is the boundary
          working (or failing) at a glance. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {spend.map((row) => (
          <div key={row.providerId} className="rounded-lg border border-border bg-card p-4 shadow-card">
            <p className="surface-label">{row.providerName} · bulan ini</p>
            <p className="metric-hero mt-1 text-2xl">{formatIdr(row.usd)}</p>
            <p className="mt-1 text-xs tabular-nums text-foreground-muted">
              {formatUsd(row.usd)} · {row.runs} run{row.runs === 1 ? '' : 's'}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3" role="group" aria-label="Filter run log">
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <span className="sr-only">Filter by agent</span>
          <select className="native-select text-xs" value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
            <option value="all">Semua agent</option>
            {agentRows.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <span className="sr-only">Filter by provider</span>
          <select className="native-select text-xs" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
            <option value="all">Semua provider</option>
            {providerRows.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <span className="sr-only">Filter by status</span>
          <select className="native-select text-xs" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Semua status</option>
            <option value="ok">ok</option>
            <option value="error">error</option>
            <option value="running">running</option>
            <option value="queued">queued</option>
          </select>
        </label>
        <span className="text-xs tabular-nums text-foreground-muted">
          {visible.length} run{visible.length === 1 ? '' : 's'}
          {hidden > 0 ? ` · ${hidden} disembunyikan filter` : ''}
        </span>
      </div>

      {runs === null ? (
        <Checking label="Run log" />
      ) : !runs.ok ? (
        <Card>
          <CardContent className="pt-5">
            <CouldNotCheck label="Run log" failure={runs} />
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <EmptyRow
          label="Run log"
          clause={runRows.length === 0 ? 'belum ada run' : 'tidak ada yang lolos filter'}
        />
      ) : (
        <section className="canvas-bleed rounded-lg border border-border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2">
                  {['Waktu', 'Agent', 'Provider', 'Status', 'Tokens in/out', 'Biaya', 'Durasi'].map(
                    (heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-foreground-muted"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((run) => {
                  const agent = agentsById.get(run.agentId);
                  const provider = providersById.get(run.providerId);
                  const isOpen = expanded === run.id;
                  const lineage = isOpen ? lineageOf(run) : [];
                  return [
                    <tr
                      key={run.id}
                      ref={isOpen ? focusRowRef : undefined}
                      className={cn(
                        'cursor-pointer border-b border-border-subtle align-top last:border-b-0 hover:bg-surface-2',
                        isOpen && 'bg-surface-2',
                      )}
                      onClick={() => setExpanded(isOpen ? null : run.id)}
                    >
                      <td className="px-3 py-2.5 text-xs tabular-nums text-foreground-muted">
                        {new Date(run.createdAt).toLocaleString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-2.5">
                        {agent?.name ?? run.agentId}
                        {run.chainId !== null && run.stepIndex !== null && (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
                            step {run.stepIndex + 1}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <ProviderChip name={provider?.name ?? '?'} />
                      </td>
                      <td className="px-3 py-2.5">
                        <RunStatusChip status={run.status} />
                      </td>
                      <td className="px-3 py-2.5 text-xs tabular-nums text-foreground-secondary">
                        {formatTokens(run.tokensIn)} / {formatTokens(run.tokensOut)}
                      </td>
                      <td className="px-3 py-2.5 text-xs tabular-nums text-foreground-secondary">
                        {run.costUsd === null ? '—' : formatIdr(run.costUsd)}
                      </td>
                      <td className="px-3 py-2.5 text-xs tabular-nums text-foreground-secondary">
                        {formatDuration(run.durationMs)}
                      </td>
                    </tr>,
                    isOpen ? (
                      <tr key={`${run.id}-detail`} className="border-b border-border-subtle last:border-b-0">
                        <td colSpan={7} className="bg-surface-2/60 px-4 py-4">
                          {lineage.length > 1 && (
                            <nav aria-label="Chain lineage" className="mb-3 flex flex-wrap items-center gap-1 text-xs">
                              {lineage.map((step, index) => (
                                <span key={step.id} className="flex items-center gap-1">
                                  {index > 0 && <span className="text-foreground-muted">→</span>}
                                  <button
                                    className={cn(
                                      'rounded-sm border px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                      step.id === run.id
                                        ? 'border-primary bg-primary-dim text-primary'
                                        : 'border-border text-foreground-secondary hover:bg-surface-3',
                                    )}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setExpanded(step.id);
                                    }}
                                  >
                                    {agentsById.get(step.agentId)?.slug ?? step.agentId}
                                    {step.stepIndex !== null ? ` · ${step.stepIndex + 1}` : ''}
                                  </button>
                                </span>
                              ))}
                            </nav>
                          )}
                          {run.error && (
                            <p className="mb-3 rounded-md border border-destructive/40 bg-card px-3 py-2 text-xs leading-5 text-destructive">
                              {run.error}
                            </p>
                          )}
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <p className="surface-label mb-1.5">Input</p>
                              <div className="max-h-64 overflow-y-auto rounded-md border border-border-subtle bg-card px-3 py-2">
                                <p className="whitespace-pre-wrap text-xs leading-5 text-foreground-secondary">
                                  {run.input || '—'}
                                </p>
                              </div>
                            </div>
                            <div>
                              <p className="surface-label mb-1.5">Output</p>
                              <div className="max-h-64 overflow-y-auto rounded-md border border-border-subtle bg-card px-3 py-2">
                                <p className="whitespace-pre-wrap text-xs leading-5 text-foreground-secondary">
                                  {run.output || '—'}
                                </p>
                              </div>
                            </div>
                          </div>
                          {run.costUsd !== null && (
                            <p className="mt-3 text-xs tabular-nums text-foreground-muted">
                              {formatIdr(run.costUsd)} = {formatUsd(run.costUsd)} · rate Rp{' '}
                              {USD_TO_IDR_DISPLAY_RATE.toLocaleString('id-ID')}/$ (labConfig)
                            </p>
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
    </div>
  );
}
