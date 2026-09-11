/**
 * THE QUIET CASE (3-D) — a seated agent that is not a skinned avatar, and
 * an empty desk with a name plate.
 *
 * Most desks in an institution are quiet most of the time. Paying full
 * skinning cost for a still figure is waste, and at this staff count it is
 * the difference between a floor that runs and one that does not. So an
 * agent with no current activity renders as a low-cost seated
 * representation: three boxes and a plate, no skeleton, no animation
 * mixer, no shadow pass. It is promoted to a full avatar the moment the
 * institution gives it something to do, and demoted again when it stops.
 *
 * A PHANTOM DESK is the same geometry with nobody in it: a seat the
 * institution has, with its name plate, and no occupant. That is the only
 * way an unfilled seat is visible without reading a warning banner — and
 * the floor should show the institution as it IS, not as the org chart
 * wishes it were.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { hexToWorld } from '../../../../../logic/floor/hex/hex';
import { anchorWorldPose } from '../../../../../logic/floor/layout/resolve';
import type { FurniturePlacement } from '../../../../../logic/floor/layout/types';
import { makeTextSprite } from '../labels/textSprite';
import { FLOOR_Y } from '../runtime';
import {
  HOST,
  LABEL_INK,
  LABEL_INK_QUIET,
  LABEL_PLATE,
  LABEL_PLATE_QUIET,
} from '../../../../../logic/floor/theme/palette';

const SEATED_COLOR = HOST.foregroundSecondary;

function makeSeatedFigure(color: string): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.22), material);
  torso.position.y = 0.62;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), material);
  head.position.y = 0.94;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.34), material);
  legs.position.set(0, 0.41, 0.12);
  for (const part of [torso, head, legs]) {
    part.castShadow = false;
    part.receiveShadow = false;
    part.raycast = () => undefined;
  }
  group.add(torso, head, legs);
  return group;
}

export interface QuietDeskProps {
  desk: FurniturePlacement;
  /** The seat's name plate: an agent slug, staffed or not. */
  label: string;
  /** What this seat is for — shown on an empty desk, which has nothing else to say. */
  seatPurpose?: string;
  occupied: boolean;
  /**
   * Whether to draw the name plate. False for an occupied desk the camera
   * is too far away to read; a PHANTOM desk ignores this and is always
   * named, because an unlabelled empty desk is indistinguishable from
   * furniture. See PLATE_ZOOM in AvatarsLayer.
   */
  showPlate?: boolean;
}

export function QuietDesk({ desk, label, seatPurpose, occupied, showPlate = true }: QuietDeskProps) {
  const object = useMemo(() => {
    const group = new THREE.Group();
    const seat = anchorWorldPose(desk, 'anchor_sit');
    const centre = hexToWorld(desk.hex);

    if (occupied) {
      const figure = makeSeatedFigure(SEATED_COLOR);
      figure.position.set(seat.x - centre.x, FLOOR_Y, seat.z - centre.z);
      figure.rotation.y = seat.yaw;
      group.add(figure);
    }

    // The name plate. An empty desk always carries one; an occupied quiet
    // desk carries one only when the camera is close enough to read it.
    if (!occupied || showPlate) {
      const plate = makeTextSprite(occupied ? label : `${label} · empty desk`, {
        color: occupied ? LABEL_INK : LABEL_INK_QUIET,
        background: occupied ? LABEL_PLATE : LABEL_PLATE_QUIET,
        height: 0.6,
      });
      plate.position.set(0, FLOOR_Y + 1.28, 0);
      group.add(plate);
    }

    if (!occupied && seatPurpose) {
      const purpose = makeTextSprite(seatPurpose.slice(0, 64), {
        color: LABEL_INK_QUIET,
        background: LABEL_PLATE_QUIET,
        height: 0.5,
      });
      purpose.position.set(0, FLOOR_Y + 1.02, 0);
      group.add(purpose);
    }

    group.position.set(centre.x, 0, centre.z);
    return group;
  }, [desk, label, occupied, seatPurpose, showPlate]);

  return <primitive object={object} />;
}
