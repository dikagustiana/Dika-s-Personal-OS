import type {
  IeltsError,
  IeltsPractice,
  IeltsPracticeTopic,
  IeltsPrepSkill,
  IeltsTopic,
} from '../../data/types';
import { resolveTopicSlug, type UnresolvedReason } from './errorTopicMap';

/**
 * THE VIEW THAT JUSTIFIES THE BUILD: what to work on next, ranked, each row
 * carrying the slug that addresses its own method page.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RANKING IS SMOOTHED
 * ---------------------------------------------------------------------------
 * Ranking by raw missed/attempted puts noise on top. One matching-headings
 * question faced once and got wrong is a 100% miss rate, and it would outrank
 * six misses in ten — which is the actual problem, with ten times the
 * evidence. Whoever opened the view would be sent to practise the wrong thing
 * on their first session, and the view's entire claim is that it tells you
 * what to work on.
 *
 * So the sort key is a shrunk estimate — (missed + 1) / (attempted + 4) —
 * which pulls small samples toward the middle until they earn their place:
 *
 *     1 of 1  missed → 0.40      six-of-ten outranks it
 *     6 of 10 missed → 0.50
 *     3 of 3  missed → 0.57      three for three still outranks it, correctly
 *     0 of 10 missed → 0.07
 *
 * THE DISPLAYED NUMBER IS ALWAYS THE RAW ONE. The smoothing decides order and
 * nothing else — a row says "6 of 10", never "0.50", because the shrunk value
 * is a ranking device and would be a lie as a statistic.
 *
 * ---------------------------------------------------------------------------
 * TWO PROVENANCES, AND WHY THE ERROR LOG CANNOT USE THE COUNT PATH
 * ---------------------------------------------------------------------------
 * Rows arrive from two places and they are NOT the same kind of evidence:
 *
 *   TAGGED   os_ielts_practice_topic, written by hand on the Log session tab.
 *            Carries attempted/missed (countable skills) or a rated severity
 *            1..3 (uncountable ones).
 *   DERIVED  os_ielts_errors, mapped through errorTopicMap.ts from a marking
 *            paste. Carries an OCCURRENCE and nothing else.
 *
 * An occurrence has NO DENOMINATOR. os_ielts_errors records that a mistake
 * happened; it does not record how many chances there were to make it. So a
 * derived row can never enter the count path: treating N occurrences as
 * `missed` requires an `attempted` that does not exist, and inventing one puts
 * a fabricated ratio on the screen that looks exactly like a measured one.
 * Derived evidence therefore feeds the SEVERITY path, and `attempted` and
 * `missed` stay at zero for a derived-only row.
 *
 * WHAT "SEVERITY" MEANS FOR A DERIVED ROW. Not a rating — nobody rated it.
 * It is RECURRENCE PER SESSION: the same mode logged three times in one
 * session is a worse problem than the same mode logged once in each of three
 * sessions, and that is exactly what the severity scale already expresses.
 * The existing estimator is reused VERBATIM, with occurrences standing in for
 * the severity sum and error sessions for the tag count, so no new constant
 * and no new scale enters the ranking.
 *
 * ONE ADDITION THE RATED PATH DOES NOT NEED: a clamp. A rated severity is 1..3
 * by database constraint, so its shrunk mean can never exceed 3. Occurrences
 * per session is unbounded — twenty occurrences in two sessions gives 1.83
 * after dividing by 3, which would break the 0..1 normalisation and let a
 * single bad session outrank every other row by an unbounded margin. The
 * shrunk mean is clamped to SEVERITY_CEILING before normalising.
 *
 * A TOPIC WITH BOTH provenances takes the MAX of the two concerns, not a sum
 * and not a blend. Blending two scales with no common unit is the fabrication
 * this file exists to avoid; max states a rule instead — rank by whichever
 * evidence is most alarming — and means derived evidence can only ever push a
 * row up, never mask a tagged one.
 *
 * ⚠ THIS DISTORTS THE COUNT/SEVERITY NORMALISATION, and the distortion is
 * pre-existing rather than introduced here, but the error log amplifies it.
 * The severity scale is FLOORED AT 1/3 (0.333) because SEVERITY_FLOOR is 1 and
 * the shrink pulls toward it before dividing by 3, while the count scale
 * reaches 0.071 at "0 of 10 missed". So:
 *
 *     one single error-log occurrence, one session   →  0.333
 *     2 of 10 missed, hand-tagged                    →  0.214
 *
 * A single logged mistake outranks a measured 20% miss rate. That was already
 * true of a single hand-tagged severity-1 row; what changes is volume, because
 * one criterion slug absorbs several modes (writing/criterion-grammatical-
 * range takes five, across three skills), so derived rows will cluster at the
 * top once the error log has data in it. The mitigation is NOT a rescale —
 * any rescale would be a number invented to fix a ranking — it is that
 * provenance is rendered on every row, so a top five that is entirely derived
 * is visible as such rather than being read as a measurement.
 */

/** Severity is 1..3, so this is the baseline "mild" it shrinks toward. */
const SEVERITY_FLOOR = 1;
const SEVERITY_CEILING = 3;

/**
 * Where a row's evidence came from. Rendered, not just tracked: a row derived
 * from a marking paste and a row tagged by hand are different claims and must
 * not look identical.
 */
export type WeaknessProvenance = 'tagged' | 'derived' | 'both';

export interface WeaknessRow {
  topic: IeltsTopic;
  /** Countable skills. ALWAYS 0 for derived evidence — there is no denominator. */
  attempted: number;
  missed: number;
  /** Uncountable skills: how many times tagged by hand, and the mean rated severity. */
  timesTagged: number;
  meanSeverity: number | null;
  /** Distinct hand-logged practice attempts. Does not include error-log sessions. */
  sessions: number;
  /** Error-log occurrences mapped to this topic. */
  occurrences: number;
  /**
   * Distinct dates among those occurrences. Kept apart from `sessions`: one
   * counts practice attempts and the other counts marking pastes, and a single
   * number covering both would mean two different things at once.
   */
  errorSessions: number;
  /** Distinct failure-mode names that fed this row, for the derived subline. */
  modes: readonly string[];
  provenance: WeaknessProvenance;
  /** Sort key only. Never rendered — see the note above. */
  concern: number;
  measurement: 'count' | 'severity';
}

// ---------------------------------------------------------------------------
// The error-log bridge
// ---------------------------------------------------------------------------

/** One topic's worth of error-log evidence. */
export interface DerivedTopicEvidence {
  topicSlug: string;
  occurrences: number;
  /** Distinct `date` values among the contributing rows. */
  errorSessions: number;
  /** Distinct failure-mode names, sorted. */
  modes: readonly string[];
}

export interface ErrorBridgeResult {
  evidence: DerivedTopicEvidence[];
  /** Every row that produced no slug, counted by why. Nothing is dropped silently. */
  unresolved: Record<UnresolvedReason, number>;
  totalErrors: number;
  mappedErrors: number;
}

const EMPTY_UNRESOLVED: Record<UnresolvedReason, number> = {
  unclassified: 0,
  unknown_skill: 0,
  unknown_mode: 0,
  mode_unmapped: 0,
  question_type_missing: 0,
  question_type_unknown: 0,
};

/**
 * Map an error log onto topics. Returns the evidence AND a full account of
 * what did not map, because an unmapped row is a fact about the taxonomy or
 * the alias table and silently losing it is the failure this bridge exists to
 * fix — see errorTopicMap.ts on UNCLASSIFIED and on the two hard-unmapped
 * pacing modes.
 */
export function deriveWeaknessFromErrors(errors: readonly IeltsError[]): ErrorBridgeResult {
  const buckets = new Map<string, { occurrences: number; dates: Set<string>; modes: Set<string> }>();
  const unresolved: Record<UnresolvedReason, number> = { ...EMPTY_UNRESOLVED };
  let mappedErrors = 0;

  for (const error of errors) {
    const resolution = resolveTopicSlug(error);
    if (resolution.slug === null) {
      unresolved[resolution.reason] += 1;
      continue;
    }
    mappedErrors += 1;
    const bucket =
      buckets.get(resolution.slug) ??
      { occurrences: 0, dates: new Set<string>(), modes: new Set<string>() };
    bucket.occurrences += 1;
    bucket.dates.add(error.date);
    bucket.modes.add(error.failureMode);
    buckets.set(resolution.slug, bucket);
  }

  const evidence = [...buckets.entries()]
    .map(([topicSlug, bucket]) => ({
      topicSlug,
      occurrences: bucket.occurrences,
      errorSessions: bucket.dates.size,
      modes: [...bucket.modes].sort(),
    }))
    .sort((a, b) => a.topicSlug.localeCompare(b.topicSlug));

  return { evidence, unresolved, totalErrors: errors.length, mappedErrors };
}

export function aggregateWeakness(
  topics: readonly IeltsTopic[],
  practices: readonly IeltsPractice[],
  practiceTopics: readonly IeltsPracticeTopic[],
  /**
   * Error-log evidence from deriveWeaknessFromErrors. Optional and defaulting
   * to empty, so every existing caller and test keeps its exact behaviour: a
   * weakness list built from hand tags alone is unchanged by this parameter.
   */
  derived: readonly DerivedTopicEvidence[] = [],
): WeaknessRow[] {
  const topicBySlug = new Map(topics.map((topic) => [topic.slug, topic]));
  const practiceById = new Map(practices.map((practice) => [practice.id, practice]));

  const accumulator = new Map<
    string,
    {
      attempted: number;
      missed: number;
      severitySum: number;
      timesTagged: number;
      sessions: Set<string>;
      occurrences: number;
      errorSessions: number;
      modes: readonly string[];
    }
  >();

  const emptyBucket = () => ({
    attempted: 0,
    missed: 0,
    severitySum: 0,
    timesTagged: 0,
    sessions: new Set<string>(),
    occurrences: 0,
    errorSessions: 0,
    modes: [] as readonly string[],
  });

  for (const row of practiceTopics) {
    // A tag whose practice row is missing is a tag from a deleted attempt, or
    // a partially-loaded read. Either way it has no date and no skill, so it
    // cannot be attributed — skip rather than count it against the topic.
    if (!practiceById.has(row.practiceId)) continue;
    if (!topicBySlug.has(row.topicSlug)) continue;

    const bucket = accumulator.get(row.topicSlug) ?? emptyBucket();

    if (row.attempted !== undefined && row.attempted !== null) {
      bucket.attempted += row.attempted;
      bucket.missed += row.missed ?? 0;
    }
    if (row.severity !== undefined && row.severity !== null) {
      bucket.severitySum += row.severity;
      bucket.timesTagged += 1;
    }
    bucket.sessions.add(row.practiceId);
    accumulator.set(row.topicSlug, bucket);
  }

  // Error-log evidence, folded in AFTER the hand tags so a topic carrying both
  // ends up in one row rather than two competing ones. A derived slug the
  // topic table does not hold is skipped by the same guard as a tag row.
  for (const item of derived) {
    if (!topicBySlug.has(item.topicSlug)) continue;
    const bucket = accumulator.get(item.topicSlug) ?? emptyBucket();
    bucket.occurrences += item.occurrences;
    bucket.errorSessions += item.errorSessions;
    bucket.modes = [...new Set([...bucket.modes, ...item.modes])].sort();
    accumulator.set(item.topicSlug, bucket);
  }

  const rows: WeaknessRow[] = [];
  for (const [slug, bucket] of accumulator) {
    const topic = topicBySlug.get(slug);
    if (!topic) continue;

    const measurement: 'count' | 'severity' = bucket.attempted > 0 ? 'count' : 'severity';
    const meanSeverity = bucket.timesTagged > 0 ? bucket.severitySum / bucket.timesTagged : null;

    const taggedConcern =
      measurement === 'count'
        ? (bucket.missed + 1) / (bucket.attempted + 4)
        : // Same shrink, expressed on the 1..3 severity scale and then
          // normalised to 0..1 so the two measurements can share one list.
          (bucket.severitySum + SEVERITY_FLOOR * 2) / (bucket.timesTagged + 2) / SEVERITY_CEILING;

    // The SAME estimator, with occurrences standing in for the severity sum and
    // error sessions for the tag count — recurrence per session, read as a
    // severity. Clamped, because occurrences per session is unbounded while a
    // rated severity is 1..3 by database constraint; without the clamp a single
    // dense session normalises above 1 and outranks everything by an unbounded
    // margin. Zero when there is no derived evidence, so max() below is a no-op.
    const derivedConcern =
      bucket.occurrences > 0
        ? Math.min(
            SEVERITY_CEILING,
            (bucket.occurrences + SEVERITY_FLOOR * 2) / (bucket.errorSessions + 2),
          ) / SEVERITY_CEILING
        : 0;

    // MAX, never a sum or a blend: the two carry no common unit, so the only
    // honest combination is a rule about which one governs. See the header.
    const concern = Math.max(taggedConcern, derivedConcern);

    const hasTagged = bucket.attempted > 0 || bucket.timesTagged > 0;
    const hasDerived = bucket.occurrences > 0;
    const provenance: WeaknessProvenance =
      hasTagged && hasDerived ? 'both' : hasDerived ? 'derived' : 'tagged';

    rows.push({
      topic,
      attempted: bucket.attempted,
      missed: bucket.missed,
      timesTagged: bucket.timesTagged,
      meanSeverity,
      sessions: bucket.sessions.size,
      occurrences: bucket.occurrences,
      errorSessions: bucket.errorSessions,
      modes: bucket.modes,
      provenance,
      concern,
      measurement,
    });
  }

  return rows.sort(
    (a, b) =>
      b.concern - a.concern ||
      // Ties break toward the row with more evidence behind it, then by label
      // so the order is stable across reloads. Occurrences count as evidence:
      // without them every derived row carries zero and twelve occurrences
      // would tie with one, falling through to an alphabetical order that
      // reads as a ranking.
      b.attempted + b.timesTagged + b.occurrences - (a.attempted + a.timesTagged + a.occurrences) ||
      a.topic.label.localeCompare(b.topic.label),
  );
}

/**
 * The raw ratio, for display. Null where the topic is severity-measured — and
 * therefore null for every derived row, because an occurrence has no
 * denominator and a percentage would be invented rather than measured.
 */
export function missRate(row: WeaknessRow): number | null {
  return row.measurement === 'count' && row.attempted > 0 ? row.missed / row.attempted : null;
}

// ---------------------------------------------------------------------------
// The dashboard's numbers
// ---------------------------------------------------------------------------

/**
 * THE BINDING CONSTRAINT: the skill furthest below its per-skill floor.
 *
 * Not the average. An overall 7.0 built on a 5.5 in writing fails a 6.5 floor,
 * and the average is the number that hides exactly that. A skill with no
 * logged band is not "at target" and is not "below" either — it is UNKNOWN,
 * and reported as such, because treating unmeasured as passing is how the one
 * skill nobody practises stays invisible until the test.
 */
export interface SkillStanding {
  skill: IeltsPrepSkill;
  latestBand: number | null;
  attemptedOn: string | null;
  /** Negative means below the floor. Null when there is no band yet. */
  gapToFloor: number | null;
}

export function skillStandings(
  practices: readonly IeltsPractice[],
  floor: number | undefined,
): SkillStanding[] {
  const skills: IeltsPrepSkill[] = ['listening', 'reading', 'writing', 'speaking'];
  return skills.map((skill) => {
    const latest = practices
      .filter((practice) => practice.skill === skill && practice.band !== undefined)
      .sort(
        (a, b) =>
          b.attemptedOn.localeCompare(a.attemptedOn) || b.createdAt.localeCompare(a.createdAt),
      )[0];
    const latestBand = latest?.band ?? null;
    return {
      skill,
      latestBand,
      attemptedOn: latest?.attemptedOn ?? null,
      gapToFloor: latestBand !== null && floor !== undefined ? latestBand - floor : null,
    };
  });
}

/** The one to name on the dashboard. Unknown skills are surfaced separately. */
export function bindingConstraint(standings: readonly SkillStanding[]): SkillStanding | null {
  const below = standings
    .filter((standing) => standing.gapToFloor !== null && standing.gapToFloor < 0)
    .sort((a, b) => (a.gapToFloor as number) - (b.gapToFloor as number));
  return below[0] ?? null;
}

/** Whole days from `today` to the test date; negative once it is past. */
export function daysUntil(testDate: string, today: Date): number {
  const target = Date.UTC(
    Number(testDate.slice(0, 4)),
    Number(testDate.slice(5, 7)) - 1,
    Number(testDate.slice(8, 10)),
  );
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - now) / 86_400_000);
}

/**
 * Attempts logged in the last 7 days including today. A rolling window, not
 * "since Monday": on a Tuesday the calendar week says 2 days of practice is
 * the whole story, which flatters a week that was actually empty.
 */
export function loggedThisWeek(practices: readonly IeltsPractice[], today: Date): number {
  const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const start = end - 6 * 86_400_000;
  return practices.filter((practice) => {
    const day = Date.UTC(
      Number(practice.attemptedOn.slice(0, 4)),
      Number(practice.attemptedOn.slice(5, 7)) - 1,
      Number(practice.attemptedOn.slice(8, 10)),
    );
    return day >= start && day <= end;
  }).length;
}
