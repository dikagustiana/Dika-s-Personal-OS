/**
 * The send button's condition, asserted against the SOURCE.
 *
 * Unusual, and deliberate. The browsing gate's last mile is one JSX condition:
 * `{sendable && (<Button …>Send</Button>)}`. Widening it to
 * `{(sendable || isRouted(card.kind, routing)) && …}` looks like a small
 * improvement — "the card is routed, surely it can send" — and it is the exact
 * bypass the whole routing design forbids: a routing row would put a send button
 * on prData while the model has no declared web access. It happened once during
 * this change and was caught by reading the diff, which is not a control.
 *
 * There is no component-test infrastructure in this project (no DOM renderer,
 * 36 test files and all of them logic or data), so the honest options were to
 * add a rendering stack for one assertion or to assert the source text. This is
 * the cheaper one, and it fails loudly on the specific edit that matters.
 *
 * If the file is refactored so these strings no longer appear, this test fails
 * and should be REWRITTEN, not deleted: the rule it protects still holds.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./PromptsTab.tsx', import.meta.url), 'utf8');

/**
 * Comments stripped before the forbidden-substring check, because the comment
 * that warns against the bypass necessarily quotes it. Checking the raw file
 * made this suite fail on its own documentation.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the send button is gated on the browsing check alone', () => {
  it('renders the Send button under `sendable` and nothing else', () => {
    // The literal condition, not a regex over the whole file: an OR smuggled
    // into this one expression is what must fail.
    expect(CODE).toContain(
      '{sendable && (\n              <Button size="sm" onClick={() => setConfirming(true)}',
    );
  });

  it('never ORs routing into a sendability decision', () => {
    for (const forbidden of ['sendable ||', '|| isRouted', 'routed ||', '|| routed']) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('asks canSend with the kind and the capabilities, never the routing table', () => {
    expect(CODE).toContain('canSend(card.kind, capabilities)');
    expect(CODE).not.toMatch(/canSend\([^)]*routing/);
    expect(CODE).not.toMatch(/sendBlockedReason\([^)]*routing/);
  });

  it('resolves the model once and sends exactly what it displayed', () => {
    // One resolution feeds both the chip and the request, so the name shown
    // before the click cannot differ from the name that runs — and it is the
    // resolver, which is where browsing-gated tasks get pinned to the declared
    // model rather than to their routing row.
    expect(CODE).toContain('resolveTaskModel(card.kind, routing, capabilities)');
    expect(CODE).toContain('model: override,');
    // No second, independent resolution anywhere in the file.
    expect(CODE).not.toContain('routedModelOverride(');
    expect(CODE).not.toContain('routedModel(');
  });
});
