// =============================================================================
// REDACTION (3-C)
// =============================================================================
//
// The HUD renders work content on screen. For an agent in the INTERNAL lane
// that content is SAMB's own figures, and a screenshot leaks what the render
// itself does not: the person watching already has the right to see it, the
// photograph of their monitor does not carry that right with it.
//
// So an internal agent is redacted BY DEFAULT: name, state, token count and
// cost stay visible — they are what the floor is for — and the task title,
// the active subtask and any output preview are masked until the director
// toggles them. The toggle is per session and never persisted: a default
// that survives a reload is a default nobody re-decides.
//
// This is a display rule, not a boundary. The boundary is the data lane
// (labGuards, the trigger, B-4) and it does not depend on anything here.

export const MASK = '••••••••';

export interface RedactableAgent {
  dataClass: 'internal' | 'public';
}

export interface RedactableFields {
  title: string;
  subtask: string;
  outputPreview?: string;
}

export interface RedactionOptions {
  /** The director has asked to see internal content in this session. */
  reveal: boolean;
}

export function shouldRedact(agent: RedactableAgent, options: RedactionOptions): boolean {
  return agent.dataClass === 'internal' && !options.reveal;
}

/**
 * Mask the content fields of one agent's card. The shape is unchanged, so
 * nothing downstream has to know whether it is looking at redacted text —
 * and a bug that forgets to redact shows up as readable SAMB text in a
 * test, not as a missing field.
 */
export function redactFields(
  agent: RedactableAgent,
  fields: RedactableFields,
  options: RedactionOptions,
): RedactableFields {
  if (!shouldRedact(agent, options)) return fields;
  return {
    title: MASK,
    subtask: MASK,
    ...(fields.outputPreview === undefined ? {} : { outputPreview: MASK }),
  };
}

/** What the HUD says instead of the content, so the mask is explained. */
export function redactionNote(count: number): string {
  if (count === 0) return '';
  return `${count} internal-lane agent${count === 1 ? '' : 's'}: task content is hidden. A screenshot leaks what the render does not.`;
}
