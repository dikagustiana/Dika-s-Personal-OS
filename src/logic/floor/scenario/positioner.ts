// The physical layer between adapters and the wire. An adapter says "agent X
// is working on task T"; the positioner knows where X is, where X's desk is,
// how long the walk takes, and emits WALKING now plus the arrival state at
// the arrival time. A newer semantic event for the same agent supersedes any
// pending arrival — the runner cancels those timers — so nothing arrives
// after the world has moved on.
import { hexEquals, hexKey, type HexCoord } from '../hex/hex';
import { findPath } from '../pathfinding/astar';
import { campusGraph } from '../pathfinding/campusGraph';
import { approachHexFor } from '../layout/resolve';
import type { CampusLayout, FurniturePlacement } from '../layout/types';
import { walkDurationSeconds } from '../movement/movement';
import type { CanonicalEvent } from '../events/schema';
import { Seating } from './seating';
import type { SemanticEvent } from './semantic';

export interface Emission {
  atMs: number;
  event: CanonicalEvent;
}

interface Walk {
  path: HexCoord[];
  startMs: number;
  endMs: number;
  dest: HexCoord;
}

interface AgentPhysical {
  location: HexCoord;
  walk: Walk | null;
  activeGroup: string | null;
}

export interface PositionerOptions {
  nextEventId?: () => string;
  /** Leave for tests: fixed walk duration in seconds regardless of path length. */
  fixedWalkSeconds?: number;
}

export class Positioner {
  readonly seating: Seating;
  private readonly graph;
  private readonly agents = new Map<string, AgentPhysical>();
  private seq = 0;
  private readonly nextEventId: () => string;

  constructor(
    private readonly layout: CampusLayout,
    private readonly opts: PositionerOptions = {},
  ) {
    this.seating = new Seating(layout);
    this.graph = campusGraph(layout);
    this.nextEventId = opts.nextEventId ?? (() => `evt-${++this.seq}`);
  }

  /** Where the agent is right now: interpolated along its walk if it is walking. */
  locationOf(agentId: string, nowMs: number): HexCoord | null {
    const a = this.agents.get(agentId);
    if (!a) return null;
    if (!a.walk) return a.location;
    const { path, startMs, endMs } = a.walk;
    const frac = endMs > startMs ? Math.min(1, Math.max(0, (nowMs - startMs) / (endMs - startMs))) : 1;
    const idx = Math.min(path.length - 1, Math.round(frac * (path.length - 1)));
    return path[idx];
  }

  /** Apply one semantic event; returns the wire events with the times to send them. */
  apply(ev: SemanticEvent, nowMs: number): Emission[] {
    const a = this.ensure(ev, nowMs);
    const here = this.locationOf(ev.agentId, nowMs) ?? a.location;

    if (a.activeGroup && ev.state !== 'collaborating') {
      this.seating.releaseGroupMember(a.activeGroup, ev.agentId);
      a.activeGroup = null;
    }

    switch (ev.state) {
      case 'error':
      case 'unknown': {
        this.stopWalk(a, here);
        const state = ev.state === 'error' ? 'OFFICE_ERROR' : (ev.unknownStateName ?? 'OFFICE_UNKNOWN');
        return [{ atMs: nowMs, event: this.wire(ev, nowMs, state, here, null, null) }];
      }
      case 'idle': {
        if (ev.idleWhere === 'here') {
          this.stopWalk(a, here);
          return [{ atMs: nowMs, event: this.wire(ev, nowMs, 'OFFICE_IDLE', here, null, null) }];
        }
        // Idle is AT YOUR OWN DESK. There is no lounge on this floor, and
        // an institution whose quiet staff all walk somewhere else to be
        // quiet is both untrue and the expensive way to render the normal
        // case (3-D: idle agents are a low-cost seated representation).
        const desk = this.seating.homeDeskFor(ev.agentId, ev.department, ev.role);
        const dest = desk?.hex ?? here;
        return this.travel(a, ev, nowMs, here, dest, 'OFFICE_WALKING', 'OFFICE_IDLE', null, desk);
      }
      case 'working': {
        const desk = this.seating.homeDeskFor(ev.agentId, ev.department, ev.role);
        const dest = desk?.hex ?? here;
        return this.travel(a, ev, nowMs, here, dest, 'OFFICE_WALKING', 'OFFICE_WORKING', null, desk);
      }
      case 'collaborating': {
        const groupId = ev.groupId ?? `group-${ev.agentId}`;
        a.activeGroup = groupId;
        // A peer review meets in ITS department's cluster, so the review is
        // visibly inside the department that owns the work.
        const chair = this.seating.meetingChairFor(groupId, ev.agentId, ev.department);
        const dest = chair?.hex ?? here;
        return this.travel(a, ev, nowMs, here, dest, 'OFFICE_WALKING', 'OFFICE_COLLABORATING', groupId, chair);
      }
      case 'delivering': {
        const target = this.seating.deliveryTargetFor(ev.deliverTo ?? 'output');
        const dest = target?.hex ?? here;
        return this.travel(a, ev, nowMs, here, dest, 'OFFICE_DELIVERING', 'OFFICE_DELIVERING', null, target, 'anchor_deliver');
      }
    }
  }

  /**
   * An agent the floor has not seen before starts AT ITS OWN DESK, not at
   * a door. The institution's staff are already at work when the director
   * opens the screen; walking everyone in from the entrance would be a
   * story the rows do not tell.
   */
  private ensure(ev: SemanticEvent, nowMs: number): AgentPhysical {
    let a = this.agents.get(ev.agentId);
    if (!a) {
      const desk = this.seating.homeDeskFor(ev.agentId, ev.department, ev.role);
      const approach = desk ? approachHexFor(desk, 'anchor_sit') : null;
      a = { location: approach ?? desk?.hex ?? { q: 0, r: 0 }, walk: null, activeGroup: null };
      this.agents.set(ev.agentId, a);
    }
    void nowMs;
    return a;
  }

  private stopWalk(a: AgentPhysical, here: HexCoord): void {
    a.walk = null;
    a.location = here;
  }

  /**
   * Emit a moving state now and the arrival state at the arrival time. If the
   * agent is already walking to the same destination, the walk is not
   * restarted: the moving event is re-sent with the current position and the
   * arrival keeps its original time.
   */
  private travel(
    a: AgentPhysical,
    ev: SemanticEvent,
    nowMs: number,
    here: HexCoord,
    dest: HexCoord,
    movingState: string,
    arrivalState: string,
    groupId: string | null,
    furniture: FurniturePlacement | null,
    anchor: 'anchor_sit' | 'anchor_deliver' = 'anchor_sit',
  ): Emission[] {
    if (hexEquals(here, dest) && !a.walk) {
      return [{ atMs: nowMs, event: this.wire(ev, nowMs, arrivalState, dest, null, groupId) }];
    }
    if (a.walk && hexEquals(a.walk.dest, dest)) {
      const endMs = Math.max(a.walk.endMs, nowMs);
      return [
        { atMs: nowMs, event: this.wire(ev, nowMs, movingState, here, dest, groupId) },
        { atMs: endMs, event: this.wire(ev, endMs, arrivalState, dest, null, groupId) },
      ];
    }
    const approach = furniture && this.layout.blocked.has(hexKey(dest)) ? approachHexFor(furniture, anchor) : dest;
    const res = findPath(this.graph, here, approach);
    let path: HexCoord[];
    if (!res) {
      // Unreachable (should not happen on a validated layout): arrive at once
      // rather than never; the layout tests are the real guard.
      path = [here, dest];
    } else {
      path = hexEquals(approach, dest) ? res.path : [...res.path, dest];
    }
    const seconds = this.opts.fixedWalkSeconds ?? walkDurationSeconds(path.length);
    const endMs = nowMs + Math.round(seconds * 1000);
    a.walk = { path, startMs: nowMs, endMs, dest };
    a.location = dest;
    return [
      { atMs: nowMs, event: this.wire(ev, nowMs, movingState, here, dest, groupId) },
      { atMs: endMs, event: this.wire(ev, endMs, arrivalState, dest, null, groupId) },
    ];
  }

  /** Called by the runner when an arrival emission has actually been sent. */
  markArrived(agentId: string, atMs: number): void {
    const a = this.agents.get(agentId);
    if (a?.walk && atMs >= a.walk.endMs) a.walk = null;
  }

  private wire(
    ev: SemanticEvent,
    atMs: number,
    state: string,
    location: HexCoord,
    target: HexCoord | null,
    groupId: string | null,
  ): CanonicalEvent {
    return {
      eventId: this.nextEventId(),
      timestamp: new Date(atMs).toISOString(),
      agentId: ev.agentId,
      agentRole: ev.agentRole,
      currentState: state,
      currentLocationHex: { q: location.q, r: location.r },
      targetDestinationHex: target ? { q: target.q, r: target.r } : null,
      currentTaskId: ev.taskId,
      collaborationGroupId: groupId,
      taskDetails: {
        title: ev.title,
        department: ev.department,
        progressPercentage: Math.min(100, Math.max(0, Math.round(ev.progress))),
        activeSubtask: ev.subtask,
        tokensUsed: Math.max(0, Math.round(ev.tokens)),
      },
    };
  }
}
