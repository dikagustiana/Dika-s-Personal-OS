// =============================================================================
// THE PROJECTOR — institution rows become semantic events for the floor
// =============================================================================
//
// The standalone build had a server that INVENTED events. This reads what
// the institution actually did: assignment rows, review rows, submissions,
// debates, egress blocks and the event log, and says what each one means
// physically. Nothing here is fabricated — every floor event traces to a
// row, which is the whole reason the floor is worth looking at.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP (3-C). It produces SEMANTIC events:
// "this agent is working", "these agents are in a review". It never says
// where anyone is or when they arrive. The positioner turns a semantic
// event into position; the client may derive position and may NEVER derive
// state. A state that appears on the floor without a row behind it is the
// failure mode this whole migration is most likely to introduce, and
// src/logic/floor/institution/project.test.ts fails if one does.

import type { SemanticEvent } from '../scenario/semantic';

export type FloorAssignmentKind =
  | 'program_intake' | 'lead_intake' | 'specialist_work' | 'peer_review' | 'lead_review'
  | 'lead_submit' | 'agent_authoring' | 'committee_review' | 'debate' | 'arbitration' | 'evaluation';

export type FloorAssignmentStatus =
  | 'assigned' | 'working' | 'peer_review' | 'rework' | 'accepted' | 'returned'
  | 'refused' | 'submitted' | 'done' | 'failed' | 'escalated';

export interface FloorAssignmentRow {
  id: string;
  agentSlug: string;
  departmentSlug: string | null;
  kind: FloorAssignmentKind;
  status: FloorAssignmentStatus;
  round: number;
  reworkCount: number;
  detail: Record<string, unknown>;
  updatedAt: string;
}

export interface FloorReviewRow {
  id: string;
  kind: 'peer' | 'lead' | 'committee';
  reviewerAgentSlug: string;
  subjectAgentSlug: string | null;
  subjectAssignmentId: string | null;
  verdict: 'accept' | 'rework' | 'reject' | 'escalate';
  round: number;
  createdAt: string;
}

export interface FloorSubmissionRow {
  id: string;
  fromDepartmentSlug: string;
  toDepartmentSlug: string | null;
  toCommittee: boolean;
  accepted: boolean;
  returnCount: number;
  createdAt: string;
}

export interface FloorDebateRow {
  id: string;
  rebuttingAgentSlug: string;
  outcome: string | null;
  round: number;
}

export interface FloorEgressRow {
  id: string;
  agentSlug: string | null;
  tool: string;
  createdAt: string;
}

export interface FloorProposalRow {
  id: string;
  agentSlug: string;
  status: 'proposed' | 'active' | 'retired' | 'rejected';
  createdAt: string;
}

export interface FloorAgentRow {
  slug: string;
  name: string;
  dataClass: 'internal' | 'public';
  departmentSlug: string | null;
  role: 'lead' | 'specialist';
  seatPurpose: string;
  /** False when the seat exists and no agent fills it: a name plate on an empty desk. */
  staffed: boolean;
}

export interface FloorSnapshot {
  briefId: string | null;
  briefStatus: string;
  weightClass: string;
  routing: string[];
  agents: FloorAgentRow[];
  assignments: FloorAssignmentRow[];
  reviews: FloorReviewRow[];
  submissions: FloorSubmissionRow[];
  debates: FloorDebateRow[];
  egress: FloorEgressRow[];
  proposals: FloorProposalRow[];
  /** How many corpus records the brief has produced — the library fills. */
  corpusRecords: number;
}

/** A department the brief did not visit is dark; one it did is lit. */
export function litDepartments(snapshot: FloorSnapshot): Set<string> {
  return new Set(snapshot.routing);
}

const DELIVERING_KINDS: ReadonlySet<FloorAssignmentKind> = new Set(['lead_submit']);

/**
 * The floor's view of one agent, derived from the rows. Exactly one state
 * per agent: the institution cannot have someone reviewing and idle at once,
 * and a floor that showed both would be inventing.
 */
export function projectAgents(snapshot: FloorSnapshot): SemanticEvent[] {
  const events: SemanticEvent[] = [];
  const byAgent = new Map<string, FloorAssignmentRow[]>();
  for (const assignment of snapshot.assignments) {
    const list = byAgent.get(assignment.agentSlug) ?? [];
    list.push(assignment);
    byAgent.set(assignment.agentSlug, list);
  }

  // A review in flight puts BOTH parties in the meeting cluster of the
  // department the work belongs to. collaborationGroupId is the review id,
  // so nothing about the grouping is invented (3-E).
  const collaborating = new Map<string, string>();
  for (const review of snapshot.reviews) {
    const subject = snapshot.assignments.find((assignment) => assignment.id === review.subjectAssignmentId);
    const open = subject ? subject.status === 'peer_review' || subject.status === 'rework' : false;
    if (!open) continue;
    collaborating.set(review.reviewerAgentSlug, review.id);
    if (review.subjectAgentSlug) collaborating.set(review.subjectAgentSlug, review.id);
  }

  const blockedBy = new Set(snapshot.egress.map((block) => block.agentSlug).filter((slug): slug is string => Boolean(slug)));

  for (const agent of snapshot.agents) {
    if (!agent.staffed) continue; // an empty desk has no avatar to place
    const mine = byAgent.get(agent.slug) ?? [];
    const latest = mine.length > 0
      ? mine.reduce((best, row) => (row.updatedAt > best.updatedAt ? row : best))
      : null;

    const base = {
      agentId: agent.slug,
      agentRole: agent.name,
      department: agent.departmentSlug ?? 'program-office',
      taskId: latest ? latest.id : null,
      title: titleOf(latest, snapshot),
      subtask: subtaskOf(latest),
      progress: progressOf(latest),
      tokens: tokensOf(latest),
    };

    // A blocked outbound call (B-4) is a visible refusal at that desk.
    // Hiding it would defeat the check, so it outranks the work state.
    if (blockedBy.has(agent.slug)) {
      events.push({ ...base, state: 'error', title: 'Outbound call blocked (B-4)', subtask: 'internal content in an outbound query' });
      continue;
    }

    const group = collaborating.get(agent.slug);
    if (group) {
      events.push({ ...base, state: 'collaborating', groupId: group });
      continue;
    }

    if (!latest || latest.status === 'done' || latest.status === 'accepted' || latest.status === 'submitted') {
      events.push({ ...base, state: 'idle', taskId: null });
      continue;
    }
    if (latest.status === 'failed' || latest.status === 'refused' || latest.status === 'escalated') {
      events.push({ ...base, state: 'error' });
      continue;
    }
    if (DELIVERING_KINDS.has(latest.kind)) {
      events.push({ ...base, state: 'delivering', deliverTo: 'output' });
      continue;
    }
    events.push({ ...base, state: 'working' });
  }

  return events;
}

function titleOf(assignment: FloorAssignmentRow | null, snapshot: FloorSnapshot): string {
  if (!assignment) return 'No assignment';
  const produced = assignment.detail.produced;
  if (typeof produced === 'string' && produced.length > 0) return produced;
  return `${assignment.kind.replace(/_/g, ' ')} · ${snapshot.weightClass}`;
}

function subtaskOf(assignment: FloorAssignmentRow | null): string {
  if (!assignment) return '';
  if (assignment.status === 'rework') return `rework ${assignment.reworkCount} of 2`;
  return assignment.status.replace(/_/g, ' ');
}

/**
 * PROGRESS IS AN ESTIMATE AND IS LABELLED ONE (0-A.2, DECISIONS D-05).
 *
 * The executor writes token counts once, at completion; nothing streams a
 * percentage. So this is derived from the STAGE the assignment has reached,
 * not from any measurement, and the HUD says "estimated" beside it. A bar
 * that looks measured and is guessed is exactly the failure this
 * institution exists to prevent.
 */
export function progressOf(assignment: FloorAssignmentRow | null): number {
  if (!assignment) return 0;
  switch (assignment.status) {
    case 'assigned': return 5;
    case 'working': return 35;
    case 'rework': return 45;
    case 'peer_review': return 65;
    case 'accepted': return 85;
    case 'submitted': return 95;
    case 'done': return 100;
    case 'escalated':
    case 'returned': return 60;
    case 'refused':
    case 'failed': return 0;
    default: return 0;
  }
}

function tokensOf(assignment: FloorAssignmentRow | null): number {
  if (!assignment) return 0;
  const tokens = assignment.detail.tokens;
  return typeof tokens === 'number' && Number.isFinite(tokens) ? Math.max(0, Math.trunc(tokens)) : 0;
}

// ---------------------------------------------------------------------------
// the floor's own events: things that move documents, not agents
// ---------------------------------------------------------------------------

export type FloorMarkerKind =
  | 'submission'        // a document carried from one lead's office to the next bay
  | 'return'            // the same document carried BACK; rework is as visible as progress
  | 'desk-filled'       // a lead authored an agent; a desk fills
  | 'proposal'          // a document carried to the director's office, and staying there
  | 'version-change'    // the director approved; a marker at that desk
  | 'escalation'        // both positions carried to the director
  | 'egress-block';     // a refusal at a desk

export interface FloorMarker {
  id: string;
  kind: FloorMarkerKind;
  /** Department slug, or 'director' / 'committee' for the fixed rooms. */
  from: string;
  to: string;
  label: string;
  at: string;
}

export function projectMarkers(snapshot: FloorSnapshot): FloorMarker[] {
  const markers: FloorMarker[] = [];

  for (const submission of snapshot.submissions) {
    const to = submission.toCommittee ? 'committee' : submission.toDepartmentSlug ?? 'director';
    markers.push({
      id: `sub-${submission.id}`,
      kind: submission.accepted ? 'submission' : 'return',
      from: submission.fromDepartmentSlug,
      to,
      label: submission.accepted ? `submitted to ${to}` : `returned to ${submission.fromDepartmentSlug}`,
      at: submission.createdAt,
    });
    if (submission.returnCount > 0) {
      markers.push({
        id: `ret-${submission.id}`,
        kind: 'return',
        from: to,
        to: submission.fromDepartmentSlug,
        label: `returned upstream ${submission.returnCount} of 2`,
        at: submission.createdAt,
      });
    }
  }

  for (const assignment of snapshot.assignments) {
    if (assignment.kind !== 'agent_authoring' || assignment.status !== 'done') continue;
    const slug = typeof assignment.detail.authoredSlug === 'string' ? assignment.detail.authoredSlug : assignment.agentSlug;
    markers.push({
      id: `auth-${assignment.id}`,
      kind: 'desk-filled',
      from: assignment.departmentSlug ?? 'program-office',
      to: assignment.departmentSlug ?? 'program-office',
      label: `${slug} now sits here`,
      at: assignment.updatedAt,
    });
  }

  for (const proposal of snapshot.proposals) {
    if (proposal.status === 'proposed') {
      markers.push({
        id: `prop-${proposal.id}`,
        kind: 'proposal',
        from: 'committee',
        to: 'director',
        label: `upgrade proposed for ${proposal.agentSlug} — pending, and ${proposal.agentSlug} still runs its current version`,
        at: proposal.createdAt,
      });
    } else if (proposal.status === 'active') {
      markers.push({
        id: `ver-${proposal.id}`,
        kind: 'version-change',
        from: 'director',
        to: proposal.agentSlug,
        label: `${proposal.agentSlug} promoted`,
        at: proposal.createdAt,
      });
    }
  }

  const unresolved = snapshot.debates.filter((debate) => debate.outcome === 'rejected' && debate.round >= 2);
  for (const debate of unresolved) {
    markers.push({
      id: `esc-${debate.id}`,
      kind: 'escalation',
      from: 'committee',
      to: 'director',
      label: `${debate.rebuttingAgentSlug} and the committee disagree after ${debate.round} rounds`,
      at: '',
    });
  }

  for (const block of snapshot.egress) {
    markers.push({
      id: `egr-${block.id}`,
      kind: 'egress-block',
      from: block.agentSlug ?? 'unknown',
      to: block.agentSlug ?? 'unknown',
      label: `${block.tool} blocked (B-4)`,
      at: block.createdAt,
    });
  }

  return markers;
}
