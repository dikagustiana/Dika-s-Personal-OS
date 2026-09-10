'use client';
// Transport → motion reconciliation (Phase 5, B-1). Pure with respect to the
// scene: it reads one event and one runtime and issues motion commands. It is
// called once per applied event, never per frame.
//
// Principles:
//  - The event's currentLocationHex is the truth about where the agent is.
//    If the avatar is elsewhere, it catches up (a short, sped-up walk when
//    close — interpolation between two known positions) or snaps when far
//    (a long invented walk would be a lie about the agent's whereabouts).
//  - A walk already heading to the same destination is never restarted by a
//    progress update; the avatar keeps its stride.
//  - Arriving anywhere without a confirming event leaves the avatar standing
//    and waiting. Only an event seats it, hands over a document, or ends an
//    error.
//  - Unknown states are shown as unknown, on the spot, with the raw name.
import { hexDistance, hexEquals, type HexCoord } from '@/core/hex/hex';
import { isKnownState, type CanonicalEvent } from '@/core/events/schema';
import { FURNITURE_SPECS } from '@/core/layout/furnitureSpecs';
import type { AnchorName, FurniturePlacement } from '@/core/layout/types';
import { WALK_SPEED_MPS } from '@/core/movement/movement';
import { pathLength } from '@/core/movement/pathFollow';
import {
  currentHex,
  furnitureAt,
  placeAtHex,
  sitAt,
  standAtAnchor,
  standAtHex,
  walkTo,
  type AvatarRuntime,
} from './avatarRuntime';

/** Beyond this many tiles from the reported location the avatar snaps instead of walking. */
export const CATCHUP_MAX_TILES = 6;
/** A catch-up walk finishes within about this long (speed capped at 3×). */
export const CATCHUP_SECONDS = 1.2;
/** Fastest a catch-up may run; beyond this the avatar snaps rather than sprints across the campus. */
export const CATCHUP_MAX_SPEED_SCALE = 3;

/** Seconds of walking left on the current route at normal speed. */
function remainingSeconds(rt: AvatarRuntime): number {
  if (!rt.follow) return 0;
  const rest = rt.follow.waypoints.slice(Math.max(0, rt.follow.index - 1));
  rest[0] = { x: rt.x, z: rt.z };
  return pathLength(rest) / WALK_SPEED_MPS;
}

function anchorFor(f: FurniturePlacement | undefined, moving: 'walk' | 'deliver'): AnchorName {
  if (!f) return 'anchor_stand';
  const spec = FURNITURE_SPECS[f.type];
  if (moving === 'deliver' && spec.canDeliver) return 'anchor_deliver';
  if (spec.canSit) return 'anchor_sit';
  if (spec.canDeliver) return 'anchor_deliver';
  return 'anchor_stand';
}

/**
 * Bring the avatar to `hex` (the event's location) and then run `arrive`.
 * Continues an in-progress walk to the same tile, walks briskly when close,
 * snaps when far, or arrives immediately when already there.
 */
function ensureAt(rt: AvatarRuntime, hex: HexCoord, arrive: () => void, opts: { carrying?: boolean } = {}): void {
  const here = currentHex(rt);
  if (rt.follow && rt.destination && hexEquals(rt.destination, hex)) {
    if (opts.carrying !== undefined) rt.carrying = opts.carrying;
    // The stream says the agent is already there: finish the remaining leg
    // briskly, or — if the renderer fell far behind (a throttled tab, a
    // starved GPU) — snap, because the truth is that the agent has arrived.
    const secs = remainingSeconds(rt);
    if (secs > CATCHUP_SECONDS * CATCHUP_MAX_SPEED_SCALE) {
      placeAtHex(rt, hex);
      arrive();
      return;
    }
    rt.onArrive = arrive;
    rt.speedScale = Math.min(CATCHUP_MAX_SPEED_SCALE, Math.max(1.6, secs / CATCHUP_SECONDS));
    return;
  }
  if (hexEquals(here, hex)) {
    if (opts.carrying !== undefined) rt.carrying = opts.carrying;
    arrive();
    return;
  }
  const d = hexDistance(here, hex);
  if (d <= CATCHUP_MAX_TILES) {
    const f = furnitureAt(hex);
    walkTo(rt, hex, anchorFor(f, opts.carrying ? 'deliver' : 'walk'), arrive, { carrying: opts.carrying, maxSeconds: CATCHUP_SECONDS });
    return;
  }
  placeAtHex(rt, hex);
  if (opts.carrying !== undefined) rt.carrying = opts.carrying;
  arrive();
}

function standSomewhere(rt: AvatarRuntime, hex: HexCoord, activity: 'idle' | 'waiting' | 'talking' = 'idle'): void {
  const f = furnitureAt(hex);
  if (f) standAtAnchor(rt, f, 'anchor_stand', activity);
  else standAtHex(rt, hex, activity);
}

/** Keep the pose the avatar already holds on this tile (an error at a desk does not stand anyone up), else stand. */
function holdOrStand(rt: AvatarRuntime, hex: HexCoord): void {
  if (rt.pose === 'sit' && hexEquals(currentHex(rt), hex)) {
    rt.activity = 'idle';
    rt.follow = null;
    rt.onArrive = null;
    return;
  }
  standSomewhere(rt, hex, 'idle');
}

/** Apply one applied event to the avatar's runtime. */
export function reconcile(rt: AvatarRuntime, ev: CanonicalEvent, isFirst: boolean): void {
  const L = ev.currentLocationHex;
  const T = ev.targetDestinationHex;
  const S = ev.currentState;
  rt.groupId = ev.collaborationGroupId;

  if (isFirst) {
    // No history: appear where the stream says, in the pose the stream says.
    placeAtHex(rt, L);
  }

  if (!isKnownState(S)) {
    rt.alert = 'unknown';
    rt.alertText = `UNKNOWN_STATE · ${S}`;
    ensureAt(rt, L, () => holdOrStand(rt, L), { carrying: false });
    return;
  }
  if (rt.alert !== 'stale') rt.alert = 'none';
  rt.alertText = '';

  switch (S) {
    case 'OFFICE_IDLE': {
      ensureAt(rt, L, () => standSomewhere(rt, L, 'idle'), { carrying: false });
      return;
    }
    case 'OFFICE_WALKING':
    case 'OFFICE_DELIVERING': {
      const carrying = S === 'OFFICE_DELIVERING';
      if (T) {
        if (rt.follow && rt.destination && hexEquals(rt.destination, T)) {
          // Same destination: keep the stride. A large lag behind the reported
          // position is corrected by moving to it and re-planning the rest.
          rt.carrying = carrying;
          const here = currentHex(rt);
          if (hexDistance(here, L) > CATCHUP_MAX_TILES) {
            placeAtHex(rt, L);
            const f = furnitureAt(T);
            walkTo(rt, T, anchorFor(f, carrying ? 'deliver' : 'walk'), () => {
              rt.activity = 'waiting';
            }, { carrying });
            return;
          }
          rt.onArrive = () => {
            rt.activity = 'waiting';
          };
          return;
        }
        // Mid-walk retarget or a new walk: start from where the avatar is,
        // unless it is nowhere near where the stream says it is.
        const here = currentHex(rt);
        if (hexDistance(here, L) > CATCHUP_MAX_TILES) placeAtHex(rt, L);
        const f = furnitureAt(T);
        walkTo(
          rt,
          T,
          anchorFor(f, carrying ? 'deliver' : 'walk'),
          () => {
            rt.activity = 'waiting';
          },
          { carrying },
        );
        return;
      }
      if (carrying) {
        // At the terminal: hand over once per task, then stand empty-handed.
        ensureAt(
          rt,
          L,
          () => {
            const f = furnitureAt(L);
            if (f && FURNITURE_SPECS[f.type].canDeliver) standAtAnchor(rt, f, 'anchor_deliver', 'idle');
            else standSomewhere(rt, L, 'idle');
            if (rt.deliveredTaskId !== ev.currentTaskId) {
              rt.activity = 'delivering';
              rt.deliveredTaskId = ev.currentTaskId;
            }
          },
          { carrying: rt.deliveredTaskId !== ev.currentTaskId },
        );
        return;
      }
      // WALKING with no target: the contract allows it; treat as standing at L.
      ensureAt(rt, L, () => standSomewhere(rt, L, 'idle'), { carrying: false });
      return;
    }
    case 'OFFICE_WORKING': {
      ensureAt(
        rt,
        L,
        () => {
          const f = furnitureAt(L);
          if (f && FURNITURE_SPECS[f.type].canSit) sitAt(rt, f, 'typing');
          else {
            standSomewhere(rt, L, 'idle');
            rt.alert = 'nodesk';
            rt.alertText = 'NO DESK AT TILE';
          }
        },
        { carrying: false },
      );
      return;
    }
    case 'OFFICE_COLLABORATING': {
      ensureAt(
        rt,
        L,
        () => {
          const f = furnitureAt(L);
          if (f && FURNITURE_SPECS[f.type].canSit) sitAt(rt, f, 'talking');
          else standSomewhere(rt, L, 'talking');
        },
        { carrying: false },
      );
      return;
    }
    case 'OFFICE_ERROR': {
      rt.alert = 'error';
      rt.alertText = ev.taskDetails.activeSubtask || 'ERROR';
      ensureAt(rt, L, () => holdOrStand(rt, L), { carrying: false });
      return;
    }
  }
}
