import { KeyRound } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  consumePassphraseRecovery,
  isSupabaseConfigured,
} from '../data/supabaseRepository';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

/**
 * Mirrors the floor consume-passphrase-recovery enforces. Duplicated here for
 * feedback only — the server and the database each hold the rule independently,
 * so a client that skipped this check would still be refused.
 */
const MIN_LENGTH = 12;
/** A length rule on its own accepts twelve of the same character. */
const MIN_DISTINCT = 4;

const RULES_COPY = `At least ${MIN_LENGTH} characters, using at least ${MIN_DISTINCT} different ones.`;
/**
 * Expired, already used and never-issued come back from the server as one
 * answer on purpose, so the copy names the possibilities without claiming which
 * one it was.
 */
const INVALID_COPY =
  'This link did not work. A recovery link works once and expires 30 minutes after it is sent, so it may already have been used or run out. Ask for a new one from the unlock screen.';
const OFFLINE_COPY = 'Could not reach the database. Check your connection and retry.';

const HASH_PREFIX = '#recover=';
const QUERY_KEY = 'recover';
/**
 * The emailed token is 32 random bytes in base64url. Matching its shape here
 * keeps an ordinary fragment (or a mangled link) from switching the app into
 * recovery and from being posted anywhere as if it were a credential.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

/**
 * Reads the recovery token the emailed link carries. The link puts it in the
 * fragment (`/#recover=…`), which browsers never send to a server — so it stays
 * out of access logs and Referer headers. A `?recover=` query is accepted as
 * well: a mail client that rewrites the link would otherwise strand the owner
 * with no way back in.
 */
export function readRecoveryToken(): string | null {
  const { hash, search } = window.location;
  const fromHash = hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : '';
  const candidate = fromHash || (new URLSearchParams(search).get(QUERY_KEY) ?? '');
  return TOKEN_PATTERN.test(candidate) ? candidate : null;
}

/**
 * replaceState rather than pushState: the entry holding the token is
 * overwritten instead of added to, so Back cannot bring it back and a reload
 * cannot re-submit it.
 */
function clearRecoveryTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete(QUERY_KEY);
  url.hash = '';
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

function tooWeak(candidate: string): boolean {
  return candidate.length < MIN_LENGTH || new Set(candidate).size < MIN_DISTINCT;
}

/** The gate's own card, so arriving from the email does not feel like a detour. */
function Frame({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-surface-2">
            <KeyRound className="size-5 text-foreground-secondary" />
          </div>
          <div>
            <p className="font-display text-base font-semibold tracking-tight">Personal OS</p>
            <p className="surface-label mt-0.5">{caption}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

type Stage = 'form' | 'saving' | 'done';

/**
 * Redeems a recovery link: takes a new passphrase, hands it to the
 * consume-passphrase-recovery Edge Function together with the token, and hands
 * the owner back to the gate. Rendered instead of the gate — the whole point is
 * to be reachable while the passphrase is unknown.
 */
export function PassphraseRecovery({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [candidate, setCandidate] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [message, setMessage] = useState<string | null>(null);
  // Reported by the server. False means the new passphrase is live but the
  // unlock screen is still counting down its lockout.
  const [lockoutCleared, setLockoutCleared] = useState(true);

  const leave = () => {
    clearRecoveryTokenFromUrl();
    onDone();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (stage === 'saving') return;
    if (candidate !== confirmation) {
      setMessage('The two passphrases do not match.');
      return;
    }
    if (tooWeak(candidate)) {
      setMessage(RULES_COPY);
      return;
    }
    setStage('saving');
    setMessage(null);
    try {
      const result = await consumePassphraseRecovery(token, candidate);
      if (result.outcome === 'ok') {
        // Spent, so it leaves the URL immediately rather than at the next click.
        clearRecoveryTokenFromUrl();
        setCandidate('');
        setConfirmation('');
        setLockoutCleared(result.lockoutCleared !== false);
        setStage('done');
        return;
      }
      setStage('form');
      setMessage(result.outcome === 'weak' ? RULES_COPY : INVALID_COPY);
    } catch {
      setStage('form');
      setMessage(OFFLINE_COPY);
    }
  };

  // A bare clone runs on the mock repository with no Supabase credentials, so
  // there is no function to call and nothing to change.
  if (!isSupabaseConfigured) {
    return (
      <Frame caption="Recovery unavailable">
        <p className="text-sm text-foreground-secondary">
          This build has no database configured, so there is no passphrase to change.
        </p>
        <Button type="button" variant="secondary" className="mt-4 w-full" onClick={leave}>
          Continue
        </Button>
      </Frame>
    );
  }

  if (stage === 'done') {
    return (
      <Frame caption="Passphrase updated">
        <p className="text-sm text-foreground-secondary">
          You can now unlock with your new passphrase.
          {!lockoutCleared &&
            ' The unlock screen may still be locked out from the earlier attempts; if it is, wait for it to lift and try again.'}
        </p>
        <Button type="button" className="mt-4 w-full" onClick={leave} autoFocus>
          Continue to unlock
        </Button>
      </Frame>
    );
  }

  return (
    <Frame caption="Set a new passphrase">
      <form onSubmit={submit}>
        <label htmlFor="recovery-passphrase" className="surface-label mb-1.5 block">
          New passphrase
        </label>
        <Input
          id="recovery-passphrase"
          type="password"
          autoComplete="new-password"
          value={candidate}
          onChange={(event) => setCandidate(event.target.value)}
          aria-describedby="recovery-rules"
          autoFocus
        />
        <label htmlFor="recovery-confirmation" className="surface-label mb-1.5 mt-4 block">
          Confirm passphrase
        </label>
        <Input
          id="recovery-confirmation"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        <p id="recovery-rules" className="mt-3 text-xs text-foreground-muted">
          {RULES_COPY} This link works once.
        </p>
        {/* Present from the start so the announcement lands, and collapsed while
            empty so it costs no space. Plain copy, matching the gate. */}
        <div
          role="status"
          aria-live="polite"
          className="mt-3 text-sm text-foreground-secondary empty:hidden"
        >
          {message}
        </div>
        <Button type="submit" className="mt-4 w-full" disabled={stage === 'saving'}>
          {stage === 'saving' ? 'Saving…' : 'Set passphrase'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={leave}
        >
          Back to unlock
        </Button>
      </form>
    </Frame>
  );
}
