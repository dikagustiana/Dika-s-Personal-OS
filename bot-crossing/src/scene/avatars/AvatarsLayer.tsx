'use client';
import { Suspense, useEffect } from 'react';
import { useUiStore } from '@/stores/uiStore';
import { AvatarTestDrive } from './AvatarTestDrive';
import { avatarRuntimes } from './avatarRuntime';

declare global {
  interface Window {
    __bcAvatars?: typeof avatarRuntimes;
  }
}

/** Every avatar in the scene. Phase 4: the dev test drive; Phase 5 adds one avatar per streamed agent. */
export function AvatarsLayer() {
  const testDrive = useUiStore((s) => s.avatarTestDrive);
  const devTools = useUiStore((s) => s.devTools);
  useEffect(() => {
    if (devTools) window.__bcAvatars = avatarRuntimes;
  }, [devTools]);
  return <Suspense fallback={null}>{testDrive ? <AvatarTestDrive /> : null}</Suspense>;
}
