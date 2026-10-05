/**
 * FSRE BUILDING — HOW EACH STATE LOOKS: ONE GLYPH AND ONE TONE.
 *
 * Colour never carries meaning alone: every state travels as glyph + word
 * (words in statuses.ts), and the tone only picks a colour token. The tone
 * names are resolved to colours in src/index.css (the `.fsre-tone` and
 * `[data-status]` rules), never here — this module holds no colour.
 *
 * Escalated is amber with ⚠ wherever it appears. Stalled shares the amber
 * but not the glyph (◐), so the two stay apart without colour.
 */
import type { AgentStatus, FolderStatus, GateResult, IssueState, ItemState, PartnerItemKind, StageStatus } from './statuses';

/** The colour roles a state can take; index.css maps each to a token. */
export const TONES = ['working', 'idle', 'stalled', 'escalated', 'done', 'failed', 'primary', 'neutral'] as const;
export type Tone = (typeof TONES)[number];

export const AGENT_GLYPHS: Record<AgentStatus, string> = {
  working: '●',
  stalled: '◐',
  escalated: '⚠',
  idle: '○',
  done: '✓',
};

export const AGENT_TONES: Record<AgentStatus, Tone> = {
  working: 'working',
  stalled: 'stalled',
  escalated: 'escalated',
  idle: 'idle',
  done: 'done',
};

export const STAGE_GLYPHS: Record<StageStatus, string> = {
  pending: '○',
  current: '▸',
  done: '✓',
  returned: '↺',
  blocked: '⊘',
  failed: '✕',
  escalated: '⚠',
};

export const STAGE_TONES: Record<StageStatus, Tone> = {
  pending: 'idle',
  current: 'working',
  done: 'done',
  returned: 'stalled',
  blocked: 'stalled',
  failed: 'failed',
  escalated: 'escalated',
};

export const GATE_GLYPHS: Record<GateResult, string> = {
  pending: '○',
  passed: '✓',
  failed: '✕',
  escalated: '⚠',
};

export const GATE_TONES: Record<GateResult, Tone> = {
  pending: 'idle',
  passed: 'done',
  failed: 'failed',
  escalated: 'escalated',
};

export const FOLDER_GLYPHS: Record<FolderStatus, string> = {
  'in-progress': '▸',
  returned: '↺',
  blocked: '⊘',
  failed: '✕',
  escalated: '⚠',
  approved: '✓',
  published: '★',
};

export const FOLDER_TONES: Record<FolderStatus, Tone> = {
  'in-progress': 'working',
  returned: 'stalled',
  blocked: 'stalled',
  failed: 'failed',
  escalated: 'escalated',
  approved: 'done',
  published: 'done',
};

export const PARTNER_KIND_GLYPHS: Record<PartnerItemKind, string> = {
  escalation: '⚠',
  proposal: '✎',
};

export const PARTNER_KIND_TONES: Record<PartnerItemKind, Tone> = {
  escalation: 'escalated',
  proposal: 'primary',
};

export const ITEM_STATE_GLYPHS: Record<ItemState, string> = {
  open: '●',
  decided: '✓',
};

// The item's KIND carries the amber (⚠ Escalation); its state stays quiet so
// an open proposal never borrows the escalation colour.
export const ITEM_STATE_TONES: Record<ItemState, Tone> = {
  open: 'primary',
  decided: 'neutral',
};

export const ISSUE_STATE_GLYPHS: Record<IssueState, string> = {
  open: '◐',
  closed: '✓',
};

export const ISSUE_STATE_TONES: Record<IssueState, Tone> = {
  open: 'stalled',
  closed: 'neutral',
};

/**
 * Glyph for the approval lock, shown with its written reasons. The lock only
 * ever exists because an escalation is open, so it takes the escalation's
 * glyph and amber rather than a padlock that would read as neutral.
 */
export const LOCK_GLYPH = '⚠';

/** Glyph for a provisional-data note. */
export const PROVISIONAL_GLYPH = '⚑';
