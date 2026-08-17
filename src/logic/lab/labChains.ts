/**
 * Chain mechanics, pure: template interpolation and the sequential plan.
 *
 * THE CLIENT SEQUENCES CHAIN STEPS — one executor call per step, the same
 * shape as the research council's one-stage-per-call, and for the same
 * reasons: an Edge Function has a wall clock, a multi-minute chain inside
 * one invocation gives the screen nothing to report but a spinner, and a
 * late failure must not destroy the paid-for steps before it. The executor
 * stamps chain_id/step_index/parent_run_id on each row; on the first error
 * the caller stops and has the executor mark the remaining steps error (no
 * retries in v1 — failures surface).
 */
import type { LabChainStep } from '../../data/labTypes';

/**
 * Fills a step's template. Both placeholders are replaced EVERYWHERE they
 * appear; an unknown {{placeholder}} is left visible in the input rather
 * than silently deleted — a template typo should be readable in the run
 * log's input column, not vanish.
 */
export function interpolateTemplate(
  template: string,
  values: { initialInput: string; previousOutput: string },
): string {
  return template
    .replaceAll('{{initial_input}}', values.initialInput)
    .replaceAll('{{previous_output}}', values.previousOutput);
}

/**
 * A chain that may run: at least one step, every step naming a known agent
 * slug and a non-empty template. Returns the reasons it may not, empty when
 * it may — the builder renders these beside the run button.
 */
export function chainIssues(
  steps: readonly LabChainStep[],
  knownSlugs: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  if (steps.length === 0) issues.push('The chain has no steps.');
  steps.forEach((step, index) => {
    if (!step.agentSlug) {
      issues.push(`Step ${index + 1} names no agent.`);
    } else if (!knownSlugs.has(step.agentSlug)) {
      issues.push(`Step ${index + 1} names ${step.agentSlug}, which does not exist.`);
    }
    if (!step.inputTemplate.trim()) {
      issues.push(`Step ${index + 1} has an empty input template.`);
    }
  });
  return issues;
}

/** Reorder helper for the linear editor: moves a step up or down one slot. */
export function moveStep(
  steps: readonly LabChainStep[],
  index: number,
  direction: -1 | 1,
): LabChainStep[] {
  const target = index + direction;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) {
    return [...steps];
  }
  const next = [...steps];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}
