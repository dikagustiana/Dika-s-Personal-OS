/**
 * MockTransport — the full local implementation of FsreTransport (contract
 * v2). Everything is synthetic: fictitious tickers, a simulated clock, no
 * network. The real backend replaces this class with no UI changes.
 *
 * Mock-only affordances beyond the interface (used by the synthetic UI):
 *  - subscribeClock: streams the simulated time so "No signal since HH.MM"
 *    can appear without an event.
 *  - setSpeed: 1x, 10x, pause — changes the mock clock's rate only.
 *  - clock / flush / dispose: test hooks.
 */
import type {
  Agent,
  AgentEvent,
  Command,
  Engagement,
  FsreTransport,
  IndustryProgressRow,
} from './contract';
import {
  DECLINE_RULES,
  ENGAGEMENT_STATUS_WORDS,
  gateStatusLabel,
  workpaperNoteText,
  type DeclinedRule,
} from '../../logic/lab/fsre/statuses';
import { formatDateLong } from '../../logic/lab/fsre/format';
import { STAGES_PROVISIONAL, STAGES_TOTAL } from './provisional';
import { MockClock } from './mockClock';
import {
  SYNTHETIC_START_ISO,
  baseIndustryProgress,
  matchSubIndustry,
  syntheticFilings,
} from './mockUniverse';
import { buildResolutionScript, buildRunScript, type RunStaffIds, type ScriptEvent } from './mockScript';

/** Command timing in the mock: received after 1–2 s, then done after 4–8 s (brief v2 §4). */
export const MOCK_COMMAND_AFTER_SEC = { received: [1, 2], done: [4, 8] } as const;

function stageIndex(stageId: string): number | null {
  return STAGES_PROVISIONAL.find((stage) => stage.id === stageId)?.order ?? null;
}

/**
 * Placeholder keyword rules, enforced in the mock only (real enforcement
 * lives in the backend later). First match wins; order matters.
 */
export function matchDeclineRule(text: string): DeclinedRule | null {
  const q = text.toLowerCase();
  if (/\bholdout\b|\breveal\b/.test(q)) return 'R1_HOLDOUT';
  if (/\bskip\b|\bbypass\b|\bomit\b/.test(q)) return 'R2_GATE_BYPASS';
  if (/\bapprov|\bpublish\b|\bsign off\b/.test(q)) return 'R3_APPROVAL';
  return null;
}

const BASE_ROSTER: Agent[] = [
  { id: 'data-lead', role: 'lead', departmentId: 'data', title: 'Data lead', skills: ['idx-universe', 'data-sourcing'], assignedTicker: null },
  { id: 'data-staff-a', role: 'staff', departmentId: 'data', title: 'Data staff', skills: ['fs-intake', 'fs-normalize'], assignedTicker: 'SYNA' },
  { id: 'data-staff-b', role: 'staff', departmentId: 'data', title: 'Data staff', skills: ['fs-intake', 'fs-normalize'], assignedTicker: 'SYNB' },
  { id: 'router', role: 'router', departmentId: null, title: 'Router', skills: ['fs-reverse-engineering'], assignedTicker: null },
  { id: 'methodology', role: 'methodology', departmentId: null, title: 'Methodology', skills: ['guruh'], assignedTicker: null },
  { id: 'modelling-lead', role: 'lead', departmentId: 'modelling', title: 'Modelling lead', skills: ['peer-benchmark'], assignedTicker: null },
  { id: 'model-staff-a', role: 'staff', departmentId: 'modelling', title: 'Modelling staff', skills: ['fs-driver-decomposition', 'financial-modeling'], assignedTicker: 'SYNA' },
  { id: 'model-staff-b', role: 'staff', departmentId: 'modelling', title: 'Modelling staff', skills: ['fs-driver-decomposition', 'financial-modeling'], assignedTicker: 'SYNB' },
  { id: 'review-lead', role: 'lead', departmentId: 'review', title: 'Review lead', skills: ['review-manager'], assignedTicker: null },
  { id: 'tieout-checker', role: 'staff', departmentId: 'review', title: 'Tie-out checker', skills: ['review-manager'], assignedTicker: null },
  { id: 'source-checker', role: 'staff', departmentId: 'review', title: 'Source-trace checker', skills: ['review-manager'], assignedTicker: null },
  { id: 'owner', role: 'owner', departmentId: null, title: 'Owner', skills: [], assignedTicker: null },
];

const BASE_STAFF_IDS: RunStaffIds = {
  dataLead: 'data-lead',
  dataStaffA: 'data-staff-a',
  dataStaffB: 'data-staff-b',
  router: 'router',
  methodology: 'methodology',
  modellingLead: 'modelling-lead',
  modelStaffA: 'model-staff-a',
  modelStaffB: 'model-staff-b',
  reviewLead: 'review-lead',
  tieoutChecker: 'tieout-checker',
  sourceChecker: 'source-checker',
  owner: 'owner',
};

const CEMENT_ENGAGEMENT_ID = 'eng-syn-cem-1';

interface OpenEscalation {
  id: string;
  ticker: string;
  stageId: string;
  openedAt: string;
  summary: string;
}

interface ScheduledEvent {
  atMs: number;
  order: number;
  event: ScriptEvent;
}

interface ScheduledPatch {
  atMs: number;
  order: number;
  id: string;
  patch: Partial<Command>;
}

interface CompanyRun {
  stagesStarted: Set<string>;
  gates: { g1: 'pending' | 'passed' | 'failed'; g2: 'pending' | 'passed' | 'failed'; g3: 'pending' | 'passed' | 'failed' };
  publishedVersion: string | null;
}

function emptyRun(): CompanyRun {
  return { stagesStarted: new Set(), gates: { g1: 'pending', g2: 'pending', g3: 'pending' }, publishedVersion: null };
}

export class MockTransport implements FsreTransport {
  readonly clock = new MockClock(SYNTHETIC_START_ISO);
  private agents = new Map<string, Agent>(BASE_ROSTER.map((a) => [a.id, { ...a }]));
  private engagements = new Map<string, Engagement>();
  private commands = new Map<string, Command>();
  private eventSubs = new Set<(e: AgentEvent) => void>();
  private scheduled: ScheduledEvent[] = [];
  private scheduledPatches: ScheduledPatch[] = [];
  private scheduleOrder = 0;
  private seq = 0;
  private commandSeq = 0;
  private engagementSeq = 0;
  private staffSeq = 0;
  private openEscalations = new Map<string, OpenEscalation[]>();
  private runs = new Map<string, Map<string, CompanyRun>>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private baseProgress = baseIndustryProgress();

  constructor() {
    const [a, b] = ['SYNA', 'SYNB'] as [string, string];
    this.engagements.set(CEMENT_ENGAGEMENT_ID, {
      id: CEMENT_ENGAGEMENT_ID,
      requestedText: 'Model the synthetic cement pair for wave 1',
      plan: {
        subIndustryCode: 'SYN-CEM',
        subIndustryName: 'Synthetic cement',
        chainNodeId: 'chain-2',
        tickers: [a, b],
        archetype: { id: 'ARC-PROC', status: 'available' },
        conflictCheck: { result: 'clear', reason: null },
        filingsFound: [...syntheticFilings(a), ...syntheticFilings(b)],
        blockedReasons: [],
      },
      status: 'running',
      createdAt: SYNTHETIC_START_ISO,
      startedAt: SYNTHETIC_START_ISO,
    });
    this.runs.set(CEMENT_ENGAGEMENT_ID, new Map([
      [a, emptyRun()],
      [b, emptyRun()],
    ]));
    this.enqueueScript(
      buildRunScript(CEMENT_ENGAGEMENT_ID, [a, b], 'Synthetic cement', BASE_STAFF_IDS),
      Date.parse(SYNTHETIC_START_ISO),
    );
    this.clock.start();
    this.flushTimer = setInterval(() => this.flush(), 100);
  }

  dispose(): void {
    if (this.flushTimer !== null) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.clock.stop();
  }

  /* ---------- event stream ---------- */

  subscribeEvents(cb: (e: AgentEvent) => void): () => void {
    this.eventSubs.add(cb);
    return () => this.eventSubs.delete(cb);
  }

  subscribeClock(cb: (iso: string) => void): () => void {
    return this.clock.subscribe(cb);
  }

  setSpeed(speed: '1x' | '10x' | 'pause'): void {
    this.clock.setSpeed(speed);
  }

  /** Emit every event (and apply every command patch) whose time has passed. */
  flush(): void {
    const nowMs = Date.parse(this.clock.nowIso());
    const duePatches = this.scheduledPatches.filter((p) => p.atMs <= nowMs);
    if (duePatches.length > 0) {
      this.scheduledPatches = this.scheduledPatches.filter((p) => p.atMs > nowMs);
      duePatches.sort((a, b) => a.atMs - b.atMs || a.order - b.order);
      for (const p of duePatches) {
        const command = this.commands.get(p.id);
        if (command) {
          Object.assign(command, p.patch, { statusAt: new Date(p.atMs).toISOString() });
        }
      }
    }
    const due = this.scheduled.filter((s) => s.atMs <= nowMs);
    if (due.length === 0) return;
    this.scheduled = this.scheduled.filter((s) => s.atMs > nowMs);
    due.sort((a, b) => a.atMs - b.atMs || a.order - b.order);
    for (const { event } of due) this.emit(event);
  }

  private emit(event: ScriptEvent): void {
    const full: AgentEvent = {
      engagementId: null,
      ticker: null,
      stageId: null,
      sourceRef: null,
      counts: null,
      waitingOn: null,
      commandId: null,
      escalationId: null,
      ...event,
      id: `evt-${++this.seq}`,
      seq: this.seq,
      at: this.clock.nowIso(),
    };
    this.observe(full);
    for (const sub of this.eventSubs) sub(full);
  }

  /** Track what an event implies: stages, gates, escalations, engagement status. */
  private observe(event: AgentEvent): void {
    const engagementId = event.engagementId;
    if (!engagementId) return;
    let run = this.runs.get(engagementId);
    if (!run) {
      run = new Map();
      this.runs.set(engagementId, run);
    }
    if (event.ticker) {
      const company = run.get(event.ticker) ?? emptyRun();
      run.set(event.ticker, company);
      if (event.stageId) company.stagesStarted.add(event.stageId);
      if (event.type === 'gate_result') {
        // fail closed: without a numeric verdict the gate stays pending
        if (typeof event.counts?.gatesFailed === 'number') {
          const gate = event.stageId === 'gate-1' ? 'g1' : event.stageId === 'gate-2' ? 'g2' : 'g3';
          company.gates[gate] = event.counts.gatesFailed > 0 ? 'failed' : 'passed';
        }
      }
    }
    if (event.type === 'escalation_opened' && event.escalationId) {
      const list = this.openEscalations.get(engagementId) ?? [];
      list.push({
        id: event.escalationId,
        ticker: event.ticker ?? '',
        stageId: event.stageId ?? '',
        openedAt: event.at,
        summary: event.summary,
      });
      this.openEscalations.set(engagementId, list);
    }
    if (event.type === 'escalation_closed' && event.escalationId) {
      const list = this.openEscalations.get(engagementId) ?? [];
      this.openEscalations.set(
        engagementId,
        list.filter((e) => e.id !== event.escalationId),
      );
    }
    if (event.type === 'waiting' && event.agentId === 'owner') {
      const engagement = this.engagements.get(engagementId);
      if (engagement && engagement.status === 'running') {
        engagement.status = 'waiting_owner';
      }
    }
  }

  private enqueueScript(steps: { gapSec: number; event: ScriptEvent }[], fromMs: number): void {
    let atMs = fromMs;
    for (const step of steps) {
      atMs += step.gapSec * 1000;
      this.scheduled.push({ atMs, order: ++this.scheduleOrder, event: step.event });
    }
  }

  private scheduleAt(atMs: number, event: ScriptEvent): void {
    this.scheduled.push({ atMs, order: ++this.scheduleOrder, event });
  }

  /* ---------- roster ---------- */

  async listAgents(): Promise<Agent[]> {
    return [...this.agents.values()].map((a) => ({ ...a }));
  }

  private leadOf(agent: Agent | undefined): Agent | null {
    if (!agent || !agent.departmentId || agent.role !== 'staff') return null;
    return [...this.agents.values()].find((a) => a.role === 'lead' && a.departmentId === agent.departmentId) ?? null;
  }

  private addStaff(department: 'data' | 'modelling', ticker: string): Agent {
    const prefix = department === 'data' ? 'data-staff' : 'model-staff';
    const agent: Agent = {
      id: `${prefix}-s${++this.staffSeq}`,
      role: 'staff',
      departmentId: department,
      title: department === 'data' ? 'Data staff' : 'Modelling staff',
      skills: department === 'data' ? ['fs-intake', 'fs-normalize'] : ['fs-driver-decomposition', 'financial-modeling'],
      assignedTicker: ticker,
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  private staffIdsFor(engagement: Engagement): RunStaffIds {
    const [a, b] = engagement.plan.tickers;
    const pick = (dept: 'data' | 'modelling', ticker: string): string => {
      const found = [...this.agents.values()].find(
        (x) => x.departmentId === dept && x.role === 'staff' && x.assignedTicker === ticker,
      );
      if (found) return found.id;
      return this.addStaff(dept, ticker).id;
    };
    return {
      ...BASE_STAFF_IDS,
      dataStaffA: pick('data', a),
      dataStaffB: pick('data', b),
      modelStaffA: pick('modelling', a),
      modelStaffB: pick('modelling', b),
    };
  }

  /* ---------- engagements ---------- */

  async listEngagements(): Promise<Engagement[]> {
    return [...this.engagements.values()].map((e) => ({ ...e, plan: { ...e.plan } }));
  }

  async proposeEngagement(requestedText: string): Promise<Engagement> {
    const sub = matchSubIndustry(requestedText);
    if (!sub) {
      throw new Error('No synthetic sub-industry matches that text. Try a ticker (SYNA–SYNS) or a sub-industry name.');
    }
    const blockedReasons: string[] = [];
    if (sub.archetype.status === 'missing') blockedReasons.push('Archetype not built yet');
    if (sub.companies.length < 2) blockedReasons.push('Peer pair needs 2 companies');
    const pair = sub.companies.slice(0, 2);
    const conflict =
      sub.excluded && pair.some((c) => c.ticker === sub.excluded?.ticker)
        ? { result: 'excluded' as const, reason: `${sub.excluded.ticker}: ${sub.excluded.reason}` }
        : { result: 'clear' as const, reason: null };
    if (conflict.result === 'excluded') {
      blockedReasons.push(`${sub.excluded?.ticker} — ${sub.excluded?.reason}`);
    }
    const engagement: Engagement = {
      id: `eng-${sub.code.toLowerCase()}-${++this.engagementSeq}`,
      requestedText,
      plan: {
        subIndustryCode: sub.code,
        subIndustryName: sub.name,
        chainNodeId: sub.chainOrder !== null ? `chain-${sub.chainOrder}` : null,
        tickers: pair.map((c) => c.ticker),
        archetype: { ...sub.archetype },
        conflictCheck: conflict,
        filingsFound: pair.flatMap((c) => syntheticFilings(c.ticker)),
        blockedReasons,
      },
      status: blockedReasons.length > 0 ? 'blocked' : 'proposed',
      createdAt: this.clock.nowIso(),
      startedAt: null,
    };
    this.engagements.set(engagement.id, engagement);
    return { ...engagement, plan: { ...engagement.plan } };
  }

  async startEngagement(id: string): Promise<Engagement> {
    const engagement = this.engagements.get(id);
    if (!engagement) throw new Error(`Unknown engagement ${id}`);
    if (engagement.plan.blockedReasons.length > 0) {
      throw new Error(`Engagement is blocked: ${engagement.plan.blockedReasons.join('; ')}`);
    }
    if (engagement.status !== 'proposed') {
      throw new Error(`Engagement ${id} cannot start from status ${engagement.status}`);
    }
    engagement.status = 'running';
    engagement.startedAt = this.clock.nowIso();
    const staffIds = this.staffIdsFor(engagement);
    this.runs.set(id, new Map(engagement.plan.tickers.map((t) => [t, emptyRun()])));
    const [a, b] = engagement.plan.tickers;
    this.enqueueScript(
      buildRunScript(id, [a, b], engagement.plan.subIndustryName, staffIds),
      Date.parse(this.clock.nowIso()),
    );
    return { ...engagement, plan: { ...engagement.plan } };
  }

  async cancelEngagement(id: string): Promise<Engagement> {
    const engagement = this.engagements.get(id);
    if (!engagement) throw new Error(`Unknown engagement ${id}`);
    if (engagement.status === 'published') throw new Error('A published engagement cannot be cancelled.');
    engagement.status = 'cancelled';
    this.scheduled = this.scheduled.filter(
      (s) => s.event.engagementId !== id || s.event.type === 'command_done' || s.event.type === 'command_declined',
    );
    // a cancelled engagement keeps its escalations as they were; approval of a
    // cancelled engagement is refused by the status check in approveVersion
    // unassign per-company staff that no other live engagement uses any more
    const stillUsed = new Set<string>();
    for (const other of this.engagements.values()) {
      if (other.status === 'running' || other.status === 'waiting_owner') {
        other.plan.tickers.forEach((t) => stillUsed.add(t));
      }
    }
    for (const agent of [...this.agents.values()]) {
      if (agent.role === 'staff' && agent.assignedTicker && !stillUsed.has(agent.assignedTicker)) {
        const isBaseStaff = ['data-staff-a', 'data-staff-b', 'model-staff-a', 'model-staff-b'].includes(agent.id);
        if (isBaseStaff) {
          agent.assignedTicker = null;
        } else {
          this.agents.delete(agent.id);
        }
      }
    }
    return { ...engagement, plan: { ...engagement.plan } };
  }

  /* ---------- commands ---------- */

  async sendCommand(
    draft: Pick<Command, 'toAgentId' | 'engagementId' | 'kind' | 'text' | 'reason'>,
  ): Promise<Command> {
    const recipient = this.agents.get(draft.toAgentId);
    if (!recipient) throw new Error(`Unknown agent ${draft.toAgentId}`);
    if (recipient.role === 'owner') throw new Error('The owner does not command themselves.');
    if (draft.kind === 'override' && !draft.reason?.trim()) {
      throw new Error('An override needs a reason.');
    }
    const now = this.clock.nowIso();
    const cc = this.leadOf(recipient);
    const command: Command = {
      id: `cmd-${++this.commandSeq}`,
      at: now,
      toAgentId: draft.toAgentId,
      ccAgentIds: cc ? [cc.id] : [],
      engagementId: draft.engagementId ?? null,
      kind: draft.kind,
      text: draft.text,
      reason: draft.kind === 'override' ? (draft.reason ?? null) : null,
      status: 'sent',
      statusAt: now,
      response: null,
      declinedRule: null,
      workpaperNote:
        draft.kind === 'override' ? workpaperNoteText(formatDateLong(this.clock.nowIso())) : null,
    };
    this.commands.set(command.id, command);
    this.scheduleCommandFlow(command, recipient.id);
    return { ...command };
  }

  private scheduleCommandFlow(command: Command, recipientId: string): void {
    const nowMs = Date.parse(this.clock.nowIso());
    const [recvMin, recvMax] = MOCK_COMMAND_AFTER_SEC.received;
    const recvDelay = (recvMin + (this.commandSeq % (recvMax - recvMin + 1))) * 1000;
    const kindWord = { instruction: 'instruction', question: 'question', override: 'override' }[command.kind];
    this.scheduleAt(nowMs + recvDelay, {
      agentId: recipientId,
      engagementId: command.engagementId,
      ticker: null,
      stageId: null,
      type: 'command_received',
      summary: `Received the owner's ${kindWord}: “${command.text}”`,
      commandId: command.id,
    });

    const decline = matchDeclineRule(command.text);
    if (decline) {
      const rule = DECLINE_RULES[decline];
      this.scheduleAt(nowMs + recvDelay + 1000, {
        agentId: recipientId,
        engagementId: command.engagementId,
        ticker: null,
        stageId: null,
        type: 'command_declined',
        summary: `Declined under ${decline} (${rule.label}): ${rule.explanation}`,
        commandId: command.id,
      });
      this.scheduleCommandPatch(command.id, nowMs + recvDelay + 1000, {
        status: 'declined',
        declinedRule: decline,
        response: rule.explanation,
      });
      return;
    }

    const [doneMin, doneMax] = MOCK_COMMAND_AFTER_SEC.done;
    const doneDelay = (doneMin + (this.commandSeq % (doneMax - doneMin + 1))) * 1000;
    const resolveEscalation =
      command.kind === 'override' &&
      /escalat/i.test(command.text) &&
      (this.openEscalations.get(command.engagementId ?? '') ?? []).length > 0;

    if (resolveEscalation) {
      const escalation = (this.openEscalations.get(command.engagementId ?? '') ?? [])[0];
      this.scheduleAt(nowMs + doneDelay, {
        agentId: recipientId,
        engagementId: command.engagementId,
        ticker: escalation.ticker,
        stageId: escalation.stageId,
        type: 'escalation_closed',
        summary: `Owner chose: “${command.reason ?? command.text}”; the escalation is closed`,
        escalationId: escalation.id,
      });
      this.enqueueScript(
        buildResolutionScript(command.engagementId ?? '', escalation.ticker, BASE_STAFF_IDS),
        nowMs + doneDelay + 1000,
      );
    }

    // Between received and done, one related event from the recipient (brief v2 §4:
    // "received after 1–2 seconds, then related events, then done"; v2.1 FX-13).
    if (command.kind === 'instruction' || command.kind === 'question') {
      this.scheduleAt(nowMs + (recvDelay + doneDelay) / 2, {
        agentId: recipientId,
        engagementId: command.engagementId,
        ticker: null,
        stageId: null,
        type: 'action',
        summary: command.kind === 'question' ? 'Looked into the owner’s question' : 'Started on the owner’s instruction',
        commandId: command.id,
      });
    }

    this.scheduleAt(nowMs + doneDelay, {
      agentId: recipientId,
      engagementId: command.engagementId,
      ticker: null,
      stageId: null,
      type: 'command_done',
      summary: resolveEscalation
        ? 'Recorded the override in the workpaper'
        : command.kind === 'question'
          ? 'Answered the owner’s question'
          : 'Picked up the owner’s instruction',
      commandId: command.id,
    });
    const response = resolveEscalation
      ? `Recorded in the workpaper as ${workpaperNoteText(formatDateLong(new Date(nowMs).toISOString()))}.`
      : command.kind === 'question'
        ? 'Checked just now: the work is on track and nothing is blocked.'
        : 'Understood; it is at the top of today’s queue.';
    this.scheduleCommandPatch(command.id, nowMs + doneDelay, { status: 'done', response });
  }

  private scheduleCommandPatch(id: string, atMs: number, patch: Partial<Command>): void {
    this.scheduledPatches.push({ atMs, order: ++this.scheduleOrder, id, patch });
  }

  async listCommands(filter: { agentId?: string; engagementId?: string }): Promise<Command[]> {
    let out = [...this.commands.values()];
    if (filter.agentId) {
      out = out.filter((c) => c.toAgentId === filter.agentId || c.ccAgentIds.includes(filter.agentId!));
    }
    if (filter.engagementId) out = out.filter((c) => c.engagementId === filter.engagementId);
    return out.map((c) => ({ ...c })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  /* ---------- industry progress ---------- */

  async getIndustryProgress(): Promise<IndustryProgressRow[]> {
    const rows: IndustryProgressRow[] = this.baseProgress.map((row) => ({
      ...row,
      companies: row.companies.map((c) => ({ ...c })),
    }));
    for (const engagement of this.engagements.values()) {
      if (engagement.status === 'cancelled' || engagement.status === 'blocked' || engagement.status === 'proposed') {
        continue;
      }
      const run = this.runs.get(engagement.id);
      if (!run) continue;
      let row = rows.find((r) => r.subIndustryCode === engagement.plan.subIndustryCode);
      if (!row) {
        row = {
          subIndustryCode: engagement.plan.subIndustryCode,
          subIndustryName: engagement.plan.subIndustryName,
          chainGroup: 'Not placed on the chain yet',
          chainOrder: null,
          targetCompanies: 2,
          companies: [],
          covered: false,
        };
        rows.push(row);
      }
      const openFor = this.openEscalations.get(engagement.id) ?? [];
      row.companies = engagement.plan.tickers.map((ticker) => {
        const company = run.get(ticker) ?? emptyRun();
        const gate = (g: 'g1' | 'g2' | 'g3', stageId: string) => {
          if (company.gates[g] === 'pending') return 'pending' as const;
          if (company.gates[g] === 'failed') return 'failed' as const;
          return openFor.some((e) => e.ticker === ticker && e.stageId === stageId)
            ? ('passed_with_open_escalations' as const)
            : ('passed' as const);
        };
        const stageIndexValue = [...company.stagesStarted].reduce(
          (max, stageId) => Math.max(max, stageIndex(stageId) ?? 0),
          0,
        );
        return {
          ticker,
          engagementId: engagement.id,
          stageIndex: stageIndexValue,
          stagesTotal: STAGES_TOTAL,
          gates: { g1: gate('g1', 'gate-1'), g2: gate('g2', 'gate-2'), g3: gate('g3', 'gate-3') },
          escalationsOpen: openFor.filter((e) => e.ticker === ticker).length,
          publishedVersion: company.publishedVersion,
        };
      });
      row.covered = row.companies.filter((c) => c.publishedVersion !== null).length >= 2;
    }
    return rows;
  }

  /* ---------- approval (owner only) ---------- */

  async approveVersion(engagementId: string, version: string): Promise<{ ok: boolean; lockedReason: string | null }> {
    const engagement = this.engagements.get(engagementId);
    if (!engagement) return { ok: false, lockedReason: `Unknown engagement ${engagementId}.` };
    if (engagement.status !== 'waiting_owner') {
      const word = ENGAGEMENT_STATUS_WORDS[engagement.status] ?? engagement.status;
      return { ok: false, lockedReason: `Not ready for approval: ${word}.` };
    }
    const open = this.openEscalations.get(engagementId) ?? [];
    if (open.length > 0) {
      return {
        ok: false,
        lockedReason:
          open.length === 1
            ? `Locked: 1 escalation is open on version ${version} (${open[0].ticker}). Resolve it first.`
            : `Locked: ${open.length} escalations are open on version ${version}. Resolve them first.`,
      };
    }
    const run = this.runs.get(engagement.id);
    if (run) {
      const gateOrder: ('g1' | 'g2' | 'g3')[] = ['g1', 'g2', 'g3'];
      for (const ticker of engagement.plan.tickers) {
        const company = run.get(ticker) ?? emptyRun();
        for (let i = 0; i < gateOrder.length; i++) {
          const status = company.gates[gateOrder[i]];
          if (status !== 'passed') {
            const word = gateStatusLabel(status, 0);
            return { ok: false, lockedReason: `Gate ${i + 1} on ${ticker} is ${word}.` };
          }
        }
      }
      for (const company of run.values()) company.publishedVersion = version;
    }
    engagement.status = 'published';
    this.emit({
      agentId: 'owner',
      engagementId: engagement.id,
      ticker: null,
      stageId: 'sign-off',
      type: 'task_done',
      summary: `Owner approved version ${version}; published for ${engagement.plan.tickers.join(' and ')}`,
      counts: null,
    });
    return { ok: true, lockedReason: null };
  }
}
