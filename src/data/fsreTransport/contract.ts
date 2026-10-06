/**
 * FSRE BUILDING v2 — THE LIVE CONTRACT, AS GLM LEFT IT.
 *
 * Ported unchanged in shape from the GLM workspace (fsre-building,
 * src/contract/v2.ts at commit 5b5d186): the exact types the real backend (an agent
 * runtime on a VPS writing to Supabase) must produce. The prose twin is
 * docs/lab/fsre-contract-v2.md; keep both in step. The open decisions on this
 * contract are listed there and in docs/lab/fsre-building-v2-port.md; none is
 * resolved here (the owner's M2 instruction: "keep the contract as GLM left it").
 *
 * The building talks only to FsreTransport. MockTransport implements it
 * against synthetic data; SupabaseTransport is a stub ("Not wired yet") until
 * milestone M3.
 */

export type DepartmentId = 'data' | 'modelling' | 'review';
export type AgentRole = 'lead' | 'staff' | 'router' | 'methodology' | 'owner';

export interface Agent {
  id: string;
  role: AgentRole;
  departmentId: DepartmentId | null;
  title: string; // "Data lead", "Data staff"
  skills: string[];
  assignedTicker: string | null;
}

export type GateStatus = 'pending' | 'passed' | 'passed_with_open_escalations' | 'failed';

export type EngagementStatus =
  | 'proposed'
  | 'blocked'
  | 'running'
  | 'waiting_owner'
  | 'returned'
  | 'published'
  | 'cancelled';

export interface EngagementPlan {
  subIndustryCode: string;
  subIndustryName: string;
  chainNodeId: string | null;
  tickers: string[]; // the peer pair, minimum 2
  archetype: { id: string | null; status: 'available' | 'missing' };
  conflictCheck: { result: 'clear' | 'excluded'; reason: string | null };
  filingsFound: { docId: string; period: string; kind: string }[];
  blockedReasons: string[]; // empty when the engagement can start
}

export interface Engagement {
  id: string;
  requestedText: string; // what the owner typed
  plan: EngagementPlan;
  status: EngagementStatus;
  createdAt: string;
  startedAt: string | null;
}

export type CommandKind = 'instruction' | 'question' | 'override';
export type CommandStatus = 'sent' | 'received' | 'done' | 'declined';

export interface Command {
  id: string;
  at: string;
  toAgentId: string;
  ccAgentIds: string[]; // the recipient's lead, added automatically
  engagementId: string | null;
  kind: CommandKind;
  text: string;
  reason: string | null; // required when kind = 'override'
  status: CommandStatus;
  statusAt: string;
  response: string | null;
  declinedRule: 'R1_HOLDOUT' | 'R2_GATE_BYPASS' | 'R3_APPROVAL' | null;
  workpaperNote: string | null; // overrides only: "Owner instruction, 6 Oct 2026"
}

export type AgentEventType =
  | 'task_started'
  | 'action'
  | 'task_done'
  | 'handoff'
  | 'waiting'
  | 'heartbeat'
  | 'escalation_opened'
  | 'escalation_closed'
  | 'gate_result'
  | 'command_received'
  | 'command_done'
  | 'command_declined';

export interface AgentEvent {
  id: string;
  seq: number;
  at: string; // ISO 8601, required, never null
  agentId: string;
  engagementId: string | null;
  ticker: string | null;
  stageId: string | null;
  type: AgentEventType;
  summary: string; // plain words, what the agent did; no financial values
  sourceRef: { docId: string; page: number | null; note: string | null } | null;
  counts: Record<string, number> | null; // e.g. { rowsMapped: 14, rowsTotal: 37 }
  waitingOn: string | null; // agent id
  commandId: string | null;
  escalationId: string | null;
}

export interface IndustryProgressRow {
  subIndustryCode: string;
  subIndustryName: string;
  chainGroup: string; // see docs/contract-v2.md
  chainOrder: number | null; // null = not placed on the chain yet
  targetCompanies: number; // 2
  companies: {
    ticker: string;
    engagementId: string;
    stageIndex: number;
    stagesTotal: number;
    gates: { g1: GateStatus; g2: GateStatus; g3: GateStatus };
    escalationsOpen: number;
    publishedVersion: string | null;
  }[];
  covered: boolean; // true only when at least 2 companies have a published version
}

export interface FsreTransport {
  subscribeEvents(cb: (e: AgentEvent) => void): () => void;
  listAgents(): Promise<Agent[]>;
  listEngagements(): Promise<Engagement[]>;
  proposeEngagement(requestedText: string): Promise<Engagement>;
  startEngagement(id: string): Promise<Engagement>;
  cancelEngagement(id: string): Promise<Engagement>;
  sendCommand(
    draft: Pick<Command, 'toAgentId' | 'engagementId' | 'kind' | 'text' | 'reason'>,
  ): Promise<Command>;
  listCommands(filter: { agentId?: string; engagementId?: string }): Promise<Command[]>;
  getIndustryProgress(): Promise<IndustryProgressRow[]>;
  /** Owner only. The UI must call this only from the partner room. */
  approveVersion(
    engagementId: string,
    version: string,
  ): Promise<{ ok: boolean; lockedReason: string | null }>;
}
