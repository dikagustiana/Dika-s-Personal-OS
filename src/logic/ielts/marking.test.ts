import { describe, expect, it } from 'vitest';
import { IELTS_ERROR_SKILLS, IELTS_ERROR_TAXONOMY } from './taxonomy';
import { prIeltsMarking } from './marking';

describe('prIeltsMarking quotes the taxonomy constant, not a copy', () => {
  it('contains every mode name of the chosen skill, byte-identically', () => {
    for (const skill of IELTS_ERROR_SKILLS) {
      const prompt = prIeltsMarking(skill);
      for (const mode of IELTS_ERROR_TAXONOMY[skill].modes) {
        expect(prompt, `${skill}/${mode.mode}`).toContain(mode.mode);
        expect(prompt, `${skill}/${mode.mode} definition`).toContain(mode.definition);
      }
    }
  });

  it('contains every Layer 1 criterion of the chosen skill', () => {
    for (const skill of IELTS_ERROR_SKILLS) {
      const prompt = prIeltsMarking(skill);
      for (const criterion of IELTS_ERROR_TAXONOMY[skill].criteria) {
        expect(prompt, `${skill}/${criterion}`).toContain(criterion);
      }
    }
  });

  it('does not leak another skill\'s modes into the prompt', () => {
    const prompt = prIeltsMarking('writing_task1');
    expect(prompt).not.toContain('not_given_confusion');
    expect(prompt).not.toContain('inflection_dropped');
  });

  it('names the skill string the log rows must carry', () => {
    expect(prIeltsMarking('writing_task2')).toContain('skill       exactly: writing_task2');
  });
});

describe('the load-bearing Output 2 rules survive in the text', () => {
  const prompt = prIeltsMarking('writing_task1');

  it('demands one row per occurrence, not a merged count', () => {
    expect(prompt).toContain('ONE ROW PER DISTINCT OCCURRENCE');
    expect(prompt).toContain('THREE rows');
  });

  it('demands a verbatim quote and offers the [absent: …] escape', () => {
    expect(prompt).toContain('VERBATIM QUOTE');
    expect(prompt).toContain('[absent: what is missing]');
  });

  it('forbids inventing a mode and requires UNCLASSIFIED + PROPOSED instead', () => {
    expect(prompt).toContain('NEVER INVENT A failure_mode');
    expect(prompt).toContain('UNCLASSIFIED');
    expect(prompt).toContain('PROPOSED: <name> — <one-line definition>');
    expect(prompt).toContain('DO NOT force it');
  });

  it('asks for the note in Bahasa Indonesia, and the review too', () => {
    expect(prompt).toContain('One sentence, Bahasa');
    expect(prompt).toContain('Labels and commentary in Bahasa Indonesia');
  });

  it('specifies the six-field shape, the escape for a literal pipe, and no header', () => {
    expect(prompt).toContain('date | skill | criterion | failure_mode | quote | note');
    expect(prompt).toContain('must be written \\|');
    expect(prompt).toContain('NO header row');
  });

  it('asks for an empty block rather than padding when there is nothing to log', () => {
    expect(prompt).toContain('EMPTY fenced block');
    expect(prompt).toContain('not pad it with rows to look thorough');
  });

  it('tells the model the whole reply is pasted, so it must not strip the review', () => {
    expect(prompt).toContain('do not strip the review');
  });
});

describe('the receptive skills get their own Layer 1 explained', () => {
  it('warns listening and reading off the writing criteria', () => {
    const prompt = prIeltsMarking('listening');
    expect(prompt).toContain('no band descriptors');
    expect(prompt).toContain('POINT OF FAILURE');
    expect(prompt).toContain('comprehension — Did not understand the source');
  });

  it('offers question_type as a seventh field only where it is meaningful', () => {
    expect(prIeltsMarking('reading')).toContain('SEVENTH field');
    expect(prIeltsMarking('writing_task1')).not.toContain('SEVENTH field');
  });
});
