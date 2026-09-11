// =============================================================================
// THE MOCK FLOOR — a synthetic institution, behind a dev flag
// =============================================================================
//
// WHAT CHANGED FROM THE STANDALONE BUILD. This file used to be the roster
// of a mock Fastify server: twenty invented agents in four invented bays
// ("Engineering Bay", "Creative Bay"), cycling through invented tasks. That
// server is deleted (B-11) and those departments do not exist. What the
// floor needs instead is a way to be worked on when the institution has
// nothing running — an empty pipeline renders an empty building, and an
// empty building teaches you nothing about whether the building is right.
//
// So this produces a SNAPSHOT of the same shape the repository produces,
// with one agent in each state the floor can draw. It is reachable only
// with ?mock=1 and it never touches the database. Everything it emits is
// stamped `mock-` so a screenshot of it can never be mistaken for a run:
// the point of the floor is that every figure traces to a row, and a mock
// that is indistinguishable from the real thing destroys that.
import type {
  FloorAgentRow,
  FloorAssignmentRow,
  FloorReviewRow,
  FloorSnapshot,
} from '../institution/project';
import { FALLBACK_SPEC, type FloorSpec } from '../layout/campus';

/** Whether the caller asked for the synthetic institution. */
export function mockFloorRequested(search: string): boolean {
  return new URLSearchParams(search).get('mock') === '1';
}

/** Small deterministic PRNG so the mock is reproducible run to run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUS_CYCLE: FloorAssignmentRow['status'][] = [
  'working', 'peer_review', 'rework', 'accepted', 'submitted', 'failed', 'done',
];

/**
 * A synthetic institution with the fallback floorplan's departments, one
 * lead and every specialist seat per department, three seats deliberately
 * left unstaffed so the phantom desks are visible, and one assignment per
 * staffed agent walking the status cycle.
 */
export function mockSnapshot(spec: FloorSpec = FALLBACK_SPEC, seed = 7): FloorSnapshot {
  const random = mulberry32(seed);
  const agents: FloorAgentRow[] = [];
  const assignments: FloorAssignmentRow[] = [];
  const reviews: FloorReviewRow[] = [];
  const now = new Date('2026-01-01T09:00:00.000Z').getTime();
  let index = 0;

  for (const department of spec.departments) {
    agents.push({
      slug: `mock-${department.slug}-lead`,
      name: `${department.name} lead (mock)`,
      dataClass: random() > 0.75 ? 'internal' : 'public',
      departmentSlug: department.slug,
      role: 'lead',
      seatPurpose: `Leads ${department.name}`,
      staffed: true,
    });
    for (let seat = 0; seat < department.specialistSeats; seat += 1) {
      // Three seats stay empty on purpose: an institution that is fully
      // staffed in the mock never shows you what an unfilled seat looks like.
      const staffed = !(department.pipelineOrder % 3 === 0 && seat === 0);
      agents.push({
        slug: `mock-${department.slug}-${seat + 1}`,
        name: staffed ? `${department.name} specialist ${seat + 1} (mock)` : `mock-${department.slug}-${seat + 1}`,
        dataClass: 'public',
        departmentSlug: department.slug,
        role: 'specialist',
        seatPurpose: `Specialist seat ${seat + 1}, ${department.name}`,
        staffed,
      });
    }
  }

  for (const agent of agents) {
    if (!agent.staffed) continue;
    const status = STATUS_CYCLE[index % STATUS_CYCLE.length];
    const id = `mock-assign-${index}`;
    assignments.push({
      id,
      agentSlug: agent.slug,
      departmentSlug: agent.departmentSlug,
      kind: agent.role === 'lead' ? 'lead_intake' : 'specialist_work',
      status,
      round: 1,
      reworkCount: status === 'rework' ? 1 : 0,
      detail: { tokens: Math.trunc(random() * 40_000), produced: `mock work item ${index}` },
      updatedAt: new Date(now + index * 1000).toISOString(),
    });
    if (status === 'peer_review') {
      reviews.push({
        id: `mock-review-${index}`,
        kind: 'peer',
        reviewerAgentSlug: `mock-${agent.departmentSlug}-lead`,
        subjectAgentSlug: agent.slug,
        subjectAssignmentId: id,
        verdict: 'rework',
        round: 1,
        createdAt: new Date(now + index * 1000).toISOString(),
      });
    }
    index += 1;
  }

  return {
    briefId: 'mock-brief',
    briefStatus: 'running',
    weightClass: 'standard',
    routing: spec.departments.map((department) => department.slug),
    agents,
    assignments,
    reviews,
    submissions: [],
    debates: [],
    egress: [],
    proposals: [],
    corpusRecords: 0,
  };
}
