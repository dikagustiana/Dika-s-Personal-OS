/**
 * F6 — Flow. Three surfaces over ONE derived state object (useLabFlowState
 * → deriveFlowState): the track strip answers "sampe mana?", the floorplan
 * answers "lagi dimana, siapa di sana, apa yang terpalang?", the console
 * and rail answer "apa yang baru terjadi, dan sistemnya sendiri sehat?".
 *
 * HONESTY RULES, from the brief and enforced by the state's shape:
 *  - POSITIONAL progress is counted and shown (13 known stages);
 *  - WORK-COMPLETION progress is invented and absent: no percentage, no
 *    ETA, no countdown, no bar toward an unknown total. Elapsed time
 *    counts UP (measured); the in-flight indicator is an indeterminate
 *    hairline; the WIP bar is a meter over a KNOWN cap;
 *  - human stations read heavier than agent stations (the floorplan's
 *    sizes), because this screen exists to show where work stops and who
 *    has to move it;
 *  - a blocked stage names its blocker and the record id, computed by the
 *    same guard mirrors the mutation path runs.
 */
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { useLabLiveStore } from '../../../store/labLiveStore';
import { agentColor } from '../../../logic/lab/labAgentColors';
import type { FlowStage } from '../../../logic/lab/labFlowState';
import { cn } from '../../../lib/utils';
import { CouldNotCheck, Checking } from '../../work/finishLineUi';
import { FlowConsole } from './FlowConsole';
import { FlowFloorplan } from './FlowFloorplan';
import { FlowRail } from './FlowRail';
import { useLabFlowState } from './useLabFlowState';

/** mm:ss, counting UP from dispatch — measured, so allowed. */
function elapsedLabel(startedAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function LiveBanner() {
  const live = useLabLiveStore((store) => store.live);
  const lastOutcome = useLabLiveStore((store) => store.lastOutcome);
  const clearOutcome = useLabLiveStore((store) => store.clearOutcome);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  if (live) {
    return (
      <div className="mb-4 overflow-hidden rounded-md border border-escalate/40 bg-surface-1">
        <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: agentColor(live.agentSlug) }} />
          <span className="font-semibold text-foreground">{live.agentSlug}</span>
          <span className="text-foreground-muted">
            {live.stepIndex !== undefined
              ? `langkah ${live.stepIndex + 1}${live.stepCount ? ` dari ${live.stepCount}` : ''} · ${live.action}`
              : live.action}
          </span>
          <span className="ml-auto font-mono text-xs text-foreground-secondary" aria-label="Waktu berjalan (menghitung naik)">
            {elapsedLabel(live.startedAt, nowMs)}
          </span>
        </div>
        {/* Indeterminate hairline: work is in flight; how much is unknowable. */}
        <div className="flow-hairline h-0.5 w-full bg-surface-2" aria-hidden />
      </div>
    );
  }

  if (lastOutcome && !lastOutcome.ok) {
    // A failed run must never leave the view looking idle.
    return (
      <div className="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-surface-1 px-4 py-2.5 text-sm" role="status">
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: agentColor(lastOutcome.agentSlug) }} />
        <div className="min-w-0">
          <p className="font-semibold text-destructive">
            {lastOutcome.agentSlug} gagal{lastOutcome.stepIndex !== undefined ? ` di langkah ${lastOutcome.stepIndex + 1}` : ''}
          </p>
          <p className="break-words font-mono text-xs text-foreground-secondary">{lastOutcome.error}</p>
          {lastOutcome.runId && <p className="text-[11px] text-foreground-muted">Run {lastOutcome.runId} — teks lengkap ada di run log.</p>}
        </div>
        <button
          aria-label="Tutup"
          className="ml-auto rounded p-1 text-foreground-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={clearOutcome}
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }
  return null;
}

/** The ordinal track: 13 segments, legible without reading a word. */
function FlowTrack({
  stages,
  selectedIndex,
  onSelect,
}: {
  stages: FlowStage[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <div role="group" aria-label="Posisi pipeline — 13 tahap berurutan" className="mb-4">
      <div className="flex gap-1">
        {stages.map((stage) => (
          <button
            key={stage.code}
            title={`${stage.code} ${stage.title} — ${stage.status}`}
            aria-label={`${stage.code} ${stage.title}: ${stage.status}${stage.frontLine ? ' (garis depan)' : ''}`}
            aria-pressed={selectedIndex === stage.index}
            onClick={() => onSelect(stage.index)}
            className={cn(
              'h-3 flex-1 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              stage.status === 'done' && 'bg-[#33465C]',
              stage.status === 'attention' && 'bg-[#9A5200]/80',
              stage.status === 'blocked' && 'flow-hatch-cell',
              stage.status === 'idle' && 'bg-[#DCE4EB]',
              stage.running && 'flow-shimmer',
              stage.frontLine && 'ring-2 ring-[#9A5200] ring-offset-1',
            )}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {stages.map((stage) => (
          <span key={stage.code} className="flex-1 text-center font-mono text-[9px] text-foreground-muted">
            {stage.code}
          </span>
        ))}
      </div>
    </div>
  );
}

function StageDetail({ stage, onClose }: { stage: FlowStage; onClose: () => void }) {
  return (
    <Card className="mt-3 border-primary/30">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-foreground-muted">
              {stage.code} · {stage.actor === 'owner' ? 'stasiun manusia' : stage.actor === 'agent' ? 'stasiun agent' : 'gerbang'} · {stage.status}
            </p>
            <h3 className="text-base font-semibold text-foreground">{stage.title}</h3>
            <p className="mt-1 text-sm text-foreground-secondary">{stage.headline}</p>
          </div>
          <button
            aria-label="Tutup detail"
            onClick={onClose}
            className="rounded p-1 text-foreground-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        </div>
        {stage.detail.length > 0 && (
          <ul className="mt-2 grid gap-1 text-xs leading-5 text-foreground-muted">
            {stage.detail.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {stage.blockers.length > 0 && (
          <div className="mt-3 grid gap-2">
            {stage.blockers.map((blocker, index) => (
              // A refusal is the system working: quiet monospace, a thin
              // rule, the cause AND the record id — never an error panel.
              <p key={index} className="border-l-2 border-border pl-3 font-mono text-xs leading-5 text-foreground-secondary">
                {blocker.reason}
                <span className="block text-[10px] text-foreground-muted">record: {blocker.recordId}</span>
              </p>
            ))}
          </div>
        )}
        {stage.presentAgents.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
            Di stasiun ini:
            {stage.presentAgents.map((slug) => (
              <span key={slug} className="inline-flex items-center gap-1 font-mono">
                <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: agentColor(slug) }} />
                {slug}
              </span>
            ))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function LabFlow() {
  const data = useLabFlowState();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">Lab / Flow</p>
          <h1 className="page-title">Flow</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
            Tiga belas tahap, dihitung — bukan ditaksir. Stasiun manusia digambar lebih berat dari
            stasiun agent karena layar ini ada untuk menunjukkan di mana kerja berhenti dan siapa
            yang harus menggerakkannya. Penolakan tampil apa adanya: gerbang yang bekerja, bukan error.
          </p>
        </div>
        <div className="mt-4 flex items-center gap-2 md:mt-0">
          {data.projects.length > 1 && (
            <select
              className="native-select"
              value={data.projectId}
              onChange={(event) => data.setProjectId(event.target.value)}
              aria-label="Project"
            >
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.status})
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" size="sm" onClick={data.reload}>
            <RefreshCw className="size-3.5" />
            Muat ulang
          </Button>
        </div>
      </header>

      <LiveBanner />

      {data.failure ? (
        <Card>
          <CardContent className="pt-5">
            <CouldNotCheck label="Flow" failure={data.failure} />
          </CardContent>
        </Card>
      ) : !data.state ? (
        <Checking label="Flow" />
      ) : (
        <>
          <FlowTrack
            stages={data.state.stages}
            selectedIndex={selectedIndex}
            onSelect={(index) => setSelectedIndex((current) => (current === index ? null : index))}
          />
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <div className="min-w-0">
              <Card>
                <CardContent className="pt-4">
                  <FlowFloorplan
                    stages={data.state.stages}
                    selectedIndex={selectedIndex}
                    onSelect={(index) => setSelectedIndex((current) => (current === index ? null : index))}
                  />
                </CardContent>
              </Card>
              {selectedIndex !== null && (
                <StageDetail stage={data.state.stages[selectedIndex]} onClose={() => setSelectedIndex(null)} />
              )}
              <div className="mt-4">
                <FlowConsole state={data.state} />
              </div>
            </div>
            <FlowRail state={data.state} />
          </div>
        </>
      )}
    </div>
  );
}
