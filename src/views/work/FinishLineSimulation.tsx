/**
 * SIMULASI HARI-H — THE FINISH LINE'S FOURTH TAB. OWNER ONLY.
 *
 * Shows one offline HTML simulation that is built in a separate repository.
 * This app stores and shows the build and nothing more: it never builds,
 * edits or bundles the simulation, and the mock carries none. The HTML comes
 * from the finish-line-simulation Edge Function (a private bucket with no
 * policy, the owner key checked on every request) and is rendered into a
 * sandboxed iframe through a Blob URL.
 *
 * Owner-only twice over: FinishLineArea never mounts this component for a
 * contributor (it renders FinishLineSimulationOwnerOnly instead, which sends
 * nothing), and a repository without the owner key answers owner-only
 * without a request.
 *
 * The seven states are distinct on purpose, and the two that matter most
 * must never be confused: "belum ada versi" (the pointer was never written —
 * an observation) and "tidak bisa dicek" (the function is not deployed, the
 * bucket is missing, the pointer is broken — a failure to look). Only the
 * first may show the empty state, and neither shows a version, a size or a
 * date it does not have.
 *
 * CSP: there is none today (vercel.json carries only the SPA rewrite). A
 * Content-Security-Policy added to this app later is INHERITED by the Blob
 * document in the iframe — measured in Chromium: `script-src 'self'` on the
 * parent refuses the simulation's inline scripts, and the build runs on
 * inline scripts. Whoever adds a CSP must write it with this tab in mind, or
 * the tab goes blank without an error anyone sees.
 */
import { Maximize2, TriangleAlert, Upload, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  SIMULATION_MAX_BYTES,
  checkSimulationUpload,
  simulationSizeFailure,
  type SimulationGuardCode,
  type SimulationGuardFailure,
} from '../../../supabase/functions/_shared/simulationUpload';
import { Button } from '../../components/ui/Button';
import type { FinishLineSimulation as Simulation } from '../../data/finishLineSimulation';
import type { ReadFailure } from '../../data/readResult';
import { useMutation } from '../../hooks/useMutation';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';

type ReadState =
  | { kind: 'loading' }
  | { kind: 'failed'; failure: ReadFailure; offline: boolean }
  | { kind: 'empty' }
  | { kind: 'ready'; simulation: Simulation };

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'rejected'; codes: SimulationGuardCode[]; messages: string[] };

/**
 * The simulation is designed for 1366×768 and 1920×1080. Embedded under the
 * page header at 1366×768 it gets roughly 1,046 px of width, so this floor
 * keeps it usable and "Layar penuh" is the real presentation mode.
 */
const MIN_FRAME_HEIGHT = 480;
const FRAME_BOTTOM_GAP = 24;

const PANEL = 'rounded-lg border border-border-subtle bg-card px-4 py-4';

function rejectedFrom(failures: SimulationGuardFailure[]): UploadState {
  return {
    kind: 'rejected',
    codes: failures.map((failure) => failure.code),
    messages: failures.map((failure) => failure.message),
  };
}

function formatUploadedAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(at);
}

/** Decimal megabytes, the unit the build's size is quoted in ("1,49 MB"). */
function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} MB`;
}

/** What a contributor sees at /finish-line/simulasi: a sentence, and no request. */
export function FinishLineSimulationOwnerOnly() {
  return (
    <div role="status" className={PANEL}>
      <p className="surface-label">Simulasi Hari-H</p>
      <p className="mt-1 text-sm text-foreground-secondary">Tab ini hanya untuk owner.</p>
    </div>
  );
}

export function FinishLineSimulation() {
  const repository = useAppStore((state) => state.repository);
  const { run } = useMutation();

  const [read, setRead] = useState<ReadState>({ kind: 'loading' });
  const [upload, setUpload] = useState<UploadState>({ kind: 'idle' });
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(MIN_FRAME_HEIGHT);
  const [fullscreenFailed, setFullscreenFailed] = useState(false);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Every load takes a number; only the latest may write the state, so a slow
  // read that returns after a newer one cannot put an old version back.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setRead({ kind: 'loading' });
    const result = await repository.readFinishLineSimulation();
    if (seq !== loadSeq.current) return;
    if (!result.ok) {
      setRead({ kind: 'failed', failure: result, offline: navigator.onLine === false });
    } else if (result.value === null) {
      setRead({ kind: 'empty' });
    } else {
      setRead({ kind: 'ready', simulation: result.value });
    }
  }, [repository]);

  useEffect(() => {
    void load();
    return () => {
      loadSeq.current += 1; // unmounted: drop whatever is still in flight
    };
  }, [load]);

  // Offline: try again by itself the moment the connection comes back.
  useEffect(() => {
    if (read.kind !== 'failed' || !read.offline) return;
    const onOnline = () => void load();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [read, load]);

  // The Blob URL follows the HTML: a new version revokes the old URL, and so
  // does leaving the tab. Keyed on the string itself, so re-reading the same
  // version does not restart a simulation someone is in the middle of.
  const html = read.kind === 'ready' ? read.simulation.html : null;
  useEffect(() => {
    if (html === null) {
      setFrameUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    setFrameUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [html]);

  // Fill the viewport below the frame's own top edge, never below the floor.
  useLayoutEffect(() => {
    if (!frameUrl) return;
    const measure = () => {
      const top = frameBoxRef.current?.getBoundingClientRect().top ?? 0;
      setFrameHeight(Math.max(MIN_FRAME_HEIGHT, Math.floor(window.innerHeight - top - FRAME_BOTTOM_GAP)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [frameUrl]);

  /**
   * Fullscreen from the PARENT. The simulation has its own fullscreen key,
   * but inside a sandbox that call can fail, and a presenter needs one that
   * does not. Measured in Chromium: the parent's requestFullscreen on the
   * iframe works with allow="fullscreen".
   */
  const enterFullscreen = async () => {
    setFullscreenFailed(false);
    const frame = frameRef.current;
    if (!frame || typeof frame.requestFullscreen !== 'function') {
      setFullscreenFailed(true);
      return;
    }
    try {
      await frame.requestFullscreen();
    } catch {
      setFullscreenFailed(true);
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared at once so choosing the same file again, after fixing it,
    // fires another change event.
    event.target.value = '';
    if (!file) return;
    // The pre-flight runs the server's own guards (one shared module). An
    // oversize file is refused from its size alone, before it is read; the
    // server is still the authority and checks everything again.
    if (file.size > SIMULATION_MAX_BYTES) {
      setUpload(rejectedFrom([simulationSizeFailure(file.size)]));
      return;
    }
    const text = await file.text();
    const check = checkSimulationUpload(text);
    if (!check.ok) {
      setUpload(rejectedFrom(check.failures));
      return;
    }
    setUpload({ kind: 'uploading' });
    const outcome = await run('Upload simulasi', async () => {
      const result = await repository.uploadFinishLineSimulation(text);
      // Inside the action on purpose: the toast's Retry re-runs this
      // function, and a retried upload that lands must refresh the tab too.
      if (result.ok) {
        setUpload({ kind: 'idle' });
        // Re-read rather than show the local file: what the tab displays is
        // what the server now serves, never what this browser just sent.
        await load();
      } else {
        setUpload({ kind: 'rejected', codes: result.codes, messages: result.messages });
      }
      return result;
    });
    // Thrown: the retryable toast already says what failed.
    if (outcome === undefined) setUpload({ kind: 'idle' });
  };

  const uploading = upload.kind === 'uploading';
  const chooseFile = () => fileRef.current?.click();

  const uploadButton = (primary: boolean, label: string) => (
    <Button
      type="button"
      variant={primary ? 'default' : 'secondary'}
      size="sm"
      onClick={chooseFile}
      disabled={uploading}
    >
      <Upload className="size-3.5" aria-hidden />
      {uploading ? 'Mengunggah…' : label}
    </Button>
  );

  return (
    <section aria-label="Simulasi Hari-H" className="grid gap-4">
      <input
        ref={fileRef}
        type="file"
        accept=".html,text/html"
        className="sr-only"
        aria-label="File HTML simulasi"
        tabIndex={-1}
        onChange={(event) => void onFile(event)}
      />

      {read.kind === 'loading' && (
        <div className={PANEL} role="status">
          <span className="surface-label">Simulasi Hari-H</span>
          <p className="mt-1 text-xs text-foreground-muted">Memeriksa versi simulasi…</p>
        </div>
      )}

      {read.kind === 'failed' && read.offline && (
        <div className={PANEL} role="alert">
          <p className="flex items-center gap-2 text-sm font-semibold text-escalate">
            <WifiOff className="size-4" aria-hidden />
            Offline
          </p>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            Sambungkan internet, lalu coba lagi. Tab ini mencoba lagi sendiri begitu koneksi kembali.
          </p>
          <div className="mt-3">
            <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
              Coba lagi
            </Button>
          </div>
        </div>
      )}

      {read.kind === 'failed' && !read.offline && (
        <div className={PANEL} role="alert">
          <p
            className={cn(
              'flex items-center gap-2 text-sm font-semibold',
              read.failure.reason === 'failed' ? 'text-destructive' : 'text-escalate',
            )}
          >
            <TriangleAlert className="size-4" aria-hidden />
            Tidak bisa dicek
          </p>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            {read.failure.reason === 'missing-relation'
              ? 'Bagian server untuk simulasi belum terpasang di sini (function atau bucket), jadi tidak ada yang bisa ditampilkan. Ini bukan tanda belum ada versi.'
              : 'Pembacaan tidak selesai, jadi tidak ada versi yang ditampilkan. Ini bukan tanda belum ada versi.'}
          </p>
          <p className="mt-1 break-words text-[11px] leading-5 text-foreground-muted">{read.failure.detail}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
              Coba lagi
            </Button>
            {uploadButton(false, 'Unggah versi baru')}
          </div>
        </div>
      )}

      {read.kind === 'empty' && (
        <div className={PANEL}>
          <p className="surface-label">Simulasi Hari-H</p>
          <p className="mt-1 text-sm text-foreground">Belum ada versi simulasi.</p>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            Unggah file HTML hasil build simulasi (maksimal 3 MB).
          </p>
          <div className="mt-3">{uploadButton(true, 'Pilih file HTML…')}</div>
        </div>
      )}

      {read.kind === 'ready' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-foreground-muted" data-testid="simulation-meta">
              Versi {formatUploadedAt(read.simulation.meta.uploadedAt)} · {formatSize(read.simulation.meta.bytes)} ·{' '}
              <span className="font-mono">{read.simulation.meta.sha256.slice(0, 8)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void enterFullscreen()}>
                <Maximize2 className="size-3.5" aria-hidden />
                Layar penuh
              </Button>
              {uploadButton(false, 'Unggah versi baru')}
            </div>
          </div>
          {fullscreenFailed && (
            <p className="text-xs text-escalate">Layar penuh tidak tersedia di browser ini.</p>
          )}
          <p className="text-xs text-foreground-muted">
            Klik area simulasi dulu, lalu pakai ← → Spasi 1–7 N F R T P A Esc.
          </p>
          <div ref={frameBoxRef}>
            {frameUrl && (
              <iframe
                key={frameUrl}
                ref={frameRef}
                src={frameUrl}
                // sandbox="allow-scripts" AND NOTHING ELSE — this attribute is
                // the tab's whole security model. Without allow-same-origin the
                // simulation's script runs in an opaque origin: it cannot read
                // this app's sessionStorage, where the owner's x-app-key lives
                // (PassphraseGate), nor localStorage, cookies or
                // parent.document — measured in Chromium, all SecurityError.
                // allow-popups, allow-forms, allow-modals and
                // allow-top-navigation would each hand the file a way out of
                // the frame; the current build uses none of them. A test pins
                // this exact string: widening it is a decision, not a tidy-up.
                sandbox="allow-scripts"
                allow="fullscreen"
                title={`Simulasi Hari-H — versi ${read.simulation.meta.sha256.slice(0, 8)}`}
                className="block w-full rounded-lg border border-border bg-card"
                style={{ height: frameHeight }}
              />
            )}
          </div>
        </>
      )}

      {upload.kind === 'rejected' && (
        <div className={PANEL} role="alert" data-testid="upload-rejected">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <TriangleAlert className="size-4" aria-hidden />
            Upload ditolak — {upload.codes.length} pemeriksaan gagal
          </p>
          <ul className="mt-2 grid gap-1 text-xs leading-5 text-foreground-secondary">
            {upload.codes.map((code, index) => (
              <li key={code}>
                <span className="font-mono font-semibold">{code}</span> — {upload.messages[index] ?? ''}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setUpload({ kind: 'idle' })}>
              Tutup
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
