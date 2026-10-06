/**
 * The v2 words in the one vocabulary (statuses.ts), and the provisional stage
 * list the live office reads (src/data/fsreTransport/provisional.ts). Ported
 * from the GLM workspace's src/contract/vocabulary.test.ts at 5b5d186.
 */
import { describe, expect, it } from 'vitest';
import { STAGES_PROVISIONAL, STAGES_TOTAL } from '../../../data/fsreTransport/provisional';
import { LIVE_GATE_STAGES, liveStageName, liveStageOrder } from './liveReducer';
import {
  AGENT_STATUS_WORDS,
  CHAIN_GROUPS,
  DECLINE_RULES,
  DESK_STATES,
  DESK_STATE_WORDS,
  GATE_RESULT_WORDS,
  gateShortWord,
  gateStatusLabel,
  noSignalSinceText,
  workpaperNoteText,
} from './statuses';

describe('the provisional stage list (STAGES_PROVISIONAL)', () => {
  it('has 13 stages in order, each named once', () => {
    expect(STAGES_TOTAL).toBe(13);
    expect(STAGES_PROVISIONAL.map((s) => s.order)).toEqual(Array.from({ length: STAGES_TOTAL }, (_, i) => i + 1));
    expect(new Set(STAGES_PROVISIONAL.map((s) => s.name)).size).toBe(STAGES_TOTAL);
  });

  it('finds the three gates by the one gate predicate, not by a written list', () => {
    expect(LIVE_GATE_STAGES.map((s) => s.id)).toEqual(['gate-1', 'gate-2', 'gate-3']);
  });

  it('answers a stage’s order and name, and says nothing invented for an unknown id', () => {
    expect(liveStageOrder('gate-2')).toBe(10);
    expect(liveStageOrder('no-such-stage')).toBeNull();
    expect(liveStageName('decomposition')).toBe('Decomposition');
    expect(liveStageName('no-such-stage')).toBe('no-such-stage');
    expect(liveStageName(null)).toBe('');
  });
});

describe('the v2 vocabulary', () => {
  it('never prints a softened escalation count (audit F2)', () => {
    const label = gateStatusLabel('passed_with_open_escalations', 0);
    expect(label).not.toContain('0 escalation');
    expect(label).toBe('Passed, 1 escalation open');
  });

  it('derives the summary label and the room word from one status', () => {
    expect(gateStatusLabel('passed_with_open_escalations', 1)).toBe('Passed, 1 escalation open');
    expect(gateStatusLabel('passed_with_open_escalations', 2)).toBe('Passed, 2 escalations open');
    expect(gateShortWord('passed_with_open_escalations')).toBe('Escalated');
    expect(gateShortWord('passed')).toBe('Passed');
    expect(gateShortWord('pending')).toBe('Pending');
    expect(gateShortWord('failed')).toBe('Failed');
  });

  it('reuses the replay’s own words where a live word means the same', () => {
    expect(gateStatusLabel('passed', 0)).toBe(GATE_RESULT_WORDS.passed);
    expect(DESK_STATE_WORDS.working).toBe(AGENT_STATUS_WORDS.working);
    expect(DESK_STATE_WORDS.escalated).toBe(AGENT_STATUS_WORDS.escalated);
  });

  it('lists the five desk states in precedence order', () => {
    expect(DESK_STATES).toEqual(['escalated', 'no_signal', 'waiting', 'working', 'idle']);
  });

  it('writes "No signal since HH.MM" from the state word', () => {
    expect(noSignalSinceText('16.02')).toBe('No signal since 16.02');
  });

  it('lists the chain groups in chain order, ending with not placed', () => {
    expect([...CHAIN_GROUPS]).toEqual([
      'Raw-material extraction',
      'Basic industry',
      'Processing industry',
      'Distribution',
      'Sales channels',
      'End users',
      'Spanning layers — Energy',
      'Spanning layers — Logistics',
      'Not placed on the chain yet',
    ]);
  });

  it('labels every decline rule as a placeholder (FX-14) and gives it a one-line explanation', () => {
    for (const rule of Object.values(DECLINE_RULES)) {
      expect(rule.label.endsWith('(placeholder)')).toBe(true);
      expect(rule.explanation.length).toBeGreaterThan(10);
      expect(rule.explanation).not.toMatch(/\n/);
    }
  });

  it('writes the workpaper note in one place', () => {
    expect(workpaperNoteText('6 Oct 2026')).toBe('Owner instruction, 6 Oct 2026');
  });
});
