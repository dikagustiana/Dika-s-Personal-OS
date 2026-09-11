import { useFrame } from '@react-three/fiber';
import { Suspense, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRecord } from '../../../../../logic/floor/events/reducer';
import { useAgentStore } from '../../store/agentStore';
import { useUiStore } from '../../store/uiStore';
import { Avatar, type AvatarBadge } from './Avatar';
import { avatarRuntimes, getOrCreateRuntime, turnToward, type AvatarRuntime } from './avatarRuntime';
import { QuietDesk } from './QuietDesk';
import { Seating } from '../../../../../logic/floor/scenario/seating';
import { activeCampus } from '../../../../../logic/floor/layout/campus';
import { reconcile } from './reconcile';
import { BADGE } from '../../../../../logic/floor/theme/palette';

declare global {
  interface Window {
    __floorAvatars?: typeof avatarRuntimes;
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
  if (!record.knownState) badges.push({ text: `UNKNOWN_STATE · ${ev.currentState}`, color: BADGE.error.background });
  else if (ev.currentState === 'OFFICE_ERROR') badges.push({ text: `ERROR · ${ev.taskDetails.activeSubtask || 'see log'}`.slice(0, 60), color: BADGE.error.background });
  if (ev.currentState === 'OFFICE_COLLABORATING') badges.push({ text: '💬 discussing', color: BADGE.info.background });
  if (rt.alert === 'nodesk') badges.push({ text: 'NO DESK AT TILE', color: BADGE.warn.background });
  if (rt.unreachable) badges.push({ text: 'NO ROUTE — straight line', color: BADGE.warn.background });
  if (stale) badges.push({ text: `STALE · last seen ${clock(record.appliedAtMs)}`, color: BADGE.muted.background });
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

/**
 * States that earn a full skinned avatar. Everything else is a quiet desk
 * (3-D): an institution where most desks are quiet most of the time is the
 * normal case, and paying skinning cost for a still figure is waste.
 */
const ACTIVE_STATES = new Set([
  'OFFICE_WALKING',
  'OFFICE_WORKING',
  'OFFICE_COLLABORATING',
  'OFFICE_DELIVERING',
  'OFFICE_ERROR',
]);

export interface PhantomSeat {
  slug: string;
  label: string;
  seatPurpose: string;
  departmentSlug: string | null;
  role: 'lead' | 'specialist';
}

/**
 * Above this camera zoom, a quiet desk shows whose it is. Below it, it does
 * not.
 *
 * WHY THERE IS A THRESHOLD AT ALL. The standalone office had twenty desks
 * and could label all of them at once. This institution has forty-seven,
 * and a name plate over every one at the default zoom is a wall of white
 * bars that hides the building it is describing — the floor stops being
 * readable at exactly the zoom you use to read the floor. So a quiet
 * OCCUPIED desk earns its plate by being looked at.
 *
 * A PHANTOM DESK IS EXEMPT and is always labelled, at every zoom. An empty
 * seat is the one thing on this floor you cannot see by looking: a desk
 * with nobody at it and no plate is just furniture. Naming it is the whole
 * point of drawing it (3-B), so it does not compete for the budget that
 * declutters everything else.
 */
const PLATE_ZOOM = 26;

/**
 * Every figure on the floor: a full avatar for each agent the institution
 * is currently moving, a quiet seated one for each agent that is idle, and
 * a named empty desk for every seat nobody fills.
 */
export function AvatarsLayer({ phantoms = [] }: { phantoms?: PhantomSeat[] }) {
  const devTools = useUiStore((s) => s.devTools);
  const agents = useAgentStore((s) => s.agents);
  const connection = useAgentStore((s) => s.connection);
  const setSelected = useUiStore((s) => s.setSelectedAgentId);
  const stale = connection.status !== 'open' && Date.now() - connection.since > STALE_AFTER_MS;
  useEffect(() => {
    if (devTools) window.__floorAvatars = avatarRuntimes;
  }, [devTools]);
  // Re-evaluate staleness while disconnected so the badge appears without a new event.
  useStaleTicker(connection.status !== 'open');
  const records = useMemo(() => Object.values(agents), [agents]);
  const active = useMemo(
    () => records.filter((record) => ACTIVE_STATES.has(record.latest.currentState)),
    [records],
  );
  const quiet = useMemo(
    () => records.filter((record) => !ACTIVE_STATES.has(record.latest.currentState)),
    [records],
  );
  const seating = useMemo(() => new Seating(activeCampus()), []);
  const closeEnoughToRead = useUiStore((s) => s.liveZoom) >= PLATE_ZOOM;

  return (
    <Suspense fallback={null}>
      <LookAtDriver />
      {active.map((r) => (
        <StreamAvatar key={r.agentId} record={r} stale={stale} onClick={setSelected} />
      ))}
      {quiet.map((record) => {
        const desk = seating.homeDeskFor(record.agentId, record.latest.taskDetails.department);
        if (!desk) return null;
        return (
          <QuietDesk
            key={`quiet-${record.agentId}`}
            desk={desk}
            label={record.agentId}
            showPlate={closeEnoughToRead}
            occupied
          />
        );
      })}
      {phantoms.map((seat) => {
        const desk = seating.homeDeskFor(`phantom:${seat.slug}`, seat.departmentSlug ?? '', seat.role);
        if (!desk) return null;
        return (
          <QuietDesk
            key={`phantom-${seat.slug}`}
            desk={desk}
            label={seat.label}
            seatPurpose={seat.seatPurpose}
            occupied={false}
          />
        );
      })}
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
