'use client';
// Developer harness for Phase 4: one avatar runs a fixed script — lounge →
// Engineering desk (sit, type) → meeting chair (stand and talk, then sit and
// talk) → carry a document to the output terminal → back to the lounge.
// It is NOT stream data and is never mounted unless the dev toggle is on; the
// HUD shows a banner while it runs (B-1).
import { useEffect, useMemo, useRef } from 'react';
import { freeTilesOfZone, furnitureOfType } from '@/core/layout/campus';
import { CAMPUS } from '@/core/layout/campus';
import type { AnchorName, FurnitureType } from '@/core/layout/types';
import { Avatar } from './Avatar';
import { getOrCreateRuntime, placeAtHex, removeRuntime, sitAt, standAtAnchor, walkTo, type AvatarMode, type AvatarRuntime } from './avatarRuntime';

export const TEST_AGENT_ID = '__test-drive__';

declare global {
  interface Window {
    /** Scripted-verification hooks for the test drive: pause the script and pose the avatar directly. */
    __bcTestDrive?: {
      pause(): void;
      resume(): void;
      sitAt(type: FurnitureType, index: number, mode?: 'sit' | 'talkSit', zoneId?: string): void;
      standAt(type: FurnitureType, index: number, anchor?: AnchorName, mode?: AvatarMode, zoneId?: string): void;
      mode(m: AvatarMode): void;
      runtime(): AvatarRuntime;
    };
  }
}

type Step = (rt: AvatarRuntime, next: () => void) => void;

function wait(ms: number, fn: () => void, timers: Set<ReturnType<typeof setTimeout>>): void {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}

export function AvatarTestDrive() {
  const lounge = useMemo(() => freeTilesOfZone(CAMPUS, 'lounge'), []);
  const desk = useMemo(() => furnitureOfType(CAMPUS, 'workstation', 'engineering')[0], []);
  const chair = useMemo(() => furnitureOfType(CAMPUS, 'meetingChair', 'meeting-a')[0], []);
  const terminal = useMemo(() => furnitureOfType(CAMPUS, 'outputTerminal')[0], []);
  const runtime = useMemo(() => {
    const rt = getOrCreateRuntime(TEST_AGENT_ID, lounge[3]);
    placeAtHex(rt, lounge[3], 0);
    return rt;
  }, [lounge]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const T = timers.current;
    let alive = true;
    let paused = false;
    const steps: Step[] = [
      (rt, next) => {
        rt.mode = 'stand';
        wait(1500, next, T);
      },
      (rt, next) => walkTo(rt, desk.hex, 'anchor_sit', 'walk', next),
      (rt, next) => {
        sitAt(rt, desk, 'sit');
        wait(6000, next, T);
      },
      (rt, next) => {
        standAtAnchor(rt, desk, 'anchor_stand');
        wait(700, next, T);
      },
      (rt, next) => walkTo(rt, chair.hex, 'anchor_sit', 'walk', next),
      (rt, next) => {
        rt.mode = 'talkStand';
        wait(4000, next, T);
      },
      (rt, next) => {
        sitAt(rt, chair, 'talkSit');
        wait(5000, next, T);
      },
      (rt, next) => {
        standAtAnchor(rt, chair, 'anchor_stand');
        wait(500, next, T);
      },
      (rt, next) => walkTo(rt, terminal.hex, 'anchor_deliver', 'carry', next),
      (rt, next) => {
        rt.mode = 'deliver';
        wait(2500, next, T);
      },
      (rt, next) => {
        rt.mode = 'stand';
        wait(800, next, T);
      },
      (rt, next) => walkTo(rt, lounge[3], 'anchor_stand', 'walk', next),
    ];
    let i = 0;
    const run = () => {
      if (!alive || paused) return;
      const step = steps[i % steps.length];
      i++;
      step(runtime, run);
    };
    window.__bcTestDrive = {
      pause: () => {
        paused = true;
        for (const t of T) clearTimeout(t);
        T.clear();
        runtime.follow = null;
        runtime.onArrive = null;
      },
      resume: () => {
        paused = false;
        run();
      },
      sitAt: (type, index, mode = 'sit', zoneId) => {
        const f = furnitureOfType(CAMPUS, type, zoneId)[index];
        if (f) sitAt(runtime, f, mode);
      },
      standAt: (type, index, anchor = 'anchor_stand', mode = 'stand', zoneId) => {
        const f = furnitureOfType(CAMPUS, type, zoneId)[index];
        if (f) standAtAnchor(runtime, f, anchor, mode);
      },
      mode: (m) => {
        runtime.mode = m;
      },
      runtime: () => runtime,
    };
    run();
    return () => {
      alive = false;
      for (const t of T) clearTimeout(t);
      T.clear();
      delete window.__bcTestDrive;
      removeRuntime(TEST_AGENT_ID);
    };
  }, [runtime, desk, chair, terminal, lounge]);

  return <Avatar runtime={runtime} label="TEST DRIVE" department="Engineering Bay" badge={{ text: 'SCRIPTED — NOT STREAM DATA', color: '#ffb547' }} />;
}
