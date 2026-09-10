// Deterministic seat assignment on top of the layout: home desks by department,
// lounge spots, meeting chairs by collaboration group.
import { hexKey, hexNeighbors, type HexCoord } from '../hex/hex';
import { freeTilesOfZone, furnitureOfType } from '../layout/campus';
import type { CampusLayout, FurniturePlacement } from '../layout/types';

export const EXECUTIVE_DEPARTMENT = 'Executive Office';

export class Seating {
  private readonly deskByAgent = new Map<string, FurniturePlacement>();
  private readonly deskOwners = new Map<string, string[]>();
  private readonly loungeByAgent = new Map<string, HexCoord>();
  private readonly loungeSpots: HexCoord[];
  private readonly roomByGroup = new Map<string, string>();
  private readonly chairByGroupAgent = new Map<string, FurniturePlacement>();
  private readonly meetingRooms: string[];

  constructor(private readonly layout: CampusLayout) {
    const lounge = layout.zones.find((z) => z.kind === 'lounge');
    const doorTiles = new Set<string>();
    for (const [inside] of lounge?.doors ?? []) {
      doorTiles.add(hexKey(inside));
      for (const n of hexNeighbors(inside)) doorTiles.add(hexKey(n));
    }
    this.loungeSpots = lounge ? freeTilesOfZone(layout, lounge.id).filter((h) => !doorTiles.has(hexKey(h))) : [];
    this.meetingRooms = layout.zones.filter((z) => z.kind === 'meeting').map((z) => z.id);
  }

  /** The agent's home workstation (or the manager desk for the executive department). Stable per agent. */
  homeDeskFor(agentId: string, department: string): FurniturePlacement | null {
    const existing = this.deskByAgent.get(agentId);
    if (existing) return existing;
    let candidates: FurniturePlacement[];
    if (department === EXECUTIVE_DEPARTMENT) {
      candidates = furnitureOfType(this.layout, 'managerDesk');
    } else {
      const zone = this.layout.zones.find((z) => z.kind === 'deskBay' && z.department === department);
      candidates = zone ? furnitureOfType(this.layout, 'workstation', zone.id) : furnitureOfType(this.layout, 'workstation');
    }
    if (candidates.length === 0) return null;
    // Least-shared desk first, in layout order for stability.
    let best = candidates[0];
    let bestCount = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const n = this.deskOwners.get(c.id)?.length ?? 0;
      if (n < bestCount) {
        best = c;
        bestCount = n;
      }
    }
    this.deskByAgent.set(agentId, best);
    this.deskOwners.set(best.id, [...(this.deskOwners.get(best.id) ?? []), agentId]);
    return best;
  }

  /** A standing spot in the lounge, away from the door. Stable per agent. */
  loungeSpotFor(agentId: string): HexCoord | null {
    const existing = this.loungeByAgent.get(agentId);
    if (existing) return existing;
    if (this.loungeSpots.length === 0) return null;
    const spot = this.loungeSpots[this.loungeByAgent.size % this.loungeSpots.length];
    this.loungeByAgent.set(agentId, spot);
    return spot;
  }

  /** The meeting chair for an agent in a collaboration group. The group keeps its room until released. */
  meetingChairFor(groupId: string, agentId: string): FurniturePlacement | null {
    const key = `${groupId}::${agentId}`;
    const existing = this.chairByGroupAgent.get(key);
    if (existing) return existing;
    let room = this.roomByGroup.get(groupId);
    if (!room) {
      const busy = new Set(this.roomByGroup.values());
      room = this.meetingRooms.find((r) => !busy.has(r)) ?? this.meetingRooms[this.roomByGroup.size % Math.max(1, this.meetingRooms.length)];
      if (!room) return null;
      this.roomByGroup.set(groupId, room);
    }
    const chairs = furnitureOfType(this.layout, 'meetingChair', room);
    const taken = new Set<string>();
    for (const [k, chair] of this.chairByGroupAgent) if (k.startsWith(`${groupId}::`)) taken.add(chair.id);
    const chair = chairs.find((c) => !taken.has(c.id)) ?? chairs[taken.size % Math.max(1, chairs.length)];
    if (!chair) return null;
    this.chairByGroupAgent.set(key, chair);
    return chair;
  }

  /** Free the room and chairs once nobody in the group is collaborating any more. */
  releaseGroupMember(groupId: string, agentId: string): void {
    this.chairByGroupAgent.delete(`${groupId}::${agentId}`);
    for (const k of this.chairByGroupAgent.keys()) if (k.startsWith(`${groupId}::`)) return;
    this.roomByGroup.delete(groupId);
  }

  deliveryTargetFor(kind: 'output' | 'manager'): FurniturePlacement | null {
    const list = furnitureOfType(this.layout, kind === 'output' ? 'outputTerminal' : 'managerDesk');
    return list[0] ?? null;
  }
}
