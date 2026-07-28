import { describe, expect, it } from 'vitest';
import type { CellState, FinishLineAccount } from '../data/types';
import {
  CONTRADICTION_NOUN,
  contradictionNoun,
  stateClauses,
  stateContradictsAccounts,
  STATE_SENTENCE,
} from './finishLine';
import { distinctFieldValues } from './finishLineAccounts';

// ===========================================================================
// ENTIRELY SYNTHETIC. No real account name, driver, owner or entity appears
// here — the owner's chart of accounts is internal and this repo is public.
// ===========================================================================

const IMPORTED = '2026-07-28T09:00:00.000Z';

function account(over: Partial<FinishLineAccount> & { accountName: string }): FinishLineAccount {
  return {
    id: `acc-${over.accountName}`,
    isDummy: false,
    order: 0,
    importedAt: IMPORTED,
    ...over,
  };
}

const ALL_STATES: CellState[] = ['figure', 'input', 'zero', 'undefined', 'locked'];

describe('the state sentences are the one definition of what a state means', () => {
  it('gives every state a sentence — a state with no explanation is jargon', () => {
    for (const state of ALL_STATES) {
      expect(STATE_SENTENCE[state], state).toBeTruthy();
    }
  });

  /**
   * Byte-for-byte. These are the sentences a reader sees on the cell panel and
   * on the matrix tooltip, and both read this same map — so a change here is a
   * change in both places, which is the whole point of the map existing.
   */
  it('states them exactly', () => {
    expect(STATE_SENTENCE.figure).toBe('Angka tersedia — sumbernya jelas dan bisa dipercaya.');
    expect(STATE_SENTENCE.input).toBe(
      'In progress — work is under way. Angkanya belum bisa dipercaya sampai sumbernya selesai.',
    );
    expect(STATE_SENTENCE.zero).toBe(
      'Nol yang benar — bisnis ini tidak punya baris itu, bukan datanya hilang.',
    );
    expect(STATE_SENTENCE.undefined).toBe(
      'Belum terdefinisi — belum diputuskan apakah baris ini berlaku di sini.',
    );
    expect(STATE_SENTENCE.locked).toBe(
      'Terkunci — menunggu keputusan atau input di luar kendali kita.',
    );
  });

  /**
   * THE LOAD-BEARING DISTINCTION. A correct zero is FINISHED; an undefined cell
   * has NOT BEEN STARTED. They look alike in a matrix and mean opposite things,
   * so the two sentences must stay recognisably different — softening one into
   * the other would quietly merge "done" with "not begun".
   */
  it('keeps zero and undefined apart', () => {
    expect(STATE_SENTENCE.zero).not.toBe(STATE_SENTENCE.undefined);
    expect(STATE_SENTENCE.zero).toContain('tidak punya baris itu');
    expect(STATE_SENTENCE.undefined).toContain('belum diputuskan');
  });

  it('splits each sentence into a label and a consequence without a second copy', () => {
    for (const state of ALL_STATES) {
      const { label, consequence } = stateClauses(state);
      expect(label.length, state).toBeGreaterThan(0);
      expect(consequence.length, state).toBeGreaterThan(0);
      // Reassembling must give the original back — proof the split invented
      // nothing and dropped nothing.
      expect(`${label} — ${consequence}`).toBe(STATE_SENTENCE[state]);
    }
  });

  it('splits only on the FIRST em dash, so a consequence may contain one', () => {
    expect(stateClauses('input')).toEqual({
      label: 'In progress',
      consequence: 'work is under way. Angkanya belum bisa dipercaya sampai sumbernya selesai.',
    });
  });
});

describe('a state that contradicts its own accounts', () => {
  it('fires for the three states that assert there is nothing behind them', () => {
    for (const state of ['zero', 'undefined', 'locked'] as CellState[]) {
      expect(stateContradictsAccounts(state, 1), state).toBe(true);
      expect(stateContradictsAccounts(state, 7), state).toBe(true);
    }
  });

  it('does not fire on a figure or an input cell, however many accounts it has', () => {
    expect(stateContradictsAccounts('figure', 7)).toBe(false);
    expect(stateContradictsAccounts('input', 7)).toBe(false);
    expect(contradictionNoun('figure')).toBeUndefined();
    expect(contradictionNoun('input')).toBeUndefined();
  });

  it('does not fire when the cell genuinely has no accounts', () => {
    for (const state of ALL_STATES) {
      expect(stateContradictsAccounts(state, 0), state).toBe(false);
    }
  });

  it('names the state accusingly, so the line reads "Ditandai nol"', () => {
    expect(contradictionNoun('zero')).toBe('nol');
    expect(CONTRADICTION_NOUN.undefined).toBe('belum terdefinisi');
    expect(CONTRADICTION_NOUN.locked).toBe('terkunci');
  });
});

describe('a cell whose accounts disagree shows every value, never the first', () => {
  /**
   * The real shape this defends against: two mapping rows can point at one
   * metric, so one cell holds accounts on genuinely different drivers. Showing
   * `accounts[0].driverType` would assert a single driver the cell does not
   * have — picked by sort order, and wrong for the rest.
   */
  const disagreeing = [
    account({ accountName: 'One', driverType: 'Driver A', pic: 'Team A', dataIdeal: 'Ideal A' }),
    account({ accountName: 'Two', driverType: 'Driver A', pic: 'Team A', dataIdeal: 'Ideal A' }),
    account({ accountName: 'Three', driverType: 'Driver B', pic: 'Team B', dataIdeal: 'Ideal A' }),
  ];

  it('returns both drivers, in the accounts own order', () => {
    expect(distinctFieldValues(disagreeing, 'driverType')).toEqual(['Driver A', 'Driver B']);
    expect(distinctFieldValues(disagreeing, 'pic')).toEqual(['Team A', 'Team B']);
  });

  it('collapses to one value when they genuinely agree', () => {
    expect(distinctFieldValues(disagreeing, 'dataIdeal')).toEqual(['Ideal A']);
  });

  it('drops blank and whitespace-only values rather than showing a nameless option', () => {
    const withGaps = [
      account({ accountName: 'A', driverType: 'Driver A' }),
      account({ accountName: 'B' }),
      account({ accountName: 'C', driverType: '   ' }),
    ];
    expect(distinctFieldValues(withGaps, 'driverType')).toEqual(['Driver A']);
  });

  it('returns nothing for a cell with no accounts, rather than inventing a value', () => {
    expect(distinctFieldValues([], 'driverType')).toEqual([]);
  });

  it('keeps every distinct value when there are more than two', () => {
    const many = ['A', 'B', 'C', 'D'].map((n) =>
      account({ accountName: n, driverType: `Driver ${n}` }),
    );
    expect(distinctFieldValues(many, 'driverType')).toHaveLength(4);
  });
});
