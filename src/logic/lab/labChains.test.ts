import { describe, expect, it } from 'vitest';
import { chainIssues, interpolateTemplate, moveStep } from './labChains';
import type { LabChainStep } from '../../data/labTypes';

describe('interpolateTemplate', () => {
  it('fills both placeholders everywhere they appear', () => {
    const filled = interpolateTemplate(
      'Q: {{initial_input}}\nPrev: {{previous_output}}\nAgain: {{initial_input}}',
      { initialInput: 'the question', previousOutput: 'step one said' },
    );
    expect(filled).toBe('Q: the question\nPrev: step one said\nAgain: the question');
  });

  it('leaves an unknown placeholder visible instead of deleting it', () => {
    // A template typo must be readable in the run log's input column.
    expect(
      interpolateTemplate('{{initial_input}} and {{step_output}}', {
        initialInput: 'x',
        previousOutput: 'y',
      }),
    ).toBe('x and {{step_output}}');
  });
});

describe('chainIssues', () => {
  const known = new Set(['a-one', 'b-two']);

  it('is empty for a runnable chain', () => {
    const steps: LabChainStep[] = [
      { agentSlug: 'a-one', inputTemplate: '{{initial_input}}' },
      { agentSlug: 'b-two', inputTemplate: '{{previous_output}}' },
    ];
    expect(chainIssues(steps, known)).toEqual([]);
  });

  it('names the step and the missing agent', () => {
    const steps: LabChainStep[] = [{ agentSlug: 'c-three', inputTemplate: 'x' }];
    expect(chainIssues(steps, known)).toEqual(['Step 1 names c-three, which does not exist.']);
  });

  it('refuses an empty chain and an empty template', () => {
    expect(chainIssues([], known)).toEqual(['The chain has no steps.']);
    expect(chainIssues([{ agentSlug: 'a-one', inputTemplate: '  ' }], known)).toEqual([
      'Step 1 has an empty input template.',
    ]);
  });
});

describe('moveStep', () => {
  const steps: LabChainStep[] = [
    { agentSlug: 'a-one', inputTemplate: '1' },
    { agentSlug: 'b-two', inputTemplate: '2' },
    { agentSlug: 'c-three', inputTemplate: '3' },
  ];

  it('swaps neighbours and preserves the rest', () => {
    expect(moveStep(steps, 0, 1).map((step) => step.agentSlug)).toEqual([
      'b-two',
      'a-one',
      'c-three',
    ]);
  });

  it('is a no-op at the edges rather than wrapping', () => {
    expect(moveStep(steps, 0, -1).map((step) => step.agentSlug)).toEqual([
      'a-one',
      'b-two',
      'c-three',
    ]);
    expect(moveStep(steps, 2, 1).map((step) => step.agentSlug)).toEqual([
      'a-one',
      'b-two',
      'c-three',
    ]);
  });

  it('returns a new array — the editor state must not be mutated in place', () => {
    const result = moveStep(steps, 1, 1);
    expect(result).not.toBe(steps);
    expect(steps[1].agentSlug).toBe('b-two');
  });
});
