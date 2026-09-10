'use client';
// Developer harness for Phase 4: one avatar runs a fixed script — lounge →
// Engineering desk (sit, type) → meeting chair (stand and talk, then sit and
// talk) → carry a document to the output terminal → back to the lounge.
// It is NOT stream data and is never mounted unless the dev toggle is on; the
// scene shows a banner while it runs (B-1).
import { useEffect, useMemo, useRef } from 'react';
import { CAMPUS, freeTilesOfZone, furnitureOfType } from '@/core/layout/campus';
import type { AnchorName, FurnitureType } from '@/core/layout/types';
import { Avatar } from './Avatar';
import {
  getOrCreateRuntime,
  placeAtHex,
  removeRuntime,
  sitAt,
  standAtAnchor,
  walkTo,
  type AvatarActivity,
  type AvatarRuntime,
} from './avatarRuntime';

export const TEST_AGENT_ID = '__test-drive__';

declare global {
  interface Window {
    /** Scripted-verification hooks for the test drive: pause the script and pose the avatar directly. */
    __bcTestDrive?: {
      pause(): void;
      resume(): void;
      sitAt(type: FurnitureType, index: number, activity?: AvatarActivity, zoneId?: string): void;
      standAt(type: FurnitureType, index: number, anchor?: AnchorName, activity?: AvatarActivity, zoneId?: string): void;
      set(patch: Partial<Pick<AvatarRuntime, 'pose' | 'activity' | 'carrying' | 'alert' | 'alertText'>>): void;
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
        rt.pose = 'stand';
        rt.activity = 'idle';
        wait(1500, next, T);
      },
      (rt, next) => walkTo(rt, desk.hex, 'anchor_sit', next),
      (rt, next) => {
        sitAt(rt, desk, 'typing');
        wait(6000, next, T);
      },
      (rt, next) => {
        standAtAnchor(rt, desk, 'anchor_stand');
        wait(700, next, T);
      },
      (rt, next) => walkTo(rt, chair.hex, 'anchor_sit', next),
      (rt, next) => {
        rt.activity = 'talking';
        wait(4000, next, T);
      },
      (rt, next) => {
        sitAt(rt, chair, 'talking');
        wait(5000, next, T);
      },
      (rt, next) => {
        standAtAnchor(rt, chair, 'anchor_stand');
        wait(500, next, T);
      },
      (rt, next) => walkTo(rt, terminal.hex, 'anchor_deliver', next, { carrying: true }),
      (rt, next) => {
        rt.activity = 'delivering';
        wait(2500, next, T);
      },
      (rt, next) => {
        rt.activity = 'idle';
        rt.carrying = false;
        wait(800, next, T);
      },
      (rt, next) => walkTo(rt, lounge[3], 'anchor_stand', next),
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
      sitAt: (type, index, activity = 'typing', zoneId) => {
        const f = furnitureOfType(CAMPUS, type, zoneId)[index];
        if (f) sitAt(runtime, f, activity);
      },
      standAt: (type, index, anchor = 'anchor_stand', activity = 'idle', zoneId) => {
        const f = furnitureOfType(CAMPUS, type, zoneId)[index];
        if (f) standAtAnchor(runtime, f, anchor, activity);
      },
      set: (patch) => Object.assign(runtime, patch),
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

  return (
    <Avatar
      runtime={runtime}
      label="TEST DRIVE"
      department="Engineering Bay"
      badges={[{ text: 'SCRIPTED — NOT STREAM DATA', color: '#ffb547' }]}
    />
  );
}
