/**
 * What the synthetic office's panels say (liveView.ts), against the mock's
 * own run: the approval lock, the gate lines, the summary card, the plan
 * card's chain position, the industries groups.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../data/fsreTransport/contract';
import { MockTransport } from '../../../data/fsreTransport/mockTransport';
import { createInitialLiveState, mergeAgents, reduceAgentEvent, type LiveState } from './liveReducer';
import { approvalLock, chainPositionText, gateLine, industriesGroups, industriesTopLine, summaryCard } from './liveView';
import { CHAIN_GROUPS } from './statuses';

const transports: MockTransport[] = [];
afterEach(() => transports.splice(0).forEach((t) => t.dispose()));

/** Runs the mock's script for `minutes` simulated minutes, folding every event. */
async function run(minutes: number): Promise<{ transport: MockTransport; state: LiveState }> {
  const transport = new MockTransport();
  transports.push(transport);
  let state = mergeAgents(createInitialLiveState([]), await transport.listAgents());
  transport.subscribeEvents((e: AgentEvent) => {
    state = reduceAgentEvent(state, e);
  });
  for (let m = 0; m < minutes * 60; m += 1) {
    transport.clock.advanceMs(1000);
    transport.flush();
  }
  return { transport, state };
}

describe('the summary card', () => {
  it('sums facts loaded over both companies and names the engagement its gates speak for', async () => {
    const { transport, state } = await run(2);
    const card = summaryCard(state, await transport.listEngagements(), null);
    expect(card.factsLoaded).toBe(18356);
    expect(card.focus?.plan.tickers).toEqual(['SYNA', 'SYNB']);
    expect(card.gates.map((g) => g.label)).toEqual(['Gate 1 · SYNA + SYNB', 'Gate 2 · SYNA + SYNB', 'Gate 3 · SYNA + SYNB']);
  });

  it('counts the real open escalations on a gate, never one by default', async () => {
    const { transport, state } = await run(14);
    const card = summaryCard(state, await transport.listEngagements(), null);
    const [, g2] = card.gates;
    expect(g2.status).toBe('passed_with_open_escalations');
    expect(g2.open).toBe(1);
    expect(card.escalationsOpen).toBe(1);
  });
});

describe('the partner room', () => {
  it('locks approval while the escalation is open, and says why', async () => {
    const { transport, state } = await run(14);
    const [cement] = await transport.listEngagements();
    expect(approvalLock(state, cement)).toBe('Locked: 1 escalation open on SYNA. Resolve it first.');
    expect(gateLine(state, cement, 'SYNA')).toContain('G2 Passed, 1 escalation open');
    expect(gateLine(state, cement, 'SYNB')).toBe('SYNB: G1 Passed · G2 Passed · G3 Passed');
  });

  it('locks approval while a gate is still pending, naming the gate from the stage list', async () => {
    const { transport, state } = await run(1);
    const [cement] = await transport.listEngagements();
    expect(approvalLock(state, cement)).toMatch(/^Locked: Gate 1 on SYNA is Pending\.$/);
  });
});

describe('the plan card and the industries board', () => {
  it('names the chain position by its group, never "9 of 8", or says it is not placed', async () => {
    const transport = new MockTransport();
    transports.push(transport);
    const progress = await transport.getIndustryProgress();
    expect(chainPositionText('chain-2', 'SYN-CEM', progress)).toBe('Basic industry · chain position 2');
    expect(chainPositionText('chain-9', 'SYN-LOG', progress)).toBe('Spanning layers — Logistics · chain position 9');
    expect(chainPositionText(null, 'SYN-AUT', progress)).toBe('Not placed on the chain yet');
  });

  it('never counts fewer escalations on the board’s top line than its own rows show (review R2)', async () => {
    const transport = new MockTransport();
    transports.push(transport);
    const progress = await transport.getIndustryProgress();
    const inRows = progress.flatMap((row) => row.companies).reduce((n, c) => n + c.escalationsOpen, 0);
    expect(inRows).toBeGreaterThan(0);
    expect(industriesTopLine(progress, await transport.listEngagements(), createInitialLiveState([])).escalationsOpen).toBe(inRows);
  });

  it('groups the board by chain group in chain order, leaving empty groups out', async () => {
    const transport = new MockTransport();
    transports.push(transport);
    const groups = industriesGroups(await transport.getIndustryProgress()).map((g) => g.group);
    const order = groups.map((g) => CHAIN_GROUPS.indexOf(g));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(groups.length).toBeGreaterThan(0);
  });
});
