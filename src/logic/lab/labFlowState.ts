/**
 * THE ONE STATE OBJECT behind every Flow surface. The track strip, the
 * floorplan, the rail and the console all render from what this file
 * derives — no surface computes its own counts, or they would disagree and
 * the owner would trust none of them.
 *
 * TWO HONESTY RULES, from the brief, load-bearing:
 *
 *  1. POSITIONAL PROGRESS IS A FACT — thirteen known stages, counted done /
 *     attention / blocked / idle. WORK-COMPLETION PROGRESS IS INVENTED —
 *     one call runs one action and the system cannot know how much a
 *     document still holds. Nothing in this state is a percentage complete,
 *     an ETA, or a bar toward an unknown total. The IND-vs-cap figure is a
 *     ratio of two KNOWN numbers, which is why it may exist.
 *
 *  2. A BLOCKED STAGE NAMES ITS BLOCKER AND THE RECORD ID. "Terhalang" with
 *     no reason turns a state view into a guessing game. Blockers here are
 *     computed by the SAME guard mirrors the mutation path runs
 *     (claimApprovalBlockers / outputFinalizeBlockers / guardOutputContent
 *     from labEvidenceGuards) so this screen can never contradict what a
 *     click would actually do.
 *
 * Everything is derived from rows the epistemic tables already hold — no
 * tracking table exists, by design: a denormalised progress table would be
 * a second source of truth about state, and it would drift.
 *
 * Pure and clock-free (`now` is an argument) so every rule is testable.
 */
import {
  claimApprovalBlockers,
  guardOutputContent,
  outputFinalizeBlockers,
} from '../../data/labEvidenceGuards';
import type {
  LabCandidateSource,
  LabClaim,
  LabClaimContradiction,
  LabDatapoint,
  LabDatapointConflict,
  LabEvidenceRequirement,
  LabModelResult,
  LabModelSpec,
  LabModelSpecParam,
  LabOutput,
  LabProject,
  LabQuestion,
  LabReference,
  LabSourceDocument,
  LabSubQuestion,
  LabTask,
} from '../../data/labEvidenceTypes';
import type { LabAgent, LabProvider, LabRun } from '../../data/labTypes';
import type { LabSweepBeat } from '../../data/labEvidenceRepository';
import type { LabLiveRun } from '../../store/labLiveStore';
import { agentFallbackName, EVIDENCE_AGENTS } from './labAgentColors';
import { IND_WIP_CAP_DISPLAY } from './labConfig';
import { omittedConsequence } from './labFlowOmissions';
import type { FlowActor, FlowStageStatus } from './flowScene';

// ---------------------------------------------------------------------------
// the thirteen stages
// ---------------------------------------------------------------------------

export interface StageDef {
  code: string;
  title: string;
  /** Who moves this station — the floorplan's colour and size axis. */
  actor: FlowActor;
  /** Which agents stand HERE when they have run. Empty for owner work. */
  agentSlugs: readonly string[];
}

/**
 * S0–S12. Actor assignment is the review's second rule made structural:
 * six owner stations (S5 the largest on the floor), six agent stations,
 * and the Finalize gate. The coordinator's token stands at Plan — its
 * delegations are task records — while the station itself stays the
 * owner's, because evidence requirements are owner-written.
 */
export const STAGES: readonly StageDef[] = [
  { code: 'S0', title: 'Intake', actor: 'owner', agentSlugs: ['evidence-framer'] },
  { code: 'S1', title: 'Rencana', actor: 'owner', agentSlugs: ['evidence-coordinator'] },
  { code: 'S2', title: 'Discovery', actor: 'agent', agentSlugs: ['evidence-scout', 'evidence-literature'] },
  { code: 'S3', title: 'Locate', actor: 'agent', agentSlugs: ['evidence-locator'] },
  { code: 'S4', title: 'Extract', actor: 'agent', agentSlugs: ['evidence-extractor'] },
  { code: 'S5', title: 'Verifikasi', actor: 'owner', agentSlugs: [] },
  { code: 'S6', title: 'Ground', actor: 'owner', agentSlugs: [] },
  { code: 'S7', title: 'Model', actor: 'agent', agentSlugs: ['evidence-modeler'] },
  { code: 'S8', title: 'Klaim', actor: 'owner', agentSlugs: [] },
  { code: 'S9', title: 'Review', actor: 'agent', agentSlugs: ['evidence-reviewer'] },
  { code: 'S10', title: 'Approve', actor: 'owner', agentSlugs: [] },
  { code: 'S11', title: 'Draft', actor: 'agent', agentSlugs: ['evidence-drafter'] },
  { code: 'S12', title: 'Finalize', actor: 'gate', agentSlugs: [] },
];

/** How stale the sweep heartbeat may be before finalize refuses (079). */
export const SWEEP_STALE_HOURS = 48;

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

export interface FlowBlocker {
  reason: string;
  recordId: string;
}

export interface FlowStage extends StageDef {
  index: number;
  status: FlowStageStatus;
  /** One counted line — the station's answer to "berapa?". */
  headline: string;
  /** More counted lines for the detail panel. */
  detail: string[];
  blockers: FlowBlocker[];
  /** Agents standing at this station: ran before, or running now. */
  presentAgents: string[];
  running: boolean;
  frontLine: boolean;
  /**
   * When set, the floorplan draws exactly these callout lines for this
   * station instead of deriving them (front line / running / blocked).
   * Used by the not-started workshop for its single S0 "start here".
   */
  callout?: string[];
}

export interface FlowAgentRow {
  slug: string;
  name: string;
  stationCode: string | null;
  /** ISO of the newest run, or null = belum pernah dijalankan. */
  lastRanAt: string | null;
  lastStatus: LabRun['status'] | null;
  runningNow: boolean;
  isActive: boolean;
  registered: boolean;
}

export type FlowLogLevel = 'INFO' | 'OK' | 'REFUSED' | 'WAIT';

export interface FlowLogLine {
  id: string;
  at: string;
  agentSlug: string | null;
  level: FlowLogLevel;
  text: string;
  run?: {
    id: string;
    status: LabRun['status'];
    durationMs: number | null;
    costUsd: number | null;
    tokensIn: number | null;
    tokensOut: number | null;
    model: string;
  };
}

export interface FlowUsageRow {
  model: string;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  usd: number;
}

export interface FlowOrchestration {
  frontLine: { index: number; code: string; title: string } | null;
  doneCount: number;
  blockedCount: number;
  indOpen: number;
  indCap: number;
  /** Open contradictions by severity — direct is the one that gates. */
  contradictions: { direct: number; tension: number; scopeDifference: number };
  unresolvedConflicts: number;
  /** Hours since the newest sweep heartbeat; null = never ran. */
  sweepAgeHours: number | null;
  sweepRowsDemoted: number | null;
  sweepReadFailed: boolean;
  /** Live blockers across all stages — gates currently refusing. */
  gatesRefusing: number;
}

export interface FlowServices {
  /** 'ok' = live reads landed; 'mock' = no Supabase config; 'failed' carries detail. */
  supabase: { state: 'ok' | 'mock' | 'failed'; detail: string };
  /** null = probe unreachable/loading — "could not check", never "no key". */
  anthropicKey: boolean | null;
  cron: {
    state: 'fresh' | 'late' | 'stale' | 'never' | 'unknown';
    ageHours: number | null;
  };
  /**
   * The data boundary as seen from the registry rows. The TRIGGERS enforce
   * it regardless (20260817000074); this row lets the owner watch the
   * registry stay congruent — and shouts the slug if it ever is not.
   */
  boundary: { state: 'verified' | 'violated' | 'unverifiable'; violations: string[] };
}

export interface LabFlowState {
  stages: FlowStage[];
  agents: FlowAgentRow[];
  orchestration: FlowOrchestration;
  services: FlowServices;
  usage: FlowUsageRow[];
  /** Newest first; REFUSED lines are refusals persisted on run rows (083). */
  log: FlowLogLine[];
}

export interface FlowInput {
  projectId: string;
  projects: readonly LabProject[];
  questions: readonly LabQuestion[];
  subQuestions: readonly LabSubQuestion[];
  requirements: readonly LabEvidenceRequirement[];
  candidates: readonly LabCandidateSource[];
  sources: readonly LabSourceDocument[];
  references: readonly LabReference[];
  datapoints: readonly LabDatapoint[];
  conflicts: readonly LabDatapointConflict[];
  claims: readonly LabClaim[];
  contradictions: readonly LabClaimContradiction[];
  outputs: readonly LabOutput[];
  tasks: readonly LabTask[];
  modelSpecs: readonly LabModelSpec[];
  modelParams: readonly LabModelSpecParam[];
  modelResults: readonly LabModelResult[];
  runs: readonly LabRun[];
  agents: readonly LabAgent[];
  providers: readonly LabProvider[];
  sweep: LabSweepBeat | null;
  sweepReadFailed: boolean;
  agentsReadFailed: boolean;
  supabaseConfigured: boolean;
  readFailureDetail: string | null;
  probe: { configured: boolean; anthropic: boolean } | null;
  live: LabLiveRun | null;
  now: Date;
  /**
   * The active workflow's route: an ordered subset of the thirteen stage
   * codes (085). Omitted/null/empty = the canonical run, no omissions.
   * Stages outside the route derive as `omitted` — greyed and labelled IN
   * POSITION with the consequence of skipping them, never dropped: the
   * gates are not workflow-scoped, and a complete-looking three-station
   * workshop would mislead right up to the wall.
   */
  workflowStageCodes?: readonly string[] | null;
}

// ---------------------------------------------------------------------------
// derivation
// ---------------------------------------------------------------------------

const hoursBetween = (later: Date, earlierIso: string): number =>
  (later.getTime() - new Date(earlierIso).getTime()) / 3_600_000;

export function deriveFlowState(input: FlowInput): LabFlowState {
  const {
    projectId,
    now,
    live,
  } = input;

  // Project-scoped rows. Datapoints / sources / references / candidates are
  // deliberately GLOBAL — datapoints are shared across projects by schema
  // design, and the WIP cap counts them globally exactly as the executor
  // does. Stage lines say "lintas proyek" where that is the case.
  const questions = input.questions.filter((row) => row.projectId === projectId);
  const questionIds = new Set(questions.map((row) => row.id));
  const subQuestions = input.subQuestions.filter((row) => questionIds.has(row.questionId));
  const subQuestionIds = new Set(subQuestions.map((row) => row.id));
  const requirements = input.requirements.filter((row) => subQuestionIds.has(row.subQuestionId));
  const claims = input.claims.filter((row) => row.projectId === projectId);
  const outputs = input.outputs.filter((row) => row.projectId === projectId);
  const specs = input.modelSpecs.filter((row) => row.projectId === projectId);
  const specIds = new Set(specs.map((row) => row.id));
  const specParams = input.modelParams.filter((row) => specIds.has(row.specId));
  const results = input.modelResults.filter((row) => specIds.has(row.specId));
  const candidates = input.candidates.filter(
    (row) => row.projectId === null || row.projectId === projectId,
  );

  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const slugOf = (run: LabRun): string | null => agentById.get(run.agentId)?.slug ?? null;

  // Newest run per agent slug — the roster's "where it last ran".
  const newestRunBySlug = new Map<string, LabRun>();
  for (const run of input.runs) {
    const slug = slugOf(run);
    if (!slug) continue;
    const held = newestRunBySlug.get(slug);
    if (!held || run.createdAt > held.createdAt) newestRunBySlug.set(slug, run);
  }
  const ranSlugs = new Set(newestRunBySlug.keys());

  const stationOf = (slug: string): string | null =>
    STAGES.find((stage) => stage.agentSlugs.includes(slug))?.code ?? null;

  const runningSlug = live?.agentSlug ?? null;

  // --- per-stage facts ----------------------------------------------------
  const ind = input.datapoints.filter((row) => row.status === 'IND');
  const matched = input.datapoints.filter((row) => row.status === 'V');
  const na = input.datapoints.filter((row) => row.status === 'NA');
  const openDirect = input.contradictions.filter(
    (row) => row.status === 'open' && row.severity === 'direct',
  );
  const openTension = input.contradictions.filter(
    (row) => row.status === 'open' && row.severity === 'tension',
  );
  const openScope = input.contradictions.filter(
    (row) => row.status === 'open' && row.severity === 'scope_difference',
  );
  const unresolvedConflicts = input.conflicts.filter(
    (row) => row.resolutionStatus === 'unresolved',
  );

  const sweepAgeHours = input.sweep ? Math.max(0, hoursBetween(now, input.sweep.ranAt)) : null;
  const sweepStale = sweepAgeHours === null || sweepAgeHours > SWEEP_STALE_HOURS;

  const stages: FlowStage[] = STAGES.map((def, index) => {
    const built = buildStage(def, index, {
      input,
      questions,
      subQuestions,
      requirements,
      claims,
      outputs,
      specs,
      specParams,
      results,
      candidates,
      ind,
      matched,
      na,
      openDirect,
      unresolvedConflicts,
      newestRunBySlug,
      sweepAgeHours,
      sweepStale,
      sweepReadFailed: input.sweepReadFailed,
    });
    const running = def.agentSlugs.some((slug) => slug === runningSlug);
    const presentAgents = def.agentSlugs.filter(
      (slug) => ranSlugs.has(slug) || slug === runningSlug,
    );
    return { ...def, index, ...built, running, presentAgents, frontLine: false };
  });

  // The active workflow's omissions (085). A station outside the route is
  // OMITTED — greyed and labelled in position, never dropped — and carries
  // the one-line consequence of skipping it, derived from the gate that
  // will actually refuse. History stays: tokens keep standing where agents
  // actually ran, because the route changes the plan, not the record.
  const routeCodes =
    input.workflowStageCodes && input.workflowStageCodes.length > 0
      ? new Set(input.workflowStageCodes)
      : null;
  if (routeCodes) {
    for (const stage of stages) {
      if (routeCodes.has(stage.code)) continue;
      stage.status = 'omitted';
      stage.blockers = [];
      stage.headline = 'dilewati — bukan bagian workflow ini';
      stage.detail = [omittedConsequence(stage.code)];
    }
  }

  // Front line: the earliest non-done stage — except an IDLE stage that
  // work has demonstrably moved past (a later stage is done or has
  // attention) is skipped, so an empty optional stage (no models yet)
  // cannot pin the line forever. Blocked stages are never skipped; OMITTED
  // stages are not part of the route, so the line never stands on one.
  let frontLineIndex: number | null = null;
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    if (stage.status === 'done' || stage.status === 'omitted') continue;
    const passedBy =
      stage.status === 'idle' &&
      stages.some(
        (later) =>
          later.index > index && (later.status === 'done' || later.status === 'attention'),
      );
    if (passedBy) continue;
    frontLineIndex = index;
    break;
  }
  if (frontLineIndex !== null) stages[frontLineIndex].frontLine = true;

  const doneCount = stages.filter((stage) => stage.status === 'done').length;
  const blockedCount = stages.filter((stage) => stage.status === 'blocked').length;
  const gatesRefusing = stages.reduce((total, stage) => total + stage.blockers.length, 0);

  // --- roster ---------------------------------------------------------------
  const registryBySlug = new Map(input.agents.map((agent) => [agent.slug, agent]));
  const agents: FlowAgentRow[] = EVIDENCE_AGENTS.map((entry) => {
    const registered = registryBySlug.get(entry.slug);
    const newest = newestRunBySlug.get(entry.slug) ?? null;
    return {
      slug: entry.slug,
      name: registered?.name ?? agentFallbackName(entry.slug),
      stationCode: stationOf(entry.slug),
      lastRanAt: newest?.createdAt ?? null,
      lastStatus: newest?.status ?? null,
      runningNow: entry.slug === runningSlug,
      isActive: registered?.isActive ?? true,
      registered: Boolean(registered),
    };
  });

  // --- services ---------------------------------------------------------------
  const boundaryViolations: string[] = [];
  for (const agent of input.agents) {
    const isEvidence = agent.slug.startsWith('evidence-');
    if (isEvidence && agent.dataClass !== 'internal') {
      boundaryViolations.push(
        `${agent.slug}: data_class '${agent.dataClass}' — an evidence agent sees project content and must be internal.`,
      );
    }
    if (agent.dataClass === 'internal' && agent.defaultProviderId) {
      const provider = input.providers.find((row) => row.id === agent.defaultProviderId);
      if (provider && provider.name !== 'anthropic') {
        boundaryViolations.push(
          `${agent.slug}: internal but default provider is ${provider.name} — Anthropic only, no fallback, no override.`,
        );
      }
    }
  }
  const services: FlowServices = {
    supabase: !input.supabaseConfigured
      ? { state: 'mock', detail: 'Supabase belum dikonfigurasi — data contoh (mock).' }
      : input.readFailureDetail
        ? { state: 'failed', detail: input.readFailureDetail }
        : { state: 'ok', detail: 'reads jalan' },
    anthropicKey: input.probe ? input.probe.anthropic : null,
    cron: {
      state: input.sweepReadFailed
        ? 'unknown'
        : sweepAgeHours === null
          ? 'never'
          : sweepAgeHours <= 26
            ? 'fresh'
            : sweepAgeHours <= SWEEP_STALE_HOURS
              ? 'late'
              : 'stale',
      ageHours: sweepAgeHours,
    },
    boundary: {
      state: input.agentsReadFailed
        ? 'unverifiable'
        : boundaryViolations.length > 0
          ? 'violated'
          : 'verified',
      violations: boundaryViolations,
    },
  };

  // --- usage ------------------------------------------------------------------
  const usageByModel = new Map<string, FlowUsageRow>();
  for (const run of input.runs) {
    const model = run.model || '(model tak tercatat)';
    const bucket = usageByModel.get(model) ?? { model, runs: 0, tokensIn: 0, tokensOut: 0, usd: 0 };
    bucket.runs += 1;
    bucket.tokensIn += run.tokensIn ?? 0;
    bucket.tokensOut += run.tokensOut ?? 0;
    bucket.usd += run.costUsd ?? 0;
    usageByModel.set(model, bucket);
  }
  const usage = [...usageByModel.values()].sort((a, b) => b.usd - a.usd);

  // --- console log --------------------------------------------------------------
  // Derived from the run LEDGER (persisted — survives any reload) plus the
  // one live line. Refusals are quiet REFUSED lines: the system working.
  const log: FlowLogLine[] = [];
  if (live) {
    log.push({
      id: `live-${live.startedAt}`,
      at: new Date(live.startedAt).toISOString(),
      agentSlug: live.agentSlug,
      level: 'WAIT',
      text:
        live.stepIndex !== undefined
          ? `${live.agentSlug} berjalan — langkah ${live.stepIndex + 1}${live.stepCount ? ` dari ${live.stepCount}` : ''} (${live.action})`
          : `${live.agentSlug} berjalan (${live.action})`,
    });
  }
  const chronological = [...input.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const run of chronological.slice(0, 60)) {
    const slug = slugOf(run);
    for (const refusal of run.refusals) {
      log.push({
        id: `${run.id}-ref-${log.length}`,
        at: run.createdAt,
        agentSlug: slug,
        level: 'REFUSED',
        text: refusal,
      });
    }
    log.push({
      id: `${run.id}-line`,
      at: run.createdAt,
      agentSlug: slug,
      level: run.status === 'ok' ? 'OK' : run.status === 'error' ? 'INFO' : 'WAIT',
      text:
        run.status === 'ok'
          ? `${slug ?? run.agentId} selesai${run.chainId ? ` (chain langkah ${(run.stepIndex ?? 0) + 1})` : ''}`
          : run.status === 'error'
            ? `${slug ?? run.agentId} gagal — ${run.error ?? 'tanpa pesan'}`
            : `${slug ?? run.agentId} ${run.status}`,
      run: {
        id: run.id,
        status: run.status,
        durationMs: run.durationMs,
        costUsd: run.costUsd,
        tokensIn: run.tokensIn,
        tokensOut: run.tokensOut,
        model: run.model,
      },
    });
  }

  const frontLine =
    frontLineIndex === null
      ? null
      : { index: frontLineIndex, code: stages[frontLineIndex].code, title: stages[frontLineIndex].title };

  return {
    stages,
    agents,
    orchestration: {
      frontLine,
      doneCount,
      blockedCount,
      indOpen: ind.length,
      indCap: IND_WIP_CAP_DISPLAY,
      contradictions: {
        direct: openDirect.length,
        tension: openTension.length,
        scopeDifference: openScope.length,
      },
      unresolvedConflicts: unresolvedConflicts.length,
      sweepAgeHours,
      sweepRowsDemoted: input.sweep?.rowsDemoted ?? null,
      sweepReadFailed: input.sweepReadFailed,
      gatesRefusing,
    },
    services,
    usage,
    log,
  };
}

// ---------------------------------------------------------------------------
// the thirteen derivations — each one counted, none estimated
// ---------------------------------------------------------------------------

interface StageFacts {
  input: FlowInput;
  questions: LabQuestion[];
  subQuestions: LabSubQuestion[];
  requirements: LabEvidenceRequirement[];
  claims: LabClaim[];
  outputs: LabOutput[];
  specs: LabModelSpec[];
  specParams: LabModelSpecParam[];
  results: LabModelResult[];
  candidates: LabCandidateSource[];
  ind: LabDatapoint[];
  matched: LabDatapoint[];
  na: LabDatapoint[];
  openDirect: LabClaimContradiction[];
  unresolvedConflicts: LabDatapointConflict[];
  newestRunBySlug: Map<string, LabRun>;
  sweepAgeHours: number | null;
  sweepStale: boolean;
  sweepReadFailed: boolean;
}

interface StageDerivation {
  status: FlowStageStatus;
  headline: string;
  detail: string[];
  blockers: FlowBlocker[];
}

// ---------------------------------------------------------------------------
// the workshop before any project exists
// ---------------------------------------------------------------------------

/**
 * The thirteen stations with every count at ZERO — the render for a
 * database that answered "nothing here". The stations are a STRUCTURAL
 * fact, independent of data: they exist whether or not a project does.
 * What is zero is each station's counts; what is not unknown is that the
 * station exists, who acts there, and what it writes.
 *
 * Derived through the same buildStage derivations as the live floor (so
 * the zero headlines are the real counted phrasings at zero), then held to
 * the not-started rules:
 *  - every status idle — nothing walked, nothing blocked. S11's "0
 *    approved claims" bar is a fact about work IN PROGRESS; before any
 *    project exists nothing has begun, so nothing is barred yet;
 *  - no front line — the one pointer is the S0 callout saying where to
 *    start;
 *  - no agents standing anywhere (nothing has run — absence renders as
 *    absence, not as an idle crowd);
 *  - the three run-ledger/optional headlines rewritten to explicit ZEROS
 *    ("belum pernah dijalankan" is honest for a ledger, but here zero is a
 *    measured value and it reads as one).
 */
export function emptyWorkshopStages(now: Date): FlowStage[] {
  const state = deriveFlowState({
    projectId: '',
    projects: [],
    questions: [],
    subQuestions: [],
    requirements: [],
    candidates: [],
    sources: [],
    references: [],
    datapoints: [],
    conflicts: [],
    claims: [],
    contradictions: [],
    outputs: [],
    tasks: [],
    modelSpecs: [],
    modelParams: [],
    modelResults: [],
    runs: [],
    agents: [],
    providers: [],
    sweep: null,
    sweepReadFailed: false,
    agentsReadFailed: false,
    supabaseConfigured: true,
    readFailureDetail: null,
    probe: null,
    live: null,
    now,
  });
  const zeroHeadline: Record<string, string> = {
    S3: '0 run locator',
    S7: '0 spec · 0 hasil model',
    S9: '0 kontradiksi terbuka · 0 konflik belum diputus',
  };
  return state.stages.map((stage) => ({
    ...stage,
    status: 'idle' as FlowStageStatus,
    blockers: [],
    frontLine: false,
    running: false,
    presentAgents: [],
    headline: zeroHeadline[stage.code] ?? stage.headline,
    ...(stage.code === 'S0'
      ? { callout: ['Mulai di sini — S0 Intake', 'Buat proyek di tab Evidence dulu.'] }
      : {}),
  }));
}

function buildStage(_def: StageDef, index: number, facts: StageFacts): StageDerivation {
  switch (index) {
    case 0: {
      // S0 Intake — os_lab_questions / os_lab_sub_questions counts.
      const q = facts.questions.length;
      const sq = facts.subQuestions.length;
      const status: FlowStageStatus = q === 0 ? 'idle' : sq === 0 ? 'attention' : 'done';
      return {
        status,
        headline: `${q} pertanyaan · ${sq} sub-pertanyaan`,
        detail:
          q > 0 && sq === 0
            ? ['Pertanyaan ada tapi belum punya sub-pertanyaan — framing belum bisa diuji.']
            : [],
        blockers: [],
      };
    }
    case 1: {
      // S1 Rencana — evidence requirements; falsifier coverage per
      // sub-question (the same rule G-FALSIFY keys on: ≥1 requirement,
      // satisfied later).
      const withPlan = facts.subQuestions.filter((sq) =>
        facts.requirements.some((req) => req.subQuestionId === sq.id),
      );
      const uncovered = facts.subQuestions.filter(
        (sq) => !facts.requirements.some((req) => req.subQuestionId === sq.id),
      );
      const tasks = facts.input.tasks.filter(
        (task) => task.projectId === null || task.projectId === facts.input.projectId,
      );
      const status: FlowStageStatus =
        facts.subQuestions.length === 0 ? 'idle' : uncovered.length > 0 ? 'attention' : 'done';
      return {
        status,
        headline: `${withPlan.length}/${facts.subQuestions.length} sub punya rencana bukti`,
        detail: [
          `${facts.requirements.length} evidence requirement · ${tasks.length} task koordinator`,
          ...uncovered
            .slice(0, 3)
            .map((sq) => `Sub-pertanyaan ${sq.id} belum punya requirement — G-FALSIFY akan menolak finalize yang mengalamatkannya.`),
        ],
        blockers: [],
      };
    }
    case 2: {
      // S2 Discovery — candidates by tier; references at abstract_only;
      // ingested sources (global — sources serve every project).
      const t1 = facts.candidates.filter((row) => row.tier === 1 && row.status === 'candidate').length;
      const t2 = facts.candidates.filter((row) => row.tier === 2 && row.status === 'candidate').length;
      const t3 = facts.candidates.filter((row) => row.tier === 3 && row.status === 'candidate').length;
      const sources = facts.input.sources.length;
      const abstracts = facts.input.references.filter(
        (row) => row.verificationLevel === 'abstract_only',
      ).length;
      const any = t1 + t2 + t3 + sources + facts.input.references.length > 0;
      return {
        status: sources > 0 ? 'done' : any ? 'attention' : 'idle',
        headline: `${sources} sumber ber-snapshot · ${t1 + t2 + t3} kandidat (t1 ${t1} · t2 ${t2} · t3 ${t3})`,
        detail: [
          `${abstracts} referensi masih abstract_only (lintas proyek)`,
          'Tier dihitung trigger dari allowlist — tier 3 tidak bisa menopang klaim layer A.',
        ],
        blockers: [],
      };
    }
    case 3: {
      // S3 Locate — locator RUNS: locators are not stored as rows (the
      // owner pastes the region), so the honest count is the run ledger's.
      const newest = facts.newestRunBySlug.get('evidence-locator');
      const anyDatapoints = facts.input.datapoints.length > 0;
      return {
        status: anyDatapoints || newest?.status === 'ok' ? 'done' : newest ? 'attention' : 'idle',
        headline: newest
          ? `run terakhir ${newest.status} — hasil dipakai langsung saat ekstraksi`
          : 'belum pernah dijalankan',
        detail: ['Locator tidak menyimpan baris — outputnya menunjuk wilayah teks yang di-paste ke Extract.'],
        blockers: [],
      };
    }
    case 4: {
      // S4 Extract — datapoints; refusals from the last extractor run
      // (persisted on the row, 083); BLOCKED at the WIP cap, naming the
      // head of the queue — the record the owner should verify first.
      const agentExtracted = facts.input.datapoints.filter(
        (row) => row.extractionMethod !== 'manual',
      ).length;
      const manual = facts.input.datapoints.length - agentExtracted;
      const newest = facts.newestRunBySlug.get('evidence-extractor');
      const blockers: FlowBlocker[] = [];
      if (facts.ind.length >= IND_WIP_CAP_DISPLAY) {
        const oldest = [...facts.ind].sort((a, b) => a.retrievedAt.localeCompare(b.retrievedAt))[0];
        blockers.push({
          reason: `WIP cap: ${facts.ind.length} datapoint terbuka di IND (cap ${IND_WIP_CAP_DISPLAY}) — ekstraksi ditolak sebelum ada yang di-source-match atau ditandai NA. Verifikasi adalah jalan majunya, bukan ekstraksi lagi.`,
          recordId: oldest?.id ?? '(antrean kosong?)',
        });
      }
      return {
        status:
          blockers.length > 0
            ? 'blocked'
            : facts.input.datapoints.length > 0
              ? 'done'
              : newest
                ? 'attention'
                : 'idle',
        headline: `${facts.input.datapoints.length} datapoint (agent ${agentExtracted} · manual ${manual}, lintas proyek)`,
        detail: newest
          ? [`Run extractor terakhir: ${newest.refusals.length} penolakan tercatat di run row.`]
          : [],
        blockers,
      };
    }
    case 5: {
      // S5 Verifikasi — the owner's queue, and the WIP figure. The largest
      // station on the floor because this is where the pipeline's clock is.
      const status: FlowStageStatus =
        facts.input.datapoints.length === 0
          ? 'idle'
          : facts.ind.length > 0
            ? 'attention'
            : 'done';
      return {
        status,
        headline: `${facts.ind.length} antre di IND (${facts.ind.length}/${IND_WIP_CAP_DISPLAY} WIP) · ${facts.matched.length} source-matched · ${facts.na.length} NA`,
        detail: [
          'Source-match membandingkan nilai tersimpan dengan lokasi yang dikutip — bukan sertifikat kebenaran.',
        ],
        blockers: [],
      };
    }
    case 6: {
      // S6 Ground — references promoted / total (global).
      const total = facts.input.references.length;
      const full = facts.input.references.filter(
        (row) => row.verificationLevel === 'full_text_read',
      ).length;
      return {
        status: total === 0 ? 'idle' : full > 0 ? 'done' : 'attention',
        headline: `${full}/${total} referensi full-text (lintas proyek)`,
        detail: ['Referensi abstract_only tidak bisa dikutip klaim — promosi adalah pernyataan sudah MEMBACA.'],
        blockers: [],
      };
    }
    case 7: {
      // S7 Model — results; BLOCKED while a bound input is not V; stale
      // results named. Optional: no specs = idle, and the front line may
      // pass it when later stages carry work.
      const blockers: FlowBlocker[] = [];
      for (const param of facts.specParams) {
        if (param.kind !== 'datapoint' || !param.datapointId) continue;
        const datapoint = facts.input.datapoints.find((row) => row.id === param.datapointId);
        if (!datapoint || datapoint.status !== 'V') {
          blockers.push({
            reason: `G-MODEL: parameter '${param.name}' mengikat datapoint yang tidak source-matched (${datapoint?.status ?? 'hilang'}) — run akan ditolak sampai di-match ulang.`,
            recordId: param.datapointId,
          });
        }
      }
      const passing = facts.results.filter(
        (row) => row.checksPassed && row.sensitivityPassed === true && !row.staleInput,
      ).length;
      const staleResults = facts.results.filter((row) => row.staleInput);
      const status: FlowStageStatus =
        facts.specs.length === 0
          ? 'idle'
          : blockers.length > 0
            ? 'blocked'
            : passing > 0
              ? 'done'
              : 'attention';
      return {
        status,
        headline:
          facts.specs.length === 0
            ? 'opsional — belum ada spec'
            : `${facts.specs.length} spec · ${passing}/${facts.results.length} hasil lolos semua check`,
        detail: staleResults
          .slice(0, 3)
          .map((row) => `Hasil ${row.id} stale_input — datapoint masukannya kehilangan V; tidak bisa memenuhi requirement atau [sim].`),
        blockers,
      };
    }
    case 8: {
      // S8 Klaim — by layer; formation, not approval (that is S10).
      const byLayer = { A: 0, B: 0, C: 0 };
      for (const claim of facts.claims) byLayer[claim.layer] += 1;
      return {
        status: facts.claims.length > 0 ? 'done' : facts.matched.length > 0 ? 'attention' : 'idle',
        headline: `${facts.claims.length} klaim (A ${byLayer.A} · B ${byLayer.B} · C ${byLayer.C})`,
        detail: [],
        blockers: [],
      };
    }
    case 9: {
      // S9 Review — open records by severity; the reviewer surfaces, the
      // owner resolves. Done = it ran AND no open direct contradiction.
      const newest = facts.newestRunBySlug.get('evidence-reviewer');
      const openItems = facts.openDirect.length + facts.unresolvedConflicts.length;
      const status: FlowStageStatus =
        facts.claims.length === 0 && !newest
          ? 'idle'
          : newest?.status === 'ok' && facts.openDirect.length === 0
            ? 'done'
            : 'attention';
      return {
        status,
        headline: newest
          ? `${facts.openDirect.length} kontradiksi DIRECT terbuka · ${facts.unresolvedConflicts.length} konflik belum diputus`
          : 'belum pernah dijalankan',
        detail:
          openItems > 0
            ? ['Reviewer hanya mencatat — resolusi adalah keputusan pemilik, di tab Claims/Datapoints.']
            : [],
        blockers: [],
      };
    }
    case 10: {
      // S10 Approve — the guard mirror decides, so this station can never
      // disagree with the click. DIRECT contradictions block by name.
      const approved = facts.claims.filter((claim) => claim.status === 'approved');
      const reviewed = facts.claims.filter((claim) => claim.status === 'reviewed');
      const blockers: FlowBlocker[] = [];
      for (const claim of facts.claims) {
        if (claim.status === 'approved') continue;
        const hits = claimApprovalBlockers({
          claim,
          datapoints: facts.input.datapoints,
          references: facts.input.references,
          conflicts: facts.input.conflicts,
          contradictions: facts.input.contradictions,
        }).filter((reason) => reason.includes('DIRECT contradiction'));
        for (const reason of hits) blockers.push({ reason, recordId: claim.id });
      }
      return {
        status:
          blockers.length > 0
            ? 'blocked'
            : approved.length > 0
              ? 'done'
              : reviewed.length > 0
                ? 'attention'
                : 'idle',
        headline: `${approved.length} approved · ${reviewed.length} menunggu persetujuan`,
        detail: [],
        blockers,
      };
    }
    case 11: {
      // S11 Draft — barred while zero approved claims: the drafter's own
      // 409, shown before anyone clicks Run.
      const approved = facts.claims.filter((claim) => claim.status === 'approved');
      const blockers: FlowBlocker[] =
        approved.length === 0
          ? [
              {
                reason:
                  'Drafter menolak: 0 klaim approved di proyek ini — drafter hanya mengutip klaim yang sudah disetujui.',
                recordId: facts.input.projectId,
              },
            ]
          : [];
      return {
        status: blockers.length > 0 ? 'blocked' : facts.outputs.length > 0 ? 'done' : 'attention',
        headline: `${facts.outputs.length} output (${facts.outputs.filter((row) => row.status === 'draft').length} draft)`,
        detail: [],
        blockers,
      };
    }
    default: {
      // S12 Finalize — every open gate, per draft output, computed with the
      // SAME mirrors the finalize path runs: G-NUMBER re-scan against the
      // CURRENT cited-claim datapoint set, outputFinalizeBlockers
      // (approval, both-sides contradictions, G-FALSIFY), and the sweep
      // heartbeat (079) — whose refusal names the SWEEP's staleness, not
      // the data's.
      const drafts = facts.outputs.filter((row) => row.status === 'draft');
      const finals = facts.outputs.filter((row) => row.status === 'final');
      const eligibleSims = facts.input.modelResults
        .filter((row) => row.checksPassed && row.sensitivityPassed === true && !row.staleInput)
        .filter((row) => row.resultValue !== null)
        .map((row) => ({ id: row.id, value: row.resultValue as number }));
      const blockers: FlowBlocker[] = [];
      for (const output of drafts) {
        const citedClaims = facts.input.claims.filter((claim) => output.claimIds.includes(claim.id));
        const backing = facts.input.datapoints.filter((datapoint) =>
          citedClaims.some((claim) => claim.datapointIds.includes(datapoint.id)),
        );
        for (const violation of guardOutputContent(output.content, backing, eligibleSims)) {
          blockers.push({
            reason: `G-NUMBER saat finalize: "${violation.token}" tidak lagi ditopang datapoint klaim yang dikutip.`,
            recordId: output.id,
          });
        }
        for (const reason of outputFinalizeBlockers({
          stale: output.stale,
          citedClaims,
          contradictions: facts.input.contradictions,
          addressedSubQuestionIds: output.subQuestionIds,
          requirements: facts.input.requirements,
        })) {
          blockers.push({ reason, recordId: output.id });
        }
        if (facts.sweepReadFailed) {
          // The read failed — this is COULD NOT CHECK, never "never ran":
          // a zero that is really a failed read is this project's most
          // repeated defect, and it does not get to recur here.
          blockers.push({
            reason:
              'Heartbeat sweep tidak bisa dibaca — status gerbang sweep TIDAK DIKETAHUI; database tetap menolak finalize sendiri bila heartbeat basi.',
            recordId: output.id,
          });
        } else if (facts.sweepStale) {
          blockers.push({
            reason:
              facts.sweepAgeHours === null
                ? `Sweep kadaluarsa belum pernah tercatat berjalan — finalize ditolak sampai heartbeat ada (basi yang dimaksud adalah SWEEP-nya, bukan datanya).`
                : `Heartbeat sweep terakhir ${Math.round(facts.sweepAgeHours)} jam lalu (batas ${SWEEP_STALE_HOURS}) — finalize ditolak; yang basi SWEEP-nya, bukan datanya.`,
            recordId: output.id,
          });
        }
      }
      return {
        status:
          drafts.length === 0 && finals.length === 0
            ? 'idle'
            : blockers.length > 0
              ? 'blocked'
              : finals.length > 0
                ? 'done'
                : 'attention',
        headline: `${finals.length} final · ${drafts.length} draft menghadap gerbang`,
        detail: [
          facts.sweepReadFailed
            ? 'Sweep: tidak bisa dicek (read gagal) — bukan berarti tidak pernah jalan.'
            : facts.sweepAgeHours === null
              ? 'Sweep: belum pernah tercatat.'
              : `Sweep terakhir ${Math.round(facts.sweepAgeHours)} jam lalu.`,
        ],
        blockers,
      };
    }
  }
}
