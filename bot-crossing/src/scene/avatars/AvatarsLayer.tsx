'use client';
import { useFrame } from '@react-three/fiber';
import { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRecord } from '@/core/events/reducer';
import { useAgentStore } from '@/stores/agentStore';
import { useUiStore } from '@/stores/uiStore';
import { Avatar, type AvatarBadge } from './Avatar';
import { AvatarTestDrive } from './AvatarTestDrive';
import { avatarRuntimes, getOrCreateRuntime, turnToward, type AvatarRuntime } from './avatarRuntime';
import { reconcile } from './reconcile';

declare global {
  interface Window {
    __bcAvatars?: typeof avatarRuntimes;
  }
}

/** How long the socket may be down before every avatar is marked STALE. */
const STALE_AFTER_MS = 3000;

function shortLabel(record: AgentRecord): string {
  const id = record.agentId.replace(/^agent-/, '');
  return `${id} · ${record.latest.agentRole}`;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** One streamed agent: reconciles its runtime on every applied event and renders the avatar. */
const StreamAvatar = memo(function StreamAvatar({ record, stale, onClick }: { record: AgentRecord; stale: boolean; onClick: (id: string) => void }) {
  const rt = useMemo(() => getOrCreateRuntime(record.agentId, record.latest.currentLocationHex), [record.agentId, record.latest.currentLocationHex]);
  const first = useRef(true);
  const lastEventId = useRef<string | null>(null);
  if (lastEventId.current !== record.latest.eventId) {
    // Apply synchronously so the frame that renders this record already moves toward it.
    lastEventId.current = record.latest.eventId;
    reconcile(rt, record.latest, first.current);
    first.current = false;
  }
  useEffect(() => {
    rt.alert = stale && rt.alert === 'none' ? 'stale' : !stale && rt.alert === 'stale' ? 'none' : rt.alert;
  }, [rt, stale]);

  const ev = record.latest;
  const badges: AvatarBadge[] = [];
  if (!record.knownState) badges.push({ text: `UNKNOWN_STATE · ${ev.currentState}`, color: '#ff5e6c' });
  else if (ev.currentState === 'OFFICE_ERROR') badges.push({ text: `ERROR · ${ev.taskDetails.activeSubtask || 'see log'}`.slice(0, 60), color: '#ff5e6c' });
  if (ev.currentState === 'OFFICE_COLLABORATING') badges.push({ text: '💬 discussing', color: '#37d2c6' });
  if (rt.alert === 'nodesk') badges.push({ text: 'NO DESK AT TILE', color: '#ffb547' });
  if (rt.unreachable) badges.push({ text: 'NO ROUTE — straight line', color: '#ffb547' });
  if (stale) badges.push({ text: `STALE · last seen ${clock(record.appliedAtMs)}`, color: '#9aa6b8' });
  const hologram =
    ev.currentState === 'OFFICE_WORKING' || ev.currentState === 'OFFICE_COLLABORATING' || ev.currentState === 'OFFICE_ERROR'
      ? { title: ev.taskDetails.title || ev.taskDetails.activeSubtask, progress: ev.taskDetails.progressPercentage }
      : null;

  return (
    <Avatar runtime={rt} label={shortLabel(record)} department={ev.taskDetails.department} badges={badges} hologram={hologram} onClick={onClick} />
  );
});

/** Mutual look-at for standing collaborators: face the centroid of the group. */
function LookAtDriver() {
  useFrame((_, dt) => {
    const groups = new Map<string, AvatarRuntime[]>();
    for (const rt of avatarRuntimes.values()) {
      if (rt.groupId && rt.activity === 'talking') {
        const list = groups.get(rt.groupId) ?? [];
        list.push(rt);
        groups.set(rt.groupId, list);
      }
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      let cx = 0;
      let cz = 0;
      for (const rt of list) {
        cx += rt.x;
        cz += rt.z;
      }
      cx /= list.length;
      cz /= list.length;
      for (const rt of list) {
        if (rt.pose !== 'stand' || rt.follow) continue;
        turnToward(rt, Math.atan2(cx - rt.x, cz - rt.z), dt);
      }
    }
  });
  return null;
}

/** Every avatar in the scene: one per streamed agent, plus the dev test drive when toggled. */
export function AvatarsLayer() {
  const testDrive = useUiStore((s) => s.avatarTestDrive);
  const devTools = useUiStore((s) => s.devTools);
  const agents = useAgentStore((s) => s.agents);
  const connection = useAgentStore((s) => s.connection);
  const setSelected = useUiStore((s) => s.setSelectedAgentId);
  const stale = connection.status !== 'open' && Date.now() - connection.since > STALE_AFTER_MS;
  useEffect(() => {
    if (devTools) window.__bcAvatars = avatarRuntimes;
  }, [devTools]);
  // Re-evaluate staleness while disconnected so the badge appears without a new event.
  useStaleTicker(connection.status !== 'open');
  const records = useMemo(() => Object.values(agents), [agents]);
  return (
    <Suspense fallback={null}>
      <LookAtDriver />
      {records.map((r) => (
        <StreamAvatar key={r.agentId} record={r} stale={stale} onClick={setSelected} />
      ))}
      {testDrive ? <AvatarTestDrive /> : null}
    </Suspense>
  );
}

/** Re-renders the layer once a second while the socket is down. */
function useStaleTicker(active: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  return n;
}
