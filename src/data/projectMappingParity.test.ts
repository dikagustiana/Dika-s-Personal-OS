/**
 * PROJECT MAPPING PARITY — C2.PRECISE-PLACEHOLDER and C3.PROJECT-MAPPING-DRIFT.
 *
 * The in-memory repository stores a Project object as given; the Supabase
 * repository squeezes it through a hand-written row mapper on the way in and
 * another on the way out. Any field one mapper forgets silently diverges the
 * two, and because the mock is the boot default, every view looks right in
 * development while production drops the value. That is exactly how an
 * estimated deadline lost its `~` on reload: createProject never sent
 * date_confidence, so the row came back null and the date read as confirmed.
 *
 * The parity test runs the same create → read → patch → read sequence against
 * both implementations — the Supabase one through the real supabase-js query
 * builder over fakePostgrest, which rejects unknown columns like PostgREST
 * does — and asserts the objects are identical.
 */
import { describe, expect, it } from 'vitest';
import { createFakePostgrest, OS_PROJECTS } from './fakePostgrest';
import { MockRepository } from './mockRepository';
import type { Repository } from './repository';
import { createSupabaseRepositoryForClient } from './supabaseRepository';
import type { Project } from './types';
import { daysLeftLabelFor, formatDateFor } from '../logic/deadlines';

function freshSupabase() {
  const fake = createFakePostgrest({ os_projects: OS_PROJECTS });
  return { fake, repo: createSupabaseRepositoryForClient(fake.client) };
}

const RESEARCH_PARENT: Omit<Project, 'id'> = {
  domain: 'growth',
  engagement: 'internal',
  title: 'Research',
  type: 'research',
  status: 'active',
  milestones: [],
  order: 4,
  deadline: '2027-03-31',
  dateConfidence: 'estimated',
  priority: 2,
  wipLimit: 3,
  staleMonths: 9,
};

describe('createProject persists date confidence (audit probe: dropped date confidence)', () => {
  it('sends date_confidence and reads it back instead of dropping it', async () => {
    const { fake, repo } = freshSupabase();
    const created = await repo.createProject({
      domain: 'growth',
      engagement: 'internal',
      title: 'Unknown date',
      type: 'other',
      status: 'active',
      milestones: [],
      order: 1,
      deadline: '2026-11-30',
      dateConfidence: 'unknown',
    });
    const insert = fake.requests.find((r) => r.method === 'POST' && r.table === 'os_projects');
    expect(insert?.body).toHaveProperty('date_confidence', 'unknown');
    expect(created.dateConfidence).toBe('unknown');
  });

  it('renders an estimated date as ~ and an unknown one as TBC after a full reload', async () => {
    const { fake, repo } = freshSupabase();
    await repo.createProject({ ...RESEARCH_PARENT, title: 'Estimated' });
    await repo.createProject({ ...RESEARCH_PARENT, title: 'Unknown', dateConfidence: 'unknown' });

    // A full reload: a brand-new repository instance over the same database,
    // holding nothing the first one knew.
    const reloaded = createSupabaseRepositoryForClient(fake.client);
    const projects = await reloaded.listProjects('growth');
    const estimated = projects.find((p) => p.title === 'Estimated')!;
    const unknown = projects.find((p) => p.title === 'Unknown')!;

    expect(formatDateFor(estimated.deadline!, estimated.dateConfidence)).toMatch(/^~/);
    expect(daysLeftLabelFor(10, estimated.dateConfidence)).toMatch(/^~/);
    expect(formatDateFor(unknown.deadline!, unknown.dateConfidence)).toBe('TBC');
    expect(daysLeftLabelFor(10, unknown.dateConfidence)).toBe('TBC');
  });
});

describe('project mapping parity: mockRepository vs supabaseRepository', () => {
  // Same calls, same order, against both. Ids differ by construction (each
  // side mints its own), so they are stripped before the comparison.
  async function run(repo: Repository) {
    const withoutId = ({ id: _id, ...rest }: Project) => rest;
    const created = await repo.createProject(RESEARCH_PARENT);
    const readOne = await repo.getProject(created.id);
    const readAll = (await repo.listProjects('growth')).find((p) => p.id === created.id);
    const patched = await repo.updateProject(created.id, {
      priority: 1,
      wipLimit: undefined,
      staleMonths: 6,
      dateConfidence: 'confirmed',
    });
    const reread = await repo.getProject(created.id);
    return {
      created: withoutId(created),
      readOne: withoutId(readOne!),
      readAll: withoutId(readAll!),
      patched: withoutId(patched),
      reread: withoutId(reread!),
    };
  }

  it('create → read → patch → read yields identical objects on both implementations', async () => {
    const mock = await run(new MockRepository());
    const supabase = await run(freshSupabase().repo);
    expect(supabase).toEqual(mock);
  });

  it('round-trips priority, wipLimit and staleMonths through the Supabase mapper', async () => {
    const { fake, repo } = freshSupabase();
    const created = await repo.createProject(RESEARCH_PARENT);
    expect(created).toMatchObject({ priority: 2, wipLimit: 3, staleMonths: 9 });
    expect(fake.rows('os_projects')[0]).toMatchObject({
      priority: 2,
      wip_limit: 3,
      stale_months: 9,
      date_confidence: 'estimated',
    });

    const patched = await repo.updateProject(created.id, { wipLimit: undefined, priority: 5 });
    expect(patched.priority).toBe(5);
    expect(patched).not.toHaveProperty('wipLimit');
    expect(fake.rows('os_projects')[0]).toMatchObject({ priority: 5, wip_limit: null, stale_months: 9 });
  });

  it('leaves the optional columns out of an INSERT when the caller gave none', async () => {
    // The established rule for later columns: name them only when supplied,
    // so a create against a database that has not run the migration still
    // succeeds. A plain WORK project must not grow research columns.
    const { fake, repo } = freshSupabase();
    await repo.createProject({
      domain: 'work',
      engagement: 'internal',
      title: 'Plain',
      type: 'other',
      status: 'active',
      milestones: [],
      order: 1,
    });
    const insert = fake.requests.find((r) => r.method === 'POST')!.body as Record<string, unknown>;
    expect(insert).not.toHaveProperty('priority');
    expect(insert).not.toHaveProperty('wip_limit');
    expect(insert).not.toHaveProperty('stale_months');
    expect(insert).not.toHaveProperty('date_confidence');
  });
});
