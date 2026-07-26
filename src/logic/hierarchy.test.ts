import { describe, expect, it } from 'vitest';
import type { Milestone, Project } from '../data/types';
import {
  ancestorIds,
  buildProjectTree,
  eligibleParents,
  entityTags,
  findNode,
  flattenNode,
  rollupMilestones,
} from './hierarchy';

function milestone(id: string, done: boolean): Milestone {
  return { id, text: id, done, status: done ? 'done' : 'not-started' };
}

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    domain: 'work',
    title: overrides.id,
    type: 'other',
    status: 'active',
    milestones: [],
    order: 1,
    ...overrides,
  };
}

describe('buildProjectTree', () => {
  it('nests children under their parent and leaves roots alone', () => {
    const tree = buildProjectTree([
      project({ id: 'parent' }),
      project({ id: 'child', parentId: 'parent' }),
      project({ id: 'loner' }),
    ]);
    expect(tree.map((node) => node.project.id)).toEqual(['parent', 'loner']);
    expect(tree[0].children.map((node) => node.project.id)).toEqual(['child']);
    expect(tree[0].children[0].depth).toBe(1);
  });

  it('promotes a project whose parent is not in the list', () => {
    const tree = buildProjectTree([project({ id: 'orphan', parentId: 'missing' })]);
    expect(tree.map((node) => node.project.id)).toEqual(['orphan']);
  });

  it('treats a self-parented project as a root', () => {
    const tree = buildProjectTree([project({ id: 'self', parentId: 'self' })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(0);
  });

  it('breaks a parent cycle instead of recursing forever', () => {
    const tree = buildProjectTree([
      project({ id: 'a', parentId: 'b' }),
      project({ id: 'b', parentId: 'a' }),
    ]);
    expect(tree.map((node) => node.project.id).sort()).toEqual(['a', 'b']);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it('loses no project, whatever the shape', () => {
    const projects = [
      project({ id: 'p' }),
      project({ id: 'c1', parentId: 'p' }),
      project({ id: 'c2', parentId: 'p' }),
      project({ id: 'g', parentId: 'c1' }),
      project({ id: 'x', parentId: 'nowhere' }),
    ];
    const seen = buildProjectTree(projects).flatMap(flattenNode);
    expect(seen).toHaveLength(projects.length);
  });
});

describe('rollupMilestones', () => {
  it('adds every descendant to the parent count', () => {
    const [node] = buildProjectTree([
      project({ id: 'p', milestones: [milestone('a', true), milestone('b', false)] }),
      project({ id: 'c', parentId: 'p', milestones: [milestone('c1', true)] }),
      project({ id: 'g', parentId: 'c', milestones: [milestone('g1', false)] }),
    ]);
    expect(rollupMilestones(node)).toEqual({
      ownDone: 1,
      ownTotal: 2,
      done: 2,
      total: 4,
      childCount: 2,
    });
  });

  it('gives an umbrella with no milestones of its own a real rollup, not a zero', () => {
    const [node] = buildProjectTree([
      project({ id: 'umbrella' }),
      project({ id: 'c1', parentId: 'umbrella', milestones: [milestone('a', true)] }),
      project({ id: 'c2', parentId: 'umbrella', milestones: [milestone('b', false)] }),
    ]);
    const rollup = rollupMilestones(node);
    expect(rollup.ownTotal).toBe(0);
    expect(rollup.done).toBe(1);
    expect(rollup.total).toBe(2);
  });

  it('reports own counts for a leaf project', () => {
    const [node] = buildProjectTree([
      project({ id: 'leaf', milestones: [milestone('a', true), milestone('b', true)] }),
    ]);
    expect(rollupMilestones(node)).toMatchObject({ done: 2, total: 2, childCount: 0 });
  });
});

describe('eligibleParents', () => {
  const projects = [
    project({ id: 'root' }),
    project({ id: 'child', parentId: 'root' }),
    project({ id: 'grandchild', parentId: 'child' }),
    project({ id: 'other' }),
    project({ id: 'growth', domain: 'growth' }),
  ];

  it('excludes the project itself and its descendants', () => {
    const options = eligibleParents(projects, projects[0]).map((item) => item.id);
    expect(options).toEqual(['other']);
  });

  it('excludes the other domain', () => {
    const options = eligibleParents(projects, projects[3]).map((item) => item.id);
    expect(options).not.toContain('growth');
  });
});

describe('entityTags', () => {
  it('returns distinct trimmed tags in alphabetical order', () => {
    expect(
      entityTags([
        project({ id: 'a', entityTag: 'NMG' }),
        project({ id: 'b', entityTag: 'BMG' }),
        project({ id: 'c', entityTag: 'NMG' }),
        project({ id: 'd', entityTag: '   ' }),
        project({ id: 'e' }),
      ]),
    ).toEqual(['BMG', 'NMG']);
  });
});

describe('findNode', () => {
  const tree = buildProjectTree([
    project({ id: 'root' }),
    project({ id: 'child', parentId: 'root' }),
    project({ id: 'grandchild', parentId: 'child' }),
  ]);

  it('finds a root', () => {
    expect(findNode(tree, 'root')?.project.id).toBe('root');
  });

  it('finds a project nested below the roots', () => {
    expect(findNode(tree, 'grandchild')?.depth).toBe(2);
  });

  it('is undefined for a project that is not there', () => {
    expect(findNode(tree, 'nope')).toBeUndefined();
  });
});

describe('ancestorIds', () => {
  const projects = [
    project({ id: 'root' }),
    project({ id: 'child', parentId: 'root' }),
    project({ id: 'grandchild', parentId: 'child' }),
  ];

  it('returns the whole chain, nearest parent first', () => {
    // A grandchild's card is only mounted when BOTH rows above it are open,
    // so a link to it has to expand the chain, not just the target.
    expect(ancestorIds(projects, 'grandchild')).toEqual(['child', 'root']);
  });

  it('is empty for a root', () => {
    expect(ancestorIds(projects, 'root')).toEqual([]);
  });

  it('is empty for an unknown id', () => {
    expect(ancestorIds(projects, 'nope')).toEqual([]);
  });

  it('stops at a missing parent rather than inventing one', () => {
    expect(ancestorIds([project({ id: 'orphan', parentId: 'gone' })], 'orphan')).toEqual([
      'gone',
    ]);
  });

  it('terminates on a parent cycle', () => {
    const looped = [
      project({ id: 'a', parentId: 'b' }),
      project({ id: 'b', parentId: 'a' }),
    ];
    expect(ancestorIds(looped, 'a')).toEqual(['b']);
  });
});
