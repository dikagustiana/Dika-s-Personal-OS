/**
 * The browser side of the optional model integration.
 *
 * THE API IS AN ACCELERANT, NEVER A DEPENDENCY. Every prompt card must render,
 * and its copy button must work, whether or not a key is configured — that is
 * how the owner's console works today and losing it would be a regression
 * dressed up as a feature. So the capability probe never throws: an
 * unreachable function, a missing key and a network failure all resolve to the
 * same "not configured" shape, and the caller renders copy-paste.
 *
 * Browsing is read from configuration and never inferred. `prData` and `prCite`
 * tell the model to re-open sources and check them as they stand today; a model
 * without web access will fabricate the confirmation, which is worse than not
 * running the review, because a fabricated all-clear retires a check that never
 * happened. The server refuses those prompts too — this is the second of two
 * gates, not the only one.
 *
 * NOTE WHAT canSend AND sendBlockedReason DO NOT TAKE: a routing table. Per-task
 * model routing (logic/research/modelRouting.ts) decides WHICH model runs a
 * prompt and has no way to decide WHETHER one may. These two functions cannot
 * see a routing row even by mistake, which is why a row naming a browsing-capable
 * model for prData still leaves prData copy-paste only.
 */
import { edgeFunctionCall, isSupabaseConfigured } from './supabaseRepository';
import { readStoredKey } from '../components/PassphraseGate';

/** Prompt kinds the client asks the server to run. Matches the builder names. */
export type PromptKind =
  | 'prBrief'
  | 'prBatch'
  | 'prAllBatch'
  | 'prData'
  | 'prCite'
  | 'prMethod'
  | 'prLit'
  | 'prContra'
  | 'prHand'
  | 'prDigest'
  | 'prScope';

export interface ModelCapabilities {
  configured: boolean;
  browsing: boolean;
  model: string;
  /** Prompt kinds that are copy-paste only unless browsing is configured. */
  requiresBrowsing: string[];
}

export const MODEL_UNCONFIGURED: ModelCapabilities = {
  configured: false,
  browsing: false,
  model: '',
  requiresBrowsing: ['prData', 'prCite', 'prLit', 'prContra', 'prScope'],
};

export interface ModelResult {
  sent: boolean;
  completion?: string;
  /** Why nothing was sent, in the server's words. Shown verbatim. */
  reason?: string;
}

const FUNCTION = 'run-research-prompt';

/**
 * Whether a prompt may be sent at all, given what is configured.
 *
 * The UI must not offer a send button it knows the server will refuse; an
 * offered button that always fails teaches the owner to ignore the panel.
 */
export function canSend(kind: PromptKind, capabilities: ModelCapabilities): boolean {
  if (!capabilities.configured) return false;
  if (capabilities.requiresBrowsing.includes(kind)) return capabilities.browsing;
  return true;
}

/** Why a prompt is copy-paste only, or null when it can be sent. */
export function sendBlockedReason(
  kind: PromptKind,
  capabilities: ModelCapabilities,
): string | null {
  if (!capabilities.configured) {
    return 'Direct sending is not configured — copy the prompt and paste it into a model.';
  }
  if (capabilities.requiresBrowsing.includes(kind) && !capabilities.browsing) {
    return 'This prompt asks the model to open sources as they stand today. The configured model has no confirmed web access, so it would fabricate confirmations. Copy it into a browsing session instead.';
  }
  return null;
}

export async function probeModel(): Promise<ModelCapabilities> {
  if (!isSupabaseConfigured) return MODEL_UNCONFIGURED;
  try {
    const data = await edgeFunctionCall<ModelCapabilities>(FUNCTION, {
      method: 'GET',
      appKey: readStoredKey() ?? undefined,
    });
    if (!data) return MODEL_UNCONFIGURED;
    return {
      configured: Boolean(data.configured),
      browsing: Boolean(data.browsing),
      model: data.model ?? '',
      requiresBrowsing: data.requiresBrowsing ?? MODEL_UNCONFIGURED.requiresBrowsing,
    };
  } catch {
    // An unreachable function is indistinguishable from an unconfigured one as
    // far as the UI is concerned, and both mean: render copy-paste.
    return MODEL_UNCONFIGURED;
  }
}

/**
 * Sends one prompt. `confirmed` is required by the server and is never defaulted
 * here — the confirm step exists so the owner sees what is going out, and a
 * default would quietly remove it.
 *
 * `model` is the routed model for this task, or undefined when the task has no
 * routing row. Undefined is sent as ABSENT rather than as the probed default
 * name: the server then picks its own RESEARCH_MODEL_DEFAULT at call time, so
 * changing that variable takes effect without a page reload. Echoing the probed
 * name back would pin whatever was current when the tab was opened.
 */
export async function sendPrompt(input: {
  kind: PromptKind;
  prompt: string;
  confirmed: boolean;
  model?: string;
}): Promise<ModelResult> {
  if (!isSupabaseConfigured) {
    return { sent: false, reason: 'Direct sending is not configured.' };
  }
  try {
    const data = await edgeFunctionCall<ModelResult>(FUNCTION, {
      method: 'POST',
      appKey: readStoredKey() ?? undefined,
      body: {
        kind: input.kind,
        prompt: input.prompt,
        confirmed: input.confirmed,
        ...(input.model ? { model: input.model } : {}),
      },
    });
    return data ?? { sent: false, reason: 'No response from the model function.' };
  } catch {
    return { sent: false, reason: 'Could not reach the model function.' };
  }
}
