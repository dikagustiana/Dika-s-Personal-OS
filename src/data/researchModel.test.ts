import { describe, expect, it } from 'vitest';
import {
  MODEL_UNCONFIGURED,
  canSend,
  sendBlockedReason,
  type ModelCapabilities,
  type PromptKind,
} from './researchModel';

const BROWSING_DEPENDENT: PromptKind[] = ['prData', 'prCite', 'prLit', 'prContra', 'prScope'];
const NO_BROWSING_NEEDED: PromptKind[] = ['prBrief', 'prBatch', 'prAllBatch', 'prMethod', 'prHand', 'prDigest'];

const configured = (browsing: boolean): ModelCapabilities => ({
  configured: true,
  browsing,
  model: 'some-model',
  requiresBrowsing: MODEL_UNCONFIGURED.requiresBrowsing,
});

describe('canSend', () => {
  it('offers nothing at all when no key is configured', () => {
    for (const kind of [...BROWSING_DEPENDENT, ...NO_BROWSING_NEEDED]) {
      expect(canSend(kind, MODEL_UNCONFIGURED)).toBe(false);
    }
  });

  it('withholds send from every browsing-dependent prompt when browsing is not declared', () => {
    // A model without web access asked to re-open a source will fabricate the
    // confirmation, and a fabricated all-clear retires a check that never ran.
    for (const kind of BROWSING_DEPENDENT) {
      expect(canSend(kind, configured(false))).toBe(false);
    }
  });

  it('still offers send for prompts that need no browsing', () => {
    for (const kind of NO_BROWSING_NEEDED) {
      expect(canSend(kind, configured(false))).toBe(true);
    }
  });

  it('offers everything once browsing is declared', () => {
    for (const kind of [...BROWSING_DEPENDENT, ...NO_BROWSING_NEEDED]) {
      expect(canSend(kind, configured(true))).toBe(true);
    }
  });

  it('reads the requiresBrowsing list from the server rather than a local copy', () => {
    // The server owns the list; if it grows, the client must follow without a
    // redeploy, so this must not be hardcoded on this side.
    const server: ModelCapabilities = { ...configured(false), requiresBrowsing: ['prMethod'] };
    expect(canSend('prMethod', server)).toBe(false);
    expect(canSend('prData', server)).toBe(true);
  });
});

describe('sendBlockedReason', () => {
  it('explains an unconfigured key as copy-paste, not as an error', () => {
    const reason = sendBlockedReason('prBrief', MODEL_UNCONFIGURED);
    expect(reason).toContain('copy');
  });

  it('names fabrication as the reason a browsing prompt is withheld', () => {
    const reason = sendBlockedReason('prData', configured(false));
    expect(reason).toContain('fabricate');
  });

  it('is null when the prompt can actually be sent', () => {
    expect(sendBlockedReason('prBrief', configured(false))).toBeNull();
    expect(sendBlockedReason('prData', configured(true))).toBeNull();
  });
});
