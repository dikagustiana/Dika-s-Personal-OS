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
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { useAppStore } from '../../../store/appStore';
import { useLabLiveStore } from '../../../store/labLiveStore';
import { useMutation } from '../../../hooks/useMutation';
import { agentColor } from '../../../logic/lab/labAgentColors';
import { emptyWorkshopStages, type FlowStage } from '../../../logic/lab/labFlowState';
import { cn } from '../../../lib/utils';
import { CouldNotCheck, Checking } from '../../work/finishLineUi';
import { FlowConsole } from './FlowConsole';
import { FlowFloorplan } from './FlowFloorplan';
import { FlowRail } from './FlowRail';
import { useLabFlowState } from './useLabFlowState';

/** `omitted` is a route fact, shown in the route's language. */
const statusShown = (status: FlowStage['status']): string =>
  status === 'omitted' ? 'dilewati' : status;

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
  // Tallies count the ROUTE's work: an omitted station is in none of them,
  // but its segment still renders — thirteen cells, always.
  const done = stages.filter((stage) => stage.status === 'done').length;
  const attention = stages.filter((stage) => stage.status === 'attention').length;
  const blocked = stages.filter((stage) => stage.status === 'blocked').length;
  return (
    <div role="group" aria-label="Posisi pipeline — 13 tahap berurutan" className="mb-4">
      <div className="flex gap-1">
        {stages.map((stage) => (
          <button
            key={stage.code}
            title={`${stage.code} ${stage.title} — ${statusShown(stage.status)}`}
            aria-label={`${stage.code} ${stage.title}: ${statusShown(stage.status)}${stage.frontLine ? ' (garis depan)' : ''}`}
            aria-pressed={selectedIndex === stage.index}
            onClick={() => onSelect(stage.index)}
            className={cn(
              'h-3 flex-1 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              stage.status === 'done' && 'bg-[#33465C]',
              stage.status === 'attention' && 'bg-[#9A5200]/80',
              stage.status === 'blocked' && 'flow-hatch-cell',
              stage.status === 'idle' && 'bg-[#DCE4EB]',
              stage.status === 'omitted' && 'border border-dashed border-[#B6BFC9] bg-transparent',
              stage.running && 'flow-shimmer',
              stage.frontLine && 'ring-2 ring-[#9A5200] ring-offset-1',
            )}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {stages.map((stage) => (
          <span
            key={stage.code}
            className={cn(
              'flex-1 text-center font-mono text-[9px] text-foreground-muted',
              stage.status === 'omitted' && 'opacity-50',
            )}
          >
            {stage.code}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-foreground-muted">
        {done} tuntas · {attention} menunggu kamu · {blocked} terhalang
      </p>
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
              {stage.code} · {stage.actor === 'owner' ? 'stasiun manusia' : stage.actor === 'agent' ? 'stasiun agent' : 'gerbang'} · {statusShown(stage.status)}
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
  const repository = useAppStore((state) => state.repository);
  const { run: mutate, isPending } = useMutation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const toggleSelect = (index: number) =>
    setSelectedIndex((current) => (current === index ? null : index));
  // The not-started workshop: thirteen structural stations, every count a
  // measured ZERO. Computed once — it depends on nothing but the clock.
  const emptyStages = useMemo(() => emptyWorkshopStages(new Date()), []);
  const canonicalId = data.workflows.find((workflow) => workflow.isCanonical)?.id ?? '';

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
          {data.projects.length > 0 && data.workflows.length > 0 && (
            // The route selector (085). Choosing the canonical row stores
            // NULL — "canonical" is the absence of an override, by schema.
            <select
              className="native-select"
              value={data.activeWorkflowId}
              disabled={isPending}
              aria-label="Workflow"
              onChange={(event) => {
                const chosen = event.target.value;
                void mutate('Ganti workflow', () =>
                  repository.labEvidence.setProjectWorkflow(
                    data.projectId,
                    chosen === canonicalId ? null : chosen,
                  ),
                ).then((saved) => {
                  if (saved) data.reload();
                });
              }}
            >
              {data.workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name} · {workflow.stageCodes.length}/13
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

      {/* Four read states, each its own render — the readResult rule.
          `Checking` is ONLY for reads that have not returned; an empty
          project list is an ANSWER and gets its meaning in words. The
          final arm is unreachable today (reads done, nothing failed, a
          project exists, yet no state) — if code drift ever makes it
          real, it renders loud, never as a spinner or an idle floor. */}
      {data.failure ? (
        <Card>
          <CardContent className="pt-5">
            <CouldNotCheck label="Flow" failure={data.failure} />
          </CardContent>
        </Card>
      ) : data.loading ? (
        <Checking label="Flow" />
      ) : data.noProjects ? (
        // The thirteen stations are a STRUCTURAL fact — they exist whether
        // or not a project does. What is zero is each station's counts, so
        // the workshop draws in full: all segments un-walked, no tokens
        // (nothing has run), every count an explicit 0, and ONE callout at
        // S0 saying where to start. Nothing is blocked — it has not begun.
        <>
          <p className="mb-4 text-sm text-foreground-muted">
            Belum ada proyek riset — buat satu di tab Evidence; denah di bawah adalah bentuk
            kerjanya, setiap hitungan 0.
          </p>
          <FlowTrack stages={emptyStages} selectedIndex={selectedIndex} onSelect={toggleSelect} />
          <Card>
            <CardContent className="pt-4">
              <FlowFloorplan
                stages={emptyStages}
                selectedIndex={selectedIndex}
                onSelect={toggleSelect}
              />
            </CardContent>
          </Card>
          {selectedIndex !== null && (
            <StageDetail stage={emptyStages[selectedIndex]} onClose={() => setSelectedIndex(null)} />
          )}
        </>
      ) : !data.state ? (
        <Card>
          <CardContent className="pt-5">
            <CouldNotCheck
              label="Flow"
              failure={{
                reason: 'failed',
                detail:
                  'Flow: semua read selesai dan proyek ada, tapi state tidak terbentuk — bug di layar ini, bukan database kosong. Laporkan.',
              }}
            />
          </CardContent>
        </Card>
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
