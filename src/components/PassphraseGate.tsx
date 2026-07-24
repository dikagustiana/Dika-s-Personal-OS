import { Lock } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  createSupabaseRepository,
  isSupabaseConfigured,
  verifyAppKey,
} from '../data/supabaseRepository';
import { useAppStore } from '../store/appStore';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

const STORAGE_KEY = 'personal-os-app-key';

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

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setState('locked');
      return;
    }
    verifyAppKey(stored)
      .then((valid) => {
        if (cancelled) return;
        if (valid) {
          setRepository(createSupabaseRepository(stored));
          setState('unlocked');
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
          setState('locked');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not reach the database. Check your connection and retry.');
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
      const valid = await verifyAppKey(candidate);
      if (valid) {
        window.localStorage.setItem(STORAGE_KEY, candidate);
        setRepository(createSupabaseRepository(candidate));
        setState('unlocked');
      } else {
        setError('That passphrase is not correct.');
      }
    } catch {
      setError('Could not reach the database. Check your connection and retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (state === 'unlocked') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-sm text-gray-600">
        Unlocking…
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <form
        onSubmit={unlock}
        className="w-full max-w-sm border border-gray-800 bg-card p-6"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-10 place-items-center border border-primary/50 bg-primary/10">
            <Lock className="size-5 text-primary" />
          </div>
          <div>
            <p className="font-bold tracking-tight">PERSONAL OS</p>
            <p className="text-[10px] uppercase tracking-[0.22em] text-gray-600">
              Passphrase required
            </p>
          </div>
        </div>
        <Input
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="Enter passphrase"
          aria-label="App passphrase"
          autoFocus
        />
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <Button type="submit" className="mt-4 w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Checking…' : 'Unlock'}
        </Button>
      </form>
    </div>
  );
}
