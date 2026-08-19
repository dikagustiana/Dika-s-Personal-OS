// Every omission consequence is DERIVED from the gate that will actually
// refuse — this file pins the pairing. The lines quote the gate mirrors'
// own output on the minimal state the omission leaves behind, so a gate
// whose wording or logic changes drags its consequence line with it; these
// tests fail if the derivation ever decouples.
import { describe, expect, it } from 'vitest';
import { omittedConsequence } from './labFlowOmissions';

describe('gate-backed stations quote the refusing gate', () => {
  it('S5 (Verifikasi) — G-CLAIM refuses an approval standing on IND', () => {
    const line = omittedConsequence('S5');
    expect(line).toContain('dilewati');
    expect(line).toContain('klaim tidak akan bisa disetujui selama datapoint masih IND');
    expect(line).toContain('G-CLAIM');
    expect(line).toContain('not source-matched (IND)');
  });

  it('S1 (Rencana) — G-FALSIFY refuses finalize over an unsatisfied requirement', () => {
    const line = omittedConsequence('S1');
    expect(line).toContain('G-FALSIFY');
    expect(line).toContain('falsifier');
  });

  it('S3 (Locate) — G-EXTRACT still demands the locator on every datapoint', () => {
    const line = omittedConsequence('S3');
    expect(line).toContain('G-EXTRACT');
    expect(line).toContain('locator');
  });

  it('S4 (Extract) and S7 (Model) — G-NUMBER refuses the unbacked figure', () => {
    expect(omittedConsequence('S4')).toContain('G-NUMBER');
    expect(omittedConsequence('S7')).toContain('G-NUMBER');
    expect(omittedConsequence('S7')).toContain('[sim');
  });

  it('S6 (Ground) — G-CLAIM refuses abstract_only citations', () => {
    const line = omittedConsequence('S6');
    expect(line).toContain('abstract_only');
    expect(line).toContain('G-CLAIM');
  });

  it('S8 (Klaim) and S10 (Approve) — G-OUTPUT refuses unapproved citations', () => {
    expect(omittedConsequence('S8')).toContain('tidak ada klaim, jadi tidak ada output');
    expect(omittedConsequence('S8')).toContain('G-OUTPUT');
    expect(omittedConsequence('S10')).toContain('G-OUTPUT');
    expect(omittedConsequence('S10')).toContain('not approved');
  });
});

describe('gateless stations say so — inventing a gate would be the same lie inverted', () => {
  it('S0, S2, S9, S11 name the loss, not a phantom refusal', () => {
    for (const code of ['S0', 'S2', 'S9', 'S11']) {
      expect(omittedConsequence(code)).toContain('tidak ada gerbang yang menolak');
    }
  });

  it('S12 states the standing condition: the output simply never becomes final', () => {
    const line = omittedConsequence('S12');
    expect(line).toContain('draft');
    expect(line).toContain('final');
  });
});
