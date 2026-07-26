import { describe, expect, it } from 'vitest';
import {
  CHAIRMAN_PERSONA,
  CONTRA_ADVISORS,
  METHOD_ADVISORS,
  SCOPE_ADVISORS,
  advisorsForMode,
  completionCount,
  type AdvisorPersona,
  type CouncilMode,
} from './personas';
import {
  anonymizeResponses,
  buildPeerReviewMessages,
  frameInput,
  parseChairmanVerdict,
  parsePeerReview,
  validateCouncilRequest,
  verdictParsed,
  type AdvisorResponse,
} from './pipeline';

const ALL_SEATS: AdvisorPersona[] = [
  ...METHOD_ADVISORS,
  ...SCOPE_ADVISORS,
  ...CONTRA_ADVISORS,
];

function response(id: string, text = `text-${id}`): AdvisorResponse {
  return { advisorId: id, advisorName: id, model: 'm', text };
}

// ---------------------------------------------------------------------------
// The two rules that make this a debate rather than a review
// ---------------------------------------------------------------------------

describe('shared advisor rules', () => {
  it('every seat requires a remedy', () => {
    // Rev 1 shipped seats that only diagnosed. A finding without a remedy is
    // something the author nods at and does not act on.
    for (const seat of ALL_SEATS) {
      expect(seat.systemPrompt, `${seat.id} must demand a remedy`).toMatch(
        /CLOSE WITH A REMEDY|remedy is/i,
      );
    }
  });

  it('every seat carries the two-tier sourcing rule verbatim', () => {
    for (const seat of ALL_SEATS) {
      expect(seat.systemPrompt, `${seat.id} missing sourcing rule`).toContain('SOURCING.');
      expect(seat.systemPrompt).toContain(
        'Claims about THIS design need no citation',
      );
      expect(seat.systemPrompt).toContain('write NOT FOUND');
      expect(seat.systemPrompt).toContain(
        'Never invent a citation, a title, a DOI, or a statistic.',
      );
    }
  });

  it('every seat is forbidden from hedging', () => {
    for (const seat of ALL_SEATS) {
      expect(seat.systemPrompt, `${seat.id} may hedge`).toContain('it depends');
    }
  });

  it('the chairman is told not to hedge and not to summarize', () => {
    expect(CHAIRMAN_PERSONA.systemPrompt).toContain('Never answer "it depends"');
    expect(CHAIRMAN_PERSONA.systemPrompt).toContain('you are the tie-breaker');
  });
});

// ---------------------------------------------------------------------------
// Which loops get a council — the check the brief says is most likely to slip
// ---------------------------------------------------------------------------

describe('council modes', () => {
  it('exists for exactly method, scope and contra', () => {
    const modes: CouncilMode[] = ['method', 'scope', 'contra'];
    for (const mode of modes) expect(advisorsForMode(mode).length).toBeGreaterThan(0);
  });

  it('has no seats for data or cite review', () => {
    // Verification asks whether a specific document says a specific thing.
    // Five models agreeing about one number is waste, so those loops get one
    // careful pass with web access instead — never a council.
    // @ts-expect-error deliberately probing a mode that must not exist
    expect(() => advisorsForMode('data')).not.toThrow();
    // The fallback must be the method council, never a data council.
    // @ts-expect-error same
    expect(advisorsForMode('data')).toBe(METHOD_ADVISORS);
  });

  it('reuses method seats in contra by reference, so an edit cannot drift', () => {
    const shared = CONTRA_ADVISORS.filter((seat) => METHOD_ADVISORS.includes(seat));
    expect(shared.map((s) => s.id)).toEqual([
      'identification-skeptic',
      'circularity-auditor',
      'policy-reader',
    ]);
  });

  it('contra adds a counter-evidence seat that treats NOT FOUND as valid', () => {
    const hunter = CONTRA_ADVISORS.find((s) => s.id === 'counter-evidence-hunter');
    expect(hunter).toBeDefined();
    expect(hunter!.systemPrompt).toContain('NOT FOUND is a valid and expected answer');
  });

  it('reports the completion count the confirm step shows', () => {
    expect(completionCount('method')).toBe(11); // 5 advisors + 5 peers + chairman
    expect(completionCount('scope')).toBe(11);
    expect(completionCount('contra')).toBe(9); // 4 seats
  });
});

// ---------------------------------------------------------------------------
// Anonymisation
// ---------------------------------------------------------------------------

describe('anonymizeResponses', () => {
  it('relabels every response and keeps a reversible mapping', () => {
    const input = [response('a'), response('b'), response('c')];
    const { anonymized, letterToAdvisorId } = anonymizeResponses(input, () => 0);
    expect(anonymized.map((r) => r.letter)).toEqual(['A', 'B', 'C']);
    expect(Object.keys(letterToAdvisorId).sort()).toEqual(['A', 'B', 'C']);
    // Every original advisor appears exactly once in the mapping.
    expect(Object.values(letterToAdvisorId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('actually shuffles — the letter order is not the input order', () => {
    const input = [response('a'), response('b'), response('c')];
    // In Fisher-Yates, rng→0 always picks j=0 and so permutes; rng→1 picks
    // j=i and swaps each element with itself, which is the identity. So 0 is
    // the value that proves the shuffle runs at all.
    const { letterToAdvisorId } = anonymizeResponses(input, () => 0);
    expect(letterToAdvisorId.A).not.toBe('a');
    expect(Object.values(letterToAdvisorId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves the order untouched when the rng degenerates to identity', () => {
    const input = [response('a'), response('b'), response('c')];
    const { letterToAdvisorId } = anonymizeResponses(input, () => 0.999);
    expect(letterToAdvisorId).toEqual({ A: 'a', B: 'b', C: 'c' });
  });

  it('keeps each letter pointing at the text that came with it', () => {
    const input = [response('a', 'AAA'), response('b', 'BBB')];
    const { anonymized, letterToAdvisorId } = anonymizeResponses(input, () => 0.999);
    for (const entry of anonymized) {
      const advisorId = letterToAdvisorId[entry.letter];
      const original = input.find((r) => r.advisorId === advisorId);
      expect(entry.text).toBe(original!.text);
    }
  });

  it('refuses more responses than it has letters', () => {
    const many = Array.from({ length: 9 }, (_, i) => response(`a${i}`));
    expect(() => anonymizeResponses(many)).toThrow(/Cannot anonymize/);
  });

  it('tells the peer prompt the real seat count, not a hardcoded five', () => {
    const four = [response('a'), response('b'), response('c'), response('d')];
    const { anonymized } = anonymizeResponses(four, () => 0);
    const [system] = buildPeerReviewMessages(CONTRA_ADVISORS[0], 'input', anonymized);
    expect(system.content).toContain('4-person research council');
    expect(system.content).not.toContain('five-person');
  });
});

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

describe('frameInput', () => {
  it('frames each mode as its own kind of artefact', () => {
    expect(frameInput('scope', 'q')).toContain('no pipeline yet');
    expect(frameInput('contra', 'c')).toContain('attack them');
    expect(frameInput('method', 'd')).toContain('review its method');
  });

  it('includes the working title when given and omits the line when not', () => {
    expect(frameInput('method', 'd', 'Carbon price')).toContain('Carbon price');
    expect(frameInput('method', 'd')).not.toContain('working title');
  });
});

// ---------------------------------------------------------------------------
// Parsing — malformed output must surface, not render as an empty panel
// ---------------------------------------------------------------------------

describe('parsing', () => {
  it('parses a fenced chairman verdict', () => {
    const verdict = parseChairmanVerdict(
      '```json\n{"consensus":"c","disagreements":"d","blind_spots":"b","recommendation":"r","first_step":"s"}\n```',
    );
    expect(verdict.recommendation).toBe('r');
    expect(verdict.firstStep).toBe('s');
    expect(verdictParsed(verdict)).toBe(true);
  });

  it('keeps unparseable chairman output as raw and reports it as unparsed', () => {
    const verdict = parseChairmanVerdict('The council broadly agrees that…');
    expect(verdict.raw).toBe('The council broadly agrees that…');
    expect(verdictParsed(verdict)).toBe(false);
  });

  it('treats an all-empty verdict as unparsed rather than as a real answer', () => {
    const verdict = parseChairmanVerdict('{}');
    expect(verdictParsed(verdict)).toBe(false);
  });

  it('accepts both snake_case and camelCase from the model', () => {
    const a = parsePeerReview('{"biggest_blind_spot":{"letter":"b","reason":"x"}}');
    const b = parsePeerReview('{"biggestBlindSpot":{"letter":"b","reason":"x"}}');
    expect(a.biggestBlindSpot?.letter).toBe('B');
    expect(b.biggestBlindSpot?.letter).toBe('B');
  });

  it('keeps unparseable peer output as raw', () => {
    const review = parsePeerReview('Response A was strongest.');
    expect(review.raw).toBe('Response A was strongest.');
    expect(review.strongest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

describe('validateCouncilRequest', () => {
  const base = { mode: 'method', content: 'design', confirmed: true };

  it('accepts a scope run with no project at all', () => {
    const { request, error } = validateCouncilRequest({ ...base, mode: 'scope' });
    expect(error).toBeUndefined();
    expect(request?.projectId).toBeUndefined();
  });

  it('rejects data and cite as modes', () => {
    expect(validateCouncilRequest({ ...base, mode: 'data' }).error).toMatch(/mode must be/);
    expect(validateCouncilRequest({ ...base, mode: 'cite' }).error).toMatch(/mode must be/);
  });

  it('defaults confirmed to false when absent, never to true', () => {
    const { request } = validateCouncilRequest({ mode: 'method', content: 'd' });
    expect(request?.confirmed).toBe(false);
  });

  it('rejects a non-UUID project id', () => {
    expect(validateCouncilRequest({ ...base, projectId: 'nope' }).error).toMatch(/UUID/);
  });

  it('rejects empty content and oversized content', () => {
    expect(validateCouncilRequest({ ...base, content: '  ' }).error).toMatch(/required/);
    expect(
      validateCouncilRequest({ ...base, content: 'x'.repeat(60_001) }).error,
    ).toMatch(/exceeds/);
  });
});

// ---------------------------------------------------------------------------
// Regressions from the Codex review of PR #20
// ---------------------------------------------------------------------------

describe('verdict shape validation (P2, review of #20)', () => {
  it('treats a parseable but contentless verdict as unparsed', () => {
    // `{}` parses cleanly into five empty strings and carries no `raw`, so a
    // `raw !== undefined` check called it good and the UI rendered an empty
    // verdict card — the exact empty-panel failure the brief forbids.
    const verdict = parseChairmanVerdict('{}');
    expect(verdict.raw).toBeUndefined();
    expect(verdictParsed(verdict)).toBe(false);
  });

  it('accepts a verdict carrying only a recommendation', () => {
    expect(verdictParsed(parseChairmanVerdict('{"recommendation":"do the thing"}'))).toBe(true);
  });

  it('accepts a verdict carrying only a consensus', () => {
    expect(verdictParsed(parseChairmanVerdict('{"consensus":"they agree"}'))).toBe(true);
  });

  it('rejects a verdict whose fields are present but blank', () => {
    expect(verdictParsed(parseChairmanVerdict('{"recommendation":"   ","consensus":""}'))).toBe(
      false,
    );
  });
});

describe('seat-count ceiling (P1, review of #20)', () => {
  it('no real council exceeds the anonymisation alphabet', () => {
    // The server caps seats at 8; anonymizeResponses throws above 8. These two
    // bounds must agree, or a request the server accepts would crash the client.
    for (const mode of ['method', 'scope', 'contra'] as CouncilMode[]) {
      expect(advisorsForMode(mode).length).toBeLessThanOrEqual(8);
    }
    const nine = Array.from({ length: 9 }, (_, i) => response(`a${i}`));
    expect(() => anonymizeResponses(nine)).toThrow();
  });
});
