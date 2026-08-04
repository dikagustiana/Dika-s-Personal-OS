import { Lock } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  consumeCollaboratorToken,
  createCollaboratorRepository,
  createSupabaseRepository,
  getCollaboratorUser,
  isSupabaseConfigured,
  listMyMemberships,
  requestPassphraseRecovery,
  signOutCollaborator,
  verifyAppKey,
} from '../data/supabaseRepository';
import { useAppStore } from '../store/appStore';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
// The photograph, its glob-based loader and its fallback to the mark all live
// in LanternPhoto — the gate is no longer the only surface that renders it, and
// one copy of the "must not break the build if the file is absent" pattern is
// the point of putting it there.
import { LANTERN_ALT, LanternPhoto } from './ui/LanternPhoto';

const STORAGE_KEY = 'personal-os-app-key';
const EXPIRY_KEY = 'personal-os-app-key-expires';
/** How long an unlocked session lasts before the passphrase is asked for again. */
const SESSION_HOURS = 12;

const OFFLINE_COPY = 'Could not reach the database. Check your connection and retry.';
/**
 * Offered only after the third miss: an escape hatch on the first screen is an
 * invitation to use it instead of remembering.
 */
const FAILURES_BEFORE_RECOVERY = 3;
/**
 * The request answers the same way whether or not it sent anything, so the copy
 * cannot promise a delivery. It also has to be clear that a link is coming and
 * not the passphrase — the stored secret is a hash and cannot be read back.
 */
const RECOVERY_SENT_COPY =
  'If an address is on file, a link for setting a new passphrase has been sent. It works once and expires in 30 minutes. The passphrase itself cannot be sent — it is not stored in a readable form.';

/**
 * The credential lives in sessionStorage, not localStorage: it dies with the
 * tab, and expires on its own inside a long-lived one. It cannot be dropped
 * entirely — RLS validates the passphrase on the `x-app-key` header of every
 * request, so the value has to survive as long as the session does.
 */
/**
 * Exported so Edge Functions that spend money can attach the same header RLS
 * checks. Reading it here rather than caching a copy elsewhere keeps one
 * definition of "is the session still unlocked", including the expiry.
 */
export function readStoredKey(): string | null {
  const key = window.sessionStorage.getItem(STORAGE_KEY);
  const expires = Number(window.sessionStorage.getItem(EXPIRY_KEY) ?? 0);
  if (!key || !expires || Date.now() > expires) {
    clearStoredKey();
    return null;
  }
  return key;
}

function storeKey(key: string) {
  window.sessionStorage.setItem(STORAGE_KEY, key);
  window.sessionStorage.setItem(
    EXPIRY_KEY,
    String(Date.now() + SESSION_HOURS * 60 * 60 * 1000),
  );
}

/**
 * Explicit lock. Reloading is the point as much as clearing the key: it drops
 * the in-memory repository holding the credential along with everything
 * rendered from it.
 */
export function lockApp() {
  clearStoredKey();
  window.location.reload();
}

export function clearStoredKey() {
  window.sessionStorage.removeItem(STORAGE_KEY);
  window.sessionStorage.removeItem(EXPIRY_KEY);
  // Older builds kept the raw passphrase here forever.
  window.localStorage.removeItem(STORAGE_KEY);
}

type GateState = 'checking' | 'locked' | 'unlocked';

/**
 * Blocks the app until the Supabase passphrase is verified. The passphrase is
 * checked server-side (os_verify_key RPC) and then attached to every request
 * as the x-app-key header that RLS validates — it never lives in the bundle.
 * When Supabase env vars are absent the gate is transparent and the app runs
 * on the in-memory mock repository.
 */
export function PassphraseGate({ children }: { children: ReactNode }) {
  const setRepository = useAppStore((state) => state.setRepository);
  const setViewer = useAppStore((state) => state.setViewer);
  const setWorkspace = useAppStore((state) => state.setWorkspace);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const [state, setState] = useState<GateState>(
    isSupabaseConfigured ? 'checking' : 'unlocked',
  );
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The "file exists but fails to decode" second line of defence moved into
  // LanternPhoto with the image itself, so every surface gets it rather than
  // only this one.
  // This session only. A reload is a fresh start, which is the right default:
  // the counter exists to spot someone struggling now, not to keep a record.
  const [failures, setFailures] = useState(0);
  const [recovery, setRecovery] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  // The collaborator side of the gate has NO CONTROL — deliberately. The app
  // never sends email, so an email form here would be a control that lies
  // about what it does and an abuse surface against arbitrary addresses.
  // Collaborators arrive by an owner-handed link (#collab_token=…), consumed
  // below; when a session lapses they ask the owner for a fresh one. This
  // notice line is the only collaborator-facing surface on the gate.
  const [collabNotice, setCollabNotice] = useState<string | null>(null);

  /**
   * Enters the app as the given collaborator session. Membership decides:
   * a session with no os_entity_members rows is signed out and told so —
   * an authenticated stranger holds a JWT that reads nothing, and letting
   * them into an all-empty shell would look broken rather than closed.
   */
  const enterAsCollaborator = async (user: { id: string; email?: string }) => {
    const entityCodes = await listMyMemberships();
    if (entityCodes.length === 0) {
      await signOutCollaborator();
      setCollabNotice('Akun ini belum punya akses. Hubungi pemilik untuk didaftarkan.');
      setState('locked');
      return;
    }
    setRepository(createCollaboratorRepository());
    setViewer({ kind: 'contributor', userId: user.id, email: user.email, entityCodes });
    // Collaborators live in WORK, on the matrix. GROWTH has no nav for them
    // (and no data behind it either way — RLS, not the nav, is the boundary).
    setWorkspace('work');
    setWorkView('finish-line');
    setState('unlocked');
  };

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const stored = readStoredKey();
    const enter = async () => {
      // Owner first: on a machine where both credentials somehow exist, the
      // passphrase wins — it is the wider capability and the owner's own.
      if (stored) {
        const result = await verifyAppKey(stored);
        if (cancelled) return true;
        if (result.valid) {
          setRepository(createSupabaseRepository(stored));
          setState('unlocked');
          return true;
        }
        clearStoredKey();
      }
      // An owner-handed sign-in link: #collab_token=<hashed token minted by
      // provision-collaborator>. Consumed exactly once, then stripped from
      // the URL so a reload or a shared screenshot does not re-present it.
      const tokenMatch = window.location.hash.match(/collab_token=([A-Za-z0-9._-]+)/);
      if (tokenMatch) {
        const consumed = await consumeCollaboratorToken(tokenMatch[1]);
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search,
        );
        if (cancelled) return true;
        if (consumed.user) {
          await enterAsCollaborator(consumed.user);
          return true;
        }
        setCollabNotice('Tautan tidak berlaku atau sudah dipakai. Minta tautan baru ke pemilik.');
        return false;
      }
      // Then an existing collaborator session (persistSession keeps them in).
      const user = await getCollaboratorUser();
      if (cancelled) return true;
      if (user) {
        await enterAsCollaborator(user);
        return true;
      }
      return false;
    };
    enter()
      .then((entered) => {
        if (!cancelled && !entered) setState('locked');
      })
      .catch(() => {
        if (cancelled) return;
        setError(OFFLINE_COPY);
        setState('locked');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setRepository]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    const candidate = passphrase.trim();
    if (!candidate || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await verifyAppKey(candidate);
      if (!result.valid) setFailures((count) => count + 1);
      if (result.valid) {
        storeKey(candidate);
        setPassphrase('');
        setRepository(createSupabaseRepository(candidate));
        setState('unlocked');
      } else if (result.lockedOut) {
        const until = new Date(Date.now() + (result.retryAfter ?? 900) * 1000);
        const hh = String(until.getHours()).padStart(2, '0');
        const mm = String(until.getMinutes()).padStart(2, '0');
        setError(`Locked until ${hh}:${mm}.`);
      } else if (result.attemptsRemaining !== undefined && result.attemptsRemaining <= 3) {
        const n = result.attemptsRemaining;
        setError(`Not correct. ${n} attempt${n === 1 ? '' : 's'} left.`);
      } else {
        setError('That passphrase is not correct.');
      }
    } catch {
      setError(OFFLINE_COPY);
    } finally {
      setIsSubmitting(false);
    }
  };

  const askForRecovery = async () => {
    if (recovery === 'sending') return;
    setRecovery('sending');
    setRecoveryNotice(null);
    try {
      await requestPassphraseRecovery();
      setRecovery('sent');
      setRecoveryNotice(RECOVERY_SENT_COPY);
    } catch {
      setRecovery('idle');
      setRecoveryNotice(OFFLINE_COPY);
    }
  };


  if (state === 'unlocked') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-sm text-foreground-muted">
        Unlocking…
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
      <form
        onSubmit={unlock}
        className="w-full rounded-lg border border-border bg-card p-6"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md border border-border bg-surface-2">
            <Lock className="size-5 text-foreground-secondary" />
          </div>
          <div>
            <p className="font-display text-base font-semibold tracking-tight">Personal OS</p>
            <p className="surface-label mt-0.5">Passphrase required</p>
          </div>
        </div>
        {/* Fixed box either way, so the mark standing in for the photo costs
            no layout shift. The photo is RGB with square corners, hence the
            clipped radius — a hard rectangle on the light canvas would read
            as an unstyled asset. */}
        <div className="mx-auto mb-5 grid size-[120px] place-items-center overflow-hidden rounded-lg border border-border-subtle bg-surface-2">
          <LanternPhoto
            size={120}
            alt={LANTERN_ALT}
            className="size-full object-cover"
            markClassName="w-14"
            markTitle="A sky lantern rising at night"
          />
        </div>
        <Input
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="Enter passphrase"
          aria-label="App passphrase"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'passphrase-error' : undefined}
          autoFocus
        />
        {/* Plain copy, not an alert banner — the lockout is information. The
            id is what ties it to the input programmatically; without it a
            screen reader hears an unexplained rejection on the first screen
            of every session. */}
        {error && (
          <p
            id="passphrase-error"
            className="mt-3 text-sm text-foreground-secondary"
            role="status"
          >
            {error}
          </p>
        )}
        <Button type="submit" className="mt-4 w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Checking…' : 'Unlock'}
        </Button>
        {failures >= FAILURES_BEFORE_RECOVERY && recovery !== 'sent' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={askForRecovery}
            disabled={recovery === 'sending'}
          >
            {recovery === 'sending' ? 'Sending…' : 'Forgot passphrase?'}
          </Button>
        )}
        {/* Present from the start so the announcement lands, collapsed while
            empty so it costs no space. */}
        <div
          role="status"
          aria-live="polite"
          className="mt-3 text-sm text-foreground-secondary empty:hidden"
        >
          {recoveryNotice}
        </div>
      </form>

      {/* No collaborator control here, deliberately: the app sends no email,
          so a form would lie about what it does and invite sends against
          arbitrary addresses. Collaborators arrive by an owner-handed link;
          this line is where a dead link's outcome is explained. */}
      <p
        role="status"
        aria-live="polite"
        className="mx-auto mt-3 max-w-sm text-center text-xs text-foreground-muted"
      >
        {collabNotice ?? 'Kolaborator masuk lewat tautan dari pemilik.'}
      </p>
      </div>
    </div>
  );
}
