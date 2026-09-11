// The diff the director reads before installing a prompt.

import { describe, expect, it } from 'vitest';
import { promptDiff } from './promptDiff';

describe('promptDiff', () => {
  it('says so when nothing changed', () => {
    expect(promptDiff('a\nb', 'a\nb')).toBe('(no change)');
  });

  it('marks an added paragraph', () => {
    const diff = promptDiff('You draw the boundary.', 'You draw the boundary.\n\nAlways state a definitional break.');
    expect(diff).toContain('+Always state a definitional break.');
    expect(diff).toContain(' You draw the boundary.');
  });

  it('marks a removed line', () => {
    const diff = promptDiff('one\ntwo\nthree', 'one\nthree');
    expect(diff).toContain('-two');
    expect(diff).not.toContain('+');
  });

  it('shows a replacement as a removal and an addition', () => {
    const diff = promptDiff('rule: never widen scope', 'rule: never widen scope without saying so');
    expect(diff).toContain('-rule: never widen scope');
    expect(diff).toContain('+rule: never widen scope without saying so');
  });

  it('elides unchanged stretches rather than reprinting the prompt', () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n');
    const after = `${before}\nthe new rule`;
    const diff = promptDiff(before, after);
    expect(diff).toContain('@@');
    expect(diff.split('\n').length).toBeLessThan(10);
    expect(diff).toContain('+the new rule');
  });

  it('keeps context around a change so it can be placed', () => {
    const before = 'a\nb\nc\nd\ne';
    const diff = promptDiff(before, 'a\nb\nCHANGED\nd\ne', 1);
    expect(diff).toContain(' b');
    expect(diff).toContain('-c');
    expect(diff).toContain('+CHANGED');
    expect(diff).toContain(' d');
  });
});
