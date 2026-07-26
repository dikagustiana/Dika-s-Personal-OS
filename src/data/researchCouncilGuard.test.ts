/**
 * §9 — the guardrail, tested at the MUTATION PATH rather than the UI.
 *
 * A chairman verdict is a confident, well-structured synthesis with a
 * recommendation and a first step. It sounds authoritative, which is exactly
 * what makes it the output most likely to be treated as settled. These tests
 * exist so that "the council cannot record a cycle" is a property of the code
 * rather than a promise in a comment — a UI test would only prove there is no
 * button today.
 */
import { describe, expect, it } from 'vitest';
import { MockResearchRepository } from './researchRepository';
import { guardHumanOnly, guardNewClaim, guardNewItem, guardItemPatch } from './researchGuards';

const repo = () => new MockResearchRepository();

describe('the council cannot reach the register', () => {
  it('exposes no update or delete for council sessions', () => {
    const instance = repo() as unknown as Record<string, unknown>;
    // Absent, not merely unimplemented — same family as cycles and log.
    expect(instance.updateCouncilSession).toBeUndefined();
    expect(instance.deleteCouncilSession).toBeUndefined();
    expect(instance.updateCycle).toBeUndefined();
    expect(instance.deleteCycle).toBeUndefined();
    expect(instance.updateLogEntry).toBeUndefined();
    expect(instance.deleteLogEntry).toBeUndefined();
  });

  it('refuses a model-origin cycle, which is the route a verdict would take', async () => {
    // Recording a cycle, choosing clean vs rework, and picking the rollback
    // stage are the author's decisions. If a verdict could write one, the
    // apparatus would be recording the model's judgement as the author's.
    await expect(
      repo().appendCycle(
        {
          projectId: 'p',
          loop: 'method',
          n: 1,
          date: '2026-07-26',
          verdict: 'rework',
          findings: 'the council said so',
          itemCount: 0,
          citeCount: 0,
          invalidated: 0,
          backLabel: '',
        },
        'model',
      ),
    ).rejects.toThrow();
  });

  it('refuses a model-origin gate tick', async () => {
    await expect(repo().setGates('p', [[true]], 'model')).rejects.toThrow();
  });

  it('refuses a model-origin decision-log entry', async () => {
    await expect(
      repo().appendLog({ projectId: 'p', date: '2026-07-26', text: 'verdict says ship' }, 'model'),
    ).rejects.toThrow();
  });

  it('cannot set an item to V from a model write, however it is phrased', () => {
    expect(() => guardItemPatch({ status: 'V' }, 'model')).toThrow();
    expect(() => guardItemPatch({ status: 'NA' }, 'model')).toThrow();
    // Smuggled alongside fields a model IS allowed to fill.
    expect(() => guardItemPatch({ value: '42', status: 'V' }, 'model')).toThrow();
    // And a newly created item arrives IND even when it asks for V.
    expect(guardNewItem({ status: 'V', crit: false } as never, 'model').status).toBe('IND');
  });

  it('cannot create a layer (a) or (b) claim from a model write', () => {
    expect(() => guardNewClaim({ layer: 'a' } as never, 'model')).toThrow();
    expect(() => guardNewClaim({ layer: 'b' } as never, 'model')).toThrow();
    // Layer (c) is allowed — that is what a verdict is.
    expect(() => guardNewClaim({ layer: 'c' } as never, 'model')).not.toThrow();
  });

  it('still permits the author to do all of it by hand', async () => {
    const instance = repo();
    await instance.upsertMeta({
      projectId: 'p',
      template: 'min',
      question: '',
      output: '',
      audience: '',
      gates: [[false]],
    });
    await expect(instance.setGates('p', [[true]], 'human')).resolves.toBeTruthy();
    expect(() => guardHumanOnly('human', 'anything')).not.toThrow();
    expect(() => guardItemPatch({ status: 'V' }, 'human')).not.toThrow();
    expect(() => guardNewClaim({ layer: 'b' } as never, 'human')).not.toThrow();
  });
});

describe('council transcripts persist append-only', () => {
  it('appends and lists, and a scope session persists with no project', async () => {
    const instance = repo();
    await instance.appendCouncilSession({
      projectId: null,
      mode: 'scope',
      inputSnapshot: 'framed question',
      advisorsConfig: [],
      advisorResponses: [],
      peerReviews: [],
      verdict: null,
    });
    const rows = await instance.listCouncilSessions({ mode: 'scope' });
    expect(rows).toHaveLength(1);
    expect(rows[0].projectId).toBeNull();
    // A chairman that failed leaves a transcript worth keeping.
    expect(rows[0].verdict).toBeNull();
  });

  it('scopes history by project when one is given', async () => {
    const instance = repo();
    const base = {
      mode: 'method',
      inputSnapshot: '',
      advisorsConfig: [],
      advisorResponses: [],
      peerReviews: [],
      verdict: null,
    };
    await instance.appendCouncilSession({ ...base, projectId: 'p1' });
    await instance.appendCouncilSession({ ...base, projectId: 'p2' });
    expect(await instance.listCouncilSessions({ projectId: 'p1' })).toHaveLength(1);
    expect(await instance.listCouncilSessions({})).toHaveLength(2);
  });
});
