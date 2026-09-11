/**
 * THE STEPPER — the institution, actually running.
 *
 * `nextAction` (supabase/functions/_shared/institution/pipeline.ts) decides
 * what happens next from the rows alone; this performs it, writes what it
 * produced, and stops. One call, one step. Nothing loops inside a step, so
 * a run is a sequence of durable states rather than a process: closing the
 * tab ends the loop, never the brief, and reopening recomputes the next
 * action from the database.
 *
 * EVERYTHING GOES THROUGH PORTS. The repository, the tool layer, the model
 * and the clock arrive as an object, so runner.test.ts drives whole briefs
 * with fakes — a refusal, a rework limit, a blocked egress attempt — with
 * no network and no provider. The fakes are stricter than production in
 * exactly one direction: they never invent a reply the parser would refuse.
 *
 * WHAT THIS FILE MAY NOT DO, and does not:
 *   * write a live system_prompt — proposals only (B-1);
 *   * create an internal agent — authorAgent always passes 'public' and the
 *     database refuses otherwise once authoredByAgentId is set (B-3);
 *   * insert a corpus record — the tool layer does, behind the synthesize
 *     gate (B-8, G-NUMBER);
 *   * continue past a bounded limit — those come back as escalations.
 */
import {
  applyLeadReview,
  applyPeerReview,
  authoringRequests,
  checkSubmission,
  intake as pureIntake,
  leadSeat,
  staffedSpecialists,
  type DepartmentConfig,
  type SeatConfig,
} from '../../../supabase/functions/_shared/institution/department';
import {
  nextAction,
  type Action,
  type AssignmentRow,
  type BriefRow,
  type DebateRow,
  type PipelineState,
  type ReviewRow,
  type SubmissionRow,
} from '../../../supabase/functions/_shared/institution/pipeline';
import {
  briefBlock,
  parseArbitration,
  parseAuthoring,
  parseLeadIntake,
  parseProgramIntake,
  parseRebuttal,
  parseReview,
  parseSpecialistWork,
  parseSubmission,
  parseWeighing,
  renderArbitration,
  renderAuthoring,
  renderCommitteeReview,
  renderEvaluation,
  renderLeadIntake,
  renderLeadReview,
  renderPeerReview,
  renderProgramIntake,
  renderRebuttal,
  renderSpecialistWork,
  renderSubmission,
  renderWeighing,
  type BriefContext,
  type ReviewFinding,
  type ToolResultSummary,
} from '../../../supabase/functions/_shared/institution/protocol';
import { estimate, SHAPES, withMandatoryStops, type CallEstimate } from '../../../supabase/functions/_shared/institution/weight';
import type { InstitutionRepository } from '../../data/institutionRepository';
import type { InstAssignment, InstBrief, InstCorpusRecord, InstDepartment, InstSeat } from '../../data/institutionTypes';
import { rowsOf } from '../../data/readResult';

// ---------------------------------------------------------------------------
// ports
// ---------------------------------------------------------------------------

export interface RunnerAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  dataClass: 'internal' | 'public';
  version: number;
}

export interface AgentRunOutcome {
  ok: boolean;
  output: string;
  runId: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** A refusal from the executor (unconfigured, boundary, rate limit) — not a model answer. */
  refusal?: string;
}

export interface ToolsPort {
  search(context: ToolRef, query: string, limit?: number): Promise<ToolOutcome>;
  fetch(context: ToolRef, url: string, query?: string): Promise<ToolOutcome>;
  publicData(context: ToolRef, url: string, query?: string): Promise<ToolOutcome>;
  execute(context: ToolRef, input: { script: string; inputs?: Record<string, string>; seed?: number; title?: string }): Promise<ToolOutcome>;
  synthesize(context: ToolRef, input: { draft: string; title?: string; records?: string[]; dryRun?: boolean }): Promise<ToolOutcome>;
}

export interface ToolRef {
  agentSlug: string;
  briefId?: string;
  assignmentId?: string;
  runId?: string;
  internalContext?: string[];
}

export type ToolOutcome =
  | { ok: true; tool: string; data: Record<string, unknown> }
  | { ok: false; tool: string; code: string; error: string };

export interface RunnerPorts {
  repo: InstitutionRepository;
  tools: ToolsPort;
  runAgent(request: { agentSlug: string; input: string; briefId: string; assignmentId?: string }): Promise<AgentRunOutcome>;
  listAgents(): Promise<RunnerAgent[]>;
  /** Creates a PUBLIC agent attributed to its author (B-3), and seats it. */
  authorAgent(input: {
    slug: string; name: string; description: string; systemPrompt: string;
    authoredByAgentId: string; authoringPurpose: string; departmentId: string; seatPurpose: string;
  }): Promise<RunnerAgent>;
  /** Measured per-call cost for the estimate; `measured: false` when there is no history. */
  callEstimate(): Promise<CallEstimate>;
  now(): Date;
}

export interface StepReport {
  action: Action['kind'];
  why: string;
  note: string;
  spentUsd: number;
  finished: boolean;
  blocked: boolean;
}

const MAX_STEPS = 120;

// ---------------------------------------------------------------------------
// state assembly
// ---------------------------------------------------------------------------

function toConfigs(departments: InstDepartment[], seats: InstSeat[], agents: RunnerAgent[]): DepartmentConfig[] {
  const bySlug = new Map(agents.map((agent) => [agent.slug, agent]));
  return departments
    .slice()
    .sort((a, b) => a.pipelineOrder - b.pipelineOrder)
    .map((department) => ({
      id: department.id,
      slug: department.slug,
      name: department.name,
      kind: department.kind,
      pipelineOrder: department.pipelineOrder,
      leadAgentSlug: department.leadAgentSlug,
      purpose: department.purpose,
      accountableFor: department.accountableFor,
      seats: seats
        .filter((seat) => seat.departmentId === department.id)
        .sort((a, b) => a.position - b.position)
        .map((seat): SeatConfig => {
          const agent = bySlug.get(seat.agentSlug);
          return {
            agentSlug: seat.agentSlug,
            role: seat.role,
            seatPurpose: seat.seatPurpose,
            position: seat.position,
            agentId: agent?.id ?? null,
            dataClass: agent?.dataClass ?? null,
            capabilities: [seat.seatPurpose, agent?.description ?? ''].filter(Boolean),
          };
        }),
    }));
}

interface LoadedState {
  pipeline: PipelineState;
  brief: InstBrief;
  configs: DepartmentConfig[];
  agents: RunnerAgent[];
  assignments: InstAssignment[];
  corpus: InstCorpusRecord[];
  departmentIdBySlug: Map<string, string>;
}

async function load(ports: RunnerPorts, briefId: string): Promise<LoadedState> {
  const brief = await ports.repo.getBrief(briefId);
  if (!brief) throw new Error(`No brief ${briefId}.`);
  const [departments, seats, agents, assignments, reviews, submissions, debates, corpus] = await Promise.all([
    ports.repo.listDepartments(),
    ports.repo.listSeats(),
    ports.listAgents(),
    ports.repo.listAssignments(briefId),
    ports.repo.listReviews(briefId),
    ports.repo.listSubmissions(briefId),
    ports.repo.listDebates(briefId),
    ports.repo.listCorpus({ briefId }),
  ]);
  const departmentRows = rowsOf(departments);
  const configs = toConfigs(departmentRows, rowsOf(seats), agents);
  const departmentIdBySlug = new Map(departmentRows.map((row) => [row.slug, row.id]));
  const slugById = new Map(departmentRows.map((row) => [row.id, row.slug]));
  const assignmentRows = rowsOf(assignments);

  const pipeline: PipelineState = {
    brief: {
      id: brief.id,
      question: brief.question,
      brief: brief.brief,
      weightClass: brief.weightClass,
      dataClass: brief.dataClass,
      routing: brief.routing,
      status: brief.status,
      currentDepartmentSlug: brief.currentDepartmentSlug,
      stepsTaken: brief.stepsTaken,
      costEstimateUsd: brief.costEstimateUsd,
      costActualUsd: brief.costActualUsd,
    } satisfies BriefRow,
    departments: configs,
    assignments: assignmentRows.map((row): AssignmentRow => ({
      id: row.id,
      briefId: row.briefId,
      departmentId: row.departmentId,
      departmentSlug: row.departmentId ? slugById.get(row.departmentId) ?? null : null,
      agentSlug: row.agentSlug,
      kind: row.kind,
      status: row.status,
      parentAssignmentId: row.parentAssignmentId,
      outputCorpusId: row.outputCorpusId,
      output: row.output,
      reworkCount: row.reworkCount,
      round: row.round,
      refusalReason: row.refusalReason,
    })),
    reviews: rowsOf(reviews).map((row): ReviewRow => ({
      id: row.id,
      briefId: row.briefId,
      kind: row.kind,
      reviewerAgentSlug: agents.find((agent) => agent.id === row.reviewerAgentId)?.slug ?? '',
      subjectAssignmentId: row.subjectAssignmentId,
      verdict: row.verdict,
      round: row.round,
    })),
    submissions: rowsOf(submissions).map((row): SubmissionRow => ({
      id: row.id,
      briefId: row.briefId,
      fromDepartmentSlug: slugById.get(row.fromDepartmentId) ?? '',
      toDepartmentSlug: row.toDepartmentId ? slugById.get(row.toDepartmentId) ?? null : null,
      toCommittee: row.toCommittee,
      returnCount: row.returnCount,
      accepted: row.accepted,
    })),
    debates: rowsOf(debates).map((row): DebateRow => ({
      id: row.id,
      briefId: row.briefId,
      reviewId: row.reviewId,
      rebuttingAgentSlug: agents.find((agent) => agent.id === row.rebuttingAgentId)?.slug ?? '',
      round: row.round,
      outcome: row.outcome,
    })),
    maxSteps: MAX_STEPS,
  };

  return { pipeline, brief, configs, agents, assignments: assignmentRows, corpus: rowsOf(corpus), departmentIdBySlug };
}

const briefContext = (brief: InstBrief): BriefContext => ({
  question: brief.question,
  restated: brief.brief.restated ?? '',
  answerWouldBe: brief.brief.answerWouldBe ?? '',
  outOfScope: brief.brief.outOfScope ?? '',
  assumptions: brief.brief.assumptions ?? [],
  weightClass: brief.weightClass,
  dataClass: brief.dataClass,
});

const archivedSummaries = (corpus: InstCorpusRecord[]): ToolResultSummary[] =>
  corpus.slice(0, 40).map((record) => ({
    tool: record.kind,
    ok: true,
    corpusId: record.id,
    summary: `${record.kind}: ${record.title}${record.url ? ` (${record.url})` : ''}`,
  }));

/** The internal haystack the egress check scans against (B-4). */
const internalContextOf = (corpus: InstCorpusRecord[]): string[] =>
  corpus.filter((record) => record.dataClass === 'internal').map((record) => record.content);

// ---------------------------------------------------------------------------
// the step
// ---------------------------------------------------------------------------

export async function stepBrief(ports: RunnerPorts, briefId: string): Promise<StepReport> {
  const state = await load(ports, briefId);
  const action = nextAction(state.pipeline);

  const report = (note: string, spentUsd = 0): StepReport => ({
    action: action.kind,
    why: action.why,
    note,
    spentUsd,
    finished: action.kind === 'done',
    blocked: action.kind === 'blocked',
  });

  if (action.kind === 'done') return report('nothing to do');
  if (action.kind === 'blocked') {
    await ports.repo.recordEvent({ briefId, kind: 'run.blocked', payload: { why: action.why } });
    return report(action.why);
  }
  if (action.kind === 'to_director') {
    await ports.repo.updateBrief(briefId, { status: 'director', finishedAt: ports.now().toISOString() });
    await ports.repo.recordEvent({ briefId, kind: 'brief.to_director', payload: { why: action.why } });
    return report('the brief is in the director\'s room');
  }

  const spend = { usd: 0, tokens: 0 };
  const run = async (agentSlug: string, input: string, assignmentId?: string): Promise<AgentRunOutcome> => {
    const outcome = await ports.runAgent({ agentSlug, input, briefId, assignmentId });
    spend.usd += outcome.costUsd;
    spend.tokens += outcome.tokensIn + outcome.tokensOut;
    return outcome;
  };
  const finish = async (note: string): Promise<StepReport> => {
    const fresh = await ports.repo.getBrief(briefId);
    await ports.repo.updateBrief(briefId, {
      stepsTaken: (fresh?.stepsTaken ?? 0) + 1,
      costActualUsd: (fresh?.costActualUsd ?? 0) + spend.usd,
      tokensActual: (fresh?.tokensActual ?? 0) + spend.tokens,
    });
    return report(note, spend.usd);
  };

  const agentBySlug = new Map(state.agents.map((agent) => [agent.slug, agent]));
  const configBySlug = new Map(state.configs.map((config) => [config.slug, config]));
  const context = briefContext(state.brief);

  switch (action.kind) {
    // -- 1-B intake ---------------------------------------------------------
    case 'program_intake': {
      const prompt = renderProgramIntake(state.brief.question, state.configs);
      const outcome = await run(action.agentSlug, prompt);
      if (!outcome.ok) {
        await ports.repo.recordEvent({ briefId, kind: 'run.refused', agentSlug: action.agentSlug, payload: { refusal: outcome.refusal } });
        return finish(`the executor refused: ${outcome.refusal ?? 'no reason given'}`);
      }
      const known = state.configs.filter((config) => config.kind === 'department').map((config) => config.slug);
      const parsed = parseProgramIntake(outcome.output, known);
      if ('error' in parsed) {
        await ports.repo.createAssignment({
          briefId, agentSlug: action.agentSlug, kind: 'program_intake', status: 'failed', input: prompt,
        });
        return finish(parsed.error);
      }
      const routing = withMandatoryStops(parsed.routing, parsed.weightClass);
      const priced = estimate(parsed.weightClass, routing, await ports.callEstimate());
      await ports.repo.updateBrief(briefId, {
        brief: {
          restated: parsed.restated,
          answerWouldBe: parsed.answerWouldBe,
          outOfScope: parsed.outOfScope,
          assumptions: parsed.assumptions,
          classReason: parsed.classReason,
          estimate: { calls: priced.calls, tokens: priced.tokens, costUsd: priced.costUsd, measured: priced.measured, breakdown: priced.breakdown },
        },
        weightClass: parsed.weightClass,
        dataClass: parsed.dataClass,
        routing,
        status: 'running',
        costEstimateUsd: priced.costUsd,
        tokensEstimate: priced.tokens,
        startedAt: state.brief.startedAt ?? ports.now().toISOString(),
      });
      const assignment = await ports.repo.createAssignment({
        briefId,
        departmentId: state.departmentIdBySlug.get('program-office') ?? null,
        agentId: agentBySlug.get(action.agentSlug)?.id ?? null,
        agentSlug: action.agentSlug,
        kind: 'program_intake',
        status: 'done',
        input: prompt,
      });
      await ports.repo.updateAssignment(assignment.id, { output: outcome.output, runId: outcome.runId, finishedAt: ports.now().toISOString() });
      await ports.repo.recordEvent({
        briefId, kind: 'brief.intake', agentSlug: action.agentSlug,
        payload: { weightClass: parsed.weightClass, routing, estimateUsd: priced.costUsd, measured: priced.measured },
      });
      return finish(`brief written: ${parsed.weightClass} class, ${routing.length} departments, estimate $${priced.costUsd.toFixed(4)}${priced.measured ? '' : ' (fallback per-call figure)'}`);
    }

    // -- 1-A intake ---------------------------------------------------------
    case 'lead_intake': {
      const config = configBySlug.get(action.departmentSlug);
      if (!config) return finish(`no config for ${action.departmentSlug}`);
      const upstream = state.pipeline.submissions.find((submission) => submission.toDepartmentSlug === config.slug);
      const upstreamText = upstream
        ? rowsOf(await ports.repo.listSubmissions(briefId)).find((row) => row.id === upstream.id)?.produced ?? ''
        : null;

      // The pure contract first: a refusal that needs no model call is free.
      const pure = pureIntake(config, {
        briefQuestion: state.brief.question,
        restated: state.brief.brief.restated ?? '',
        answerWouldBe: state.brief.brief.answerWouldBe ?? '',
        dataClass: state.brief.dataClass,
        upstreamSummary: upstreamText,
        requiredCapabilities: [],
      });
      if (!pure.accepted) {
        const assignment = await ports.repo.createAssignment({
          briefId,
          departmentId: config.id,
          agentSlug: config.leadAgentSlug,
          kind: 'lead_intake',
          status: 'refused',
          input: 'refused before dispatch by the department contract',
        });
        await ports.repo.updateAssignment(assignment.id, { refusalReason: pure.reason, finishedAt: ports.now().toISOString() });
        await ports.repo.recordEvent({ briefId, kind: 'department.refused', departmentSlug: config.slug, agentSlug: config.leadAgentSlug, payload: { code: pure.code, reason: pure.reason } });
        return finish(`${config.name} returned the assignment: ${pure.reason}`);
      }

      const lead = leadSeat(config);
      const bench = staffedSpecialists(config).filter((seat) => state.brief.dataClass === 'public' || seat.dataClass === 'internal');
      const prompt = renderLeadIntake(config, context, upstreamText, bench);
      const outcome = await run(config.leadAgentSlug, prompt);
      if (!outcome.ok) return finish(`the executor refused: ${outcome.refusal ?? 'no reason given'}`);
      const parsed = parseLeadIntake(outcome.output, bench.map((seat) => seat.agentSlug));

      const assignment = await ports.repo.createAssignment({
        briefId,
        departmentId: config.id,
        agentId: lead?.agentId ?? null,
        agentSlug: config.leadAgentSlug,
        kind: 'lead_intake',
        status: parsed.accept ? 'done' : 'refused',
        input: prompt,
      });
      await ports.repo.updateAssignment(assignment.id, {
        output: outcome.output,
        runId: outcome.runId,
        refusalReason: parsed.accept ? null : parsed.reason,
        detail: { instructions: parsed.instructions },
        finishedAt: ports.now().toISOString(),
      });
      if (!parsed.accept) {
        await ports.repo.recordEvent({ briefId, kind: 'department.refused', departmentSlug: config.slug, agentSlug: config.leadAgentSlug, payload: { reason: parsed.reason } });
        return finish(`${config.name} returned the assignment: ${parsed.reason}`);
      }

      const shape = SHAPES[state.brief.weightClass];
      const chosen = (parsed.assignTo.length > 0 ? parsed.assignTo : bench.map((seat) => seat.agentSlug)).slice(0, shape.specialistsPerDepartment);
      for (const slug of chosen) {
        await ports.repo.createAssignment({
          briefId,
          departmentId: config.id,
          agentId: agentBySlug.get(slug)?.id ?? null,
          agentSlug: slug,
          kind: 'specialist_work',
          status: 'assigned',
          parentAssignmentId: assignment.id,
          input: parsed.instructions[slug] ?? `Work this brief within ${config.name}'s accountability: ${config.accountableFor}`,
        });
      }
      for (const request of authoringRequests(config, parsed.authorNeeded, config.leadAgentSlug)) {
        await ports.repo.createAssignment({
          briefId,
          departmentId: config.id,
          agentSlug: request.slug,
          kind: 'agent_authoring',
          status: 'assigned',
          parentAssignmentId: assignment.id,
          input: request.purpose,
        });
      }
      await ports.repo.recordEvent({ briefId, kind: 'department.accepted', departmentSlug: config.slug, agentSlug: config.leadAgentSlug, payload: { assigned: chosen, authorNeeded: parsed.authorNeeded } });
      return finish(`${config.name} accepted and assigned ${chosen.length} specialist(s)${parsed.authorNeeded.length > 0 ? `, and must author ${parsed.authorNeeded.length}` : ''}`);
    }

    // -- B-3 authoring ------------------------------------------------------
    case 'agent_authoring': {
      const config = configBySlug.get(action.departmentSlug);
      if (!config) return finish(`no config for ${action.departmentSlug}`);
      const pending = state.assignments.find(
        (row) => row.kind === 'agent_authoring' && row.agentSlug === action.capability && row.status !== 'done' && row.status !== 'failed',
      );
      const prompt = renderAuthoring(config, action.capability, context);
      const outcome = await run(action.authorSlug, prompt, pending?.id);
      if (!outcome.ok) return finish(`the executor refused: ${outcome.refusal ?? 'no reason given'}`);
      const parsed = parseAuthoring(outcome.output);
      if ('error' in parsed) {
        if (pending) await ports.repo.updateAssignment(pending.id, { status: 'failed', output: outcome.output, refusalReason: parsed.error });
        return finish(parsed.error);
      }
      const author = agentBySlug.get(action.authorSlug);
      if (!author) return finish(`no agent row for ${action.authorSlug}`);
      const created = await ports.authorAgent({
        slug: parsed.slug,
        name: parsed.name,
        description: parsed.description,
        systemPrompt: parsed.systemPrompt,
        authoredByAgentId: author.id,
        authoringPurpose: parsed.purpose,
        departmentId: config.id,
        seatPurpose: parsed.description || action.capability,
      });
      if (pending) {
        await ports.repo.updateAssignment(pending.id, {
          status: 'done', output: outcome.output, runId: outcome.runId,
          detail: { authoredSlug: created.slug, dataClass: created.dataClass }, finishedAt: ports.now().toISOString(),
        });
      }
      await ports.repo.recordEvent({
        briefId, kind: 'agent.authored', departmentSlug: config.slug, agentSlug: action.authorSlug,
        payload: { slug: created.slug, dataClass: created.dataClass },
      });
      return finish(`${action.authorSlug} authored ${created.slug} (${created.dataClass} lane) for ${config.name}`);
    }

    // -- specialist work ----------------------------------------------------
    case 'specialist_work': {
      const config = configBySlug.get(action.departmentSlug);
      if (!config) return finish(`no config for ${action.departmentSlug}`);
      const seat = config.seats.find((candidate) => candidate.agentSlug === action.agentSlug);
      if (!seat) return finish(`${action.agentSlug} has no seat in ${config.name}`);
      const existing = state.assignments.find(
        (row) => row.kind === 'specialist_work' && row.agentSlug === action.agentSlug && ['assigned', 'working', 'rework'].includes(row.status),
      );
      if (!existing) return finish(`no open assignment for ${action.agentSlug}`);

      const reworkNote = existing.status === 'rework'
        ? rowsOf(await ports.repo.listReviews(briefId))
            .filter((review) => review.subjectAssignmentId === existing.id)
            .flatMap((review) => review.findings.map((finding) => `[${finding.severity}] ${finding.claim} — ${finding.finding}${finding.suggestedFix ? ` (fix: ${finding.suggestedFix})` : ''}`))
            .join('\n')
        : null;

      const prompt = renderSpecialistWork(config, seat, context, existing.input, archivedSummaries(state.corpus), reworkNote);
      await ports.repo.updateAssignment(existing.id, { status: 'working', startedAt: ports.now().toISOString() });
      const outcome = await run(action.agentSlug, prompt, existing.id);
      if (!outcome.ok) {
        await ports.repo.updateAssignment(existing.id, { status: 'failed', refusalReason: outcome.refusal ?? 'the executor refused' });
        return finish(`the executor refused: ${outcome.refusal ?? 'no reason given'}`);
      }
      const parsed = parseSpecialistWork(outcome.output);

      // Retrieval the specialist asked for, run now and archived before use
      // (B-6). A blocked call (B-4) is an outcome, not a crash: it comes
      // back as a note the specialist sees on its next turn.
      const toolNotes: string[] = [];
      const toolRef: ToolRef = {
        agentSlug: action.agentSlug,
        briefId,
        assignmentId: existing.id,
        runId: outcome.runId ?? undefined,
        internalContext: seat.dataClass === 'internal' ? internalContextOf(state.corpus) : undefined,
      };
      for (const need of parsed.needs.slice(0, 3)) {
        let result: ToolOutcome;
        if (need.tool === 'web_search') result = await ports.tools.search(toolRef, need.query);
        else if (need.tool === 'web_fetch') result = await ports.tools.fetch(toolRef, need.query, need.why);
        else if (need.tool === 'public_data') result = await ports.tools.publicData(toolRef, need.query, need.why);
        else if (need.tool === 'execute') result = await ports.tools.execute(toolRef, { script: need.query, title: need.why });
        else continue;
        if (result.ok) {
          toolNotes.push(`${need.tool}: archived as ${String(result.data.corpusId)}`);
        } else {
          toolNotes.push(`${need.tool} refused (${result.code}): ${result.error}`);
          if (result.code === 'egress_blocked') {
            await ports.repo.recordEvent({
              briefId, kind: 'egress.blocked', agentSlug: action.agentSlug, departmentSlug: config.slug,
              payload: { tool: need.tool, note: result.error },
            });
          }
        }
      }

      await ports.repo.updateAssignment(existing.id, {
        status: 'peer_review',
        output: parsed.prose,
        runId: outcome.runId,
        detail: {
          produced: parsed.produced,
          restsOn: parsed.restsOn,
          uncertain: parsed.uncertain,
          didNotDo: parsed.didNotDo,
          toolNotes,
        },
        finishedAt: ports.now().toISOString(),
      });
      await ports.repo.recordEvent({
        briefId, kind: 'specialist.produced', departmentSlug: config.slug, agentSlug: action.agentSlug,
        payload: { produced: parsed.produced, tools: toolNotes.length },
      });
      return finish(`${action.agentSlug} produced: ${parsed.produced}${toolNotes.length > 0 ? ` (${toolNotes.length} tool call(s))` : ''}`);
    }

    // -- peer review --------------------------------------------------------
    case 'peer_review': {
      const config = configBySlug.get(action.departmentSlug);
      const subject = state.assignments.find((row) => row.id === action.subjectAssignmentId);
      const reviewer = agentBySlug.get(action.reviewerSlug);
      if (!config || !subject || !reviewer) return finish('the peer review has no subject or no reviewer');
      const prompt = renderPeerReview(config, action.reviewerSlug, subject.agentSlug, subject.output, context);
      const outcome = await run(action.reviewerSlug, prompt, subject.id);
      if (!outcome.ok) return finish(`the executor refused: ${outcome.refusal ?? 'no reason given'}`);
      const parsed = parseReview(outcome.output);
      await ports.repo.createReview({
        briefId,
        kind: 'peer',
        reviewerAgentId: reviewer.id,
        subjectAssignmentId: subject.id,
        subjectAgentId: subject.agentId,
        findings: parsed.findings,
        verdict: parsed.verdict,
        summary: parsed.summary,
        round: action.round,
        runId: outcome.runId,
      });
      const applied = applyPeerReview(
        { agentSlug: subject.agentSlug, status: subject.status, reworkCount: subject.reworkCount, round: action.round },
        parsed.verdict,
      );
      await ports.repo.updateAssignment(subject.id, { status: applied.next.status, round: applied.next.round });
      await ports.repo.recordEvent({
        briefId, kind: 'review.peer', departmentSlug: config.slug, agentSlug: action.reviewerSlug,
        payload: { subject: subject.agentSlug, verdict: parsed.verdict, findings: parsed.findings.length },
      });
      return finish(`${action.reviewerSlug} reviewed ${subject.agentSlug}: ${parsed.verdict} — ${applied.note}`);
    }

    // -- lead review --------------------------------------------------------
    case 'lead_review': {
      const config = configBySlug.get(action.departmentSlug);
      const subject = state.assignments.find((row) => row.id === action.subjectAssignmentId);
      const reviewer = agentBySlug.get(action.agentSlug);
      if (!config || !subject || !reviewer) return finish('the lead review has no subject or no reviewer');
      const peerFindings: ReviewFinding[] = rowsOf(await ports.repo.listReviews(briefId))
        .filter((review) => review.kind === 'peer' && review.subjectAssignmentId === subject.id)
        .flatMap((review) => review.findings);
      const prompt = renderLeadReview(config, context, subject.output, peerFindings);
      const outcome = await run(action.agentSlug, prompt, subject.id);
      if (!outcome.ok) return finish(`the executor refused: ${outcome.refusal ?? 'no reason given'}`);
      const parsed = parseReview(outcome.output);
      await ports.repo.createReview({
        briefId,
        kind: 'lead',
        reviewerAgentId: reviewer.id,
        subjectAssignmentId: subject.id,
        subjectAgentId: subject.agentId,
        findings: parsed.findings,
        verdict: parsed.verdict,
        summary: parsed.summary,
        round: subject.reworkCount + 1,
        runId: outcome.runId,
      });
      const applied = applyLeadReview(
        { agentSlug: subject.agentSlug, status: subject.status, reworkCount: subject.reworkCount, round: subject.round },
        parsed.verdict,
      );
      await ports.repo.updateAssignment(subject.id, { status: applied.next.status, reworkCount: applied.next.reworkCount });
      await ports.repo.recordEvent({
        briefId, kind: 'review.lead', departmentSlug: config.slug, agentSlug: action.agentSlug,
        payload: { subject: subject.agentSlug, verdict: parsed.verdict, escalated: applied.escalated },
      });
      return finish(`${action.agentSlug} reviewed ${subject.agentSlug}: ${parsed.verdict} — ${applied.note}`);
    }

    // -- submission ---------------------------------------------------------
    case 'lead_submit': {
      const config = configBySlug.get(action.departmentSlug);
      if (!config) return finish(`no config for ${action.departmentSlug}`);
      const accepted = state.assignments.filter((row) => row.kind === 'specialist_work' && row.status === 'accepted');
      const work = accepted.map((row) => `## ${row.agentSlug}\n${row.output}`).join('\n\n');
      const toName = action.toCommittee ? 'the Editorial Committee' : action.toDepartmentSlug ?? 'the next department';
      let prompt = renderSubmission(config, context, work, toName);
      let parsed = parseSubmission((await run(action.agentSlug, prompt)).output);
      let problems = checkSubmission({ produced: parsed.produced, restsOn: parsed.restsOn, uncertainties: parsed.uncertainties, exclusions: parsed.exclusions });
      if (problems.length > 0) {
        // One second attempt with the gaps named. A submission is a record;
        // an incomplete one is sent back once and then escalated, never
        // filled in by the institution on the lead's behalf.
        prompt = `${prompt}\n\nYOUR PREVIOUS ATTEMPT WAS INCOMPLETE:\n${problems.map((problem) => `  ${problem.field}: ${problem.message}`).join('\n')}`;
        parsed = parseSubmission((await run(action.agentSlug, prompt)).output);
        problems = checkSubmission({ produced: parsed.produced, restsOn: parsed.restsOn, uncertainties: parsed.uncertainties, exclusions: parsed.exclusions });
      }
      if (problems.length > 0) {
        const leadIntake = state.assignments.find((row) => row.kind === 'lead_intake' && row.departmentId === config.id);
        if (leadIntake) await ports.repo.updateAssignment(leadIntake.id, { status: 'escalated', refusalReason: problems.map((problem) => problem.message).join('; ') });
        return finish(`${config.name}'s submission is still not a record after two attempts: ${problems.map((problem) => problem.field).join(', ')}`);
      }
      const submission = await ports.repo.createSubmission({
        briefId,
        fromDepartmentId: config.id,
        toDepartmentId: action.toDepartmentSlug ? state.departmentIdBySlug.get(action.toDepartmentSlug) ?? null : null,
        toCommittee: action.toCommittee,
        produced: parsed.produced,
        restsOn: parsed.restsOn,
        uncertainties: parsed.uncertainties,
        exclusions: parsed.exclusions,
        accepted: true,
      });
      for (const row of accepted) {
        await ports.repo.updateAssignment(row.id, { status: 'submitted' });
      }
      await ports.repo.updateBrief(briefId, { currentDepartmentSlug: action.toDepartmentSlug });
      await ports.repo.recordEvent({
        briefId, kind: 'department.submitted', departmentSlug: config.slug, agentSlug: action.agentSlug,
        payload: { to: action.toCommittee ? 'committee' : action.toDepartmentSlug, submissionId: submission.id, restsOn: parsed.restsOn.length },
      });
      return finish(`${config.name} submitted to ${toName}`);
    }

    // -- 1-D committee ------------------------------------------------------
    case 'committee_review': {
      const committee = agentBySlug.get(action.agentSlug);
      if (!committee) return finish('the committee has no agent row yet; the director seeds its prompt');
      const submissions = rowsOf(await ports.repo.listSubmissions(briefId));
      const reviews = rowsOf(await ports.repo.listReviews(briefId));
      const slugById = new Map(state.configs.map((config) => [config.id, config.name]));
      const submissionText = submissions.map((submission) =>
        `## ${slugById.get(submission.fromDepartmentId) ?? submission.fromDepartmentId}\nPRODUCED: ${submission.produced}\nRESTS ON: ${submission.restsOn.join(', ') || '(nothing named)'}\nUNCERTAIN: ${submission.uncertainties}\nDID NOT DO: ${submission.exclusions}`,
      ).join('\n\n');
      const historyText = reviews.map((review) =>
        `${review.kind} review by ${state.agents.find((agent) => agent.id === review.reviewerAgentId)?.slug ?? 'unknown'}: ${review.verdict} — ${review.summary}`,
      ).join('\n');
      const prompt = renderCommitteeReview(context, submissionText, historyText);
      const outcome = await run(action.agentSlug, prompt);
      if (!outcome.ok) return finish(`the executor refused: ${outcome.refusal ?? 'no reason given'}`);
      const parsed = parseReview(outcome.output);
      const review = await ports.repo.createReview({
        briefId,
        kind: 'committee',
        reviewerAgentId: committee.id,
        findings: parsed.findings,
        verdict: parsed.verdict,
        summary: parsed.summary,
        round: 1,
        runId: outcome.runId,
      });
      const proposed = await recordProposals(ports, state.agents, parsed.proposals, committee.slug, review.id);
      await ports.repo.updateBrief(briefId, { status: 'committee' });
      await ports.repo.recordEvent({
        briefId, kind: 'review.committee', agentSlug: action.agentSlug,
        payload: { verdict: parsed.verdict, findings: parsed.findings.length, proposals: proposed.length },
      });

      // 1-D: the reviewed parties may contest, at full class.
      if (SHAPES[state.brief.weightClass].debate && parsed.findings.length > 0) {
        const contested = new Set(
          state.assignments
            .filter((row) => row.kind === 'specialist_work' && row.status === 'submitted')
            .map((row) => row.agentSlug),
        );
        for (const slug of [...contested].slice(0, 2)) {
          const party = agentBySlug.get(slug);
          const work = state.assignments.find((row) => row.agentSlug === slug)?.output ?? '';
          if (!party) continue;
          const rebuttalOutcome = await run(slug, renderRebuttal(slug, parsed.findings, work));
          if (!rebuttalOutcome.ok) continue;
          const rebuttal = parseRebuttal(rebuttalOutcome.output);
          if (!rebuttal.contest) continue;
          await ports.repo.createDebate({ briefId, reviewId: review.id, rebuttingAgentId: party.id, rebuttal: rebuttal.rebuttal, round: 1 });
          await ports.repo.updateBrief(briefId, { status: 'debate' });
          await ports.repo.recordEvent({ briefId, kind: 'debate.filed', agentSlug: slug, payload: { reviewId: review.id } });
        }
      }
      return finish(`the committee returned ${parsed.verdict} with ${parsed.findings.length} finding(s) and ${proposed.length} proposal(s)`);
    }

    case 'committee_reweigh': {
      const committee = agentBySlug.get(action.agentSlug);
      if (!committee) return finish('the committee has no agent row');
      const open = rowsOf(await ports.repo.listDebates(briefId)).filter((debate) => debate.outcome === null);
      const prompt = renderWeighing(open.map((debate) => ({
        id: debate.id,
        agentSlug: state.agents.find((agent) => agent.id === debate.rebuttingAgentId)?.slug ?? 'unknown',
        rebuttal: debate.rebuttal,
      })));
      const outcome = await run(action.agentSlug, prompt);
      if (!outcome.ok) return finish(`the executor refused: ${outcome.refusal ?? 'no reason given'}`);
      const parsed = parseWeighing(outcome.output, open.map((debate) => debate.id));
      for (const weighing of parsed.weighings) {
        await ports.repo.weighDebate(weighing.id, weighing.weighing, weighing.outcome);
      }
      const proposed = await recordProposals(ports, state.agents, parsed.proposals, committee.slug, null);
      await ports.repo.recordEvent({
        briefId, kind: 'debate.weighed', agentSlug: action.agentSlug,
        payload: { weighed: parsed.weighings.length, accepted: parsed.weighings.filter((entry) => entry.outcome !== 'rejected').length, proposals: proposed.length },
      });
      return finish(`the committee weighed ${parsed.weighings.length} rebuttal(s); ${proposed.length} proposal(s) followed`);
    }

    // -- arbitration --------------------------------------------------------
    case 'arbitration': {
      const stuck = state.assignments.find((row) => row.id === action.about);
      const history = rowsOf(await ports.repo.listReviews(briefId))
        .filter((review) => review.subjectAssignmentId === action.about)
        .map((review) => `${review.kind}: ${review.verdict} — ${review.summary}`)
        .join('\n');
      const prompt = renderArbitration(
        `${stuck?.agentSlug ?? action.about}'s work in ${stuck?.departmentId ?? 'a department'}: ${action.why}`,
        history || '(no reviews recorded)',
      );
      const outcome = await run(action.agentSlug, prompt, action.about);
      if (!outcome.ok) return finish(`the executor refused: ${outcome.refusal ?? 'no reason given'}`);
      const parsed = parseArbitration(outcome.output);
      const arbitration = await ports.repo.createAssignment({
        briefId,
        agentSlug: action.agentSlug,
        kind: 'arbitration',
        status: 'done',
        parentAssignmentId: action.about,
        input: prompt,
      });
      await ports.repo.updateAssignment(arbitration.id, { output: outcome.output, runId: outcome.runId, detail: { decision: parsed.decision, reason: parsed.reason } });
      if (stuck) {
        if (parsed.decision === 'continue') await ports.repo.updateAssignment(stuck.id, { status: 'accepted' });
        else if (parsed.decision === 'drop') await ports.repo.updateAssignment(stuck.id, { status: 'failed', refusalReason: parsed.reason });
        else await ports.repo.updateBrief(briefId, { status: 'director' });
      }
      await ports.repo.recordEvent({ briefId, kind: 'arbitration', agentSlug: action.agentSlug, payload: { decision: parsed.decision, reason: parsed.reason } });
      return finish(`the program office arbitrated: ${parsed.decision} — ${parsed.reason}`);
    }

    default:
      return finish('nothing to do');
  }
}

/** Upgrade proposals (B-1): rows, never writes to a live prompt. */
async function recordProposals(
  ports: RunnerPorts,
  agents: readonly RunnerAgent[],
  proposals: ReadonlyArray<{ agentSlug: string; rationale: string; change: string }>,
  proposedBySlug: string,
  reviewId: string | null,
): Promise<string[]> {
  const proposer = agents.find((agent) => agent.slug === proposedBySlug);
  const recorded: string[] = [];
  for (const proposal of proposals.slice(0, 4)) {
    const target = agents.find((agent) => agent.slug === proposal.agentSlug);
    if (!target) continue;
    const next = `${target.systemPrompt.trim()}\n\n${proposal.change.trim()}`;
    const version = await ports.repo.proposeVersion({
      agentId: target.id,
      systemPrompt: next,
      proposedBy: proposedBySlug,
      proposedByAgentId: proposer?.id ?? null,
      rationale: proposal.rationale,
      diff: `+ ${proposal.change.trim().split('\n').join('\n+ ')}`,
      triggeredByReviewId: reviewId,
    });
    recorded.push(version.id);
  }
  return recorded;
}

// ---------------------------------------------------------------------------
// driving a whole brief
// ---------------------------------------------------------------------------

export interface RunOptions {
  maxSteps?: number;
  onStep?: (report: StepReport) => void;
  /** Checked between steps so the director can stop a run mid-flight. */
  shouldStop?: () => boolean;
}

export async function runBrief(ports: RunnerPorts, briefId: string, options: RunOptions = {}): Promise<StepReport[]> {
  const reports: StepReport[] = [];
  const limit = options.maxSteps ?? MAX_STEPS;
  for (let i = 0; i < limit; i += 1) {
    if (options.shouldStop?.()) break;
    const report = await stepBrief(ports, briefId);
    reports.push(report);
    options.onStep?.(report);
    if (report.finished || report.blocked || report.action === 'to_director') break;
  }
  return reports;
}

// ---------------------------------------------------------------------------
// evaluations (B-9)
// ---------------------------------------------------------------------------

export interface EvaluationOutcome {
  evaluationSlug: string;
  runId: string;
  answered: boolean;
}

/**
 * Run the held-fixed set against one agent and record the answers. The score
 * is NOT written here: os_inst_eval_score() writes it, from a rubric no
 * agent and no client ever sees.
 */
export async function runEvaluations(
  ports: RunnerPorts,
  agent: RunnerAgent,
  phase: 'before' | 'after' | 'baseline',
  agentVersionId: string | null,
  departmentSlug?: string,
): Promise<EvaluationOutcome[]> {
  const evaluations = rowsOf(await ports.repo.listEvaluations())
    .filter((evaluation) => evaluation.isActive)
    .filter((evaluation) => !departmentSlug || evaluation.departmentSlug === departmentSlug || evaluation.departmentSlug === null);
  const outcomes: EvaluationOutcome[] = [];
  for (const evaluation of evaluations) {
    const outcome = await ports.runAgent({ agentSlug: agent.slug, input: renderEvaluation(evaluation.task), briefId: '' });
    const run = await ports.repo.recordEvaluationRun({
      evaluationId: evaluation.id,
      agentId: agent.id,
      agentVersionId,
      phase,
      answer: outcome.ok ? outcome.output : '',
      runId: outcome.runId,
    });
    outcomes.push({ evaluationSlug: evaluation.slug, runId: run.id, answered: outcome.ok });
  }
  return outcomes;
}

export { briefBlock };
