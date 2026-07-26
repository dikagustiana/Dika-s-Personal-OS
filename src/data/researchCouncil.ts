/**
 * The browser side of the council.
 *
 * Drives the three stages in order, reporting progress after each so the UI
 * can show counts rather than a spinner, and persists the transcript once.
 *
 * THE GUARDRAIL LIVES HERE, NOT ONLY IN THE UI. A chairman verdict is a
 * confident, well-structured synthesis with a recommendation and a first step.
 * It SOUNDS authoritative, which is exactly what makes it the output most
 * likely to be treated as settled. It is not settled: it is layer (c), the
 * author's own inference, until he acts on it.
 *
 * So this module exposes no path that writes a cycle, ticks a gate, sets an
 * item to V, or creates a claim at layer (a) or (b). It cannot: it imports
 * only the council repository, which has an append and a list and nothing
 * else. Adding a convenience "apply the verdict" helper here would re-open the
 * hole the whole subsystem exists to close.
 */
import { edgeFunctionCall, isSupabaseConfigured } from './supabaseRepository';
import { readStoredKey } from '../components/PassphraseGate';
import {
  CHAIRMAN_PERSONA,
  advisorsForMode,
  type AdvisorPersona,
  type CouncilMode,
} from '../logic/research/council/personas';
import {
  anonymizeResponses,
  buildChairmanMessages,
  buildPeerReviewMessages,
  frameInput,
  parseChairmanVerdict,
  parsePeerReview,
  verdictParsed,
  type AdvisorResponse,
  type ChairmanVerdict,
  type PeerReviewVerdict,
} from '../logic/research/council/pipeline';

const FUNCTION = 'run-research-council';

export interface CouncilCapabilities {
  configured: boolean;
  browsing: boolean;
  model: string;
  /** Modes that need web access; `contra` today. */
  requiresBrowsing: string[];
}

export const COUNCIL_UNCONFIGURED: CouncilCapabilities = {
  configured: false,
  browsing: false,
  model: '',
  requiresBrowsing: ['contra'],
};

export interface FailedSeat {
  id: string;
  name: string;
}

export interface CouncilProgress {
  advisorsDone: number;
  advisorsTotal: number;
  peersDone: number;
  peersTotal: number;
  chairmanDone: boolean;
  failedSeats: FailedSeat[];
}

export interface CouncilTranscript {
  mode: CouncilMode;
  projectId?: string;
  inputSnapshot: string;
  advisorsConfig: Array<{ id: string; name: string; model: string; systemPrompt: string }>;
  advisorResponses: Array<AdvisorResponse & { letter: string }>;
  peerReviews: Array<{ reviewerId: string; reviewerName: string; review: PeerReviewVerdict }>;
  /** Null when the chairman stage failed — the other stages still stand. */
  verdict: ChairmanVerdict | null;
  /** True when the verdict came back as prose that would not parse. */
  verdictUnparsed: boolean;
  failedSeats: FailedSeat[];
  persisted: boolean;
}

/** Whether the council may be offered at all for this mode. */
export function councilAvailable(
  mode: CouncilMode,
  capabilities: CouncilCapabilities,
): boolean {
  if (!capabilities.configured) return false;
  if (capabilities.requiresBrowsing.includes(mode)) return capabilities.browsing;
  return true;
}

/** Why the council button is absent, or null when it is offered. */
export function councilBlockedReason(
  mode: CouncilMode,
  capabilities: CouncilCapabilities,
): string | null {
  if (!capabilities.configured) {
    return 'The council needs the model API, which is not configured. The single-pass prompt still works.';
  }
  if (capabilities.requiresBrowsing.includes(mode) && !capabilities.browsing) {
    return 'The contra council hunts published counter-evidence. The configured model has no confirmed web access, so it would invent citations. Use the single-pass prompt in a browsing session.';
  }
  return null;
}

export async function probeCouncil(): Promise<CouncilCapabilities> {
  if (!isSupabaseConfigured) return COUNCIL_UNCONFIGURED;
  try {
    const data = await edgeFunctionCall<CouncilCapabilities>(FUNCTION, {
      method: 'GET',
      appKey: readStoredKey() ?? undefined,
    });
    if (!data) return COUNCIL_UNCONFIGURED;
    return {
      configured: Boolean(data.configured),
      browsing: Boolean(data.browsing),
      model: data.model ?? '',
      requiresBrowsing: data.requiresBrowsing ?? COUNCIL_UNCONFIGURED.requiresBrowsing,
    };
  } catch {
    return COUNCIL_UNCONFIGURED;
  }
}

export interface RunCouncilInput {
  mode: CouncilMode;
  content: string;
  topic?: string;
  projectId?: string;
  /** Never defaulted — the confirm step exists so the owner sees the spend. */
  confirmed: boolean;
  onProgress?: (progress: CouncilProgress) => void;
}

export type RunCouncilResult =
  | { ok: true; transcript: CouncilTranscript }
  | { ok: false; reason: string; failedSeats?: FailedSeat[] };

/**
 * Runs the council. Stages are sequential because each one needs the previous
 * one's output; within a stage the seats run in parallel, so the advisor count
 * fills unevenly — which is why progress is a count and not a percentage.
 */
export async function runCouncil(input: RunCouncilInput): Promise<RunCouncilResult> {
  if (!isSupabaseConfigured) return { ok: false, reason: 'Supabase is not configured.' };

  const advisors = advisorsForMode(input.mode);
  const framedInput = frameInput(input.mode, input.content, input.topic);
  const progress: CouncilProgress = {
    advisorsDone: 0,
    advisorsTotal: advisors.length,
    peersDone: 0,
    peersTotal: advisors.length,
    chairmanDone: false,
    failedSeats: [],
  };
  const report = () => input.onProgress?.({ ...progress });
  report();

  const call = async (payload: Record<string, unknown>) =>
    edgeFunctionCall<Record<string, unknown>>(FUNCTION, {
      method: 'POST',
      // Without this the function answers 401: the anon key in the bundle is
      // not authorization for spending the owner's model budget.
      appKey: readStoredKey() ?? undefined,
      body: { mode: input.mode, confirmed: input.confirmed, framedInput, ...payload },
    });

  // ── Advisors ────────────────────────────────────────────────────────────
  let stage1: Record<string, unknown>;
  try {
    stage1 = await call({
      stage: 'advisors',
      advisors: advisors.map((persona: AdvisorPersona) => ({
        id: persona.id,
        name: persona.name,
        systemPrompt: persona.systemPrompt,
        model: persona.model,
      })),
    });
  } catch {
    return { ok: false, reason: 'Could not reach the council function.' };
  }
  if (!stage1?.ran) {
    return {
      ok: false,
      reason: String(stage1?.reason ?? 'The council did not run.'),
      failedSeats: (stage1?.failedSeats as FailedSeat[]) ?? [],
    };
  }

  const advisorResponses = (stage1.advisorResponses ?? []) as AdvisorResponse[];
  progress.advisorsDone = advisorResponses.length;
  progress.failedSeats = (stage1.failedSeats as FailedSeat[]) ?? [];
  progress.peersTotal = advisorResponses.length;
  report();

  // ── Anonymise, then peer review ─────────────────────────────────────────
  const { anonymized, letterToAdvisorId } = anonymizeResponses(advisorResponses);
  const respondingSeats = advisors.filter((persona) =>
    advisorResponses.some((r) => r.advisorId === persona.id),
  );

  let stage2: Record<string, unknown>;
  try {
    stage2 = await call({
      stage: 'peers',
      peerPrompts: respondingSeats.map((persona) => {
        const [system, user] = buildPeerReviewMessages(persona, framedInput, anonymized);
        return {
          reviewerId: persona.id,
          reviewerName: persona.name,
          system: system.content,
          user: user.content,
          model: persona.model,
        };
      }),
    });
  } catch {
    return { ok: false, reason: 'Could not reach the council function during peer review.' };
  }

  const rawPeers = (stage2?.peerReviews ?? []) as Array<{
    reviewerId: string;
    reviewerName: string;
    raw: string;
  }>;
  const peerReviews = rawPeers.map((entry) => ({
    reviewerId: entry.reviewerId,
    reviewerName: entry.reviewerName,
    review: parsePeerReview(entry.raw),
  }));
  progress.peersDone = peerReviews.length;
  progress.failedSeats = [
    ...progress.failedSeats,
    ...(((stage2?.failedSeats as FailedSeat[]) ?? []) as FailedSeat[]),
  ];
  report();

  // ── Chairman ────────────────────────────────────────────────────────────
  const [chairSystem, chairUser] = buildChairmanMessages(
    CHAIRMAN_PERSONA.systemPrompt,
    framedInput,
    anonymized,
    peerReviews.map((p) => p.review),
  );

  let verdict: ChairmanVerdict | null = null;
  let verdictUnparsed = false;
  try {
    const stage3 = await call({
      stage: 'chairman',
      chairman: {
        system: chairSystem.content,
        user: chairUser.content,
        model: CHAIRMAN_PERSONA.model,
      },
    });
    if (stage3?.ran) {
      verdict = parseChairmanVerdict(String(stage3.chairmanRaw ?? ''));
      // Not `verdict.raw !== undefined`: a chairman that returns `{}` parses
      // cleanly into five empty strings, and rendering that as a verdict card
      // says "the council had nothing to say", which is the opposite of what
      // happened. verdictParsed covers both shapes.
      verdictUnparsed = !verdictParsed(verdict);
      progress.chairmanDone = true;
    }
  } catch {
    // Deliberately swallowed: ten completions are already paid for and in
    // hand. The transcript persists without a verdict and the UI offers to
    // retry the chairman alone.
    verdict = null;
  }
  report();

  const letterByAdvisorId = Object.fromEntries(
    Object.entries(letterToAdvisorId).map(([letter, advisorId]) => [advisorId, letter]),
  );

  const transcript: CouncilTranscript = {
    mode: input.mode,
    projectId: input.projectId,
    inputSnapshot: framedInput,
    advisorsConfig: advisors.map((persona) => ({
      id: persona.id,
      name: persona.name,
      model: persona.model ?? '',
      systemPrompt: persona.systemPrompt,
    })),
    advisorResponses: advisorResponses.map((r) => ({
      ...r,
      letter: letterByAdvisorId[r.advisorId] ?? '?',
    })),
    peerReviews,
    verdict,
    verdictUnparsed,
    failedSeats: progress.failedSeats,
    persisted: false,
  };

  return { ok: true, transcript };
}
