'use client';
import { useEffect, useMemo } from 'react';
import { hexToWorld } from '@/core/hex/hex';
import { CAMPUS } from '@/core/layout/campus';
import { FLOOR_Y } from '../runtime';
import { makeTextSprite } from './textSprite';

/** One canvas sprite per zone, floating above the pod. Nine sprites, nine draw calls. */
export function ZoneSigns() {
  const sprites = useMemo(
    () =>
      CAMPUS.zones.map((z) => {
        let x = 0;
        let zz = 0;
        for (const h of z.tiles) {
          const w = hexToWorld(h);
          x += w.x;
          zz += w.z;
        }
        x /= z.tiles.length;
        zz /= z.tiles.length;
        const sprite = makeTextSprite(z.label, { background: 'rgba(16,20,28,0.78)', accent: '#37D2C6', height: 1.1 });
        sprite.position.set(x, FLOOR_Y + 3.9, zz);
        sprite.renderOrder = 5;
        return sprite;
      }),
    [],
  );
  useEffect(
    () => () => {
      for (const s of sprites) {
        s.material.map?.dispose();
        s.material.dispose();
      }
    },
    [sprites],
  );
  return (
    <group>
      {sprites.map((s, i) => (
        <primitive key={i} object={s} />
      ))}
    </group>
  );
}
