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
