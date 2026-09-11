// Which tools an agent may call, and what happens at the lane boundary.
//
// B-4: an internal-lane agent gets the SAME tools, with an egress check on
// every outbound call. There is no "internal agents may not search" rule —
// inbound is safe — and no tool an internal agent is denied. What changes is
// that its outbound text is scanned, and a match blocks and logs.
//
// The public lane needs no scan: a public agent has no internal context, and
// buildContext() refuses to give it one, so there is nothing to leak. That
// refusal is here rather than at the call site because it is a rule, not an
// implementation detail.

import type { DataClass, ToolContext, ToolName } from './types.ts';

export interface OutboundText {
  /** Where in the request the text sits, for the block log. */
  field: 'query' | 'url' | 'body' | 'script';
  text: string;
}

export interface PolicyDecision {
  scanRequired: boolean;
  reason: string;
}

/** Tools that place caller-authored text in front of a third party. */
export const OUTBOUND_TOOLS: readonly ToolName[] = ['web_search', 'web_fetch', 'public_data', 'methodology_research'];

export function policyFor(context: ToolContext, tool: ToolName): PolicyDecision {
  if (!OUTBOUND_TOOLS.includes(tool)) {
    return { scanRequired: false, reason: 'the call does not leave the institution' };
  }
  if (context.agent.dataClass === 'internal') {
    return { scanRequired: true, reason: 'B-4: an internal-lane agent is scanned on every outbound call' };
  }
  if (context.internalContext.length > 0) {
    // Defence in depth: a public agent holding internal context is itself
    // the breach, and buildContext refuses to build one — but if a caller
    // ever hands one over, the scan runs rather than being skipped.
    return { scanRequired: true, reason: 'public agent carrying internal context — scanned, and the context itself is a bug' };
  }
  return { scanRequired: false, reason: 'public lane, no internal content in scope' };
}

export class ContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextError';
  }
}

/**
 * Assemble a tool context. The internal haystack is accepted only for an
 * internal-lane agent; handing internal strings to a public agent throws,
 * because the alternative is a public agent that quietly holds SAMB figures
 * and is not scanned for them.
 */
export function buildContext(input: {
  agent: { id: string; slug: string; dataClass: DataClass };
  brief: { id: string; dataClass: DataClass } | null;
  assignmentId?: string | null;
  runId?: string | null;
  internalContext?: readonly string[];
}): ToolContext {
  const internal = input.internalContext ?? [];
  if (internal.length > 0 && input.agent.dataClass !== 'internal') {
    throw new ContextError(
      `lane: ${input.agent.slug} is a public agent and was handed internal context. A public agent does not receive internal content — route this assignment to an internal-lane agent instead.`,
    );
  }
  if (input.brief?.dataClass === 'internal' && input.agent.dataClass !== 'internal') {
    throw new ContextError(
      `lane: brief ${input.brief.id} is internal and ${input.agent.slug} is a public agent. Per B-3 an agent authored inside the institution is public; promoting one to internal is the director's action.`,
    );
  }
  return {
    agent: input.agent,
    brief: input.brief,
    assignmentId: input.assignmentId ?? null,
    runId: input.runId ?? null,
    internalContext: internal,
  };
}
