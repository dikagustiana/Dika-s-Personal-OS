import { describe, expect, it } from 'vitest';
import { hexDistance, hexEquals, hexKey } from '@/core/hex/hex';
import type { CanonicalEvent } from '@/core/events/schema';
import { CAMPUS, freeTilesOfZone, furnitureOfType } from '@/core/layout/campus';
import { anchorWorldPose } from '@/core/layout/resolve';
import { WALK_SPEED_MPS } from '@/core/movement/movement';
import { pathLength } from '@/core/movement/pathFollow';
import { advanceAvatar, avatarRuntimes, currentHex, getOrCreateRuntime, removeRuntime } from './avatarRuntime';
import { CATCHUP_MAX_TILES, reconcile } from './reconcile';

const lounge = freeTilesOfZone(CAMPUS, 'lounge');
const desk = furnitureOfType(CAMPUS, 'workstation', 'engineering')[0];
const chair = furnitureOfType(CAMPUS, 'meetingChair', 'meeting-a')[1];
const terminal = furnitureOfType(CAMPUS, 'outputTerminal')[0];

let n = 0;
function ev(over: Partial<CanonicalEvent>): CanonicalEvent {
  n++;
  return {
    eventId: `e${n}`,
    timestamp: new Date(1_000_000 + n * 1000).toISOString(),
    agentId: 'a',
    agentRole: 'Engineer',
    currentState: 'OFFICE_IDLE',
    currentLocationHex: lounge[0],
    targetDestinationHex: null,
    currentTaskId: 'task-1',
    collaborationGroupId: null,
    taskDetails: { title: 'T', department: 'Engineering Bay', progressPercentage: 10, activeSubtask: 'S', tokensUsed: 1 },
    ...over,
  };
}

function fresh(id = 'a') {
  removeRuntime(id);
  return getOrCreateRuntime(id, lounge[0]);
}

/** Run frames until the avatar stops walking (or the budget runs out). */
function settle(rt: ReturnType<typeof fresh>, maxSeconds = 120): number {
  let t = 0;
  while (rt.follow && t < maxSeconds) {
    advanceAvatar(rt, 1 / 30);
    t += 1 / 30;
  }
  return t;
}

describe('reconcile: stream → motion', () => {
  it('first appearance places the avatar at the reported tile in the reported pose, without a walk', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: desk.hex }), true);
    expect(rt.follow).toBeNull();
    expect(rt.pose).toBe('sit');
    expect(rt.activity).toBe('typing');
    expect(hexEquals(currentHex(rt), desk.hex)).toBe(true);
    // Hips on the pan: origin is the rig's hip-back offset in front of the seat anchor, on the floor.
    const a = anchorWorldPose(desk, 'anchor_sit');
    expect(Math.hypot(rt.x - a.x, rt.z - a.z)).toBeCloseTo(0.33, 2);
  });

  it('WALKING starts a walk toward the target and, on arrival without a new event, stands and waits', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_IDLE', currentLocationHex: lounge[0] }), true);
    reconcile(rt, ev({ currentState: 'OFFICE_WALKING', currentLocationHex: lounge[0], targetDestinationHex: desk.hex }), false);
    expect(rt.pose).toBe('walk');
    expect(rt.follow).not.toBeNull();
    expect(hexEquals(rt.destination, desk.hex)).toBe(true);
    const seconds = settle(rt);
    expect(seconds).toBeGreaterThan(3);
    expect(rt.pose).toBe('stand');
    expect(rt.activity).toBe('waiting');
    // Waiting at the stand anchor, not the tile centre.
    const stand = anchorWorldPose(desk, 'anchor_stand');
    expect(Math.hypot(rt.x - stand.x, rt.z - stand.z)).toBeLessThan(0.05);
  });

  it('a mid-walk update with the same target does not restart the walk', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_IDLE' }), true);
    reconcile(rt, ev({ currentState: 'OFFICE_WALKING', targetDestinationHex: desk.hex }), false);
    for (let i = 0; i < 60; i++) advanceAvatar(rt, 1 / 30);
    const x = rt.x;
    const z = rt.z;
    const idx = rt.follow!.index;
    reconcile(rt, ev({ currentState: 'OFFICE_WALKING', currentLocationHex: currentHex(rt), targetDestinationHex: desk.hex }), false);
    expect(rt.x).toBe(x);
    expect(rt.z).toBe(z);
    expect(rt.follow!.index).toBe(idx);
  });

  it('WORKING while still en route (but close) lets the walk finish briskly and then sits', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_IDLE' }), true);
    reconcile(rt, ev({ currentState: 'OFFICE_WALKING', targetDestinationHex: desk.hex }), false);
    // Walk until about two seconds of route remain.
    const total = pathLength(rt.follow!.waypoints) / WALK_SPEED_MPS;
    const frames = Math.floor((total - 2) * 30);
    for (let i = 0; i < frames; i++) advanceAvatar(rt, 1 / 30);
    expect(rt.follow).not.toBeNull();
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: desk.hex }), false);
    expect(rt.follow).not.toBeNull();
    expect(rt.speedScale).toBeGreaterThan(1);
    const secs = settle(rt);
    expect(secs).toBeLessThan(1.6);
    expect(rt.pose).toBe('sit');
    expect(rt.activity).toBe('typing');
  });

  it('a starved renderer far behind the stream snaps to the confirmed tile instead of sprinting', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_IDLE' }), true);
    reconcile(rt, ev({ currentState: 'OFFICE_WALKING', targetDestinationHex: desk.hex }), false);
    // Barely moved: the whole route is still ahead.
    advanceAvatar(rt, 1 / 30);
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: desk.hex }), false);
    expect(rt.follow).toBeNull();
    expect(rt.pose).toBe('sit');
    expect(hexEquals(currentHex(rt), desk.hex)).toBe(true);
  });

  it('a WALKING update reporting a position far ahead of a lagging avatar moves it there and re-plans', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_IDLE' }), true);
    reconcile(rt, ev({ currentState: 'OFFICE_WALKING', targetDestinationHex: desk.hex }), false);
    advanceAvatar(rt, 1 / 30);
    // The stream says the agent is already next to the desk.
    const near = freeTilesOfZone(CAMPUS, 'engineering')[0];
    reconcile(rt, ev({ currentState: 'OFFICE_WALKING', currentLocationHex: near, targetDestinationHex: desk.hex }), false);
    expect(hexDistance(currentHex(rt), near)).toBeLessThanOrEqual(1);
    expect(rt.follow).not.toBeNull();
    expect(hexEquals(rt.destination, desk.hex)).toBe(true);
  });

  it('a location far from the avatar snaps; a near one catches up with a short walk', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_IDLE', currentLocationHex: lounge[0] }), true);
    // Far: the desk is more than CATCHUP_MAX_TILES from the lounge.
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: desk.hex }), false);
    expect(rt.follow).toBeNull();
    expect(rt.pose).toBe('sit');
    // Near: two tiles away inside the bay → a brisk walk, not a snap.
    const near = freeTilesOfZone(CAMPUS, 'engineering').find((h) => {
      const d = Math.max(Math.abs(h.q - desk.hex.q), Math.abs(h.r - desk.hex.r), Math.abs(-h.q - h.r + desk.hex.q + desk.hex.r));
      return d === 2;
    })!;
    reconcile(rt, ev({ currentState: 'OFFICE_IDLE', currentLocationHex: near }), false);
    expect(rt.follow).not.toBeNull();
    expect(rt.speedScale).toBeGreaterThanOrEqual(1);
    const secs = settle(rt);
    expect(secs).toBeLessThan(3);
    expect(rt.pose).toBe('stand');
    expect(hexEquals(currentHex(rt), near)).toBe(true);
    expect(CATCHUP_MAX_TILES).toBe(6);
  });

  it('COLLABORATING seats the agent at its chair, talking, with the group recorded', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_COLLABORATING', currentLocationHex: chair.hex, collaborationGroupId: 'g1' }), true);
    expect(rt.pose).toBe('sit');
    expect(rt.activity).toBe('talking');
    expect(rt.groupId).toBe('g1');
  });

  it('DELIVERING with a target carries toward it; at the terminal it hands over exactly once per task', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: desk.hex }), true);
    reconcile(rt, ev({ currentState: 'OFFICE_DELIVERING', currentLocationHex: desk.hex, targetDestinationHex: terminal.hex }), false);
    expect(rt.pose).toBe('walk');
    expect(rt.carrying).toBe(true);
    settle(rt);
    expect(rt.activity).toBe('waiting');
    expect(rt.carrying).toBe(true);
    reconcile(rt, ev({ currentState: 'OFFICE_DELIVERING', currentLocationHex: terminal.hex, targetDestinationHex: null, currentTaskId: 'task-1' }), false);
    expect(rt.activity).toBe('delivering');
    const deliver = anchorWorldPose(terminal, 'anchor_deliver');
    expect(Math.hypot(rt.x - deliver.x, rt.z - deliver.z)).toBeLessThan(0.05);
    // The hand-over animation finished (the component clears carrying); a repeat frame must not replay it.
    rt.activity = 'idle';
    rt.carrying = false;
    reconcile(rt, ev({ currentState: 'OFFICE_DELIVERING', currentLocationHex: terminal.hex, targetDestinationHex: null, currentTaskId: 'task-1' }), false);
    expect(rt.activity).toBe('idle');
    expect(rt.carrying).toBe(false);
  });

  it('ERROR at the desk keeps the agent seated but stops the typing and raises the alert', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: desk.hex }), true);
    reconcile(rt, ev({ currentState: 'OFFICE_ERROR', currentLocationHex: desk.hex, taskDetails: { title: 'T', department: 'Engineering Bay', progressPercentage: 40, activeSubtask: 'Tests failed', tokensUsed: 5 } }), false);
    expect(rt.pose).toBe('sit');
    expect(rt.activity).toBe('idle');
    expect(rt.alert).toBe('error');
    expect(rt.alertText).toBe('Tests failed');
    // Back to work clears it.
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: desk.hex }), false);
    expect(rt.alert).toBe('none');
    expect(rt.activity).toBe('typing');
  });

  it('an unknown state renders as unknown on the spot and is never mapped to a neighbour', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: desk.hex }), true);
    reconcile(rt, ev({ currentState: 'OFFICE_DANCING', currentLocationHex: desk.hex }), false);
    expect(rt.alert).toBe('unknown');
    expect(rt.alertText).toContain('OFFICE_DANCING');
    expect(rt.activity).toBe('idle');
    expect(rt.pose).toBe('sit');
  });

  it('WORKING on a tile without a desk stands the agent there with a visible NO DESK alert', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: lounge[2] }), true);
    expect(rt.pose).toBe('stand');
    expect(rt.alert).toBe('nodesk');
  });

  it('a silent agent never changes: no event, no motion command', () => {
    const rt = fresh();
    reconcile(rt, ev({ currentState: 'OFFICE_WORKING', currentLocationHex: desk.hex }), true);
    const before = JSON.stringify({ ...rt, onArrive: undefined });
    for (let i = 0; i < 300; i++) advanceAvatar(rt, 1 / 30);
    expect(JSON.stringify({ ...rt, onArrive: undefined })).toBe(before);
    expect(avatarRuntimes.has('a')).toBe(true);
    expect(hexKey(currentHex(rt))).toBe(hexKey(desk.hex));
  });
});
