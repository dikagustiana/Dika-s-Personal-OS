/**
 * The console: Event log, Penolakan (with a count), Runs. Lines are
 * timestamped, coloured by agent, levelled INFO / OK / REFUSED / WAIT.
 *
 * REFUSALS ARE QUIET MONOSPACE, NEVER ERRORS. A refusal is the system
 * working correctly — styled like an error it teaches the owner to route
 * around the very gates Phase 1 built. The Penolakan tab reads the
 * refusals PERSISTED on run rows (083), which is why its history survives
 * a reload: the run row is the record, this console only renders it.
 */
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent } from '../../../components/ui/Card';
import { useAppStore } from '../../../store/appStore';
import { agentColor } from '../../../logic/lab/labAgentColors';
import { formatDuration, formatIdr } from '../../../logic/lab/labCost';
import type { FlowLogLine, LabFlowState } from '../../../logic/lab/labFlowState';
import { cn } from '../../../lib/utils';

type ConsoleTab = 'log' | 'penolakan' | 'runs';

const LEVEL_TONE: Record<FlowLogLine['level'], string> = {
  INFO: 'text-foreground-muted',
  OK: 'text-success',
  REFUSED: 'text-foreground-secondary',
  WAIT: 'text-escalate',
};

function LogLine({ line }: { line: FlowLogLine }) {
  return (
    <div className="flex items-start gap-2 py-1 font-mono text-[11px] leading-4">
      <span className="shrink-0 text-foreground-muted">
        {new Date(line.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
      </span>
      {line.agentSlug ? (
        <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: agentColor(line.agentSlug) }} />
      ) : (
        <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-border" />
      )}
      <span className={cn('w-14 shrink-0 font-semibold', LEVEL_TONE[line.level])}>{line.level}</span>
      <span
        className={cn(
          'min-w-0 whitespace-pre-wrap break-words',
          // Quiet: a thin rule, muted text — the system saying no, calmly.
          line.level === 'REFUSED' && 'border-l-2 border-border pl-2 text-foreground-secondary',
        )}
      >
        {line.text}
      </span>
    </div>
  );
}

export function FlowConsole({ state }: { state: LabFlowState }) {
  const [tab, setTab] = useState<ConsoleTab>('log');
  const setLabView = useAppStore((store) => store.setLabView);
  const setLabLogFocus = useAppStore((store) => store.setLabLogFocus);

  const refusals = state.log.filter((line) => line.level === 'REFUSED');
  const runLines = state.log.filter((line) => line.run);

  const TABS: Array<{ id: ConsoleTab; label: string }> = [
    { id: 'log', label: 'Event log' },
    { id: 'penolakan', label: `Penolakan (${refusals.length})` },
    { id: 'runs', label: 'Runs' },
  ];

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-2 flex gap-1 border-b border-border-subtle" role="tablist" aria-label="Konsol lab">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                'border-b-2 px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === entry.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-foreground-muted hover:text-foreground-secondary',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === 'log' && (
          <div className="max-h-72 overflow-y-auto">
            {state.log.length === 0 && (
              <p className="py-2 text-xs text-foreground-muted">Belum ada aktivitas tercatat.</p>
            )}
            {state.log.map((line) => (
              <LogLine key={line.id} line={line} />
            ))}
          </div>
        )}

        {tab === 'penolakan' && (
          <div className="max-h-72 overflow-y-auto">
            <p className="py-1 text-[11px] leading-4 text-foreground-muted">
              Penolakan adalah sistem yang bekerja dengan benar — gerbang menyebut sebab dan record,
              lalu menunggu. Baris di sini dibaca dari kolom <code className="font-mono">refusals</code> pada
              run row (migrasi 083), jadi riwayatnya tahan reload.
            </p>
            {refusals.length === 0 && (
              <p className="py-2 text-xs text-foreground-muted">Tidak ada penolakan tercatat di run log.</p>
            )}
            {refusals.map((line) => (
              <LogLine key={line.id} line={line} />
            ))}
          </div>
        )}

        {tab === 'runs' && (
          <div className="max-h-72 overflow-y-auto">
            {runLines.length === 0 && (
              <p className="py-2 text-xs text-foreground-muted">Belum ada run.</p>
            )}
            {runLines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-3 border-b border-border-subtle py-1.5 text-[11px] last:border-b-0">
                <span className="flex min-w-0 items-center gap-2 font-mono">
                  {line.agentSlug && (
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: agentColor(line.agentSlug) }} />
                  )}
                  <span className="truncate text-foreground-secondary">{line.agentSlug ?? 'agent'}</span>
                  <span
                    className={cn(
                      'shrink-0',
                      line.run!.status === 'ok' ? 'text-success' : line.run!.status === 'error' ? 'text-destructive' : 'text-escalate',
                    )}
                  >
                    {line.run!.status}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3 font-mono text-foreground-muted">
                  <span>{formatDuration(line.run!.durationMs)}</span>
                  <span>{line.run!.costUsd === null ? '—' : formatIdr(line.run!.costUsd)}</span>
                  <span title={line.at}>{formatDistanceToNow(new Date(line.at), { addSuffix: true })}</span>
                  <button
                    className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setLabLogFocus({ runId: line.run!.id });
                      setLabView('runs');
                    }}
                  >
                    buka di log
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
