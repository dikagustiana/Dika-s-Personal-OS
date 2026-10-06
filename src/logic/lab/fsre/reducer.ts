/**
 * FSRE BUILDING — THE REDUCER. THE BUILDING IS A PURE FUNCTION OF EVENTS.
 *
 * createInitialState gives the empty building; reduceEvent folds one event
 * in and returns a new state; nothing is mutated and nothing moves unless an
 * event says so. Everything the screen shows is this state or a selector
 * over it — there is no other input (rule 1).
 *
 * WHY THE SHAPE CHANGED FROM THE SOURCE (mount report §1.5, §3.2). The
 * source held ONE folder whose ticker came from the replay file, one
 * `currentStageId` per agent and one value per metric, each overwritten by
 * the latest event. With ten companies that showed SYN03's gate failure as
 * nothing, 10.000 facts instead of 55.000, an escalation titled with another
 * company's issue, and one `approved` clearing every company. So:
 *
 *   - State is PER TICKER (`companies`). Run totals are never stored: they
 *     are summed from the companies by `runTotals`, so they cannot drift.
 *   - Gate results are a HISTORY. A later result for the same company and
 *     gate is appended, never written over, so a failure stays on record.
 *   - Agents hold the SET of tickers in their hands; their status is
 *     derived (`agentStatus`). A gate passed with escalation leaves the
 *     reviewer escalated — the escalation it raised is open — never done.
 *   - Partner-room items come only from event payloads and are keyed by
 *     ticker + event id. An escalation always makes one.
 *   - `approved` acts on its ticker only. Without a `ref` it approves the
 *     company for publication and is REFUSED — the state is returned
 *     unchanged — while that ticker (or the run) has an open escalation.
 *     With a `ref` it decides the escalation or proposal it names.
 *
 * INCREMENTAL. One event copies only what it touches: the company record,
 * the agents it moves, the companies map's top level. Agent histories are
 * not stored at all (the source copied every agent's event array on every
 * event); `agentEventIndexes` derives them by scanning when a panel asks.
 * `createStateCache` keeps checkpoints so a live run thousands of events
 * long steps back without replaying from the start.
 */
import type { FsreRun } from './data';
import { figureOf, figureValue, isGateEvent, type FsreEvent, type FsreFigure } from './events';
import { CHECKPOINT_EVERY } from './geometry';
import {
  deskKeyForStage,
  partnerDeskKey,
  planFloors,
  runnerOf,
  stagesRunBy,
  type DeskKey,
  type FloorPlan,
} from './layout';
import {
  GATE_RESULTS,
  GATE_SEVERITY,
  STAGE_SEVERITY,
  type AgentStatus,
  type FolderStatus,
  type GateResult,
  type IssueState,
  type ItemState,
  type PartnerItemKind,
  type StageStatus,
} from './statuses';

/* ---------- state ---------- */

/** A stage status as recorded; `escalated` is only ever derived. */
export type RecordedStageStatus = Exclude<StageStatus, 'escalated'>;

export interface GateRecord {
  eventId: string;
  stageId: string | null;
  result: Exclude<GateResult, 'pending'>;
  skill: string | null;
  figures: Record<string, FsreFigure>;
}

export interface IssueRecord {
  eventId: string;
  ticker: string | null;
  stageId: string | null;
  raisedBy: string | null;
  title: string;
  detail: string | null;
  state: IssueState;
}

export interface EscalationRecord {
  eventId: string;
  ticker: string | null;
  stageId: string | null;
  raisedBy: string | null;
  title: string;
  /** Why approval is locked, in the export's own words when it gave any. */
  reason: string;
  detail: string | null;
  state: ItemState;
  decidedBy: string | null;
}

export interface ProposalRecord {
  eventId: string;
  ticker: string | null;
  stageId: string | null;
  raisedBy: string | null;
  title: string;
  detail: string | null;
  mode: string | null;
  ref: string | null;
  state: ItemState;
  decidedBy: string | null;
}

export interface CompanyState {
  ticker: string;
  name: string | null;
  /** The stage the company is at (last started, returned to, blocked at or gated). */
  stageId: string | null;
  stageStatuses: Record<string, RecordedStageStatus>;
  /** Where its folder rests. */
  deskKey: DeskKey | null;
  /** The skill holding it right now, if any. */
  activeSkill: string | null;
  gates: GateRecord[];
  issues: IssueRecord[];
  escalations: EscalationRecord[];
  proposals: ProposalRecord[];
  /** Latest value per figure key, from payloads. */
  figures: Record<string, FsreFigure>;
  approved: boolean;
  published: boolean;
}

export interface AgentState {
  skill: string;
  /** Tickers in this agent's hands, in arrival order. */
  activeTickers: string[];
  /** Units of work it finished: stages completed, gates reported, proposals logged. */
  completed: number;
}

/** Items raised with `ticker: null`: they belong to the run, not to a company. */
export interface RunLevelState {
  issues: IssueRecord[];
  escalations: EscalationRecord[];
  proposals: ProposalRecord[];
}

export interface PartnerRef {
  kind: PartnerItemKind;
  ticker: string | null;
  eventId: string;
}

export interface FsreState {
  companies: Record<string, CompanyState>;
  /** Tickers in the order an event first named them. */
  companyOrder: string[];
  agents: Record<string, AgentState>;
  runLevel: RunLevelState;
  /** Partner-room items in arrival order. */
  partnerOrder: PartnerRef[];
}

/** What the reducer needs from the data besides the events: the stage-derived floor plan. */
export interface FsreContext {
  run: FsreRun;
  plan: FloorPlan;
}

export function buildContext(run: FsreRun): FsreContext {
  return { run, plan: planFloors(run.stages, run.skills) };
}

export function createInitialState(ctx: FsreContext): FsreState {
  return {
    companies: {},
    companyOrder: [],
    agents: Object.fromEntries(ctx.plan.agentSkills.map((skill) => [skill, { skill, activeTickers: [], completed: 0 }])),
    runLevel: { issues: [], escalations: [], proposals: [] },
    partnerOrder: [],
  };
}

/* ---------- small immutable helpers ---------- */

function stageName(ctx: FsreContext, stageId: string | null | undefined): string | null {
  if (!stageId) return null;
  return ctx.plan.stagesById[stageId]?.name ?? stageId;
}

function newCompany(ctx: FsreContext, ticker: string): CompanyState {
  return {
    ticker,
    name: ctx.run.companyNames[ticker] ?? null,
    stageId: null,
    stageStatuses: {},
    deskKey: null,
    activeSkill: null,
    gates: [],
    issues: [],
    escalations: [],
    proposals: [],
    figures: {},
    approved: false,
    published: false,
  };
}

/** The company record, creating it (and its place in the order) the first time a ticker is named. */
function companyFor(ctx: FsreContext, state: FsreState, ticker: string): { state: FsreState; company: CompanyState } {
  const existing = state.companies[ticker];
  if (existing) return { state, company: existing };
  const company = newCompany(ctx, ticker);
  return {
    state: { ...state, companies: { ...state.companies, [ticker]: company }, companyOrder: [...state.companyOrder, ticker] },
    company,
  };
}

function putCompany(state: FsreState, company: CompanyState): FsreState {
  return { ...state, companies: { ...state.companies, [company.ticker]: company } };
}

function updateAgent(state: FsreState, skill: string | null, update: (agent: AgentState) => AgentState): FsreState {
  if (!skill) return state;
  const agent = state.agents[skill];
  if (!agent) return state;
  const next = update(agent);
  return next === agent ? state : { ...state, agents: { ...state.agents, [skill]: next } };
}

const addTicker = (ticker: string) => (agent: AgentState): AgentState =>
  agent.activeTickers.includes(ticker) ? agent : { ...agent, activeTickers: [...agent.activeTickers, ticker] };

const dropTicker = (ticker: string) => (agent: AgentState): AgentState =>
  agent.activeTickers.includes(ticker) ? { ...agent, activeTickers: agent.activeTickers.filter((t) => t !== ticker) } : agent;

const countWork = (agent: AgentState): AgentState => ({ ...agent, completed: agent.completed + 1 });

/**
 * Move a company's folder to a desk and hand it to `worker` (or to nobody).
 * The skill that held it lets go — a folder is in one pair of hands at a time.
 */
function relocate(state: FsreState, company: CompanyState, deskKey: DeskKey, worker: string | null): { state: FsreState; company: CompanyState } {
  let next = state;
  if (company.activeSkill && company.activeSkill !== worker) next = updateAgent(next, company.activeSkill, dropTicker(company.ticker));
  if (worker) next = updateAgent(next, worker, addTicker(company.ticker));
  return { state: next, company: { ...company, deskKey, activeSkill: worker } };
}

/** Let go of a company without moving its folder: the stage is finished, the folder waits. */
function release(state: FsreState, company: CompanyState, skill: string | null): { state: FsreState; company: CompanyState } {
  let next = state;
  if (company.activeSkill) next = updateAgent(next, company.activeSkill, dropTicker(company.ticker));
  if (skill && skill !== company.activeSkill) next = updateAgent(next, skill, dropTicker(company.ticker));
  return { state: next, company: { ...company, activeSkill: null } };
}

function mergeFigures(company: CompanyState, event: FsreEvent): CompanyState {
  const figures = event.payload?.figures;
  if (!figures || Object.keys(figures).length === 0) return company;
  return { ...company, figures: { ...company.figures, ...figures } };
}

function withStage(company: CompanyState, stageId: string | undefined, status: RecordedStageStatus, moveTo: boolean): CompanyState {
  if (!stageId) return company;
  return {
    ...company,
    stageId: moveTo || company.stageId === null ? stageId : company.stageId,
    stageStatuses: { ...company.stageStatuses, [stageId]: status },
  };
}

/** Issues at a stage close when the stage completes or its gate reports. */
function closeIssuesAt(company: CompanyState, stageId: string | undefined): CompanyState {
  if (!stageId || !company.issues.some((issue) => issue.state === 'open' && issue.stageId === stageId)) return company;
  return {
    ...company,
    issues: company.issues.map((issue) => (issue.state === 'open' && issue.stageId === stageId ? { ...issue, state: 'closed' } : issue)),
  };
}

/* ---------- escalations and proposals ---------- */

function openEscalation(ctx: FsreContext, state: FsreState, event: FsreEvent, raisedBy: string | null, fallbackReason: string): FsreState {
  const ticker = event.ticker;
  const stageId = event.stageId ?? null;
  const name = stageName(ctx, stageId);
  const company = ticker ? state.companies[ticker] : undefined;
  // The suffix is THIS company's first open issue at this stage (the one that
  // started the trouble) — the source looked up any company's issue and
  // titled SYN09's escalation with SYN07's words.
  const issue = company?.issues.find((i) => i.state === 'open' && i.stageId === stageId);
  const subject = ticker ?? 'Run';
  const title = event.payload?.title ?? (name ? `${subject}, ${name}${issue ? `: ${issue.title}` : ''}` : `Escalation for ${subject}`);
  const record: EscalationRecord = {
    eventId: event.id,
    ticker,
    stageId,
    raisedBy,
    title,
    reason: event.payload?.reason ?? event.payload?.detail ?? fallbackReason,
    detail: event.payload?.detail ?? null,
    state: 'open',
    decidedBy: null,
  };
  const ref: PartnerRef = { kind: 'escalation', ticker, eventId: event.id };
  if (company) {
    return { ...putCompany(state, { ...company, escalations: [...company.escalations, record] }), partnerOrder: [...state.partnerOrder, ref] };
  }
  return {
    ...state,
    runLevel: { ...state.runLevel, escalations: [...state.runLevel.escalations, record] },
    partnerOrder: [...state.partnerOrder, ref],
  };
}

function decideRecords<T extends { eventId: string; state: ItemState; decidedBy: string | null }>(
  records: T[],
  matches: (record: T) => boolean,
  decidedBy: string,
): T[] | null {
  const index = records.findIndex((record) => record.state === 'open' && matches(record));
  if (index < 0) return null;
  return records.map((record, i) => (i === index ? { ...record, state: 'decided' as const, decidedBy } : record));
}

/**
 * `approved` with a `ref`: decide the open escalation or proposal it names
 * (by event id, or by the proposal's own ref) — on its ticker first, then
 * at run level. A ref that names nothing open changes nothing.
 */
function decideByRef(state: FsreState, event: FsreEvent, ref: string): FsreState {
  const ticker = event.ticker;
  const company = ticker ? state.companies[ticker] : undefined;
  if (company) {
    const escalations = decideRecords(company.escalations, (r) => r.eventId === ref, event.id);
    if (escalations) return putCompany(state, { ...company, escalations });
    const proposals = decideRecords(company.proposals, (r) => r.eventId === ref || r.ref === ref, event.id);
    if (proposals) return putCompany(state, { ...company, proposals });
  }
  const runEscalations = decideRecords(state.runLevel.escalations, (r) => r.eventId === ref, event.id);
  if (runEscalations) return { ...state, runLevel: { ...state.runLevel, escalations: runEscalations } };
  const runProposals = decideRecords(state.runLevel.proposals, (r) => r.eventId === ref || r.ref === ref, event.id);
  if (runProposals) return { ...state, runLevel: { ...state.runLevel, proposals: runProposals } };
  return state;
}

/* ---------- the reducer ---------- */

/** Fold one event into the state. Pure: same state + same event → equal result. */
export function reduceEvent(ctx: FsreContext, state: FsreState, event: FsreEvent): FsreState {
  const { plan } = ctx;
  const stageId = event.stageId;

  // Run-level events (ticker null) carry no folder: only items and agents move.
  if (event.ticker === null) {
    switch (event.kind) {
      case 'issue_raised':
        return { ...state, runLevel: { ...state.runLevel, issues: [...state.runLevel.issues, issueRecord(ctx, event)] } };
      case 'escalated':
        return openEscalation(ctx, state, event, event.skill ?? runnerOf(plan, stageId), defaultReason(ctx, stageId));
      case 'proposal_logged': {
        const record = proposalRecord(event);
        const next: FsreState = {
          ...state,
          runLevel: { ...state.runLevel, proposals: [...state.runLevel.proposals, record] },
          partnerOrder: [...state.partnerOrder, { kind: 'proposal', ticker: null, eventId: event.id }],
        };
        return updateAgent(next, record.raisedBy, countWork);
      }
      case 'approved':
        return event.payload?.ref ? decideByRef(state, event, event.payload.ref) : state;
      default:
        // A stage, gate or publication with no company has nothing to move.
        return state;
    }
  }

  if (event.kind === 'approved') {
    if (event.payload?.ref) return decideByRef(state, event, event.payload.ref);
    // Refused while an escalation is open: returned unchanged, not partly applied.
    if (approvalLock(state, event.ticker).locked) return state;
  }

  const seen = companyFor(ctx, state, event.ticker);
  let next = seen.state;
  let company = seen.company;

  switch (event.kind) {
    case 'stage_started': {
      const worker = event.skill ?? runnerOf(plan, stageId);
      company = withStage(company, stageId, 'current', true);
      ({ state: next, company } = relocate(next, company, deskKeyForStage(plan, stageId, worker), worker));
      break;
    }

    case 'stage_completed': {
      const worker = event.skill ?? runnerOf(plan, stageId);
      company = closeIssuesAt(mergeFigures(withStage(company, stageId, 'done', false), event), stageId);
      ({ state: next, company } = release(next, company, worker));
      next = updateAgent(next, worker, countWork);
      break;
    }

    case 'stage_returned': {
      // Work goes back to the stage's own runner; the skill that sent it back
      // (event.skill) is only the actor.
      const worker = runnerOf(plan, stageId) ?? event.skill ?? null;
      company = mergeFigures(withStage(company, stageId, 'returned', true), event);
      ({ state: next, company } = relocate(next, company, deskKeyForStage(plan, stageId, worker), worker));
      break;
    }

    case 'stage_blocked': {
      const worker = event.skill ?? runnerOf(plan, stageId);
      company = mergeFigures(withStage(company, stageId, 'blocked', true), event);
      ({ state: next, company } = relocate(next, company, deskKeyForStage(plan, stageId, worker), worker));
      break;
    }

    case 'gate_passed':
    case 'gate_failed':
    case 'gate_passed_with_escalation': {
      const keeper = event.skill ?? runnerOf(plan, stageId);
      const result: GateRecord['result'] =
        event.kind === 'gate_passed' ? 'passed' : event.kind === 'gate_failed' ? 'failed' : 'escalated';
      const record: GateRecord = { eventId: event.id, stageId: stageId ?? null, result, skill: keeper, figures: { ...(event.payload?.figures ?? {}) } };
      company = { ...company, gates: [...company.gates, record] };
      company = closeIssuesAt(mergeFigures(withStage(company, stageId, result === 'failed' ? 'failed' : 'done', true), event), stageId);
      // The folder waits in the gate room; nobody holds it until the next stage starts.
      ({ state: next, company } = relocate(next, company, deskKeyForStage(plan, stageId, keeper), null));
      next = updateAgent(updateAgent(next, keeper, dropTicker(company.ticker)), keeper, countWork);
      next = putCompany(next, company);
      if (event.kind === 'gate_passed_with_escalation') {
        // The export (and the live feed) raise each escalated note as its own
        // `escalated` event before the gate reports, and the gate's "with
        // escalation" IS those notes. It opens an item of its own only when
        // nothing is open at that stage yet: a lone gate result still reaches
        // the partner room and locks approval, and the notes are not counted
        // twice.
        if (company.escalations.some((e) => e.state === 'open' && e.stageId === (stageId ?? null))) return next;
        const name = stageName(ctx, stageId) ?? 'The gate';
        return openEscalation(ctx, next, event, keeper, `${name} passed with an escalation that needs the owner's decision.`);
      }
      return next;
    }

    case 'escalated': {
      company = mergeFigures(company, event);
      next = putCompany(next, company);
      return openEscalation(ctx, next, event, event.skill ?? runnerOf(plan, stageId), defaultReason(ctx, stageId));
    }

    case 'issue_raised':
      company = { ...company, issues: [...company.issues, issueRecord(ctx, event)] };
      break;

    case 'proposal_logged': {
      const record = proposalRecord(event);
      company = { ...company, proposals: [...company.proposals, record] };
      next = updateAgent(
        { ...next, partnerOrder: [...next.partnerOrder, { kind: 'proposal', ticker: company.ticker, eventId: event.id }] },
        record.raisedBy,
        countWork,
      );
      break;
    }

    case 'approved':
      company = { ...company, approved: true };
      break;

    case 'published':
      company = { ...company, published: true };
      ({ state: next, company } = relocate(next, company, partnerDeskKey(plan), null));
      break;
  }

  return putCompany(next, company);
}

function defaultReason(ctx: FsreContext, stageId: string | undefined): string {
  const name = stageName(ctx, stageId);
  return name ? `The work at ${name} needs the owner's decision.` : "The work needs the owner's decision.";
}

function issueRecord(ctx: FsreContext, event: FsreEvent): IssueRecord {
  const name = stageName(ctx, event.stageId);
  return {
    eventId: event.id,
    ticker: event.ticker,
    stageId: event.stageId ?? null,
    raisedBy: event.skill ?? null,
    title: event.payload?.title ?? `Review issue at ${name ?? 'the run'}`,
    detail: event.payload?.detail ?? null,
    state: 'open',
  };
}

function proposalRecord(event: FsreEvent): ProposalRecord {
  const raisedBy = event.skill ?? null;
  const mode = event.payload?.mode ?? null;
  return {
    eventId: event.id,
    ticker: event.ticker,
    stageId: event.stageId ?? null,
    raisedBy,
    title: event.payload?.title ?? `Proposal from ${raisedBy ?? 'an unnamed skill'}`,
    // The mode is its own field; the panel shows it once, beside who raised it.
    detail: event.payload?.detail ?? null,
    mode,
    ref: event.payload?.ref ?? null,
    state: 'open',
    decidedBy: null,
  };
}

export function reduceEvents(ctx: FsreContext, events: readonly FsreEvent[], from: FsreState = createInitialState(ctx)): FsreState {
  let state = from;
  for (const event of events) state = reduceEvent(ctx, state, event);
  return state;
}

/* ---------- the cache: incremental stepping ---------- */

export interface StateCache {
  /** The state after the first `cursor` events. */
  stateAt(events: readonly FsreEvent[], cursor: number): FsreState;
}

function commonPrefix(a: readonly FsreEvent[], b: readonly FsreEvent[]): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

/**
 * Forward steps reduce from the last state; a step back starts from the
 * nearest checkpoint at or before the target. When the event list is
 * replaced (a live append), everything up to the shared prefix is kept.
 */
export function createStateCache(ctx: FsreContext): StateCache {
  const initial = createInitialState(ctx);
  let source: readonly FsreEvent[] | null = null;
  let checkpoints = new Map<number, FsreState>([[0, initial]]);
  let last = { cursor: 0, state: initial };

  const nearestCheckpoint = (cursor: number) => {
    let best = 0;
    for (const key of checkpoints.keys()) if (key <= cursor && key > best) best = key;
    return { cursor: best, state: checkpoints.get(best) ?? initial };
  };

  return {
    stateAt(events, cursor) {
      const target = Math.max(0, Math.min(Math.trunc(cursor), events.length));
      if (events !== source) {
        const kept = source ? commonPrefix(source, events) : 0;
        checkpoints = new Map([...checkpoints].filter(([key]) => key <= kept));
        if (last.cursor > kept) last = nearestCheckpoint(kept);
        source = events;
      }
      let from = last.cursor <= target ? last : nearestCheckpoint(target);
      let state = from.state;
      for (let i = from.cursor; i < target; i += 1) {
        state = reduceEvent(ctx, state, events[i]);
        if ((i + 1) % CHECKPOINT_EVERY === 0) checkpoints.set(i + 1, state);
      }
      from = { cursor: target, state };
      last = from;
      return state;
    },
  };
}

/* ---------- selectors ---------- */

export function companyList(state: FsreState): CompanyState[] {
  return state.companyOrder.map((ticker) => state.companies[ticker]);
}

/**
 * A company's status at a stage, as the stage screen and the timeline show
 * it. An open escalation there outranks whatever was recorded; and a gate
 * failure ON RECORD stays visible after a later pass, exactly as the gate
 * room shows it — a later result never erases an earlier failure.
 */
export function effectiveStageStatus(company: CompanyState, stageId: string): StageStatus {
  if (company.escalations.some((e) => e.state === 'open' && e.stageId === stageId)) return 'escalated';
  const recorded: StageStatus = company.stageStatuses[stageId] ?? 'pending';
  const failedOnRecord = company.gates.some((gate) => gate.stageId === stageId && gate.result === 'failed');
  return failedOnRecord && STAGE_SEVERITY.failed > STAGE_SEVERITY[recorded] ? 'failed' : recorded;
}

/**
 * Where the company stands NOW at its current stage: the recorded status,
 * under any open escalation there. Unlike effectiveStageStatus it does not
 * carry history — a company that failed a gate and then passed it is in
 * progress, and its folder says so (the gate's record says the rest).
 */
export function currentStageStatus(company: CompanyState): StageStatus {
  const at = company.stageId;
  if (!at) return 'pending';
  if (company.escalations.some((e) => e.state === 'open' && e.stageId === at)) return 'escalated';
  return company.stageStatuses[at] ?? 'pending';
}

/** Open escalations that bear on a ticker: its own, and any raised for the whole run. */
export function openEscalationsFor(state: FsreState, ticker: string): EscalationRecord[] {
  const own = state.companies[ticker]?.escalations ?? [];
  return [...own, ...state.runLevel.escalations].filter((e) => e.state === 'open');
}

export interface ApprovalLock {
  locked: boolean;
  /** Every open escalation's reason, written out — never only the latest. */
  reasons: EscalationRecord[];
}

export function approvalLock(state: FsreState, ticker: string): ApprovalLock {
  const reasons = openEscalationsFor(state, ticker);
  return { locked: reasons.length > 0, reasons };
}

export function folderStatus(state: FsreState, company: CompanyState): FolderStatus {
  if (openEscalationsFor(state, company.ticker).length > 0) return 'escalated';
  if (company.published) return 'published';
  if (company.approved) return 'approved';
  const status = currentStageStatus(company);
  if (status === 'failed' || status === 'blocked' || status === 'returned') return status;
  return 'in-progress';
}

/** Escalated > stalled > working > done > idle, from the companies and items — never stored. */
export function agentStatus(ctx: FsreContext, state: FsreState, skill: string): AgentStatus {
  const raised = (e: EscalationRecord) => e.state === 'open' && e.raisedBy === skill;
  if (state.runLevel.escalations.some(raised)) return 'escalated';
  const runs = new Set(stagesRunBy(ctx.plan, skill));
  let stalled = false;
  for (const ticker of state.companyOrder) {
    const company = state.companies[ticker];
    if (company.escalations.some(raised)) return 'escalated';
    const at = company.stageId;
    if (at && runs.has(at)) {
      if (company.stageStatuses[at] === 'blocked' || company.issues.some((i) => i.state === 'open' && i.stageId === at)) stalled = true;
    }
  }
  if (stalled) return 'stalled';
  const agent = state.agents[skill];
  if (agent && agent.activeTickers.length > 0) return 'working';
  if (agent && agent.completed > 0) return 'done';
  return 'idle';
}

export interface PartnerItem {
  /** `${ticker ?? 'run'}:${eventId}` — unique across companies. */
  key: string;
  kind: PartnerItemKind;
  ticker: string | null;
  eventId: string;
  stageId: string | null;
  raisedBy: string | null;
  title: string;
  detail: string | null;
  /** Escalations only. */
  reason: string | null;
  /** Proposals only. */
  mode: string | null;
  state: ItemState;
}

export function partnerKey(ticker: string | null, eventId: string): string {
  return `${ticker ?? 'run'}:${eventId}`;
}

/** Every partner-room item in arrival order, open and decided. */
export function partnerItems(state: FsreState): PartnerItem[] {
  const items: PartnerItem[] = [];
  for (const ref of state.partnerOrder) {
    const owner = ref.ticker ? state.companies[ref.ticker] : null;
    if (ref.kind === 'escalation') {
      const record = (owner ? owner.escalations : state.runLevel.escalations).find((e) => e.eventId === ref.eventId);
      if (record) {
        items.push({
          key: partnerKey(ref.ticker, ref.eventId),
          kind: 'escalation',
          ticker: ref.ticker,
          eventId: ref.eventId,
          stageId: record.stageId,
          raisedBy: record.raisedBy,
          title: record.title,
          detail: record.detail,
          reason: record.reason,
          mode: null,
          state: record.state,
        });
      }
    } else {
      const record = (owner ? owner.proposals : state.runLevel.proposals).find((p) => p.eventId === ref.eventId);
      if (record) {
        items.push({
          key: partnerKey(ref.ticker, ref.eventId),
          kind: 'proposal',
          ticker: ref.ticker,
          eventId: ref.eventId,
          stageId: record.stageId,
          raisedBy: record.raisedBy,
          title: record.title,
          detail: record.detail,
          reason: null,
          mode: record.mode,
          state: record.state,
        });
      }
    }
  }
  return items;
}

/** The notification badge's count: items still waiting for the owner. */
export function openPartnerCount(state: FsreState): number {
  return partnerItems(state).filter((item) => item.state === 'open').length;
}

export interface FigureTotal {
  value: number;
  /** Summed totals, when every company reporting the figure gave one. */
  of: number | null;
  /** How many companies reported it. */
  companies: number;
}

export interface RunTotals {
  companies: number;
  escalationsOpen: number;
  itemsWaiting: number;
  figures: Record<string, FigureTotal>;
}

/** Run totals, summed from the companies every time — never a stored number. */
export function runTotals(state: FsreState, tickers: readonly string[] = state.companyOrder): RunTotals {
  const figures: Record<string, FigureTotal> = {};
  const missingOf = new Set<string>();
  let escalationsOpen = state.runLevel.escalations.filter((e) => e.state === 'open').length;
  for (const ticker of tickers) {
    const company = state.companies[ticker];
    if (!company) continue;
    escalationsOpen += company.escalations.filter((e) => e.state === 'open').length;
    for (const [key, figure] of Object.entries(company.figures)) {
      const total = figures[key] ?? { value: 0, of: 0, companies: 0 };
      const of = figureOf(figure);
      if (of === null) missingOf.add(key);
      figures[key] = { value: total.value + figureValue(figure), of: (total.of ?? 0) + (of ?? 0), companies: total.companies + 1 };
    }
  }
  for (const key of Object.keys(figures)) if (missingOf.has(key)) figures[key] = { ...figures[key], of: null };
  return { companies: tickers.length, escalationsOpen, itemsWaiting: openPartnerCount(state), figures };
}

export interface GateSummary {
  /** The most severe result on record: a later pass never hides an earlier failure. */
  worst: GateResult;
  latest: GateResult;
  latestRecord: GateRecord | null;
  results: GateRecord[];
}

export function gateSummary(company: CompanyState, stageId: string): GateSummary {
  const results = company.gates.filter((gate) => gate.stageId === stageId);
  const worst = results.reduce<GateResult>((acc, gate) => (GATE_SEVERITY[gate.result] > GATE_SEVERITY[acc] ? gate.result : acc), 'pending');
  const latestRecord = results.at(-1) ?? null;
  return { worst, latest: latestRecord?.result ?? 'pending', latestRecord, results };
}

/** Companies per gate result at a gate stage (worst on record each); companies not there yet are pending. */
export function gateBreakdown(state: FsreState, stageId: string): Record<GateResult, number> {
  const counts = Object.fromEntries(GATE_RESULTS.map((result) => [result, 0])) as Record<GateResult, number>;
  for (const ticker of state.companyOrder) counts[gateSummary(state.companies[ticker], stageId).worst] += 1;
  return counts;
}

/** The worst result across companies at a gate, or pending. */
export function gateAggregate(state: FsreState, stageId: string): GateResult {
  const counts = gateBreakdown(state, stageId);
  return GATE_RESULTS.reduce<GateResult>((acc, result) => (counts[result] > 0 && GATE_SEVERITY[result] > GATE_SEVERITY[acc] ? result : acc), 'pending');
}

/** The worst status any company has at a stage — the run view is never cleaner than its worst company. */
export function stageAggregate(state: FsreState, stageId: string): StageStatus {
  let worst: StageStatus = 'pending';
  for (const ticker of state.companyOrder) {
    const status = effectiveStageStatus(state.companies[ticker], stageId);
    if (STAGE_SEVERITY[status] > STAGE_SEVERITY[worst]) worst = status;
  }
  return worst;
}

/** Folders grouped by the desk they rest on, in company order. */
export function foldersByDesk(state: FsreState): Record<DeskKey, string[]> {
  const byDesk: Record<DeskKey, string[]> = {};
  for (const ticker of state.companyOrder) {
    const deskKey = state.companies[ticker].deskKey;
    if (!deskKey) continue;
    (byDesk[deskKey] ??= []).push(ticker);
  }
  return byDesk;
}

/** The skills an event touches: whoever it names, and whoever runs the stage it is at. */
export function actorsOf(ctx: FsreContext, event: FsreEvent): string[] {
  const actors = [event.skill, isGateEvent(event.kind) || event.kind.startsWith('stage_') || event.kind === 'issue_raised' || event.kind === 'escalated' ? runnerOf(ctx.plan, event.stageId) : null];
  return [...new Set(actors.filter((skill): skill is string => typeof skill === 'string'))];
}

/** Indexes of the events (of the first `cursor`) that touched a skill — derived, never stored. */
export function agentEventIndexes(ctx: FsreContext, events: readonly FsreEvent[], cursor: number, skill: string): number[] {
  const indexes: number[] = [];
  const end = Math.min(cursor, events.length);
  for (let i = 0; i < end; i += 1) if (actorsOf(ctx, events[i]).includes(skill)) indexes.push(i);
  return indexes;
}

/** Was this `approved` refused? True when it carries no ref and its ticker is locked in `before`. */
export function isRefusedApproval(state: FsreState, event: FsreEvent): boolean {
  return event.kind === 'approved' && !event.payload?.ref && event.ticker !== null && approvalLock(state, event.ticker).locked;
}
