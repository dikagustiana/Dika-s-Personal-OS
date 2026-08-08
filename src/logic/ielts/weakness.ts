import type {
  IeltsPractice,
  IeltsPracticeTopic,
  IeltsPrepSkill,
  IeltsTopic,
} from '../../data/types';

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
 */

/** Severity is 1..3, so this is the baseline "mild" it shrinks toward. */
const SEVERITY_FLOOR = 1;
const SEVERITY_CEILING = 3;

export interface WeaknessRow {
  topic: IeltsTopic;
  /** Countable skills. */
  attempted: number;
  missed: number;
  /** Uncountable skills: how many times tagged, and the mean severity. */
  timesTagged: number;
  meanSeverity: number | null;
  /** How many distinct practice attempts contributed. */
  sessions: number;
  /** Sort key only. Never rendered — see the note above. */
  concern: number;
  measurement: 'count' | 'severity';
}

export function aggregateWeakness(
  topics: readonly IeltsTopic[],
  practices: readonly IeltsPractice[],
  practiceTopics: readonly IeltsPracticeTopic[],
): WeaknessRow[] {
  const topicBySlug = new Map(topics.map((topic) => [topic.slug, topic]));
  const practiceById = new Map(practices.map((practice) => [practice.id, practice]));

  const accumulator = new Map<
    string,
    { attempted: number; missed: number; severitySum: number; timesTagged: number; sessions: Set<string> }
  >();

  for (const row of practiceTopics) {
    // A tag whose practice row is missing is a tag from a deleted attempt, or
    // a partially-loaded read. Either way it has no date and no skill, so it
    // cannot be attributed — skip rather than count it against the topic.
    if (!practiceById.has(row.practiceId)) continue;
    if (!topicBySlug.has(row.topicSlug)) continue;

    const bucket =
      accumulator.get(row.topicSlug) ??
      { attempted: 0, missed: 0, severitySum: 0, timesTagged: 0, sessions: new Set<string>() };

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

  const rows: WeaknessRow[] = [];
  for (const [slug, bucket] of accumulator) {
    const topic = topicBySlug.get(slug);
    if (!topic) continue;

    const measurement: 'count' | 'severity' = bucket.attempted > 0 ? 'count' : 'severity';
    const meanSeverity = bucket.timesTagged > 0 ? bucket.severitySum / bucket.timesTagged : null;

    const concern =
      measurement === 'count'
        ? (bucket.missed + 1) / (bucket.attempted + 4)
        : // Same shrink, expressed on the 1..3 severity scale and then
          // normalised to 0..1 so the two measurements can share one list.
          (bucket.severitySum + SEVERITY_FLOOR * 2) / (bucket.timesTagged + 2) / SEVERITY_CEILING;

    rows.push({
      topic,
      attempted: bucket.attempted,
      missed: bucket.missed,
      timesTagged: bucket.timesTagged,
      meanSeverity,
      sessions: bucket.sessions.size,
      concern,
      measurement,
    });
  }

  return rows.sort(
    (a, b) =>
      b.concern - a.concern ||
      // Ties break toward the row with more evidence behind it, then by label
      // so the order is stable across reloads.
      b.attempted + b.timesTagged - (a.attempted + a.timesTagged) ||
      a.topic.label.localeCompare(b.topic.label),
  );
}

/** The raw ratio, for display. Null where the topic is severity-measured. */
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
