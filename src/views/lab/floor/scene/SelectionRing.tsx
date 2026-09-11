import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useUiStore } from '../store/uiStore';
import { SELECTION } from '../../../../logic/floor/theme/palette';
import { avatarRuntimes } from './avatars/avatarRuntime';

/** Teal ring under the selected avatar. One mesh, moved per frame; hidden when nothing is selected. */
export function SelectionRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const id = useUiStore.getState().selectedAgentId;
    const rt = id ? avatarRuntimes.get(id) : undefined;
    if (!rt) {
      m.visible = false;
      return;
    }
    m.visible = true;
    m.position.set(rt.x, rt.y + 0.02, rt.z);
    const s = 1 + 0.06 * Math.sin(clock.elapsedTime * 3);
    m.scale.set(s, s, s);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={2}>
      <ringGeometry args={[0.5, 0.64, 40]} />
      <meshBasicMaterial color={SELECTION} transparent opacity={0.85} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}
