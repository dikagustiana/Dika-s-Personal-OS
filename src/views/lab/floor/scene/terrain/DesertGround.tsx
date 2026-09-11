import { useMemo } from 'react';
import { runtime } from '../runtime';

/**
 * The desert beyond the tiled campus: one plane that fades into the fog, and a
 * handful of low dunes so the horizon is not a ruler. Static, no shadows cast.
 */
export function DesertGround() {
  const dunes = useMemo(() => {
    const out: Array<{ x: number; z: number; sx: number; sy: number; sz: number }> = [];
    const c = runtime.campusCenter;
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + rnd() * 0.3;
      const dist = 62 + rnd() * 40;
      out.push({
        x: c.x + Math.cos(angle) * dist,
        z: c.z + Math.sin(angle) * dist,
        sx: 18 + rnd() * 26,
        sy: 3 + rnd() * 5,
        sz: 12 + rnd() * 18,
      });
    }
    return out;
  }, []);
  const c = runtime.campusCenter;
  return (
    <group>
      <mesh position={[c.x, -0.02, c.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color="#dcb079" roughness={1} metalness={0} />
      </mesh>
      {dunes.map((d, i) => (
        <mesh key={i} position={[d.x, -0.5, d.z]} scale={[d.sx, d.sy, d.sz]} receiveShadow>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#d9a86f" roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}
