// The dependency checker's contract, including THE ground truth from the lab
// brief: with the seeded registry, exactly financial-modeling,
// verify-financial-model, consolidation-reporting and deck-narrative-drafter
// are phantoms on first load. If this test needs changing, either an agent
// was added (fine — update the fixture) or the parser drifted (not fine).
import { describe, expect, it } from 'vitest';
import type { LabAgent, LabChain } from '../../data/labTypes';
import { extractSlugRefs, phantomReport } from './labDeps';

function agent(partial: Pick<LabAgent, 'id' | 'slug' | 'description'> & { systemPrompt?: string }): LabAgent {
  return {
    name: partial.slug,
    systemPrompt: partial.systemPrompt ?? '',
    dataClass: 'public',
    defaultProviderId: null,
    version: 1,
    isActive: true,
    createdAt: '2026-08-17T00:00:00Z',
    updatedAt: '2026-08-17T00:00:00Z',
    ...partial,
  };
}

// The seeded registry's reference structure, condensed: what each agent
// cites is what matters, not the prose around it.
const SEEDED: LabAgent[] = [
  agent({
    id: 'a1',
    slug: 'senior-finance-analyst',
    description:
      'Do NOT use it to build models (financial-modeling), re-check arithmetic (verify-financial-model), consolidate (consolidation-reporting), design SOPs (business-process-improvement), track execution (pmo-coordinator), or package slides (deck-narrative-drafter).',
  }),
  agent({
    id: 'a2',
    slug: 'business-process-improvement',
    description:
      'Not the finance judgment (senior-finance-analyst), models (financial-modeling), the TB (consolidation-reporting), tracking (pmo-coordinator), or decks (deck-narrative-drafter).',
  }),
  agent({
    id: 'a3',
    slug: 'pmo-coordinator',
    description:
      'Judgment is (senior-finance-analyst), process design is (business-process-improvement), models are (financial-modeling), close mechanics are (consolidation-reporting).',
  }),
  agent({
    id: 'a4',
    slug: 'ceo-briefing-deck',
    description: 'The house template belongs to (deck-narrative-drafter).',
  }),
];

describe('extractSlugRefs', () => {
  it('reads parenthesized and backticked slugs, unique and sorted', () => {
    expect(
      extractSlugRefs('use (financial-modeling) or `verify-financial-model`, then (financial-modeling) again'),
    ).toEqual(['financial-modeling', 'verify-financial-model']);
  });

  it('ignores hyphenated prose — a strict grammar is what keeps warnings meaningful', () => {
    // Real prose from the skill library that must NOT read as references.
    const prose =
      'cost-to-serve math, three-statement mechanics, a first-class value, (e.g. cost-to-serve analysis), month-end close';
    expect(extractSlugRefs(prose)).toEqual([]);
  });

  it('requires at least two segments — (analysis) is a word, not a slug', () => {
    expect(extractSlugRefs('(analysis) and `budget`')).toEqual([]);
  });
});

describe('phantomReport', () => {
  it('surfaces exactly the four ground-truth phantoms on the seeded registry', () => {
    const report = phantomReport(SEEDED, []);
    expect(report.all).toEqual([
      'consolidation-reporting',
      'deck-narrative-drafter',
      'financial-modeling',
      'verify-financial-model',
    ]);
  });

  it('does not flag references to agents that exist', () => {
    const report = phantomReport(SEEDED, []);
    for (const phantoms of Object.values(report.byAgentId)) {
      expect(phantoms).not.toContain('senior-finance-analyst');
      expect(phantoms).not.toContain('pmo-coordinator');
    }
  });

  it('attributes phantoms to the referencing card', () => {
    const report = phantomReport(SEEDED, []);
    expect(report.byAgentId['a4']).toEqual(['deck-narrative-drafter']);
    expect(report.byAgentId['a3']).toEqual(['consolidation-reporting', 'financial-modeling']);
  });

  it('checks chain steps against the registry directly, no parsing', () => {
    const chain: LabChain = {
      id: 'c1',
      name: 'x',
      description: '',
      steps: [
        { agentSlug: 'senior-finance-analyst', inputTemplate: '{{initial_input}}' },
        { agentSlug: 'financial-modeling', inputTemplate: '{{previous_output}}' },
      ],
      isActive: true,
    };
    const report = phantomReport(SEEDED, [chain]);
    expect(report.byChainId['c1']).toEqual(['financial-modeling']);
  });

  it('reports a clean registry as clean', () => {
    const clean = [agent({ id: 'z1', slug: 'solo-agent', description: 'stands alone' })];
    expect(phantomReport(clean, []).all).toEqual([]);
  });
});
