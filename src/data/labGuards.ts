/**
 * The data boundary's client-side fast failure, on the mutation path rather
 * than in the UI — the same posture as researchGuards.ts.
 *
 * ===========================================================================
 * INTERNAL DATA REACHES ANTHROPIC MODELS ONLY.
 * ===========================================================================
 * The database trigger (20260817000074) is the boundary; the executor
 * re-validates before dispatch; the UI disables the selector. This module is
 * none of those — it is the failure that happens BEFORE a doomed request
 * leaves the browser, so the person editing an agent reads a sentence
 * instead of a PostgREST error, and so a future caller that forgets the UI
 * rule still cannot submit the write. A UI-only guard would be bypassed by
 * the first caller that forgot.
 *
 * NOTE WHAT IS ABSENT: no flag, no bypass argument, no dev mode. If a guard
 * here is in the way, the boundary is in the way, and that is a conversation
 * with the owner, not a parameter.
 */
import type { LabAgentWrite, LabProvider } from './labTypes';

export class LabBoundaryGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabBoundaryGuardError';
  }
}

/**
 * Refuses an agent write that would place internal data outside Anthropic.
 * Written exactly like the trigger: the provider must RESOLVE and be the
 * Anthropic row — a null id, a dangling id and a wrong provider all fail,
 * so a NULL cannot satisfy the boundary by vacuity.
 */
export function guardAgentWrite(
  input: LabAgentWrite,
  providers: readonly LabProvider[],
): LabAgentWrite {
  if (input.dataClass !== 'internal') return input;
  const resolved = providers.find((provider) => provider.id === input.defaultProviderId);
  if (!resolved || resolved.name !== 'anthropic') {
    throw new LabBoundaryGuardError(
      `Agent ${input.slug} is internal — its default provider must be Anthropic, and may not be empty. ` +
        'Internal SAMB data is processed by Anthropic models only.',
    );
  }
  return input;
}

/**
 * Whether a provider may be OFFERED for a run of this agent. The Run
 * screen's selector reads this; the executor and the trigger re-check it.
 * Null means "no restriction beyond the provider being active".
 */
export function providerBlockedReason(
  dataClass: 'internal' | 'public',
  provider: LabProvider,
): string | null {
  if (dataClass === 'internal' && provider.name !== 'anthropic') {
    return 'Internal data — Anthropic only. Enforced in the database, not just here.';
  }
  return null;
}
