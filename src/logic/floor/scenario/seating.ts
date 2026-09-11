// Deterministic seat assignment on top of the institution's floorplan.
//
// WHAT CHANGED FROM THE STANDALONE BUILD. There is no coffee lounge to send
// an idle agent to, and there are no two shared meeting rooms: every
// department has its own bay, its own lead office and its own peer-review
// cluster. So:
//
//   * a specialist's home desk is a workstation in ITS department's bay,
//     assigned in seat order so the same agent always sits in the same
//     place and the floor is legible run to run;
//   * a LEAD's desk is the manager desk in its own office, because the
//     lead review happens there and a lead sitting in the bay would make
//     the two rooms mean the same thing;
//   * an idle agent stays at its desk. Most desks are quiet most of the
//     time, and an institution whose idle staff all walk to a lounge is
//     both a lie and (3-D) the expensive way to render the normal case;
//   * a review meets in the cluster of the department the work belongs to,
//     so a peer review is visibly inside that department.
import { hexKey, type HexCoord } from '../hex/hex';
import { freeTilesOfZone, furnitureOfType } from '../layout/campus';
import type { CampusLayout, FurniturePlacement } from '../layout/types';

/** The program office is a room, not a department bay; its lead sits there. */
export const PROGRAM_OFFICE_ZONE = 'program-office';
export const COMMITTEE_ZONE = 'committee';
export const DIRECTOR_ZONE = 'director';
export const LIBRARY_ZONE = 'library';

export interface SeatRequest {
  agentId: string;
  /** Department slug; '' or unknown puts the agent in the program office. */
  department: string;
  role?: 'lead' | 'specialist';
}

export class Seating {
  private readonly deskByAgent = new Map<string, FurniturePlacement>();
  private readonly deskOwners = new Map<string, string[]>();
  private readonly roomByGroup = new Map<string, string>();
  private readonly chairByGroupAgent = new Map<string, FurniturePlacement>();
  private readonly meetingRooms: string[];

  constructor(private readonly layout: CampusLayout) {
    this.meetingRooms = layout.zones.filter((z) => z.kind === 'meeting').map((z) => z.id);
  }

  /**
   * The agent's own desk. Stable per agent: the first call decides, every
   * later call returns the same placement, so an agent does not move house
   * because a row arrived in a different order.
   */
  homeDeskFor(agentId: string, department: string, role: 'lead' | 'specialist' = 'specialist'): FurniturePlacement | null {
    const existing = this.deskByAgent.get(agentId);
    if (existing) return existing;

    let candidates: FurniturePlacement[] = [];
    if (role === 'lead') {
      candidates = furnitureOfType(this.layout, 'managerDesk', `lead-${department}`);
      if (candidates.length === 0) candidates = furnitureOfType(this.layout, 'managerDesk', PROGRAM_OFFICE_ZONE);
    } else {
      candidates = furnitureOfType(this.layout, 'workstation', `bay-${department}`);
    }
    if (candidates.length === 0) {
      // No bay for this department (the program office, the committee): its
      // people work at the nearest desk the floor does have.
      candidates = [
        ...furnitureOfType(this.layout, 'managerDesk', PROGRAM_OFFICE_ZONE),
        ...furnitureOfType(this.layout, 'workstation'),
      ];
    }
    if (candidates.length === 0) return null;

    let best = candidates[0];
    let bestCount = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const owners = this.deskOwners.get(candidate.id)?.length ?? 0;
      if (owners < bestCount) {
        best = candidate;
        bestCount = owners;
      }
    }
    this.deskByAgent.set(agentId, best);
    this.deskOwners.set(best.id, [...(this.deskOwners.get(best.id) ?? []), agentId]);
    return best;
  }

  /** Who sits at a given desk — the floor reads this for its name plates. */
  ownersOf(placementId: string): readonly string[] {
    return this.deskOwners.get(placementId) ?? [];
  }

  /**
   * The meeting chair for an agent in a review or a debate. The group keeps
   * its room until released. `preferDepartment` puts a peer review in that
   * department's own cluster; a committee session goes to the committee
   * chamber.
   */
  meetingChairFor(groupId: string, agentId: string, preferDepartment?: string): FurniturePlacement | null {
    const key = `${groupId}::${agentId}`;
    const existing = this.chairByGroupAgent.get(key);
    if (existing) return existing;

    let room = this.roomByGroup.get(groupId);
    if (!room) {
      const preferred = preferDepartment ? `meet-${preferDepartment}` : undefined;
      const busy = new Set(this.roomByGroup.values());
      room =
        (preferred && this.meetingRooms.includes(preferred) ? preferred : undefined) ??
        this.meetingRooms.find((candidate) => !busy.has(candidate)) ??
        this.meetingRooms[this.roomByGroup.size % Math.max(1, this.meetingRooms.length)];
      if (!room) return null;
      this.roomByGroup.set(groupId, room);
    }
    const chairs = furnitureOfType(this.layout, 'meetingChair', room);
    const taken = new Set<string>();
    for (const [existingKey, chair] of this.chairByGroupAgent) {
      if (existingKey.startsWith(`${groupId}::`)) taken.add(chair.id);
    }
    const chair = chairs.find((candidate) => !taken.has(candidate.id)) ?? chairs[taken.size % Math.max(1, chairs.length)];
    if (!chair) return null;
    this.chairByGroupAgent.set(key, chair);
    return chair;
  }

  /** Free the room and chairs once nobody in the group is meeting any more. */
  releaseGroupMember(groupId: string, agentId: string): void {
    this.chairByGroupAgent.delete(`${groupId}::${agentId}`);
    for (const key of this.chairByGroupAgent.keys()) if (key.startsWith(`${groupId}::`)) return;
    this.roomByGroup.delete(groupId);
  }

  /**
   * Where a delivery goes: an output to the library (the corpus is where
   * work is archived and cited from), anything for the director to the
   * director's office.
   */
  deliveryTargetFor(kind: 'output' | 'manager'): FurniturePlacement | null {
    if (kind === 'manager') {
      const director = furnitureOfType(this.layout, 'managerDesk', DIRECTOR_ZONE);
      if (director.length > 0) return director[0];
    }
    const terminals = [
      ...furnitureOfType(this.layout, 'outputTerminal', LIBRARY_ZONE),
      ...furnitureOfType(this.layout, 'outputTerminal'),
    ];
    return terminals[0] ?? null;
  }

  /** A standing spot in a named room, for an agent with no desk of its own. */
  spotInZone(zoneId: string, index: number): HexCoord | null {
    const free = freeTilesOfZone(this.layout, zoneId).filter((tile) => !this.layout.blocked.has(hexKey(tile)));
    if (free.length === 0) return null;
    return free[index % free.length];
  }
}
