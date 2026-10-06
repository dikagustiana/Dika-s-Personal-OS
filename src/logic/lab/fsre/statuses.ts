/**
 * FSRE BUILDING — ONE SOURCE PER LIST.
 *
 * Every status list, and the one word map for each, lives here; every glyph
 * and tone lives beside it in glyphs.ts. Components never declare their own
 * words. The source app kept a second copy of the legend words, the event
 * kind words and the figure labels (three times) inside its panels; a word
 * changed in one copy silently disagreed with the others.
 *
 * British English throughout. Words are sentence case; callers lower-case
 * them where a sentence needs it.
 */
import type { FsreEventKind } from './events';

/** What an agent is doing, derived from the companies it holds (reducer.ts). */
export const AGENT_STATUSES = ['working', 'stalled', 'escalated', 'idle', 'done'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * Where one company stands at one stage. `escalated` is never stored: it is
 * derived while an escalation at that stage is open, so it outranks whatever
 * the stage last recorded and a stage can never read as clean underneath it.
 */
export const STAGE_STATUSES = ['pending', 'current', 'done', 'returned', 'blocked', 'failed', 'escalated'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/**
 * A gate's result for one company. `escalated` is "passed with escalation"
 * and its word says so in full — it is never shortened to "Passed".
 */
export const GATE_RESULTS = ['pending', 'passed', 'failed', 'escalated'] as const;
export type GateResult = (typeof GATE_RESULTS)[number];

/** A company folder. There is no "not started": a folder exists once an event names its ticker. */
export const FOLDER_STATUSES = ['in-progress', 'returned', 'blocked', 'failed', 'escalated', 'approved', 'published'] as const;
export type FolderStatus = (typeof FOLDER_STATUSES)[number];

export const PARTNER_ITEM_KINDS = ['escalation', 'proposal'] as const;
export type PartnerItemKind = (typeof PARTNER_ITEM_KINDS)[number];

/** An escalation or a proposal is open until an `approved` event names it. */
export const ITEM_STATES = ['open', 'decided'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** A review issue is open until its stage completes or its gate reports. */
export const ISSUE_STATES = ['open', 'closed'] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

export const AGENT_STATUS_WORDS: Record<AgentStatus, string> = {
  working: 'Working',
  stalled: 'Stalled',
  escalated: 'Escalated',
  idle: 'Idle',
  done: 'Done',
};

export const STAGE_STATUS_WORDS: Record<StageStatus, string> = {
  pending: 'Pending',
  current: 'Current',
  done: 'Done',
  returned: 'Returned',
  blocked: 'Blocked',
  failed: 'Failed',
  escalated: 'Escalated',
};

export const GATE_RESULT_WORDS: Record<GateResult, string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  escalated: 'Passed with escalation',
};

/**
 * The gate chips in the drawing. Three gate rooms stand side by side, and at
 * the chips' 9px floor "Passed with escalation" ran into the next room's
 * chip at tablet and phone widths. The chip says what the stage screen says
 * for the same state; its button's label, the metrics and the panel keep the
 * full words. Glyph ⚠ and the escalated tone are unchanged (rule 3).
 */
export const GATE_CHIP_WORDS: Record<GateResult, string> = {
  ...GATE_RESULT_WORDS,
  escalated: STAGE_STATUS_WORDS.escalated,
};

export const FOLDER_STATUS_WORDS: Record<FolderStatus, string> = {
  'in-progress': 'In progress',
  returned: 'Returned',
  blocked: 'Blocked',
  failed: 'Gate failed',
  escalated: 'Escalated',
  approved: 'Approved',
  published: 'Published',
};

export const PARTNER_KIND_WORDS: Record<PartnerItemKind, string> = {
  escalation: 'Escalation',
  proposal: 'Proposal',
};

/** Plural nouns for counts ("2 escalations"), kept with their singulars. */
export const PARTNER_KIND_COUNT_NOUNS: Record<PartnerItemKind, { one: string; many: string }> = {
  escalation: { one: 'escalation', many: 'escalations' },
  proposal: { one: 'proposal', many: 'proposals' },
};

export const ITEM_STATE_WORDS: Record<ItemState, string> = {
  open: 'Open',
  decided: 'Decided',
};

export const ISSUE_STATE_WORDS: Record<IssueState, string> = {
  open: 'Open issue',
  closed: 'Closed issue',
};

/** One word per event kind, for histories and the timeline of an agent. */
export const EVENT_KIND_WORDS: Record<FsreEventKind, string> = {
  stage_started: 'Stage started',
  stage_completed: 'Stage completed',
  stage_returned: 'Returned to the stage',
  stage_blocked: 'Stage blocked',
  gate_passed: 'Gate passed',
  gate_failed: 'Gate failed',
  gate_passed_with_escalation: 'Gate passed with escalation',
  issue_raised: 'Issue raised',
  escalated: 'Escalated to the owner',
  proposal_logged: 'Proposal logged',
  package_staged: 'Package staged for approval',
  approved: 'Approved',
  published: 'Published',
};

/**
 * THE figure-label map. A key not listed here is shown as written, so a new
 * figure in the export appears under its own name rather than vanishing.
 */
export const FIGURE_LABELS: Record<string, string> = {
  filings: 'Filings',
  factsLoaded: 'Facts loaded',
  rows: 'Rows',
  unmappedConcepts: 'Unmapped concepts',
  rowsTraced: 'Rows traced',
  tieOutChecks: 'Tie-out checks',
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
  unitEconomicsPeriods: 'Unit-economics periods',
  identityPeriodsRun: 'Identity periods run',
};

export function figureLabel(key: string): string {
  return FIGURE_LABELS[key] ?? key;
}

/** The three input files, by role. */
export const FSRE_FILE_KEYS = ['stages', 'skills', 'replay'] as const;
export type FsreFileKey = (typeof FSRE_FILE_KEYS)[number];

export const FILE_WORDS: Record<FsreFileKey, string> = {
  stages: 'Stage list',
  skills: 'Skill roles',
  replay: 'Replay events',
};

export const SEARCH_RESULT_TYPES = ['company', 'skill', 'stage'] as const;
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export const SEARCH_TYPE_WORDS: Record<SearchResultType, string> = {
  company: 'Company',
  skill: 'Skill',
  stage: 'Stage',
};

/**
 * Severity, for picking the one status that stands for several companies.
 * An open escalation outranks everything, then a failure, then a block:
 * the aggregate is never cleaner than its worst company.
 */
export const STAGE_SEVERITY: Record<StageStatus, number> = {
  pending: 0,
  done: 1,
  current: 2,
  returned: 3,
  blocked: 4,
  failed: 5,
  escalated: 6,
};

export const GATE_SEVERITY: Record<GateResult, number> = {
  pending: 0,
  passed: 1,
  failed: 2,
  escalated: 3,
};

/* ======================================================================
 * v2 — THE LIVE OFFICE (brief v2 §2: one vocabulary, used everywhere).
 *
 * Desk states, gate labels, engagement and command words, the placeholder
 * decline rules, the thresholds, the chain groups and the modes. Where a v2
 * word means what a v1 word already says, it is that word, not a copy.
 * Names that come from data (stage ids and names, skill names) are not here:
 * they live in src/data/fsreTransport/provisional.ts.
 * ====================================================================== */

/** A desk's state, derived by deriveDeskState (deskState.ts) in this order of precedence. */
export const DESK_STATES = ['escalated', 'no_signal', 'waiting', 'working', 'idle'] as const;
export type DeskState = (typeof DESK_STATES)[number];

export const DESK_STATE_WORDS: Record<DeskState, string> = {
  escalated: AGENT_STATUS_WORDS.escalated,
  no_signal: 'No signal',
  waiting: 'Waiting',
  working: AGENT_STATUS_WORDS.working,
  idle: AGENT_STATUS_WORDS.idle,
};

/** The chip of a staff desk with no agent: it never reads as working. */
export const UNASSIGNED_DESK_WORD = 'Idle, no assignment';

/** "No signal since 16.02": the time is the last signal's, written by the caller in HH.MM. */
export function noSignalSinceText(time: string): string {
  return `${DESK_STATE_WORDS.no_signal} since ${time}`;
}

/** A gate's status for one company in the live contract. */
export const LIVE_GATE_STATUSES = ['pending', 'passed', 'passed_with_open_escalations', 'failed'] as const;
export type LiveGateStatus = (typeof LIVE_GATE_STATUSES)[number];

/**
 * The one gate label (brief v2 §2: "Pending", "Passed", "Passed, N escalations
 * open", "Failed"). The summary card and the partner room use this; the gate
 * room's short word (gateShortWord) derives from the same status.
 */
export function gateStatusLabel(status: LiveGateStatus, openEscalations: number): string {
  switch (status) {
    case 'pending':
      return GATE_RESULT_WORDS.pending;
    case 'passed':
      return GATE_RESULT_WORDS.passed;
    case 'failed':
      return GATE_RESULT_WORDS.failed;
    case 'passed_with_open_escalations':
      // Never a softened count (audit F2), and never an invented one: without
      // a count the label says an escalation is open, not how many (FX-3).
      if (openEscalations < 1) return 'Passed, escalation open';
      return openEscalations === 1 ? 'Passed, 1 escalation open' : `Passed, ${openEscalations} escalations open`;
  }
}

/** The short word a gate takes where space is tight; same underlying status. */
export function gateShortWord(status: LiveGateStatus): string {
  return status === 'passed_with_open_escalations' ? STAGE_STATUS_WORDS.escalated : gateStatusLabel(status, 0);
}

export const ENGAGEMENT_STATUSES = ['proposed', 'blocked', 'running', 'waiting_owner', 'returned', 'published', 'cancelled'] as const;
export type EngagementStatusV = (typeof ENGAGEMENT_STATUSES)[number];

export const ENGAGEMENT_STATUS_WORDS: Record<EngagementStatusV, string> = {
  proposed: 'Proposed',
  blocked: STAGE_STATUS_WORDS.blocked,
  running: 'Running',
  waiting_owner: 'Waiting for owner',
  returned: STAGE_STATUS_WORDS.returned,
  published: FOLDER_STATUS_WORDS.published,
  cancelled: 'Cancelled',
};

export const COMMAND_KINDS = ['instruction', 'question', 'override'] as const;
export type CommandKindV = (typeof COMMAND_KINDS)[number];

export const COMMAND_KIND_WORDS: Record<CommandKindV, string> = {
  instruction: 'Instruction',
  question: 'Question',
  override: 'Override',
};

export const COMMAND_STATUSES = ['sent', 'received', 'done', 'declined'] as const;
export type CommandStatusV = (typeof COMMAND_STATUSES)[number];

export const COMMAND_STATUS_WORDS: Record<CommandStatusV, string> = {
  sent: 'Sent',
  received: 'Received',
  done: AGENT_STATUS_WORDS.done,
  declined: 'Declined',
};

/** Shown on the composer when the kind is Override, and recorded on the command. */
export function workpaperNoteText(dateText: string): string {
  return `Owner instruction, ${dateText}`;
}

export type DeclinedRule = 'R1_HOLDOUT' | 'R2_GATE_BYPASS' | 'R3_APPROVAL';

/**
 * The PLACEHOLDER decline rules: keyword rules enforced in the mock only;
 * real enforcement lives in the backend later (brief v2 §4). Every surface
 * that shows a declined command uses these labels and one-line explanations.
 */
export const DECLINE_RULES: Record<DeclinedRule, { label: string; explanation: string }> = {
  R1_HOLDOUT: {
    label: 'R1 — holdout (placeholder)',
    explanation: 'The holdout stays sealed, so the model is never checked against the answer it must not see.',
  },
  R2_GATE_BYPASS: {
    label: 'R2 — gate bypass (placeholder)',
    explanation: 'A gate or a tie-out cannot be skipped; fix the finding instead.',
  },
  R3_APPROVAL: {
    label: 'R3 — approval (placeholder)',
    explanation: 'Only the owner approves or publishes; agents cannot be asked to do it.',
  },
};

/** The tooltip on every declined command: the rules above are the mock's, not the backend's. */
export const PLACEHOLDER_RULE_NOTE = 'Placeholder rule (mock only); real enforcement lives in the backend later';

/** Minutes without an event before an open task reads as "No signal". */
export const NO_SIGNAL_AFTER_MIN = 5;

/** The industries board's chain groups, in chain order (brief v2 §4). */
export const CHAIN_GROUPS = [
  'Raw-material extraction',
  'Basic industry',
  'Processing industry',
  'Distribution',
  'Sales channels',
  'End users',
  'Spanning layers — Energy',
  'Spanning layers — Logistics',
  'Not placed on the chain yet',
] as const;
export type ChainGroup = (typeof CHAIN_GROUPS)[number];

/** The header's mode switch. Live stays disabled until milestone M3 wires the backend. */
export const MODES = [
  { id: 'replay', label: 'Replay', note: '' },
  { id: 'synthetic', label: 'Synthetic', note: 'The mock live office on synthetic data' },
  { id: 'live', label: 'Live', note: 'Not wired yet' },
] as const;
export type ModeId = (typeof MODES)[number]['id'];

export const SYNTHETIC_BANNER = 'Synthetic run: fictitious companies and a mock transport. No real companies, filings or figures.';

/** The two views of the synthetic mode. */
export const LIVE_VIEWS = [
  { id: 'building', label: 'Building' },
  { id: 'industries', label: 'Industries' },
] as const;
export type LiveViewId = (typeof LIVE_VIEWS)[number]['id'];

/** Words of the floor tag beyond the desk states (deskViews.ts floorTagParts). */
export const FLOOR_TAG_WORDS = {
  unstaffed: 'unstaffed',
  notDrawn: 'more not drawn',
} as const;

/** The name plate of a staff desk with nobody at it, outside the review department. */
export const VACANT_DESK_TITLE = 'Staff desk';

/** An industries row whose sub-industry has at least two published companies. */
export const COVERED_WORD = 'Covered';

/** An industries row with no engagement yet. */
export const NOT_STARTED_WORD = 'Not started';

/** The summary card's gates when no engagement is running or waiting for the owner. */
export const NO_LIVE_ENGAGEMENT_WORD = 'No engagement running';

/** Before a dimmed desk's label: what it works on instead of the filtered engagement. */
export const OTHER_WORK_WORD = 'other work:';

/** The dim label of a desk whose work belongs to no ticker of the filtered engagement. */
export const OTHER_ENGAGEMENT_WORD = 'other engagement';

/** A desk's in-tray, on its chip: queued items plus open commands. */
export const IN_TRAY_WORD = 'In-tray';

/** The three departments of the v2 office, by their contract ids. */
export const DEPARTMENT_WORDS: Record<'data' | 'modelling' | 'review', string> = {
  data: 'Data department',
  modelling: 'Modelling department',
  review: 'Review department',
};
