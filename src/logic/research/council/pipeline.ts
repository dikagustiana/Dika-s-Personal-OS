/**
 * Pure council-pipeline helpers: input framing, anonymisation, message
 * assembly, and tolerant response parsing.
 *
 * PORTED from the website's supabase/functions/council-review/pipeline.ts.
 * Kept essentially unchanged: anonymizeResponses (Fisher-Yates with injectable
 * rng), buildAdvisorMessages, buildChairmanMessages, parseJsonObject,
 * parsePeerReview, parseChairmanVerdict. Those were already correct and
 * already unit-tested there; rewriting them would have been the reinvention
 * the brief forbids.
 *
 * Changed, deliberately:
 *  - frameInput now frames a research artefact, not an essay draft. The modes
 *    are method / scope / contra rather than brainstorm / review.
 *  - buildPeerReviewMessages says "research council" and derives the seat
 *    count from the input instead of hardcoding five, because the contra
 *    council seats four.
 *
 * No network, no storage, no Deno imports — everything here is deterministic
 * given its inputs, which is what makes the anonymisation testable.
 */
import type { AdvisorPersona, CouncilMode } from './personas';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AdvisorResponse {
  advisorId: string;
  advisorName: string;
  model: string;
  text: string;
}

export interface AnonymizedResponse {
  letter: string;
  text: string;
}

export interface AnonymizationResult {
  anonymized: AnonymizedResponse[];
  /** letter → advisorId, so a transcript stays reversible after the run. */
  letterToAdvisorId: Record<string, string>;
}

export interface PeerReviewVerdict {
  strongest: { letter: string; reason: string } | null;
  biggestBlindSpot: { letter: string; reason: string } | null;
  missedByAll: string | null;
  /** Raw output kept when structured parsing failed. */
  raw?: string;
}

export interface ChairmanVerdict {
  consensus: string;
  disagreements: string;
  blindSpots: string;
  recommendation: string;
  firstStep: string;
  raw?: string;
}

export const MAX_CONTENT_LENGTH = 60_000;

// ---------------------------------------------------------------------------
// Input framing
// ---------------------------------------------------------------------------

/**
 * Frame the raw input once; every seat receives the same framed text, and the
 * framed text is what gets stored as input_snapshot. A verdict has to be
 * readable against what the council actually saw, not against what the project
 * looks like weeks later.
 */
export function frameInput(mode: CouncilMode, content: string, topic?: string): string {
  const title = topic?.trim() ? `Research question / working title: ${topic.trim()}\n\n` : '';
  if (mode === 'scope') {
    return [
      'The researcher is considering a question that has no pipeline yet, and wants the council to judge it before any work starts.',
      '',
      `${title}--- QUESTION ---`,
      content.trim(),
      '--- END QUESTION ---',
    ].join('\n');
  }
  if (mode === 'contra') {
    return [
      'The researcher has a set of claims and wants the council to attack them as their smartest critic would.',
      '',
      `${title}--- CLAIMS AND SUPPORTING EVIDENCE ---`,
      content.trim(),
      '--- END CLAIMS ---',
    ].join('\n');
  }
  return [
    'The researcher has a research design in progress and wants the council to review its method before going further.',
    '',
    `${title}--- DESIGN, HYPOTHESES AND DECISION LOG ---`,
    content.trim(),
    '--- END DESIGN ---',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Anonymisation — ported unchanged
// ---------------------------------------------------------------------------

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Shuffle responses into anonymous letters so peer reviewers and the chairman
 * cannot develop positional or identity bias. `rng` is injectable so the
 * shuffle is testable; it defaults to Math.random.
 *
 * The letterToAdvisorId map is what lets the stored transcript show the
 * persona name AND its letter afterwards — which is how the owner learns
 * which seat is consistently strongest. Anonymity is for the models during
 * the run, not for the reader after it.
 */
export function anonymizeResponses(
  responses: AdvisorResponse[],
  rng: () => number = Math.random,
): AnonymizationResult {
  if (responses.length > LETTERS.length) {
    throw new Error(`Cannot anonymize more than ${LETTERS.length} responses`);
  }

  const shuffled = [...responses];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const anonymized: AnonymizedResponse[] = [];
  const letterToAdvisorId: Record<string, string> = {};
  shuffled.forEach((response, index) => {
    const letter = LETTERS[index];
    anonymized.push({ letter, text: response.text });
    letterToAdvisorId[letter] = response.advisorId;
  });

  return { anonymized, letterToAdvisorId };
}

// ---------------------------------------------------------------------------
// Message assembly
// ---------------------------------------------------------------------------

export function buildAdvisorMessages(
  persona: AdvisorPersona,
  framedInput: string,
): ChatMessage[] {
  return [
    { role: 'system', content: persona.systemPrompt },
    { role: 'user', content: framedInput },
  ];
}

function formatAnonymizedResponses(anonymized: AnonymizedResponse[]): string {
  return anonymized
    .map((r) => `--- RESPONSE ${r.letter} ---\n${r.text}\n--- END RESPONSE ${r.letter} ---`)
    .join('\n\n');
}

export function buildPeerReviewMessages(
  persona: AdvisorPersona,
  framedInput: string,
  anonymized: AnonymizedResponse[],
): ChatMessage[] {
  const letters = anonymized.map((r) => r.letter).join(', ');
  // Seat count read from the input rather than hardcoded: the contra council
  // seats four, and a prompt claiming five would be lying to the model.
  const system = `You are ${persona.name}, one member of a ${anonymized.length}-person research council. The council has just produced ${anonymized.length} independent responses to the same input. They are anonymized (Response ${letters}); one of them is yours, but you don't know which label it received. Judge them all on merit alone.

Respond ONLY with valid JSON in this exact structure:
{
  "strongest": { "letter": "A", "reason": "Why this response is the strongest (1-2 sentences)" },
  "biggest_blind_spot": { "letter": "B", "reason": "Why this response has the biggest blind spot (1-2 sentences)" },
  "missed_by_all": "The most important thing that ALL responses missed (1-3 sentences)"
}

Write in English. Be decisive — pick exactly one letter for each field. Never answer "it depends".`;

  const user = `${framedInput}\n\nHere are the council's responses:\n\n${formatAnonymizedResponses(anonymized)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function buildChairmanMessages(
  chairmanSystemPrompt: string,
  framedInput: string,
  anonymized: AnonymizedResponse[],
  peerReviews: PeerReviewVerdict[],
): ChatMessage[] {
  const reviewsText = peerReviews
    .map((review, index) => {
      const body = review.raw
        ? review.raw
        : [
            review.strongest
              ? `Strongest: Response ${review.strongest.letter} — ${review.strongest.reason}`
              : null,
            review.biggestBlindSpot
              ? `Biggest blind spot: Response ${review.biggestBlindSpot.letter} — ${review.biggestBlindSpot.reason}`
              : null,
            review.missedByAll ? `Missed by all: ${review.missedByAll}` : null,
          ]
            .filter(Boolean)
            .join('\n');
      return `--- PEER REVIEW ${index + 1} ---\n${body}\n--- END PEER REVIEW ${index + 1} ---`;
    })
    .join('\n\n');

  const user = [
    framedInput,
    '',
    'ADVISOR RESPONSES:',
    '',
    formatAnonymizedResponses(anonymized),
    '',
    'PEER REVIEWS:',
    '',
    reviewsText,
  ].join('\n');

  return [
    { role: 'system', content: chairmanSystemPrompt },
    { role: 'user', content: user },
  ];
}

// ---------------------------------------------------------------------------
// Tolerant parsing — ported unchanged
// ---------------------------------------------------------------------------

/**
 * Parse a reply that should be a JSON object, tolerating markdown fences and
 * surrounding prose. Returns null when nothing parseable is found, which the
 * callers turn into a `raw` passthrough rather than an empty panel.
 */
export function parseJsonObject(content: string): Record<string, unknown> | null {
  if (!content || !content.trim()) return null;

  let jsonStr = content.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  if (!jsonStr.startsWith('{')) {
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    jsonStr = jsonStr.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asLetterVerdict(value: unknown): { letter: string; reason: string } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.letter !== 'string' || !record.letter.trim()) return null;
  return {
    letter: record.letter.trim().toUpperCase().slice(0, 1),
    reason: typeof record.reason === 'string' ? record.reason : '',
  };
}

export function parsePeerReview(content: string): PeerReviewVerdict {
  const parsed = parseJsonObject(content);
  if (!parsed) {
    return { strongest: null, biggestBlindSpot: null, missedByAll: null, raw: content };
  }
  return {
    strongest: asLetterVerdict(parsed.strongest),
    biggestBlindSpot: asLetterVerdict(parsed.biggest_blind_spot ?? parsed.biggestBlindSpot),
    missedByAll:
      typeof parsed.missed_by_all === 'string'
        ? parsed.missed_by_all
        : typeof parsed.missedByAll === 'string'
          ? (parsed.missedByAll as string)
          : null,
  };
}

export function parseChairmanVerdict(content: string): ChairmanVerdict {
  const parsed = parseJsonObject(content);
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  if (!parsed) {
    return {
      consensus: '',
      disagreements: '',
      blindSpots: '',
      recommendation: '',
      firstStep: '',
      raw: content,
    };
  }
  return {
    consensus: str(parsed.consensus),
    disagreements: str(parsed.disagreements),
    blindSpots: str(parsed.blind_spots ?? parsed.blindSpots),
    recommendation: str(parsed.recommendation),
    firstStep: str(parsed.first_step ?? parsed.firstStep),
  };
}

/**
 * Whether a chairman verdict actually parsed into its shape.
 *
 * A verdict that arrived as unparseable prose must surface as an error rather
 * than as five empty sections — an empty panel reads as "the council had
 * nothing to say", which is the opposite of what happened.
 */
export function verdictParsed(verdict: ChairmanVerdict): boolean {
  if (verdict.raw !== undefined) return false;
  return Boolean(verdict.recommendation.trim() || verdict.consensus.trim());
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export interface CouncilRequest {
  mode: CouncilMode;
  content: string;
  topic?: string;
  projectId?: string;
  confirmed: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOPIC_LENGTH = 500;

export function validateCouncilRequest(body: unknown): {
  request?: CouncilRequest;
  error?: string;
} {
  if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object' };
  const record = body as Record<string, unknown>;

  if (record.mode !== 'method' && record.mode !== 'scope' && record.mode !== 'contra') {
    return { error: "mode must be 'method', 'scope' or 'contra'" };
  }
  if (typeof record.content !== 'string' || !record.content.trim()) {
    return { error: 'content is required' };
  }
  if (record.content.length > MAX_CONTENT_LENGTH) {
    return { error: `content exceeds ${MAX_CONTENT_LENGTH} characters` };
  }
  if (
    record.topic !== undefined &&
    (typeof record.topic !== 'string' || record.topic.length > MAX_TOPIC_LENGTH)
  ) {
    return { error: `topic must be a string of at most ${MAX_TOPIC_LENGTH} characters` };
  }
  // Nullable by design: a scope council runs before any project exists.
  if (
    record.projectId !== undefined &&
    record.projectId !== null &&
    (typeof record.projectId !== 'string' || !UUID_PATTERN.test(record.projectId))
  ) {
    return { error: 'projectId must be a UUID' };
  }

  return {
    request: {
      mode: record.mode,
      content: record.content,
      topic: record.topic as string | undefined,
      projectId: (record.projectId as string | undefined) ?? undefined,
      confirmed: record.confirmed === true,
    },
  };
}
