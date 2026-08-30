// The wall between the two Lab lanes, asserted on the client side.
//
// The DATABASE is the boundary — supabase/tests/lab_public_lane.sql calls the
// triggers and asserts they refuse. These tests pin the MOCK's mirror of the
// same rules, because the mock is what every other test in this repo reasons
// against: a mock that permits what the database refuses would let a whole
// suite pass while describing a wall that is not there.
//
// Both halves are here on purpose:
//   * the freeze must REFUSE a lane change, in both directions;
//   * the lane must stay THIN — ordinary edits and public deletes must work.
// A guard that blocks too much is a different bug with the same symptom
// (an unusable lane), and only the second half catches it.
import { describe, expect, it } from 'vitest';
import { MockLabRepository } from './labRepository';
import type { LabAgentWrite, LabProvider } from './labTypes';

const providers: LabProvider[] = [
  {
    id: 'p-anthropic',
    name: 'anthropic',
    adapter: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'm',
    costInPerMtok: 3,
    costOutPerMtok: 15,
    isActive: true,
  },
  {
    id: 'p-kimi',
    name: 'kimi',
    adapter: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'm',
    costInPerMtok: 3,
    costOutPerMtok: 15,
    isActive: true,
  },
];

const publicWrite = (over: Partial<LabAgentWrite> = {}): LabAgentWrite => ({
  slug: 'ielts-essay-drafter',
  name: 'IELTS essay drafter',
  description: '',
  systemPrompt: 'Draft an IELTS Task 2 essay.',
  dataClass: 'public',
  defaultProviderId: 'p-kimi',
  ...over,
});

const internalWrite = (over: Partial<LabAgentWrite> = {}): LabAgentWrite => ({
  slug: 'samb-margin-analyst',
  name: 'SAMB margin analyst',
  description: '',
  systemPrompt: 'Analyse SAMB entity margins.',
  dataClass: 'internal',
  defaultProviderId: 'p-anthropic',
  ...over,
});

describe('data_class is frozen after insert', () => {
  it('refuses internal → public — the laundering vector', async () => {
    // The one that matters: an internal agent carries a prompt full of SAMB
    // context. Flipping it to public would let it be pointed at any provider.
    const repo = new MockLabRepository();
    const agent = await repo.createAgent(internalWrite(), providers);
    await expect(
      repo.updateAgent(
        agent.id,
        internalWrite({ dataClass: 'public', defaultProviderId: 'p-kimi' }),
        providers,
      ),
    ).rejects.toThrow(/frozen after insert/i);
  });

  it('refuses public → internal — promotion is not an edit either', async () => {
    const repo = new MockLabRepository();
    const agent = await repo.createAgent(publicWrite(), providers);
    await expect(
      repo.updateAgent(
        agent.id,
        publicWrite({ dataClass: 'internal', defaultProviderId: 'p-anthropic' }),
        providers,
      ),
    ).rejects.toThrow(/frozen after insert/i);
  });

  it('names both classes and the agent, so the refusal is actionable', async () => {
    const repo = new MockLabRepository();
    const agent = await repo.createAgent(publicWrite(), providers);
    await expect(
      repo.updateAgent(
        agent.id,
        publicWrite({ dataClass: 'internal', defaultProviderId: 'p-anthropic' }),
        providers,
      ),
    ).rejects.toThrow(/public → internal.*ielts-essay-drafter/i);
  });

  it('still allows an ordinary edit — the lane must stay thin', async () => {
    const repo = new MockLabRepository();
    const agent = await repo.createAgent(publicWrite(), providers);
    const updated = await repo.updateAgent(
      agent.id,
      publicWrite({ name: 'IELTS drafter v2', systemPrompt: 'Draft, band 8 target.' }),
      providers,
    );
    expect(updated.name).toBe('IELTS drafter v2');
    // A prompt edit is still a new version — the freeze must not disturb the
    // pre-existing versioning mirror.
    expect(updated.version).toBe(agent.version + 1);
  });
});

describe('delete is a public-lane privilege', () => {
  it('removes a public agent — the lane is disposable', async () => {
    const repo = new MockLabRepository();
    const agent = await repo.createAgent(publicWrite(), providers);
    const before = await repo.listAgents();
    await repo.deleteAgent(agent.id);
    const after = await repo.listAgents();
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(after.rows.length).toBe(before.rows.length - 1);
      expect(after.rows.find((a) => a.id === agent.id)).toBeUndefined();
    }
  });

  it('refuses to delete an internal agent', async () => {
    // Internal agents are cited by run rows and by sibling prompts; removing
    // one silently orphans that history.
    const repo = new MockLabRepository();
    const agent = await repo.createAgent(internalWrite(), providers);
    await expect(repo.deleteAgent(agent.id)).rejects.toThrow(/internal-lane/i);
  });

  it('leaves the internal agent in place after a refused delete', async () => {
    const repo = new MockLabRepository();
    const agent = await repo.createAgent(internalWrite(), providers);
    await expect(repo.deleteAgent(agent.id)).rejects.toThrow();
    const after = await repo.listAgents();
    expect(after.ok && after.rows.some((a) => a.id === agent.id)).toBe(true);
  });

  it('reports a missing agent rather than silently succeeding', async () => {
    const repo = new MockLabRepository();
    await expect(repo.deleteAgent('no-such-agent')).rejects.toThrow(/no agent/i);
  });
});

describe('chains are routes, not lanes', () => {
  it('deletes a chain without touching its agents', async () => {
    const repo = new MockLabRepository();
    const agent = await repo.createAgent(publicWrite(), providers);
    const chain = await repo.createChain({
      name: 'IELTS two-step',
      description: '',
      steps: [{ agentSlug: agent.slug, inputTemplate: '{{initial_input}}' }],
    });
    await repo.deleteChain(chain.id);
    const chains = await repo.listChains();
    const agents = await repo.listAgents();
    expect(chains.ok && chains.rows.some((c) => c.id === chain.id)).toBe(false);
    // The agent outlives the route that referenced it.
    expect(agents.ok && agents.rows.some((a) => a.id === agent.id)).toBe(true);
  });
});
