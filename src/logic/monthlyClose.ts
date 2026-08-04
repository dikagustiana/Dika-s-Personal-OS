import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Repository } from '../data/repository';
import type { Milestone, Project } from '../data/types';
import { milestoneEnd } from './milestones';

// The recurring monthly-close cycle: five entity closes plus consolidation.
export const CLOSE_ENTITIES = ['BMG', 'OKI', 'KGR', 'NMG', 'KBF'] as const;

// One independent series per project. Each generates, and rolls forward, on
// its own — a series is never suppressed because a sibling already exists.
export const CLOSE_SERIES = [...CLOSE_ENTITIES, 'Consolidation'] as const;
export type CloseSeries = (typeof CLOSE_SERIES)[number];

const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

// The title separator between the period label and the series name.
const SERIES_SEPARATOR = ' — ';

/**
 * The close period a given date belongs to, as YYYY-MM. Cycles generate on
 * the 22nd for THAT month's close, so before the 22nd the pending period is
 * still the previous month (its milestones run into the following month).
 */
export function targetPeriod(now: Date): string {
  const day = now.getDate();
  const base = new Date(now.getFullYear(), now.getMonth() - (day < 22 ? 1 : 0), 1);
  return format(base, 'yyyy-MM');
}

/** "2026-07" -> "Closing Juli" — the label follows the PERIOD month. */
export function periodLabel(period: string): string {
  const month = Number(period.slice(5, 7));
  return `Closing ${INDONESIAN_MONTHS[month - 1]}`;
}

// ---------------------------------------------------------------------------
// Working-day arithmetic
//
// A close is not paced in calendar days. D0 is the last calendar day of the
// period (the cut-off), WD1 is the first weekday strictly after it, and WDn
// counts weekdays only — so a task at WD6 lands on a Monday when the weekend
// falls in between, instead of on a Saturday nobody works.
//
// Indonesian public holidays are deliberately NOT modelled. There is no
// holiday table in this app and no reliable source wired up to it; a guessed
// or hardcoded list would silently move real deadlines onto wrong dates,
// which is worse than the owner nudging two dates by hand when a national
// holiday lands mid-close. Weekends only.
//
// Only resolved calendar dates are ever stored. "WD5" is a way of computing a
// date, never a value that reaches the database.
// ---------------------------------------------------------------------------

// A close task more than a working year past cut-off is bad data, not a
// schedule. The cap keeps a corrupt date from spinning the resolver.
const MAX_WORKING_DAY = 260;

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6; // Sunday, Saturday
}

/** D0 — the last calendar day of the period, as YYYY-MM-DD. */
export function periodEnd(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7)); // 1-based; day 0 = last day of it
  return format(new Date(year, month, 0), 'yyyy-MM-dd');
}

/**
 * Resolves a close-day index to a calendar date.
 *
 * `0` is D0, `n >= 1` is WDn, and a negative index is that many calendar days
 * before D0 — the last case exists only so a hand-entered date inside the
 * period survives a roll-forward instead of being snapped to the cut-off.
 */
export function resolveCloseDay(period: string, index: number): string {
  const d0 = parseISO(periodEnd(period));
  if (index <= 0) return format(addDays(d0, index), 'yyyy-MM-dd');

  let cursor = d0;
  let counted = 0;
  const target = Math.min(index, MAX_WORKING_DAY);
  while (counted < target) {
    cursor = addDays(cursor, 1);
    if (isWeekday(cursor)) counted += 1;
  }
  return format(cursor, 'yyyy-MM-dd');
}

/** WDn for a period. `workingDay('2026-07', 6)` is 2026-08-10, not the 8th. */
export function workingDay(period: string, n: number): string {
  return resolveCloseDay(period, n);
}

/**
 * The close-day index a date sits on within its period — the inverse of
 * `resolveCloseDay`, so a date can be re-expressed in another period's
 * calendar.
 *
 * A date that falls on a weekend after D0 reports the index of the weekday
 * before it, so it snaps onto a working day on the way back out. That is a
 * deliberate normalisation: a close task scheduled on a Saturday is an
 * artefact, not an intention.
 */
export function closeDayIndex(period: string, date: string): number {
  const d0 = parseISO(periodEnd(period));
  const offset = differenceInCalendarDays(parseISO(date), d0);
  if (offset <= 0) return offset;

  let cursor = d0;
  let index = 0;
  for (let step = 0; step < offset; step += 1) {
    cursor = addDays(cursor, 1);
    if (isWeekday(cursor)) index += 1;
  }
  return index;
}

/** Re-expresses a date from one period's close calendar in another's. */
export function shiftCloseDate(date: string, from: string, to: string): string {
  return resolveCloseDay(to, closeDayIndex(from, date));
}

// ---------------------------------------------------------------------------
// The close-cycle window
// ---------------------------------------------------------------------------

// WD8 is where a cycle is expected to be finished. The project deadline and the
// close card's window both end there, so they read from one value instead of
// two literals that can drift apart.
const CLOSE_DEADLINE_WD = 8;

// The day of the period's own month a cycle opens — the same day `targetPeriod`
// starts pointing at that period.
const CLOSE_OPEN_DAY = 22;

export type CloseWindowState = 'before' | 'visible' | 'ask';

/**
 * Where a period's close sits relative to its own window.
 *
 * `before` means the cycle has not opened yet. `visible` runs from the 22nd of
 * the period month through WD8 of the following month. After WD8 the state is
 * `ask`, not `before` again: a cycle that overran is still real work, so the
 * card asks whether it finished rather than vanishing and taking an unfinished
 * checklist with it. What that question looks like is the UI's business.
 *
 * Compared on calendar dates, so any time of day on the 22nd or on WD8 counts
 * as inside the window instead of half of it.
 */
export function closeWindowState(period: string, now: Date): CloseWindowState {
  const today = format(now, 'yyyy-MM-dd');
  const opens = `${period}-${String(CLOSE_OPEN_DAY).padStart(2, '0')}`;
  if (today < opens) return 'before';
  return today <= workingDay(period, CLOSE_DEADLINE_WD) ? 'visible' : 'ask';
}

// ---------------------------------------------------------------------------
// Series identity
// ---------------------------------------------------------------------------

function isCloseSeries(value: string): value is CloseSeries {
  return (CLOSE_SERIES as readonly string[]).includes(value);
}

/** Where a series sits in the Monthly Close view, matching generation order. */
function closeOrder(series: CloseSeries): number {
  return 100 + CLOSE_SERIES.indexOf(series);
}

/**
 * Which series a recurring close project belongs to.
 *
 * `entity_tag` wins when it names a known series, because it is the field the
 * owner controls; the title suffix is the fallback, and is what every project
 * generated before entity tags existed carries. Returns null for a project
 * that is not part of the cycle at all.
 */
export function seriesOf(project: Project): CloseSeries | null {
  const tag = project.entityTag?.trim();
  if (tag && isCloseSeries(tag)) return tag;
  const suffix = project.title.split(SERIES_SEPARATOR).pop()?.trim();
  return suffix && isCloseSeries(suffix) ? suffix : null;
}

// ---------------------------------------------------------------------------
// Fallback template
// ---------------------------------------------------------------------------

/**
 * A milestone for the fallback template. Dates are written to `endDate`:
 * `dueDate` is the legacy field and nothing new writes it, so a first-ever
 * generation does not immediately owe the next roll-forward a migration.
 */
function milestone(text: string, period: string, wd: number): Milestone {
  return {
    id: crypto.randomUUID(),
    text,
    done: false,
    status: 'not-started',
    endDate: workingDay(period, wd),
  };
}

/**
 * The generic six-project template — used ONLY when a series has no prior
 * period to copy from: a first-ever generation, or an entity added to
 * CLOSE_SERIES later.
 *
 * Its milestone content is deliberately minimal and generic. The real
 * checklist for a given entity is data the owner maintains from the UI, and
 * it reaches new periods by roll-forward, not from this file.
 */
export function buildMonthlyCloseInputs(period: string): Array<Omit<Project, 'id'>> {
  const label = periodLabel(period);
  const entityProjects = CLOSE_ENTITIES.map<Omit<Project, 'id'>>((entity) => ({
    domain: 'work',
    // Every close series is a SAMB-group entity; the collaborator read policy
    // keys on this, so a template that forgot it would hide new closes.
    engagement: 'samb',
    title: `${label}${SERIES_SEPARATOR}${entity}`,
    type: 'other',
    status: 'active',
    // The project deadline is the same working day the checklist runs to. A
    // calendar 8th read as overdue while the last milestone was still
    // legitimately open, which made the project card argue with its own rows.
    deadline: workingDay(period, CLOSE_DEADLINE_WD),
    milestones: [
      milestone('Close the books', period, 3),
      milestone('TB final & reconciled', period, 6),
    ],
    order: closeOrder(entity),
    recurring: 'monthly',
    period,
  }));

  const consolidation: Omit<Project, 'id'> = {
    domain: 'work',
    engagement: 'samb',
    title: `${label}${SERIES_SEPARATOR}Consolidation`,
    type: 'other',
    status: 'active',
    // Consolidation used to sit one calendar day after the entities. Both now
    // land on WD8, so that gap is deliberately collapsed: expressing it in
    // working days would push consolidation to WD9, a date nobody committed to.
    deadline: workingDay(period, CLOSE_DEADLINE_WD),
    milestones: [
      milestone('Collect entity TBs', period, 4),
      milestone('Eliminations & consolidated TB', period, 5),
      milestone('Approve TB', period, 6),
      milestone('Build monthly review deck', period, 7),
    ],
    order: closeOrder('Consolidation'),
    recurring: 'monthly',
    period,
  };

  return [...entityProjects, consolidation];
}

// ---------------------------------------------------------------------------
// Roll-forward
// ---------------------------------------------------------------------------

/**
 * Copies one milestone into the next period.
 *
 * Preserved: the text, the PIC (the owner rarely reassigns month to month),
 * and any date-confidence marking they set.
 *
 * Reset: status and done, so the new cycle starts clean — except for a
 * milestone still 'blocked' at the end of the cycle, which keeps that status
 * and the note explaining it. Cleared otherwise: the note, the escalation
 * flag, and the documents (last month's working papers are not this month's).
 * A fresh id, because this is a new instance of the task and not the same one.
 *
 * Dates shift by working day, not by adding a month — a task that ran on WD6
 * in June runs on WD6 in July, wherever the weekend falls. This is also the
 * one place the legacy `dueDate` is allowed to migrate: a milestone that only
 * ever had a `dueDate` comes out the other side with `endDate` set and
 * `dueDate` gone.
 */
export function rollForwardMilestone(
  source: Milestone,
  from: string,
  to: string,
): Milestone {
  const end = milestoneEnd(source);
  // A blocker resolved mid-cycle would already have moved the milestone to
  // in-progress or done, so anything still blocked when the cycle ends was
  // never unblocked: it is a standing blocker, not last month's news. Resetting
  // it to not-started and dropping the explanation produces a LESS accurate
  // record of where the work stands, not a cleaner one.
  const stillBlocked = source.status === 'blocked';
  const rolled: Milestone = {
    id: crypto.randomUUID(),
    text: source.text,
    done: false,
    status: stillBlocked ? 'blocked' : 'not-started',
    escalateTo: 'none',
  };
  if (stillBlocked && source.note) rolled.note = source.note;
  if (source.pic) rolled.pic = source.pic;
  if (source.dateConfidence) rolled.dateConfidence = source.dateConfidence;
  if (source.startDate) rolled.startDate = shiftCloseDate(source.startDate, from, to);
  if (end) rolled.endDate = shiftCloseDate(end, from, to);
  return rolled;
}

/**
 * Copies a whole close project into the next period.
 *
 * Every milestone comes across as a new instance of the task — clean, apart
 * from a standing blocker (see `rollForwardMilestone`). Milestones
 * the previous cycle never finished are NOT additionally carried over as
 * leftovers — they stay on the older project, where they keep showing as
 * overdue, which is the existing deliberate behaviour. Copying them as well
 * would double-count the same piece of work across two periods.
 *
 * The project keeps its entity tag and its parent; project-level documents
 * are cleared for the same reason milestone documents are.
 */
export function rollForwardProject(
  source: Project,
  to: string,
  series: CloseSeries,
): Omit<Project, 'id'> {
  const from = source.period ?? to;
  const rolled: Omit<Project, 'id'> = {
    domain: source.domain,
    // Rolls forward with the series: a close cycle never changes client.
    engagement: source.engagement,
    title: `${periodLabel(to)}${SERIES_SEPARATOR}${series}`,
    type: source.type,
    status: 'active',
    milestones: source.milestones.map((item) => rollForwardMilestone(item, from, to)),
    order: closeOrder(series),
    recurring: 'monthly',
    period: to,
    // WD8 for every series, consolidation included — see the note in
    // buildMonthlyCloseInputs on the collapsed one-day gap.
    deadline: workingDay(to, CLOSE_DEADLINE_WD),
  };
  if (source.targetMetric) rolled.targetMetric = source.targetMetric;
  if (source.entityTag) rolled.entityTag = source.entityTag;
  if (source.parentId) rolled.parentId = source.parentId;
  return rolled;
}

/** The most recent close project in a series strictly before `period`. */
export function latestPriorClose(
  existing: Project[],
  period: string,
  series: CloseSeries,
): Project | null {
  const candidates = existing
    .filter(
      (project) =>
        project.recurring === 'monthly' &&
        typeof project.period === 'string' &&
        project.period < period &&
        seriesOf(project) === series,
    )
    .sort((a, b) => (a.period as string).localeCompare(b.period as string));
  return candidates.at(-1) ?? null;
}

/** Series with no project for the period yet, in generation order. */
export function missingSeries(existing: Project[], period: string): CloseSeries[] {
  const present = new Set<CloseSeries>();
  for (const project of existing) {
    if (project.recurring !== 'monthly' || project.period !== period) continue;
    const series = seriesOf(project);
    if (series) present.add(series);
  }
  return CLOSE_SERIES.filter((series) => !present.has(series));
}

/**
 * True when THIS series has no project for the period.
 *
 * Per series, not per period: the old per-period check meant one existing
 * project suppressed generation of the other five, so a cycle that was
 * partially created (or had one project deleted) could never complete itself.
 */
export function needsGeneration(
  existing: Project[],
  period: string,
  series: CloseSeries,
): boolean {
  return missingSeries(existing, period).includes(series);
}

/**
 * Generates whatever the current period is missing, one series at a time.
 *
 * Each missing series rolls forward from its own most recent prior period —
 * so the checklist the owner maintains in the UI propagates automatically,
 * with PICs intact, dates shifted by working day, and statuses clean. A
 * series with no history at all falls back to the generic template; nothing
 * is invented for it.
 *
 * Idempotent: a second run for the same period creates nothing and never
 * touches a close already in flight.
 *
 * The project-level `deadline` is WD8 of the following month — the same day
 * the checklist runs to, so it no longer reads as overdue while the cycle's
 * last milestones are still legitimately open. Consolidation shares that WD8
 * rather than trailing the entities by a day.
 */
export async function ensureMonthlyClose(
  repository: Repository,
  now: Date,
): Promise<Project[]> {
  const period = targetPeriod(now);
  const existing = await repository.listProjects('work');
  const missing = missingSeries(existing, period);
  if (missing.length === 0) return [];

  const fallbacks = new Map<CloseSeries, Omit<Project, 'id'>>();
  for (const input of buildMonthlyCloseInputs(period)) {
    const series = input.title.split(SERIES_SEPARATOR).pop()?.trim();
    if (series && isCloseSeries(series)) fallbacks.set(series, input);
  }

  const created: Project[] = [];
  for (const series of missing) {
    const source = latestPriorClose(existing, period, series);
    const input = source
      ? rollForwardProject(source, period, series)
      : fallbacks.get(series);
    if (input) created.push(await repository.createProject(input));
  }
  return created;
}
