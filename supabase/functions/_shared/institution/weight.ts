// =============================================================================
// B-10 — WEIGHT CLASSES AND THE COST ESTIMATE
// =============================================================================
//
// Eight departments, peer review in each, a lead review, a committee review
// and a debate is the right shape for a major research output and absurd for
// a small question. Without a lighter path the director stops using the
// system, which is the real failure mode. So the program office picks a
// class at intake, shows the estimate BEFORE the run, and the actual after.
//
//   brief      one department, one specialist, one peer review. No committee.
//   standard   the departments the question needs, full peer and lead review,
//              committee review, no proactive upgrade proposals.
//   full       the whole pipeline, committee, debate, proposals, evals.
//
// VERIFICATION IS IN EVERY CLASS, brief included. It is the last line before
// the director's name goes on something, and 1-C says it may not be skipped.
//
// The estimate is arithmetic over measured per-call costs, not a guess: the
// caller passes the provider's price per million tokens and the median
// tokens per call measured from os_lab_runs. Where there is no history the
// caller passes the fallback and the UI says the estimate is a fallback —
// the same honesty rule as the floor's progress bar.

export type WeightClass = 'brief' | 'standard' | 'full';

export const WEIGHT_CLASSES: readonly WeightClass[] = ['brief', 'standard', 'full'];

export interface ClassShape {
  weightClass: WeightClass;
  /** How many departments the class will visit, at most. */
  maxDepartments: number;
  specialistsPerDepartment: number;
  peerReviewPerOutput: boolean;
  leadReview: boolean;
  committeeReview: boolean;
  debate: boolean;
  proposals: boolean;
  evals: boolean;
}

export const SHAPES: Record<WeightClass, ClassShape> = {
  brief: {
    weightClass: 'brief',
    maxDepartments: 2, // the one the question needs, plus Verification
    specialistsPerDepartment: 1,
    peerReviewPerOutput: true,
    leadReview: true,
    committeeReview: false,
    debate: false,
    proposals: false,
    evals: false,
  },
  standard: {
    weightClass: 'standard',
    maxDepartments: 6,
    specialistsPerDepartment: 2,
    peerReviewPerOutput: true,
    leadReview: true,
    committeeReview: true,
    debate: false,
    proposals: false,
    evals: false,
  },
  full: {
    weightClass: 'full',
    maxDepartments: 9,
    specialistsPerDepartment: 3,
    peerReviewPerOutput: true,
    leadReview: true,
    committeeReview: true,
    debate: true,
    proposals: true,
    evals: true,
  },
};

/** Verification is in every routing, at every class. 1-C, not negotiable. */
export const ALWAYS_ROUTED = 'verification';

export interface CallEstimate {
  /** Median input+output tokens for one agent call, measured where possible. */
  tokensPerCall: number;
  /** True when the figure came from run history rather than the fallback. */
  measured: boolean;
  costPerMillionTokensUsd: number;
}

export interface Estimate {
  weightClass: WeightClass;
  departments: string[];
  calls: number;
  tokens: number;
  costUsd: number;
  measured: boolean;
  breakdown: Array<{ stage: string; calls: number }>;
}

/**
 * Count the calls a class implies over a routing, then price them.
 *
 * The count is deliberately explicit rather than a formula: every line is a
 * real call the stepper will make, so an estimate that is wrong is wrong in
 * a way a reader can point at.
 */
export function estimate(
  weightClass: WeightClass,
  routing: readonly string[],
  call: CallEstimate,
): Estimate {
  const shape = SHAPES[weightClass];
  const departments = routing.slice(0, shape.maxDepartments);
  const breakdown: Array<{ stage: string; calls: number }> = [];

  // Every line below is one `await run(...)` in the stepper, counted against
  // what nextAction() actually dispatches. weight.test.ts walks the state
  // machine and fails if these drift — which they had: intake was priced at
  // two calls when the stepper makes one, and lead review was priced per
  // DEPARTMENT when the machine reviews per OUTPUT. At `full` that undercounted
  // a seven-department run by 23 calls, and B-10 would have reported it as an
  // overrun after the money was spent instead of before.
  breakdown.push({ stage: 'program office intake and routing', calls: 1 });
  const perDepartment = departments.length;
  breakdown.push({ stage: 'lead intake', calls: perDepartment });
  const specialistCalls = perDepartment * shape.specialistsPerDepartment;
  breakdown.push({ stage: 'specialist work', calls: specialistCalls });
  if (shape.peerReviewPerOutput) breakdown.push({ stage: 'peer review', calls: specialistCalls });
  if (shape.leadReview) {
    // One lead review per output (pipeline.ts branch f), then one submission
    // per department (branch g).
    breakdown.push({ stage: 'lead review', calls: specialistCalls });
    breakdown.push({ stage: 'submission onward', calls: perDepartment });
  }
  if (shape.committeeReview) breakdown.push({ stage: 'committee review', calls: 1 });
  if (shape.debate) breakdown.push({ stage: 'debate (2 rounds, both sides)', calls: 4 });
  if (shape.proposals) breakdown.push({ stage: 'upgrade proposals', calls: 2 });
  if (shape.evals) breakdown.push({ stage: 'evaluations before and after', calls: 4 });

  const calls = breakdown.reduce((total, line) => total + line.calls, 0);
  const tokens = calls * call.tokensPerCall;
  const costUsd = (tokens / 1_000_000) * call.costPerMillionTokensUsd;
  return {
    weightClass,
    departments: [...departments],
    calls,
    tokens,
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    measured: call.measured,
    breakdown,
  };
}

export interface ClassSuggestion {
  weightClass: WeightClass;
  reason: string;
}

/**
 * The class the program office suggests from the question alone. The
 * director may override it, and the override is recorded on the brief —
 * `class_overridden_by_director`, so a cheap run that produced thin work can
 * be told from a cheap run the institution chose.
 */
export function suggestClass(question: string, requestedDepartments: number): ClassSuggestion {
  const text = question.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  const majorMarkers = ['strategy', 'business plan', 'market entry', 'feasibility', 'valuation', 'restructur', 'board', 'investment case', 'transformation'];
  const smallMarkers = ['what is', 'define', 'look up', 'how many', 'when did', 'which standard', 'remind me', 'summarise', 'summarize'];

  if (smallMarkers.some((marker) => text.includes(marker)) && words <= 25 && requestedDepartments <= 1) {
    return { weightClass: 'brief', reason: 'a single lookup-shaped question: one department, one specialist, one peer review, and Verification' };
  }
  if (majorMarkers.some((marker) => text.includes(marker)) || requestedDepartments >= 6 || words > 80) {
    return { weightClass: 'full', reason: 'a decision-grade question: the whole pipeline, the committee, debate, proposals and evals' };
  }
  return { weightClass: 'standard', reason: 'a research question of ordinary size: the departments it needs, full review, committee, no proactive proposals' };
}

/** Routing always ends at Verification, then Editorial if the class carries it. */
export function withMandatoryStops(routing: readonly string[], weightClass: WeightClass): string[] {
  const out = routing.filter((slug) => slug !== ALWAYS_ROUTED && slug !== 'editorial');
  out.push(ALWAYS_ROUTED);
  if (weightClass !== 'brief' && routing.includes('editorial')) out.push('editorial');
  return out;
}

export interface OverrunVerdict {
  overrun: boolean;
  ratio: number;
  message: string;
}

/**
 * The program office owns spend against the estimate and surfaces overrun to
 * the director rather than silently continuing. 1.5x is the line: under it
 * an estimate was imprecise, over it the estimate was wrong about the work.
 */
export function checkOverrun(estimated: number, actual: number, threshold = 1.5): OverrunVerdict {
  if (estimated <= 0) {
    return { overrun: actual > 0, ratio: Number.POSITIVE_INFINITY, message: 'no estimate was recorded, so nothing was measured against it' };
  }
  const ratio = actual / estimated;
  if (ratio <= threshold) {
    return { overrun: false, ratio, message: `spend is ${ratio.toFixed(2)}x the estimate` };
  }
  return {
    overrun: true,
    ratio,
    message: `spend is ${ratio.toFixed(2)}x the estimate (over the ${threshold}x line) — the director is told now, not after the run`,
  };
}
