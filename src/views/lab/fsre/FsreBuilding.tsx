/**
 * THE FSRE BUILDING (v2) — the owner's financial-statement reverse-
 * engineering pipeline drawn as an office: departments of agents at desks,
 * a lobby with the router and methodology, a partner room for the owner.
 *
 * Three modes (brief v2 WO-2):
 *   Replay      — the recorded UNVR run, replayed event by event on the
 *                 department floors, and since M3 the live pipeline feed
 *                 (fsre_status.events) as a second run with the owner's
 *                 approve button in the partner room (FsreReplay).
 *   Synthetic   — the mock live office: desks the owner can walk up to,
 *                 commands, new engagements, the industries board (FsreOffice).
 *   Live office — disabled: the v2 transport (commands, engagements, a
 *                 roster) waits for a backend with those entities.
 *
 * OWNER ONLY, and lazy. App.tsx mounts this behind React.lazy for the owner
 * viewer only; a contributor gets FsreOwnerOnly, which imports nothing from
 * here. The replay files are dynamic imports inside the event source.
 *
 * Mount report: docs/lab/fsre-building-mount-report.md; v2 port:
 * docs/lab/fsre-building-v2-port.md.
 */
import type { FsreEventSource } from '../../../logic/lab/fsre/eventSource';
import { FsreModeSwitch } from './FsreModeSwitch';
import { FsreOffice } from './FsreOffice';
import { FsreReplay, REPLAY_SOURCES } from './FsreReplay';
import { useFsreOfficeStore } from './useFsreOfficeStore';

export function FsreBuilding({ sources = REPLAY_SOURCES }: { sources?: readonly FsreEventSource[] }) {
  const mode = useFsreOfficeStore((s) => s.mode);
  const setMode = useFsreOfficeStore((s) => s.setMode);
  return (
    <div className="page-shell">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="page-kicker">Lab</p>
          <h1 className="page-title">FSRE building</h1>
        </div>
        <FsreModeSwitch mode={mode} onMode={setMode} />
      </header>
      {mode === 'synthetic' ? <FsreOffice /> : <FsreReplay sources={sources} />}
    </div>
  );
}
