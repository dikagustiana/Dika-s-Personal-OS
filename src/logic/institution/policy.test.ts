// B-4's scope rule and the lane refusal that keeps a public agent from ever
// holding internal content in the first place.

import { describe, expect, it } from 'vitest';
import {
  buildContext,
  ContextError,
  policyFor,
  OUTBOUND_TOOLS,
} from '../../../supabase/functions/_shared/institution/policy';

const internalAgent = { id: 'a1', slug: 'math-specialist', dataClass: 'internal' as const };
const publicAgent = { id: 'a2', slug: 'method-scout', dataClass: 'public' as const };

describe('buildContext', () => {
  it('gives an internal agent its internal haystack', () => {
    const context = buildContext({ agent: internalAgent, brief: { id: 'b1', dataClass: 'internal' }, internalContext: ['a figure'] });
    expect(context.internalContext).toEqual(['a figure']);
  });

  it('refuses to hand internal content to a public agent', () => {
    expect(() => buildContext({ agent: publicAgent, brief: null, internalContext: ['a figure'] })).toThrow(ContextError);
  });

  it('refuses to put a public agent on an internal brief, and says why', () => {
    expect(() => buildContext({ agent: publicAgent, brief: { id: 'b1', dataClass: 'internal' } }))
      .toThrow(/internal and method-scout is a public agent/);
  });

  it('lets a public agent work a public brief', () => {
    const context = buildContext({ agent: publicAgent, brief: { id: 'b2', dataClass: 'public' } });
    expect(context.internalContext).toEqual([]);
  });
});

describe('policyFor', () => {
  const internal = buildContext({ agent: internalAgent, brief: { id: 'b1', dataClass: 'internal' }, internalContext: ['x'] });
  const pub = buildContext({ agent: publicAgent, brief: { id: 'b2', dataClass: 'public' } });

  it('scans every outbound tool for an internal agent', () => {
    for (const tool of OUTBOUND_TOOLS) expect(policyFor(internal, tool).scanRequired).toBe(true);
  });

  it('does not scan an internal agent reading its own corpus', () => {
    expect(policyFor(internal, 'corpus_get').scanRequired).toBe(false);
    expect(policyFor(internal, 'execute').scanRequired).toBe(false);
  });

  it('does not scan a public agent, which has nothing to leak', () => {
    for (const tool of OUTBOUND_TOOLS) expect(policyFor(pub, tool).scanRequired).toBe(false);
  });

  it('gives an internal agent the same tools, not fewer', () => {
    // B-4 is a scan, not a denial: no tool is withheld from the internal lane.
    expect(OUTBOUND_TOOLS.every((tool) => policyFor(internal, tool).reason.includes('B-4'))).toBe(true);
  });
});
