/**
 * Tests the MUTATION PATH, not the UI. §8.5's rule is only worth anything if a
 * caller that bypasses the interface still cannot verify an item.
 */
import { describe, expect, it } from 'vitest';
import type { ResearchClaim, ResearchItem } from './types';
import {
  ResearchGuardError,
  guardHumanOnly,
  guardItemPatch,
  guardNewClaim,
  guardNewItem,
} from './researchGuards';

const newItem: Omit<ResearchItem, 'id'> = {
  projectId: 'p',
  name: 'Discount rate',
  unit: '%',
  type: 'parameter',
  crit: false,
  status: 'IND',
  value: '',
  source: '',
  asof: '',
  note: '',
  order: 0,
};

describe('status can never reach V except by a human register edit', () => {
  it('refuses a model patch that sets status to V', () => {
    expect(() => guardItemPatch({ status: 'V' }, 'model')).toThrow(ResearchGuardError);
  });

  it('refuses a model patch that sets status at all, not just to V', () => {
    expect(() => guardItemPatch({ status: 'NA' }, 'model')).toThrow(ResearchGuardError);
    expect(() => guardItemPatch({ status: 'IND' }, 'model')).toThrow(ResearchGuardError);
  });

  it('refuses a model patch that smuggles status alongside allowed fields', () => {
    expect(() =>
      guardItemPatch({ value: '7.5', source: 'A', status: 'V' }, 'model'),
    ).toThrow(/refused: status/);
  });

  it('allows a model to fill value, source, asof and note', () => {
    const patch = { value: '7.5', source: 'Publisher A', asof: '2024', note: 'pre-tax' };
    expect(guardItemPatch(patch, 'model')).toEqual(patch);
  });

  it('allows a human to set status to V — the only route that exists', () => {
    expect(guardItemPatch({ status: 'V' }, 'human')).toEqual({ status: 'V' });
  });

  it('forces a model-created item to arrive IND even when it asks for V', () => {
    const created = guardNewItem({ ...newItem, status: 'V' }, 'model');
    expect(created.status).toBe('IND');
  });

  it('refuses a model-created item marked critical', () => {
    expect(() => guardNewItem({ ...newItem, crit: true }, 'model')).toThrow(
      /cannot mark an item critical/,
    );
  });
});

describe('claim layers', () => {
  const claim: Omit<ResearchClaim, 'id'> = {
    projectId: 'p',
    text: 'A finding.',
    layer: 'c',
    ev: '',
    order: 0,
  };

  it('allows a model to create a layer (c) claim', () => {
    expect(guardNewClaim(claim, 'model').layer).toBe('c');
  });

  it('refuses a model claim at layer (a) or (b)', () => {
    expect(() => guardNewClaim({ ...claim, layer: 'b' }, 'model')).toThrow(/layer \(b\)/);
    expect(() => guardNewClaim({ ...claim, layer: 'a' }, 'model')).toThrow(/layer \(a\)/);
  });

  it('allows a human any layer', () => {
    expect(guardNewClaim({ ...claim, layer: 'a' }, 'human').layer).toBe('a');
  });
});

describe('gates, cycles and the decision log are human-only', () => {
  it('refuses model writes with a reason naming the surface', () => {
    expect(() => guardHumanOnly('model', 'A review cycle')).toThrow(
      /A review cycle is recorded by the owner alone/,
    );
    expect(() => guardHumanOnly('model', 'A gate')).toThrow(ResearchGuardError);
  });

  it('permits human writes', () => {
    expect(() => guardHumanOnly('human', 'A review cycle')).not.toThrow();
  });
});
