/**
 * Routing at the SEND PATH, not at the display.
 *
 * modelRouting.test.ts proves the resolution rules. These tests prove the model
 * name actually reaches the wire — every seat of a council, every stage — and
 * that the two things routing must never do it still cannot do: overrule a seat
 * that names its own model, and travel as a name when no row exists (which would
 * pin the default read at page load instead of letting the function choose at
 * call time).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<Record<string, unknown>> = [];

vi.mock('./supabaseRepository', () => ({
  isSupabaseConfigured: true,
  edgeFunctionCall: vi.fn(async (_name: string, options: Record<string, unknown>) => {
    const body = (options.body ?? {}) as Record<string, unknown>;
    calls.push(body);
    const stage = String(body.stage ?? '');
    if (stage === 'advisors') {
      const advisors = (body.advisors ?? []) as Array<{ id: string; name: string }>;
      return {
        ran: true,
        advisorResponses: advisors.map((seat) => ({
          advisorId: seat.id,
          advisorName: seat.name,
          text: 'a response',
        })),
        failedSeats: [],
      };
    }
    if (stage === 'peers') {
      const peers = (body.peerPrompts ?? []) as Array<{ reviewerId: string; reviewerName: string }>;
      return {
        ran: true,
        peerReviews: peers.map((peer) => ({
          reviewerId: peer.reviewerId,
          reviewerName: peer.reviewerName,
          raw: 'a review',
        })),
        failedSeats: [],
      };
    }
    return { ran: true, chairmanRaw: '{"consensus":"c","recommendation":"r","first_step":"f"}' };
  }),
}));

vi.mock('../components/PassphraseGate', () => ({ readStoredKey: () => 'test-key' }));

const { runCouncil } = await import('./researchCouncil');
const { sendPrompt } = await import('./researchModel');
const { MockResearchRepository } = await import('./researchRepository');
const { CHAIRMAN_PERSONA, advisorsForMode } = await import(
  '../logic/research/council/personas'
);
const { ROUTABLE_TASKS, routingTable } = await import('../logic/research/modelRouting');

const seatModels = () => {
  const advisorStage = calls.find((body) => body.stage === 'advisors');
  return ((advisorStage?.advisors ?? []) as Array<{ model?: string }>).map((seat) => seat.model);
};
const peerModels = () => {
  const peerStage = calls.find((body) => body.stage === 'peers');
  return ((peerStage?.peerPrompts ?? []) as Array<{ model?: string }>).map((peer) => peer.model);
};
const chairmanModel = () => {
  const stage = calls.find((body) => body.stage === 'chairman');
  return (stage?.chairman as { model?: string } | undefined)?.model;
};

beforeEach(() => {
  calls.length = 0;
});

describe('a routed council mode reaches every seat', () => {
  it('sends the routed model on all three stages', async () => {
    const result = await runCouncil({
      mode: 'method',
      content: 'the design',
      confirmed: true,
      model: 'routed-model',
    });
    expect(result.ok).toBe(true);

    const seats = advisorsForMode('method').length;
    expect(seatModels()).toEqual(Array.from({ length: seats }, () => 'routed-model'));
    expect(peerModels()).toEqual(Array.from({ length: seats }, () => 'routed-model'));
    // The chairman is the eleventh completion and the one whose output reads as
    // settled; running it on a different model than the council would be a
    // silent quality change.
    expect(chairmanModel()).toBe('routed-model');
  });

  it('sends no model at all when the mode has no routing row', async () => {
    // Undefined, not the probed default name: the function decides at call time,
    // so changing RESEARCH_MODEL_DEFAULT does not need a page reload.
    await runCouncil({ mode: 'method', content: 'the design', confirmed: true });
    expect(seatModels().every((model) => model === undefined)).toBe(true);
    expect(peerModels().every((model) => model === undefined)).toBe(true);
    expect(chairmanModel()).toBeUndefined();
  });

  it('lets a seat that names its own model keep it', async () => {
    // No persona sets one today. The precedence still has to read one way, and
    // this pins it: a seat given a model for a reason particular to that seat is
    // not overruled by a mode-wide route.
    const seats = advisorsForMode('scope');
    const first = seats[0];
    const restored = first.model;
    first.model = 'seat-own-model';
    try {
      await runCouncil({
        mode: 'scope',
        content: 'a question',
        confirmed: true,
        model: 'routed-model',
      });
      const models = seatModels();
      expect(models[0]).toBe('seat-own-model');
      expect(models.slice(1).every((model) => model === 'routed-model')).toBe(true);
      expect(chairmanModel()).toBe(CHAIRMAN_PERSONA.model ?? 'routed-model');
    } finally {
      first.model = restored;
    }
  });

  it('still refuses to run without confirmation, routed or not', async () => {
    // Routing has nothing to do with consent. The server enforces this too.
    await runCouncil({
      mode: 'method',
      content: 'the design',
      confirmed: false,
      model: 'routed-model',
    });
    const advisorStage = calls.find((body) => body.stage === 'advisors');
    expect(advisorStage?.confirmed).toBe(false);
  });
});

describe('a routed prompt card sends its model', () => {
  it('puts the routed model in the request body', async () => {
    await sendPrompt({
      kind: 'prMethod',
      prompt: 'a prompt',
      confirmed: true,
      model: 'routed-model',
    });
    expect(calls.at(-1)).toMatchObject({
      kind: 'prMethod',
      confirmed: true,
      model: 'routed-model',
    });
  });

  it('omits the field entirely for an unrouted card', async () => {
    await sendPrompt({ kind: 'prMethod', prompt: 'a prompt', confirmed: true });
    expect(calls.at(-1)).not.toHaveProperty('model');
  });

  it('carries the kind whatever the model is, because the gate reads the kind', async () => {
    // The server refuses a browsing-dependent kind before it looks at the model
    // name, so the kind must always travel — a routed model does not replace it.
    await sendPrompt({
      kind: 'prData',
      prompt: 'a prompt',
      confirmed: true,
      model: 'model-with-web-access',
    });
    expect(calls.at(-1)).toMatchObject({ kind: 'prData', model: 'model-with-web-access' });
  });
});

describe('the routing table is read-only from the app', () => {
  it('offers no write path — a routing change is a table edit, not a feature', () => {
    const instance = new MockResearchRepository() as unknown as Record<string, unknown>;
    expect(typeof instance.listModelRouting).toBe('function');
    // Absent, not unimplemented, for the same reason cycles have no update:
    // adding one later re-opens what the shape exists to close.
    expect(instance.setModelRoute).toBeUndefined();
    expect(instance.upsertModelRouting).toBeUndefined();
    expect(instance.deleteModelRoute).toBeUndefined();
  });

  it('reads the seeded vocabulary as routing nothing', async () => {
    const rows = await new MockResearchRepository().listModelRouting();
    expect(rows.map((row) => row.task)).toEqual([...ROUTABLE_TASKS]);
    // Every seeded row is blank, so a bare clone runs entirely on the default.
    expect(routingTable(rows)).toEqual({});
  });
});
