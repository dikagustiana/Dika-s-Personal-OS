import { describe, expect, it } from 'vitest';
import {
  IELTS_ERROR_SKILLS,
  IELTS_ERROR_TAXONOMY,
  UNCLASSIFIED,
  findMode,
  isIeltsErrorSkill,
  isValidCriterion,
  isValidFailureMode,
  parseProposal,
} from './taxonomy';

describe('taxonomy shape', () => {
  it('covers all five skills, with writing split into two tasks', () => {
    expect([...IELTS_ERROR_SKILLS].sort()).toEqual([
      'listening',
      'reading',
      'speaking',
      'writing_task1',
      'writing_task2',
    ]);
  });

  it('holds the mode counts the spec fixes: 7 / 6 / 5 / 5 / 5', () => {
    expect(IELTS_ERROR_TAXONOMY.writing_task1.modes).toHaveLength(7);
    expect(IELTS_ERROR_TAXONOMY.writing_task2.modes).toHaveLength(6);
    expect(IELTS_ERROR_TAXONOMY.speaking.modes).toHaveLength(5);
    expect(IELTS_ERROR_TAXONOMY.listening.modes).toHaveLength(5);
    expect(IELTS_ERROR_TAXONOMY.reading.modes).toHaveLength(5);
  });

  it('gives every mode a rule and a check — the two remedies differ by class', () => {
    for (const skill of IELTS_ERROR_SKILLS) {
      for (const mode of IELTS_ERROR_TAXONOMY[skill].modes) {
        expect(mode.rule.length, `${skill}/${mode.mode} rule`).toBeGreaterThan(10);
        expect(mode.check.length, `${skill}/${mode.mode} check`).toBeGreaterThan(10);
      }
    }
  });

  it("anchors every mode's criterion inside its own skill's Layer 1", () => {
    for (const skill of IELTS_ERROR_SKILLS) {
      const taxonomy = IELTS_ERROR_TAXONOMY[skill];
      for (const mode of taxonomy.modes) {
        expect(taxonomy.criteria, `${skill}/${mode.mode}`).toContain(mode.criterion);
      }
    }
  });

  it('has no duplicate mode name within a skill', () => {
    for (const skill of IELTS_ERROR_SKILLS) {
      const names = IELTS_ERROR_TAXONOMY[skill].modes.map((mode) => mode.mode);
      expect(new Set(names).size, skill).toBe(names.length);
    }
  });

  it('keeps the four deliberately-repeated names identical across their two skills', () => {
    // Same definition, separate counts — that is the whole design.
    expect(findMode('writing_task1', 'function_word_slip')?.definition).toBe(
      findMode('writing_task2', 'function_word_slip')?.definition,
    );
    expect(findMode('listening', 'paraphrase_missed')).toBeDefined();
    expect(findMode('reading', 'paraphrase_missed')).toBeDefined();
    expect(findMode('listening', 'answer_form_error')).toBeDefined();
    expect(findMode('reading', 'answer_form_error')).toBeDefined();
  });

  it('gives listening and reading the pipeline Layer 1, not band descriptors', () => {
    expect(IELTS_ERROR_TAXONOMY.reading.criteria).toEqual([
      'comprehension',
      'location',
      'transfer',
      'timing',
    ]);
    expect(IELTS_ERROR_TAXONOMY.reading.criteria).not.toContain('Lexical Resource');
  });

  it('marks question_type as meaningful only for the receptive skills', () => {
    expect(IELTS_ERROR_TAXONOMY.listening.usesQuestionType).toBe(true);
    expect(IELTS_ERROR_TAXONOMY.reading.usesQuestionType).toBe(true);
    expect(IELTS_ERROR_TAXONOMY.writing_task1.usesQuestionType).toBe(false);
    expect(IELTS_ERROR_TAXONOMY.speaking.usesQuestionType).toBe(false);
  });

  it('carries no Coherence & Cohesion mode for writing_task1, on purpose', () => {
    const criteria = IELTS_ERROR_TAXONOMY.writing_task1.modes.map((mode) => mode.criterion);
    expect(criteria).not.toContain('Coherence & Cohesion');
    // The criterion itself stays in Layer 1 — it is part of writing's band set.
    expect(IELTS_ERROR_TAXONOMY.writing_task1.criteria).toContain('Coherence & Cohesion');
  });
});

describe('validation', () => {
  it('accepts a mode only under the skill that owns it', () => {
    expect(isValidFailureMode('reading', 'not_given_confusion')).toBe(true);
    expect(isValidFailureMode('writing_task1', 'not_given_confusion')).toBe(false);
  });

  it('lets UNCLASSIFIED pass for every skill — §6 depends on it', () => {
    for (const skill of IELTS_ERROR_SKILLS) {
      expect(isValidFailureMode(skill, UNCLASSIFIED), skill).toBe(true);
    }
  });

  it('rejects a translated, pluralised, or reworded name', () => {
    // A different string is a separate count, which is why this is enforced in
    // code and not in documentation.
    expect(isValidFailureMode('writing_task1', 'broken_clauses')).toBe(false);
    expect(isValidFailureMode('writing_task1', 'Broken_Clause')).toBe(false);
    expect(isValidFailureMode('writing_task1', 'klausa_rusak')).toBe(false);
    expect(isValidFailureMode('writing_task1', 'broken clause')).toBe(false);
  });

  it('rejects a writing criterion pasted against listening', () => {
    expect(isValidCriterion('writing_task1', 'Lexical Resource')).toBe(true);
    expect(isValidCriterion('listening', 'Lexical Resource')).toBe(false);
  });

  it('recognises exactly the five skill strings', () => {
    expect(isIeltsErrorSkill('writing_task1')).toBe(true);
    expect(isIeltsErrorSkill('writing')).toBe(false);
    expect(isIeltsErrorSkill('')).toBe(false);
  });
});

describe('parseProposal', () => {
  it('pulls the name and definition out of a PROPOSED note', () => {
    expect(parseProposal('PROPOSED: hedging_absent — klaim ditulis tanpa hedging')).toEqual({
      name: 'hedging_absent',
      definition: 'klaim ditulis tanpa hedging',
    });
  });

  it('accepts an en dash or a hyphen where the prompt asked for an em dash', () => {
    expect(parseProposal('PROPOSED: hedging_absent – tanpa hedging')?.name).toBe(
      'hedging_absent',
    );
    expect(parseProposal('PROPOSED: hedging_absent - tanpa hedging')?.name).toBe(
      'hedging_absent',
    );
  });

  it('keeps a name even when the model omitted the definition', () => {
    expect(parseProposal('PROPOSED: hedging_absent')).toEqual({
      name: 'hedging_absent',
      definition: '',
    });
  });

  it('keeps a hyphenated name intact — a bare hyphen is not a separator', () => {
    // Truncating at the hyphen merged distinct proposals under a fabricated
    // name, destroying the count that justifies promoting one.
    expect(parseProposal('PROPOSED: comma-splice_run_on — dua klausa digabung koma')).toEqual({
      name: 'comma-splice_run_on',
      definition: 'dua klausa digabung koma',
    });
    expect(parseProposal('PROPOSED: comma-splice_run_on - dua klausa digabung koma')?.name).toBe(
      'comma-splice_run_on',
    );
  });

  it('returns null for a note that proposes nothing', () => {
    expect(parseProposal('Kalimat ini kehilangan subjek.')).toBeNull();
    expect(parseProposal(undefined)).toBeNull();
  });
});
