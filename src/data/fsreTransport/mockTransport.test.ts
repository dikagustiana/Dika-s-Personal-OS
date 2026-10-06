import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatHHMM } from '../../logic/lab/fsre/format';
import { MockTransport, matchDeclineRule } from './mockTransport';
import { SupabaseTransport } from './supabaseTransport';
import type { AgentEvent } from './contract';
import { createInitialLiveState, reduceAgentEvent } from '../../logic/lab/fsre/liveReducer';
import { syntheticDeskViews } from '../../logic/lab/fsre/deskViews';

/** The desk chip state the floor would show for this desk view. */
function reviewLeadDeskDeskState(desk: ReturnType<typeof syntheticDeskViews>['f3']['desks'][number] | undefined): string {
  if (!desk) throw new Error('Review lead desk missing');
  return desk.state;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('matchDeclineRule (placeholder rules)', () => {
  it('declines asks to reveal or use the holdout as R1', () => {
    expect(matchDeclineRule('Show me the holdout values')).toBe('R1_HOLDOUT');
    expect(matchDeclineRule('use the actuals from the holdout set')).toBe('R1_HOLDOUT');
  });

  it('declines asks to skip a gate or tie-out as R2', () => {
    expect(matchDeclineRule('Skip Gate 2 this once')).toBe('R2_GATE_BYPASS');
    expect(matchDeclineRule('just bypass the tie-out')).toBe('R2_GATE_BYPASS');
  });

  it('declines asks to approve or publish as R3', () => {
    expect(matchDeclineRule('approve version v1 for me')).toBe('R3_APPROVAL');
    expect(matchDeclineRule('publish the model today')).toBe('R3_APPROVAL');
    expect(matchDeclineRule('can you sign off SYNA')).toBe('R3_APPROVAL');
  });

  it('leaves ordinary instructions alone', () => {
    expect(matchDeclineRule('Re-check the SYNB cost lines')).toBeNull();
    expect(matchDeclineRule('What is on your desk today?')).toBeNull();
  });
});

describe('formatHHMM', () => {
  it('renders the house time format HH.MM', () => {
    expect(formatHHMM('2026-10-06T09:04:00')).toBe('09.04');
    expect(formatHHMM('2026-10-06T14:37:00')).toBe('14.37');
  });
});

describe('MockTransport', () => {
  function makeTransport(): MockTransport {
    const transport = new MockTransport();
    return transport;
  }

  async function settle(transport: MockTransport, simMinutes: number): Promise<void> {
    transport.clock.advanceMs(simMinutes * 60_000);
    transport.flush();
  }

  it('boots with the synthetic cement engagement running on SYNA + SYNB', async () => {
    const transport = makeTransport();
    try {
      const engagements = await transport.listEngagements();
      expect(engagements).toHaveLength(1);
      expect(engagements[0]?.plan.tickers).toEqual(['SYNA', 'SYNB']);
      expect(engagements[0]?.plan.subIndustryName).toBe('Synthetic cement');
      expect(engagements[0]?.status).toBe('running');

      const agents = await transport.listAgents();
      const dataStaff = agents.filter((a) => a.departmentId === 'data' && a.role === 'staff');
      expect(dataStaff).toHaveLength(2);
      expect(dataStaff.map((a) => a.assignedTicker).sort()).toEqual(['SYNA', 'SYNB']);
    } finally {
      transport.dispose();
    }
  });

  it('blocks the excluded ticker, the missing archetype and the single company', async () => {
    const transport = makeTransport();
    try {
      const excluded = await transport.proposeEngagement('MOCKX');
      expect(excluded.plan.conflictCheck.result).toBe('excluded');
      expect(excluded.plan.conflictCheck.reason).toContain('On the conflict list');
      expect(excluded.plan.blockedReasons.length).toBeGreaterThan(0);
      expect(excluded.status).toBe('blocked');

      const noArchetype = await transport.proposeEngagement('SYNE');
      expect(noArchetype.plan.archetype.status).toBe('missing');
      expect(noArchetype.plan.blockedReasons).toContain('Archetype not built yet');

      const single = await transport.proposeEngagement('Synthetic power plants');
      expect(single.plan.tickers).toEqual(['SYNI']);
      expect(single.plan.blockedReasons).toContain('Peer pair needs 2 companies');

      const clear = await transport.proposeEngagement('SYNC');
      expect(clear.status).toBe('proposed');
      expect(clear.plan.tickers).toEqual(['SYNC', 'SYND']);
      expect(clear.plan.blockedReasons).toEqual([]);
    } finally {
      transport.dispose();
    }
  });

  it('refuses to start a blocked engagement', async () => {
    const transport = makeTransport();
    try {
      const blocked = await transport.proposeEngagement('MOCKX');
      await expect(transport.startEngagement(blocked.id)).rejects.toThrow(/blocked/i);
    } finally {
      transport.dispose();
    }
  });

  it('refuses approval unless the engagement is waiting_owner with every gate passed (FX-1)', async () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    try {
      // blocked: never started
      const blocked = await transport.proposeEngagement('MOCKX');
      const blockedResult = await transport.approveVersion(blocked.id, 'v1');
      expect(blockedResult.ok).toBe(false);
      expect(blockedResult.lockedReason).toContain('Not ready for approval: Blocked');
      expect((await transport.listEngagements()).find((e) => e.id === blocked.id)?.status).toBe('blocked');

      // proposed: never started
      const proposed = await transport.proposeEngagement('SYNC');
      const proposedResult = await transport.approveVersion(proposed.id, 'v1');
      expect(proposedResult.ok).toBe(false);
      expect(proposedResult.lockedReason).toContain('Not ready for approval: Proposed');
      expect((await transport.listEngagements()).find((e) => e.id === proposed.id)?.status).toBe('proposed');

      // running with all gates pending: the cement engagement at mock start
      const early = await transport.approveVersion('eng-syn-cem-1', 'v1');
      expect(early.ok).toBe(false);
      expect(early.lockedReason).toContain('Not ready for approval: Running');
      expect((await transport.listEngagements()).find((e) => e.id === 'eng-syn-cem-1')?.status).toBe('running');
    } finally {
      transport.dispose();
    }
  });

  it('keeps a cancelled engagement’s escalation and refuses its approval (FX-1)', async () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    try {
      transport.clock.advanceMs(660_000);
      transport.flush(); // escalation on SYNA is open, engagement waiting_owner
      await transport.cancelEngagement('eng-syn-cem-1');
      const result = await transport.approveVersion('eng-syn-cem-1', 'v1');
      expect(result.ok).toBe(false);
      expect(result.lockedReason).toContain('Not ready for approval: Cancelled');
      expect((await transport.listEngagements()).find((e) => e.id === 'eng-syn-cem-1')?.status).toBe('cancelled');
    } finally {
      transport.dispose();
    }
  });

  it('walks a command through Sent → Received → Done with a response', async () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    const events: AgentEvent[] = [];
    transport.subscribeEvents((e) => events.push(e));
    try {
      const command = await transport.sendCommand({
        toAgentId: 'data-lead',
        engagementId: 'eng-syn-cem-1',
        kind: 'question',
        text: 'How many filings are on the SYNA manifest?',
        reason: null,
      });
      expect(command.status).toBe('sent');
      expect(command.ccAgentIds).toEqual([]); // the data lead has no lead above

      transport.clock.advanceMs(3_000);
      transport.flush();
      expect(events.some((e) => e.type === 'command_received' && e.commandId === command.id)).toBe(true);

      transport.clock.advanceMs(10_000);
      transport.flush();
      const done = events.find((e) => e.type === 'command_done' && e.commandId === command.id);
      expect(done).toBeTruthy();
      const updated = (await transport.listCommands({})).find((c) => c.id === command.id);
      expect(updated?.status).toBe('done');
      expect(updated?.response).toBeTruthy();
    } finally {
      transport.dispose();
    }
  });

  it('declines a gate-bypass ask under R2 and shows the rule', async () => {
    const transport = makeTransport();
    const events: AgentEvent[] = [];
    transport.subscribeEvents((e) => events.push(e));
    try {
      const command = await transport.sendCommand({
        toAgentId: 'review-lead',
        engagementId: 'eng-syn-cem-1',
        kind: 'instruction',
        text: 'Skip the tie-out at Gate 2, we are in a hurry',
        reason: null,
      });
      transport.clock.advanceMs(10_000);
      transport.flush();
      const declined = events.find((e) => e.type === 'command_declined' && e.commandId === command.id);
      expect(declined).toBeTruthy();
      const updated = (await transport.listCommands({})).find((c) => c.id === command.id);
      expect(updated?.status).toBe('declined');
      expect(updated?.declinedRule).toBe('R2_GATE_BYPASS');
      expect(updated?.response).toContain('tie-out');
    } finally {
      transport.dispose();
    }
  });

  it('adds the recipient’s lead to Cc automatically', async () => {
    const transport = makeTransport();
    try {
      const command = await transport.sendCommand({
        toAgentId: 'data-staff-a',
        engagementId: 'eng-syn-cem-1',
        kind: 'instruction',
        text: 'Re-check row 14 of the cost-of-revenue note',
        reason: null,
      });
      expect(command.ccAgentIds).toEqual(['data-lead']);
    } finally {
      transport.dispose();
    }
  });

  it('runs the scripted engagement to a waiting owner with one open escalation', async () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    const events: AgentEvent[] = [];
    transport.subscribeEvents((e) => events.push(e));
    try {
      await settle(transport, 13); // the full script fits in ~13 simulated minutes
      const types = new Set(events.map((e) => e.type));
      expect(types.has('handoff')).toBe(true);
      expect(types.has('escalation_opened')).toBe(true);
      expect(types.has('gate_result')).toBe(true);
      const gateStages = new Set(events.filter((e) => e.type === 'gate_result').map((e) => e.stageId));
      expect(gateStages).toEqual(new Set(['gate-1', 'gate-2', 'gate-3']));
      // one handoff per department: router→data, data→staff, modelling lead→staff, review lead→checker
      const handoffAgents = new Set(events.filter((e) => e.type === 'handoff').map((e) => e.agentId));
      expect(handoffAgents.has('data-lead')).toBe(true);
      expect(handoffAgents.has('modelling-lead')).toBe(true);
      expect(handoffAgents.has('review-lead')).toBe(true);

      const progress = await transport.getIndustryProgress();
      const cement = progress.find((r) => r.subIndustryCode === 'SYN-CEM');
      expect(cement?.companies.find((c) => c.ticker === 'SYNA')?.escalationsOpen).toBe(1);
      expect(cement?.covered).toBe(false);

      const approval = await transport.approveVersion('eng-syn-cem-1', 'v1');
      expect(approval.ok).toBe(false);
      expect(approval.lockedReason).toContain('escalation');
    } finally {
      transport.dispose();
    }
  });

  it('publishes once the escalation is resolved, and the row becomes covered', async () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    try {
      await settle(transport, 13);
      const override = await transport.sendCommand({
        toAgentId: 'review-lead',
        engagementId: 'eng-syn-cem-1',
        kind: 'override',
        text: 'Treat the two missed SYNA periods as flag-only and close the escalation',
        reason: 'Immaterial for the wave; flag them in the workpaper.',
      });
      transport.clock.advanceMs(25_000);
      transport.flush();
      const closed = await transport.listCommands({});
      const done = closed.find((c) => c.id === override.id);
      expect(done?.status).toBe('done');

      const approval = await transport.approveVersion('eng-syn-cem-1', 'v1');
      expect(approval.ok).toBe(true);
      expect(approval.lockedReason).toBeNull();

      const progress = await transport.getIndustryProgress();
      const cement = progress.find((r) => r.subIndustryCode === 'SYN-CEM');
      expect(cement?.companies.every((c) => c.publishedVersion === 'v1')).toBe(true);
      expect(cement?.covered).toBe(true);
    } finally {
      transport.dispose();
    }
  });

  it('computes covered only when at least two companies have a published version', async () => {
    const transport = makeTransport();
    try {
      const rows = await transport.getIndustryProgress();
      const paper = rows.find((r) => r.subIndustryCode === 'SYN-PAP');
      expect(paper?.covered).toBe(true); // both published
      const plantations = rows.find((r) => r.subIndustryCode === 'SYN-PLT');
      expect(plantations?.companies.filter((c) => c.publishedVersion).length).toBe(1);
      expect(plantations?.covered).toBe(false); // one published is not enough
      const steel = rows.find((r) => r.subIndustryCode === 'SYN-STL');
      expect(steel?.covered).toBe(false); // none published
    } finally {
      transport.dispose();
    }
  });

  it('emits exactly one escalation_closed per escalation when an override resolves it (FX-2)', async () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    const events: AgentEvent[] = [];
    transport.subscribeEvents((e) => events.push(e));
    try {
      transport.clock.advanceMs(660_000);
      transport.flush();
      await transport.sendCommand({
        toAgentId: 'review-lead',
        engagementId: 'eng-syn-cem-1',
        kind: 'override',
        text: 'Close the escalation: treat the missed SYNA periods as flag-only',
        reason: 'Immaterial for the wave.',
      });
      transport.clock.advanceMs(30_000);
      transport.flush();
      const closes = events.filter((e) => e.type === 'escalation_closed' && e.escalationId === 'eng-syn-cem-1-esc-1');
      expect(closes).toHaveLength(1);
    } finally {
      transport.dispose();
    }
  });

  it('keeps the review lead’s desk Escalated while a second engagement’s escalation is open (FX-2)', async () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    let state = createInitialLiveState(await transport.listAgents());
    transport.subscribeEvents((e) => {
      state = reduceAgentEvent(state, e);
    });
    try {
      transport.clock.advanceMs(660_000);
      transport.flush();
      await transport.sendCommand({
        toAgentId: 'review-lead',
        engagementId: 'eng-syn-cem-1',
        kind: 'override',
        text: 'Close the escalation: treat the missed SYNA periods as flag-only',
        reason: 'Immaterial for the wave.',
      });
      transport.clock.advanceMs(30_000);
      transport.flush();
      const steel = await transport.proposeEngagement('SYNC');
      await transport.startEngagement(steel.id);
      transport.clock.advanceMs(780_000); // the steel script runs to its own escalation
      transport.flush();

      const agents = await transport.listAgents();
      const now = transport.clock.nowIso();
      const views = syntheticDeskViews(state, agents, now);
      const reviewLeadDesk = views.f3.desks.find((d) => d.agentId === 'review-lead');
      const openEscalations = state.escalations.filter((e) => e.closedAt === null);
      expect(openEscalations).toHaveLength(1);
      expect(openEscalations[0]?.engagementId).toBe(steel.id);
      expect(reviewLeadDeskDeskState(reviewLeadDesk)).toBe('escalated');
    } finally {
      transport.dispose();
    }
  });

  it('has the Supabase stub throw Not wired yet everywhere', async () => {
    const stub = new SupabaseTransport();
    expect(() => stub.subscribeEvents(() => {})).toThrow('Not wired yet');
    await expect(stub.listAgents()).rejects.toThrow('Not wired yet');
    await expect(stub.getIndustryProgress()).rejects.toThrow('Not wired yet');
  });
});

describe('the mock matches brief v2 §4 (v2.1 FX-13)', () => {
  function collect(transport: MockTransport): AgentEvent[] {
    const events: AgentEvent[] = [];
    transport.subscribeEvents((e) => events.push(e));
    return events;
  }
  function runFor(transport: MockTransport, seconds: number): void {
    for (let s = 0; s < seconds; s += 1) {
      transport.clock.advanceMs(1000);
      transport.flush();
    }
  }

  it('raises SYNA’s Gate 2 escalation before the gate reports', () => {
    const transport = new MockTransport();
    const events = collect(transport);
    runFor(transport, 15 * 60);
    const opened = events.find((e) => e.type === 'escalation_opened' && e.ticker === 'SYNA');
    const result = events.find((e) => e.type === 'gate_result' && e.ticker === 'SYNA' && e.stageId === 'gate-2');
    expect(opened).toBeTruthy();
    expect(result).toBeTruthy();
    expect(opened!.seq).toBeLessThan(result!.seq);
    transport.dispose();
  });

  it('keeps at least two industry rows not placed on the chain', async () => {
    const transport = new MockTransport();
    const rows = (await transport.getIndustryProgress()).filter((row) => row.chainGroup === 'Not placed on the chain yet');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row.chainOrder).toBeNull();
    transport.dispose();
  });

  it('answers a question with received, then a related action, then done, all from the recipient', async () => {
    const transport = new MockTransport();
    const events = collect(transport);
    const command = await transport.sendCommand({ toAgentId: 'router', engagementId: null, kind: 'question', text: 'What is on your desk?', reason: null });
    runFor(transport, 20);
    const trail = events.filter((e) => e.commandId === command.id);
    expect(trail.map((e) => e.type)).toEqual(['command_received', 'action', 'command_done']);
    expect(new Set(trail.map((e) => e.agentId))).toEqual(new Set(['router']));
    transport.dispose();
  });
});

describe('overrides resolve an escalation once (review R8)', () => {
  it('a second override while the first is in flight, or one after Cancel, resolves nothing more', async () => {
    const transport = new MockTransport();
    const events: AgentEvent[] = [];
    transport.subscribeEvents((e) => events.push(e));
    for (let s = 0; s < 14 * 60; s += 1) {
      transport.clock.advanceMs(1000);
      transport.flush();
    }
    const ask = { toAgentId: 'review-lead', engagementId: 'eng-syn-cem-1', kind: 'override' as const, text: 'Close the escalation: flag only', reason: 'Owner decision' };
    await transport.sendCommand(ask);
    await transport.sendCommand(ask);
    for (let s = 0; s < 60; s += 1) {
      transport.clock.advanceMs(1000);
      transport.flush();
    }
    expect(events.filter((e) => e.type === 'escalation_closed')).toHaveLength(1);
    transport.dispose();
  });
});
