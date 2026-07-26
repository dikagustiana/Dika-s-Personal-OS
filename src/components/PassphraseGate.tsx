import { Lock } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  createSupabaseRepository,
  isSupabaseConfigured,
  requestPassphraseRecovery,
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

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const stored = readStoredKey();
    if (!stored) {
      setState('locked');
      return;
    }
    verifyAppKey(stored)
      .then((result) => {
        if (cancelled) return;
        if (result.valid) {
          setRepository(createSupabaseRepository(stored));
          setState('unlocked');
        } else {
          clearStoredKey();
          setState('locked');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError(OFFLINE_COPY);
        setState('locked');
      });
    return () => {
      cancelled = true;
    };
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
      <form
        onSubmit={unlock}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6"
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
    </div>
  );
}
