// The client-side fast failure in front of the database boundary. These
// tests pin the same NULL-vacuity rule the SQL suite pins: an internal agent
// with no provider, a dangling provider id and a wrong provider all refuse.
import { describe, expect, it } from 'vitest';
import { guardAgentWrite, LabBoundaryGuardError, providerBlockedReason } from './labGuards';
import type { LabAgentWrite, LabProvider } from './labTypes';

const providers: LabProvider[] = [
  {
    id: 'p-anthropic',
    name: 'anthropic',
    adapter: 'anthropic',
    baseUrl: '',
    model: 'm',
    costInPerMtok: 3,
    costOutPerMtok: 15,
    isActive: true,
  },
  {
    id: 'p-deepseek',
    name: 'deepseek',
    adapter: 'openai',
    baseUrl: '',
    model: 'm',
    costInPerMtok: 0.27,
    costOutPerMtok: 1.1,
    isActive: true,
  },
];

function write(partial: Partial<LabAgentWrite>): LabAgentWrite {
  return {
    slug: 't-agent',
    name: 'T',
    description: '',
    systemPrompt: 'p',
    dataClass: 'public',
    defaultProviderId: null,
    ...partial,
  };
}

describe('guardAgentWrite', () => {
  it('refuses an internal agent pointed at DeepSeek', () => {
    expect(() =>
      guardAgentWrite(write({ dataClass: 'internal', defaultProviderId: 'p-deepseek' }), providers),
    ).toThrow(LabBoundaryGuardError);
  });

  it('refuses an internal agent with no provider — NULL cannot satisfy the boundary', () => {
    expect(() =>
      guardAgentWrite(write({ dataClass: 'internal', defaultProviderId: null }), providers),
    ).toThrow(LabBoundaryGuardError);
  });

  it('refuses an internal agent whose provider id resolves to nothing', () => {
    expect(() =>
      guardAgentWrite(write({ dataClass: 'internal', defaultProviderId: 'p-ghost' }), providers),
    ).toThrow(LabBoundaryGuardError);
  });

  it('passes an internal agent on Anthropic, and any public agent, unchanged', () => {
    const internal = write({ dataClass: 'internal', defaultProviderId: 'p-anthropic' });
    expect(guardAgentWrite(internal, providers)).toBe(internal);
    const publicAgent = write({ dataClass: 'public', defaultProviderId: 'p-deepseek' });
    expect(guardAgentWrite(publicAgent, providers)).toBe(publicAgent);
    const publicNull = write({ dataClass: 'public', defaultProviderId: null });
    expect(guardAgentWrite(publicNull, providers)).toBe(publicNull);
  });
});

describe('providerBlockedReason', () => {
  it('blocks non-Anthropic providers for internal agents, with the stated reason', () => {
    expect(providerBlockedReason('internal', providers[1])).toContain('Anthropic only');
    expect(providerBlockedReason('internal', providers[0])).toBeNull();
  });

  it('blocks nothing for public agents', () => {
    expect(providerBlockedReason('public', providers[1])).toBeNull();
  });
});
