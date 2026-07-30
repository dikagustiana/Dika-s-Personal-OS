/**
 * A failure must arrive as a sentence, not as a blank panel.
 *
 * The two functions answer refusals in two different shapes: the function's own
 * refusals carry a prose `reason`, its guard's refusals carry `error` — auth,
 * rate limiting, malformed request. The client read only `reason`, so the most
 * likely real-world failure of all (a session key expires after twelve hours,
 * the next send is a 401) reached the card as "Nothing was sent." with no cause.
 * These cases pin both shapes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let respond: (name: string, options: Record<string, unknown>) => unknown = () => ({});

vi.mock('./supabaseRepository', () => ({
  isSupabaseConfigured: true,
  edgeFunctionCall: vi.fn(async (name: string, options: Record<string, unknown>) =>
    respond(name, options),
  ),
}));
vi.mock('../components/PassphraseGate', () => ({ readStoredKey: () => 'test-key' }));

const { refusalDetail, refusalReason, sendPrompt } = await import('./researchModel');
const { runCouncil } = await import('./researchCouncil');

beforeEach(() => {
  respond = () => ({});
});

describe('refusalReason', () => {
  it('prefers the function’s own prose reason', () => {
    expect(refusalReason({ reason: 'Direct sending is not configured.' })).toBe(
      'Direct sending is not configured.',
    );
  });

  it('passes a guard error through rather than dropping it', () => {
    expect(refusalReason({ error: 'Unauthorized' })).toBe('Unauthorized. Nothing was sent.');
  });

  it('says when to try again if the guard gave a lockout window', () => {
    // The retry window AND the promise that nothing went out: on a single card
    // both are true, and the second is what the owner needs before retrying.
    expect(refusalReason({ error: 'Locked out', retryAfter: 420 })).toBe(
      'Locked out. Try again in 420s. Nothing was sent.',
    );
    // refusalDetail is the same sentence without the promise, for the council,
    // where completions HAVE been paid for by the time a later stage fails.
    expect(refusalDetail({ error: 'Locked out', retryAfter: 420 })).toBe(
      'Locked out. Try again in 420s.',
    );
    expect(refusalDetail({ error: 'Unauthorized' })).not.toContain('Nothing was sent');
  });

  it('never returns an empty string, whatever came back', () => {
    for (const body of [null, undefined, {}, { reason: '' }, { error: '' }]) {
      expect(refusalReason(body).length).toBeGreaterThan(10);
    }
  });

  it('does not interpret the error into a cause it cannot know', () => {
    // 'Unauthorized' and 'No prompt supplied' arrive the same way. Guessing
    // "your session expired" would be wrong half the time.
    expect(refusalReason({ error: 'No prompt supplied' })).toContain('No prompt supplied');
    expect(refusalReason({ error: 'No prompt supplied' })).not.toMatch(/session|unlock/i);
  });
});

describe('sendPrompt surfaces every failure shape', () => {
  it('reports an expired-session 401 as the server worded it', async () => {
    respond = () => ({ error: 'Unauthorized' });
    const result = await sendPrompt({ kind: 'prMethod', prompt: 'p', confirmed: true });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain('Unauthorized');
  });

  it('reports a provider failure with the status the function reported', async () => {
    // What a wrong model name produces: the provider 400s, the function turns it
    // into a 502 with a status-only reason — never the provider body, which can
    // contain the key.
    respond = () => ({ sent: false, reason: 'Model call failed (404).' });
    const result = await sendPrompt({ kind: 'prMethod', prompt: 'p', confirmed: true, model: 'no-such-model' });
    expect(result.reason).toBe('Model call failed (404).');
  });

  it('reports a lockout with its retry window', async () => {
    respond = () => ({ error: 'Locked out', retryAfter: 900 });
    const result = await sendPrompt({ kind: 'prMethod', prompt: 'p', confirmed: true });
    expect(result.reason).toContain('900s');
  });

  it('reports an unreachable function rather than resolving as sent', async () => {
    respond = () => {
      throw new Error('network down');
    };
    const result = await sendPrompt({ kind: 'prMethod', prompt: 'p', confirmed: true });
    expect(result).toEqual({ sent: false, reason: 'Could not reach the model function.' });
  });

  it('keeps a successful completion untouched', async () => {
    respond = () => ({ sent: true, completion: 'the answer' });
    const result = await sendPrompt({ kind: 'prMethod', prompt: 'p', confirmed: true });
    expect(result).toMatchObject({ sent: true, completion: 'the answer' });
  });
});

describe('runCouncil surfaces every failure shape', () => {
  it('reports a guard refusal instead of "the council did not run"', async () => {
    respond = () => ({ error: 'Unauthorized' });
    const result = await runCouncil({ mode: 'method', content: 'x', confirmed: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Unauthorized');
      expect(result.reason).not.toBe('The council did not run.');
    }
  });

  it('reports a lockout with its retry window', async () => {
    respond = () => ({ error: 'Locked out', retryAfter: 300 });
    const result = await runCouncil({ mode: 'method', content: 'x', confirmed: true });
    if (!result.ok) expect(result.reason).toContain('300s');
  });

  it('names the failed seats when only some answered', async () => {
    respond = () => ({
      ran: false,
      reason: 'Only 1 of 5 seats answered — a council needs at least two.',
      failedSeats: [{ id: 'policy-reader', name: 'The Policy Reader' }],
    });
    const result = await runCouncil({ mode: 'method', content: 'x', confirmed: true });
    if (!result.ok) {
      expect(result.reason).toContain('at least two');
      expect(result.failedSeats?.[0].name).toBe('The Policy Reader');
    }
  });

  it('says the peer stage failed AND that the advisor completions were paid for', async () => {
    respond = (_name, options) => {
      const body = (options.body ?? {}) as { stage?: string };
      if (body.stage === 'advisors') {
        return {
          ran: true,
          advisorResponses: [
            { advisorId: 'a', advisorName: 'A', text: 't' },
            { advisorId: 'b', advisorName: 'B', text: 't' },
          ],
          failedSeats: [],
        };
      }
      return { ran: false, error: 'Locked out', retryAfter: 60 };
    };
    const result = await runCouncil({ mode: 'method', content: 'x', confirmed: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Peer review stage failed');
      expect(result.reason).toContain('60s');
      expect(result.reason).toContain('2 advisor responses');
    }
  });
});
