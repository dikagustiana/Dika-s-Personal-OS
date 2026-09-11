// The floor renders what the institution did, and nothing else.
//
// The test that matters most here is the LAST one: a state transition must
// originate in a row. The standalone build got that for free because the
// positioner ran server-side and held authority; moving it client-side is
// the most likely way this migration breaks the property the whole system
// rests on, and it would look completely correct on screen.

import { describe, expect, it } from 'vitest';
import {
  litDepartments,
  progressOf,
  projectAgents,
  projectMarkers,
  type FloorAgentRow,
  type FloorAssignmentRow,
  type FloorSnapshot,
} from './project';

const agent = (over: Partial<FloorAgentRow> & Pick<FloorAgentRow, 'slug'>): FloorAgentRow => ({
  name: over.slug,
  dataClass: 'public',
  departmentSlug: 'framing-office',
  role: 'specialist',
  seatPurpose: '',
  staffed: true,
  ...over,
});

const assignment = (over: Partial<FloorAssignmentRow> & Pick<FloorAssignmentRow, 'id' | 'agentSlug' | 'status'>): FloorAssignmentRow => ({
  departmentSlug: 'framing-office',
  kind: 'specialist_work',
  round: 1,
  reworkCount: 0,
  detail: {},
  updatedAt: '2026-09-11T10:00:00.000Z',
  ...over,
});

const snapshot = (over: Partial<FloorSnapshot> = {}): FloorSnapshot => ({
  briefId: 'b1',
  briefStatus: 'running',
  weightClass: 'standard',
  routing: ['framing-office', 'verification'],
  agents: [agent({ slug: 'scope-analyst' }), agent({ slug: 'assumption-auditor' })],
  assignments: [],
  reviews: [],
  submissions: [],
  debates: [],
  egress: [],
  proposals: [],
  corpusRecords: 0,
  ...over,
});

describe('projectAgents', () => {
  it('puts an agent with no assignment at idle, with no task id', () => {
    const events = projectAgents(snapshot());
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.state).toBe('idle');
      expect(event.taskId).toBeNull();
    }
  });

  it('places no avatar on an empty desk', () => {
    const events = projectAgents(snapshot({
      agents: [agent({ slug: 'financial-modeling', staffed: false }), agent({ slug: 'scope-analyst' })],
    }));
    expect(events.map((event) => event.agentId)).toEqual(['scope-analyst']);
  });

  it('shows an agent working when its assignment is open', () => {
    const events = projectAgents(snapshot({
      assignments: [assignment({ id: 'a1', agentSlug: 'scope-analyst', status: 'working' })],
    }));
    expect(events.find((event) => event.agentId === 'scope-analyst')?.state).toBe('working');
  });

  it('puts BOTH parties of an open review in the same collaboration group, and the group is the review id', () => {
    const events = projectAgents(snapshot({
      assignments: [assignment({ id: 'a1', agentSlug: 'scope-analyst', status: 'peer_review' })],
      reviews: [{
        id: 'review-77', kind: 'peer', reviewerAgentSlug: 'assumption-auditor',
        subjectAgentSlug: 'scope-analyst', subjectAssignmentId: 'a1', verdict: 'rework', round: 1,
        createdAt: '2026-09-11T10:01:00.000Z',
      }],
    }));
    for (const slug of ['scope-analyst', 'assumption-auditor']) {
      const event = events.find((entry) => entry.agentId === slug);
      expect(event?.state).toBe('collaborating');
      expect(event?.groupId).toBe('review-77');
    }
  });

  it('ends the collaboration when the review closes', () => {
    const events = projectAgents(snapshot({
      assignments: [assignment({ id: 'a1', agentSlug: 'scope-analyst', status: 'accepted' })],
      reviews: [{
        id: 'review-77', kind: 'peer', reviewerAgentSlug: 'assumption-auditor',
        subjectAgentSlug: 'scope-analyst', subjectAssignmentId: 'a1', verdict: 'accept', round: 1,
        createdAt: '2026-09-11T10:01:00.000Z',
      }],
    }));
    expect(events.every((event) => event.state !== 'collaborating')).toBe(true);
  });

  it('shows a blocked outbound call as a refusal at that desk, outranking the work state', () => {
    const events = projectAgents(snapshot({
      assignments: [assignment({ id: 'a1', agentSlug: 'scope-analyst', status: 'working' })],
      egress: [{ id: 'e1', agentSlug: 'scope-analyst', tool: 'web_search', createdAt: '2026-09-11T10:02:00.000Z' }],
    }));
    const event = events.find((entry) => entry.agentId === 'scope-analyst');
    expect(event?.state).toBe('error');
    expect(event?.title).toContain('B-4');
  });

  it('shows a lead carrying a submission as delivering', () => {
    const events = projectAgents(snapshot({
      agents: [agent({ slug: 'framing-lead', role: 'lead' })],
      assignments: [assignment({ id: 'a1', agentSlug: 'framing-lead', kind: 'lead_submit', status: 'working' })],
    }));
    expect(events[0].state).toBe('delivering');
  });

  it('shows a failed or escalated assignment as an error, never as progress', () => {
    for (const status of ['failed', 'refused', 'escalated'] as const) {
      const events = projectAgents(snapshot({
        assignments: [assignment({ id: 'a1', agentSlug: 'scope-analyst', status })],
      }));
      expect(events.find((event) => event.agentId === 'scope-analyst')?.state).toBe('error');
    }
  });

  it('gives each agent exactly one state', () => {
    const events = projectAgents(snapshot({
      assignments: [
        assignment({ id: 'a1', agentSlug: 'scope-analyst', status: 'accepted', updatedAt: '2026-09-11T10:00:00.000Z' }),
        assignment({ id: 'a2', agentSlug: 'scope-analyst', status: 'working', updatedAt: '2026-09-11T10:05:00.000Z' }),
      ],
    }));
    const mine = events.filter((event) => event.agentId === 'scope-analyst');
    expect(mine).toHaveLength(1);
    expect(mine[0].state).toBe('working'); // the later row wins
  });
});

describe('progress is an estimate', () => {
  it('rises with the stage the work has reached, and is never a measurement', () => {
    expect(progressOf(null)).toBe(0);
    const stages = (['assigned', 'working', 'peer_review', 'accepted', 'submitted', 'done'] as const).map((status) =>
      progressOf(assignment({ id: 'a', agentSlug: 'x', status })),
    );
    for (let i = 1; i < stages.length; i += 1) expect(stages[i]).toBeGreaterThan(stages[i - 1]);
  });

  it('reports nothing for work that failed', () => {
    expect(progressOf(assignment({ id: 'a', agentSlug: 'x', status: 'failed' }))).toBe(0);
  });
});

describe('projectMarkers', () => {
  it('carries a document from one lead to the next bay', () => {
    const markers = projectMarkers(snapshot({
      submissions: [{
        id: 's1', fromDepartmentSlug: 'framing-office', toDepartmentSlug: 'verification',
        toCommittee: false, accepted: true, returnCount: 0, createdAt: '2026-09-11T10:03:00.000Z',
      }],
    }));
    expect(markers[0]).toMatchObject({ kind: 'submission', from: 'framing-office', to: 'verification' });
  });

  it('carries it BACK when work went upstream, so rework is as visible as progress', () => {
    const markers = projectMarkers(snapshot({
      submissions: [{
        id: 's1', fromDepartmentSlug: 'framing-office', toDepartmentSlug: 'verification',
        toCommittee: false, accepted: true, returnCount: 1, createdAt: '2026-09-11T10:03:00.000Z',
      }],
    }));
    expect(markers.some((marker) => marker.kind === 'return' && marker.to === 'framing-office')).toBe(true);
  });

  it('fills a desk when a lead authored an agent', () => {
    const markers = projectMarkers(snapshot({
      assignments: [assignment({
        id: 'a1', agentSlug: 'discourse-analyst', kind: 'agent_authoring', status: 'done',
        detail: { authoredSlug: 'discourse-analyst' },
      })],
    }));
    expect(markers.some((marker) => marker.kind === 'desk-filled' && marker.label.includes('discourse-analyst'))).toBe(true);
  });

  it('sends a proposal to the director and says the agent still runs its old version', () => {
    const markers = projectMarkers(snapshot({
      proposals: [{ id: 'v1', agentSlug: 'scope-analyst', status: 'proposed', createdAt: '2026-09-11T10:04:00.000Z' }],
    }));
    const proposal = markers.find((marker) => marker.kind === 'proposal');
    expect(proposal?.to).toBe('director');
    expect(proposal?.label).toContain('still runs its current version');
  });

  it('marks a version change at the agent\'s desk once the director approved', () => {
    const markers = projectMarkers(snapshot({
      proposals: [{ id: 'v1', agentSlug: 'scope-analyst', status: 'active', createdAt: '2026-09-11T10:06:00.000Z' }],
    }));
    expect(markers.some((marker) => marker.kind === 'version-change' && marker.to === 'scope-analyst')).toBe(true);
  });

  it('carries both positions to the director when a debate ran out of rounds', () => {
    const markers = projectMarkers(snapshot({
      debates: [{ id: 'd1', rebuttingAgentSlug: 'framing-lead', outcome: 'rejected', round: 2 }],
    }));
    expect(markers.some((marker) => marker.kind === 'escalation' && marker.to === 'director')).toBe(true);
  });

  it('shows a blocked egress attempt rather than hiding it', () => {
    const markers = projectMarkers(snapshot({
      egress: [{ id: 'e1', agentSlug: 'math-specialist', tool: 'web_search', createdAt: '2026-09-11T10:07:00.000Z' }],
    }));
    expect(markers.some((marker) => marker.kind === 'egress-block')).toBe(true);
  });
});

describe('the weight class is visible at a glance', () => {
  it('lights only the departments the brief routes through', () => {
    const lit = litDepartments(snapshot({ routing: ['framing-office', 'verification'] }));
    expect(lit.has('framing-office')).toBe(true);
    expect(lit.has('editorial')).toBe(false);
  });
});

describe('the state-origin rule (3-C)', () => {
  /**
   * THE TEST THE MIGRATION EXISTS TO PASS.
   *
   * Every state the floor shows has to come from a row. This walks every
   * state the projector can emit and asserts that removing the rows removes
   * the state: with no assignments, no reviews and no blocks, every staffed
   * agent is idle and nothing else. A client-side positioner that invented
   * an arrival, a "working" after a walk, or a collaboration because two
   * agents happen to be in the same room would fail here.
   */
  it('emits no state that is not backed by a row', () => {
    const empty = projectAgents(snapshot({ assignments: [], reviews: [], egress: [] }));
    expect(empty.every((event) => event.state === 'idle')).toBe(true);
    expect(empty.every((event) => event.taskId === null)).toBe(true);

    // Add exactly one row at a time; exactly one state changes each time.
    const working = projectAgents(snapshot({
      assignments: [assignment({ id: 'a1', agentSlug: 'scope-analyst', status: 'working' })],
    }));
    expect(working.filter((event) => event.state !== 'idle')).toHaveLength(1);

    const reviewed = projectAgents(snapshot({
      assignments: [assignment({ id: 'a1', agentSlug: 'scope-analyst', status: 'peer_review' })],
      reviews: [{
        id: 'r1', kind: 'peer', reviewerAgentSlug: 'assumption-auditor', subjectAgentSlug: 'scope-analyst',
        subjectAssignmentId: 'a1', verdict: 'rework', round: 1, createdAt: '2026-09-11T10:01:00.000Z',
      }],
    }));
    expect(reviewed.filter((event) => event.state === 'collaborating')).toHaveLength(2);
  });

  it('produces no marker without a row behind it', () => {
    expect(projectMarkers(snapshot())).toEqual([]);
  });
});
