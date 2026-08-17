/**
 * F2 — run one agent. Input in, stream out, run row in the log.
 *
 * THE SCREEN IS A WINDOW, THE ROW IS THE RECORD. Every outcome path here —
 * done, error, abort, tab closed — ends at the same place: the run log,
 * which the executor writes server-side. That is why the log link appears
 * the moment the run starts, not when it succeeds.
 *
 * The provider selector is DISABLED for internal agents with the reason in
 * always-visible text (a title-only tooltip is unreachable on touch, and the
 * rule deserves better than hover). Layer 3 of 3 — the executor and the
 * database both re-check it.
 */
import { CircleStop, Play, Save, ScrollText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import {
  LAB_UNCONFIGURED,
  probeLab,
  runLabAgent,
  saveRunArtifact,
  type LabCapabilities,
} from '../../data/labModel';
import type { LabProviderName } from '../../data/labTypes';
import { providerBlockedReason } from '../../data/labGuards';
import { formatDuration, formatIdr, formatTokens, formatUsd } from '../../logic/lab/labCost';
import { pushToast } from '../../store/toastStore';
import { useAppStore } from '../../store/appStore';
import { CouldNotCheck, Checking } from '../work/finishLineUi';
import { DataClassChip, rowsOr, useLabData } from './labUi';

interface RunMetrics {
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  durationMs: number | null;
}

export function LabRun() {
  const setLabView = useAppStore((state) => state.setLabView);
  const setLabLogFocus = useAppStore((state) => state.setLabLogFocus);
  const labRunFocus = useAppStore((state) => state.labRunFocus);
  const setLabRunFocus = useAppStore((state) => state.setLabRunFocus);
  const { providers, agents } = useLabData();
  const [capabilities, setCapabilities] = useState<LabCapabilities>(LAB_UNCONFIGURED);
  const [agentSlug, setAgentSlug] = useState('');
  const [providerName, setProviderName] = useState<'' | LabProviderName>('');
  const [input, setInput] = useState('');
  const [attachedName, setAttachedName] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState('');
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [failure, setFailure] = useState('');
  const [artifactSaved, setArtifactSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void probeLab().then(setCapabilities);
  }, []);

  // The one-shot handoff from a registry card's Run button: consumed and
  // cleared on arrival, like every focus in this app.
  useEffect(() => {
    if (!labRunFocus) return;
    setAgentSlug(labRunFocus.agentSlug);
    setLabRunFocus(null);
  }, [labRunFocus, setLabRunFocus]);

  // Abort a still-open stream when the screen unmounts; the executor writes
  // the terminal row either way.
  useEffect(() => () => abortRef.current?.abort(), []);

  const agentRows = rowsOr(agents).filter((agent) => agent.isActive);
  const providerRows = rowsOr(providers).filter((provider) => provider.isActive);
  const agent = agentRows.find((row) => row.slug === agentSlug);
  const defaultProvider = agent
    ? providerRows.find((row) => row.id === agent.defaultProviderId)
    : undefined;

  // Internal agents run on Anthropic, full stop: the selector collapses to
  // the default and disables. Public agents choose freely.
  const isInternal = agent?.dataClass === 'internal';
  const effectiveProvider: LabProviderName | '' = isInternal
    ? 'anthropic'
    : providerName || defaultProvider?.name || '';
  const providerConfigured = effectiveProvider
    ? capabilities.providers[effectiveProvider]
    : false;

  const blockedReason = useMemo(() => {
    if (!agent) return 'Pilih agent dulu.';
    if (!input.trim()) return 'Tulis input dulu.';
    if (!effectiveProvider) return 'Agent ini tidak punya default provider — pilih provider.';
    if (!providerConfigured) {
      return `Kunci API ${effectiveProvider} belum di-set (function secret) — run tidak bisa dikirim.`;
    }
    return null;
  }, [agent, input, effectiveProvider, providerConfigured]);

  const attachFile = async (file: File | undefined) => {
    if (!file) return;
    // v1 attaches text: the content travels inside the input so the run row
    // records exactly what the model saw. Binary uploads are a TODO.
    const text = await file.text();
    setInput((current) =>
      `${current}${current.endsWith('\n') || current === '' ? '' : '\n\n'}--- ${file.name} ---\n${text}`,
    );
    setAttachedName(file.name);
  };

  const startRun = async () => {
    if (!agent || blockedReason) return;
    setRunning(true);
    setOutput('');
    setRunId('');
    setMetrics(null);
    setFailure('');
    setArtifactSaved(false);
    const controller = new AbortController();
    abortRef.current = controller;

    const outcome = await runLabAgent({
      agentSlug: agent.slug,
      input,
      // The default is left to the server unless the owner chose — the same
      // absence-means-server-decides rule as the research send path.
      ...(isInternal || !providerName ? {} : { provider: providerName }),
      signal: controller.signal,
      onRunStart: (info) => setRunId(info.runId),
      onDelta: (delta) => setOutput((current) => current + delta),
    });

    setRunning(false);
    abortRef.current = null;
    if (outcome.ran) {
      setMetrics({
        tokensIn: outcome.tokensIn,
        tokensOut: outcome.tokensOut,
        costUsd: outcome.costUsd,
        durationMs: outcome.durationMs,
      });
    } else {
      if (outcome.runId) setRunId(outcome.runId);
      setFailure(outcome.reason);
    }
  };

  const saveArtifact = async () => {
    if (!runId || !output) return;
    const result = await saveRunArtifact({
      runId,
      filename: `${agentSlug}-output.md`,
      mime: 'text/markdown',
      content: output,
    });
    if (result.saved) {
      setArtifactSaved(true);
      pushToast({ tone: 'info', message: 'Output tersimpan sebagai artifact.' });
    } else {
      pushToast({ tone: 'error', message: `Simpan artifact gagal — ${result.reason}` });
    }
  };

  const openInLog = () => {
    if (!runId) return;
    setLabLogFocus({ runId });
    setLabView('runs');
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">Lab / Run</p>
        <h1 className="page-title">Run an agent</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
          One input, one streamed completion, one row in the log. Internal agents run on
          Anthropic only — the selector is not offering what the database would refuse.
        </p>
      </header>

      {agents === null || providers === null ? (
        <Checking label="Agents" />
      ) : !agents.ok ? (
        <Card>
          <CardContent className="pt-5">
            <CouldNotCheck label="Agents" failure={agents} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[2fr_3fr]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Setup</CardTitle>
                {agent && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <DataClassChip dataClass={agent.dataClass} />
                    <span className="text-xs text-foreground-muted">
                      {agent.slug} · v{agent.version}
                    </span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
                  Agent
                  <select
                    className="native-select"
                    value={agentSlug}
                    onChange={(event) => {
                      setAgentSlug(event.target.value);
                      setProviderName('');
                    }}
                  >
                    <option value="">— pilih agent —</option>
                    {agentRows.map((row) => (
                      <option key={row.id} value={row.slug}>
                        {row.name} ({row.dataClass})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
                  Provider
                  <select
                    className="native-select"
                    value={effectiveProvider}
                    onChange={(event) => setProviderName(event.target.value as LabProviderName)}
                    disabled={!agent || isInternal}
                  >
                    {!effectiveProvider && <option value="">— pilih provider —</option>}
                    {providerRows.map((provider) => {
                      const blocked = agent
                        ? providerBlockedReason(agent.dataClass, provider)
                        : null;
                      return (
                        <option key={provider.id} value={provider.name} disabled={Boolean(blocked)}>
                          {provider.name} · {provider.model}
                          {capabilities.providers[provider.name] ? '' : ' (no key)'}
                        </option>
                      );
                    })}
                  </select>
                  {isInternal && (
                    <span className="text-[11px] font-normal normal-case leading-4 text-foreground-muted">
                      Internal data — Anthropic only. Enforced in the database, not just here.
                    </span>
                  )}
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
                  Input
                  <textarea
                    className="min-h-48 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={
                      isInternal
                        ? 'Angka internal boleh di sini — agent ini terkunci ke Anthropic.'
                        : 'Konten publik / non-sensitif.'
                    }
                  />
                </label>

                <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
                  Attach a text file (optional)
                  <input
                    type="file"
                    accept=".txt,.md,.csv,.json"
                    className="text-xs text-foreground-muted file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground-secondary"
                    onChange={(event) => void attachFile(event.target.files?.[0])}
                  />
                  {attachedName && (
                    <span className="text-[11px] font-normal normal-case text-foreground-muted">
                      {attachedName} ditambahkan ke input — isi file ikut terkirim dan tercatat di log.
                    </span>
                  )}
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  {running ? (
                    <Button variant="danger" onClick={() => abortRef.current?.abort()}>
                      <CircleStop className="size-4" />
                      Stop
                    </Button>
                  ) : (
                    <Button onClick={() => void startRun()} disabled={Boolean(blockedReason)}>
                      <Play className="size-4" />
                      Run
                    </Button>
                  )}
                  {blockedReason && !running && (
                    <span className="text-xs text-foreground-muted">{blockedReason}</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Output</CardTitle>
              <div className="flex items-center gap-2">
                {runId && (
                  <Button size="sm" variant="ghost" onClick={openInLog}>
                    <ScrollText className="size-4" />
                    Run log
                  </Button>
                )}
                {runId && output && !running && (
                  <Button size="sm" variant="secondary" onClick={() => void saveArtifact()} disabled={artifactSaved}>
                    <Save className="size-4" />
                    {artifactSaved ? 'Tersimpan' : 'Save as artifact'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {failure && (
                <p className="mb-3 rounded-md border border-destructive/40 bg-surface-2 px-3 py-2 text-xs leading-5 text-destructive">
                  {failure}
                </p>
              )}
              {output ? (
                <div className="max-h-[32rem] overflow-y-auto rounded-md border border-border-subtle bg-surface-2 px-3 py-2">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{output}</p>
                </div>
              ) : (
                <p className="text-sm text-foreground-muted">
                  {running ? 'Menunggu token pertama…' : 'Belum ada output — jalankan sesuatu.'}
                </p>
              )}
              {metrics && (
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-foreground-muted">
                  <span>in {formatTokens(metrics.tokensIn)}</span>
                  <span>out {formatTokens(metrics.tokensOut)}</span>
                  <span>
                    {metrics.costUsd === null
                      ? 'cost —'
                      : `${formatIdr(metrics.costUsd)} (${formatUsd(metrics.costUsd)})`}
                  </span>
                  <span>{formatDuration(metrics.durationMs)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
