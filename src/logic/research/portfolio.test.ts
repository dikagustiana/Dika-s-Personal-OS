import { describe, expect, it } from 'vitest';
import type { FactLibraryEntry, Project, ResearchItem, ResearchProject } from '../../data/types';
import { gatesFor } from './templates';
import {
  LIBRARY_PULL_NOTE,
  itemFromLibrary,
  librarySweepCandidates,
  sharedPending,
  valueConflicts,
} from './portfolio';

function research(title: string, items: Array<Partial<ResearchItem>>): ResearchProject {
  return {
    project: {
      id: title,
      domain: 'growth',
      title,
      type: 'research',
      status: 'active',
      milestones: [],
      order: 1,
    } as Project,
    meta: { projectId: title, template: 'min', question: '', output: '', audience: '', gates: gatesFor('min') },
    items: items.map((over, index) => ({
      id: `${title}-${index}`,
      projectId: title,
      name: 'x',
      unit: '',
      type: 'parameter',
      crit: false,
      status: 'IND',
      value: '',
      source: '',
      asof: '',
      note: '',
      order: index,
      ...over,
    })) as ResearchItem[],
    claims: [],
    cycles: [],
    log: [],
  };
}

describe('value conflicts across projects', () => {
  it('fires on the same name with different non-empty values in two projects', () => {
    const conflicts = valueConflicts([
      research('One', [{ name: 'Discount rate', value: '7.5', source: 'A', asof: '2024' }]),
      research('Two', [{ name: 'Discount rate', value: '9.0', source: 'B', asof: '2023' }]),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].name).toBe('Discount rate');
    expect(conflicts[0].values.map((v) => v.value).sort()).toEqual(['7.5', '9.0']);
    // Each side keeps its provenance, which is what makes the conflict resolvable.
    expect(conflicts[0].values.map((v) => v.projectTitle).sort()).toEqual(['One', 'Two']);
    expect(conflicts[0].values.every((v) => v.source.length > 0)).toBe(true);
  });

  it('matches on a normalised name, so spacing and case do not hide a conflict', () => {
    const conflicts = valueConflicts([
      research('One', [{ name: 'Discount Rate', value: '7.5' }]),
      research('Two', [{ name: '  discount rate ', value: '9.0' }]),
    ]);
    expect(conflicts).toHaveLength(1);
  });

  it('does not fire when the projects agree', () => {
    expect(
      valueConflicts([
        research('One', [{ name: 'Rate', value: '7.5' }]),
        research('Two', [{ name: 'Rate', value: '7.5' }]),
      ]),
    ).toHaveLength(0);
  });

  it('does not treat an unfilled value as a disagreement', () => {
    expect(
      valueConflicts([
        research('One', [{ name: 'Rate', value: '7.5' }]),
        research('Two', [{ name: 'Rate', value: '' }]),
      ]),
    ).toHaveLength(0);
  });
});

describe('shared pending work', () => {
  it('groups an IND item wanted by several projects and lists them', () => {
    const shared = sharedPending([
      research('One', [{ name: 'Capacity factor', crit: false }]),
      research('Two', [{ name: 'capacity factor', crit: true }]),
      research('Three', [{ name: 'Something else' }]),
    ]);
    const multi = shared.find((row) => row.projects.length > 1);
    expect(multi?.projects.sort()).toEqual(['One', 'Two']);
    // Critical anywhere makes the shared row critical, and sorts it first.
    expect(multi?.crit).toBe(true);
    expect(shared[0]).toBe(multi);
  });

  it('ignores items that are already verified', () => {
    const shared = sharedPending([
      research('One', [{ name: 'Rate', status: 'V' }]),
      research('Two', [{ name: 'Rate', status: 'V' }]),
    ]);
    expect(shared).toHaveLength(0);
  });
});

describe('fact library', () => {
  const fact: FactLibraryEntry = {
    id: 'f1',
    name: 'Discount rate',
    unit: '%',
    value: '7.5',
    source: 'Publisher A',
    asof: '2024',
    fromProject: 'One',
  };

  it('a pulled item arrives verified but carries the definition-check note', () => {
    const pulled = itemFromLibrary(fact, 'Two', 0);
    expect(pulled.status).toBe('V');
    expect(pulled.note).toContain(LIBRARY_PULL_NOTE);
    // The safeguard is the note: the same figure can be right in one project
    // and wrong in another because the definition differs.
    expect(pulled.note).toContain('definisinya harus dicek ulang');
    expect(pulled.note).toContain('One');
    expect(pulled.value).toBe('7.5');
  });

  it('the sweep takes every verified item once, skipping name-duplicates', () => {
    const candidates = librarySweepCandidates(
      [
        research('One', [
          { name: 'Rate', status: 'V', value: '7.5' },
          { name: 'Other', status: 'V', value: '1' },
          { name: 'Pending', status: 'IND' },
        ]),
        research('Two', [{ name: 'rate', status: 'V', value: '9.0' }]),
      ],
      [],
    );
    expect(candidates.map((c) => c.name).sort()).toEqual(['Other', 'Rate']);
    expect(candidates.every((c) => c.fromProject.length > 0)).toBe(true);
  });

  it('skips facts already in the library, matching on the normalised name', () => {
    const candidates = librarySweepCandidates(
      [
        research('One', [
          { name: 'discount RATE', status: 'V', value: '7.5' }, // already in the library
          { name: 'Genuinely new', status: 'V', value: '3' },
        ]),
      ],
      [fact],
    );
    expect(candidates.map((c) => c.name)).toEqual(['Genuinely new']);
  });
});
