'use client';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useUiStore } from '@/stores/uiStore';
import { DevPanel } from './DevPanel';
import { TopBar } from './TopBar';

// The canvas needs a WebGL context; it never renders on the server.
const OfficeCanvas = dynamic(() => import('@/scene/OfficeCanvas').then((m) => m.OfficeCanvas), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">Loading the campus…</div>
  ),
});

declare global {
  interface Window {
    __bcUi?: typeof useUiStore;
  }
}

function devToolsRequested(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('dev') === '1') return true;
  if (params.get('dev') === '0') return false;
  if (process.env.NEXT_PUBLIC_DEV_TOOLS === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

/** The page: the 3D world underneath, the 2D HUD on top. */
export function OfficeApp() {
  const devTools = useUiStore((s) => s.devTools);
  const setDevTools = useUiStore((s) => s.setDevTools);
  useEffect(() => {
    const on = devToolsRequested();
    setDevTools(on);
    // Scripted verification (Playwright) drives the store through this handle.
    if (on) window.__bcUi = useUiStore;
  }, [setDevTools]);

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <OfficeCanvas />
      <TopBar />
      {devTools ? <DevPanel /> : null}
    </main>
  );
}
