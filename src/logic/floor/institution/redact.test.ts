// 3-C: internal agents render redacted by default.

import { describe, expect, it } from 'vitest';
import { MASK, redactFields, redactionNote, shouldRedact } from './redact';

const internal = { dataClass: 'internal' as const };
const publicLane = { dataClass: 'public' as const };
const fields = { title: 'KGR yield against standard', subtask: 'reading the 2024 series', outputPreview: 'Yield was 73,4%' };

describe('redaction', () => {
  it('redacts an internal agent by default', () => {
    expect(shouldRedact(internal, { reveal: false })).toBe(true);
    const masked = redactFields(internal, fields, { reveal: false });
    expect(masked.title).toBe(MASK);
    expect(masked.subtask).toBe(MASK);
    expect(masked.outputPreview).toBe(MASK);
  });

  it('never masks a public agent', () => {
    expect(shouldRedact(publicLane, { reveal: false })).toBe(false);
    expect(redactFields(publicLane, fields, { reveal: false })).toEqual(fields);
  });

  it('reveals when the director asks, and only then', () => {
    expect(redactFields(internal, fields, { reveal: true })).toEqual(fields);
  });

  it('keeps the shape, so a forgotten redaction shows up as readable text and not as a crash', () => {
    const masked = redactFields(internal, { title: 'x', subtask: 'y' }, { reveal: false });
    expect(Object.keys(masked).sort()).toEqual(['subtask', 'title']);
  });

  it('explains the mask rather than leaving a blank card', () => {
    expect(redactionNote(0)).toBe('');
    expect(redactionNote(1)).toContain('1 internal-lane agent:');
    expect(redactionNote(3)).toContain('screenshot');
  });
});
