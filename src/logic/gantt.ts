import { addDays, differenceInCalendarDays, parseISO } from 'date-fns';
import type { Project } from '../data/types';
import { urgencyForConfident, type Urgency } from './deadlines';

export interface GanttRow {
  project: Project;
  /** 0–100, offset of the bar's left edge within the window. */
  startPct: number;
  /** 0–100, bar width within the window. */
  widthPct: number;
  urgency: Urgency;
  hasDates: boolean;
}

export interface GanttChart {
  windowStart: Date;
  windowEnd: Date;
  todayPct: number;
  rows: GanttRow[];
}

const FALLBACK_LEAD_DAYS = 30; // bar lead-in when startDate is missing

/**
 * Lays out one bar per initiative from startDate to deadline across a shared
 * window, with a today marker. Projects without a deadline get hasDates:false
 * (rendered as a placeholder row). dueSoonDays follows the GROWTH threshold.
 */
export function buildGanttChart(
  projects: Project[],
  today: Date,
  dueSoonDays = 14,
): GanttChart {
  const dated = projects.filter((project) => project.deadline);
  const spans = dated.map((project) => {
    const end = parseISO(project.deadline as string);
    const start = project.startDate
      ? parseISO(project.startDate)
      : addDays(end, -FALLBACK_LEAD_DAYS);
    return { project, start: start < end ? start : addDays(end, -1), end };
  });

  const allDates = [today, ...spans.flatMap((span) => [span.start, span.end])];
  const min = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const max = new Date(Math.max(...allDates.map((d) => d.getTime())));
  // Pad the window so bars never touch the edges.
  const windowStart = addDays(min, -7);
  const windowEnd = addDays(max, 14);
  const total = Math.max(1, differenceInCalendarDays(windowEnd, windowStart));

  const pct = (date: Date) =>
    Math.min(100, Math.max(0, (100 * differenceInCalendarDays(date, windowStart)) / total));

  const rows: GanttRow[] = projects.map((project) => {
    const span = spans.find((item) => item.project.id === project.id);
    if (!span) {
      return { project, startPct: 0, widthPct: 0, urgency: 'on-track', hasDates: false };
    }
    const startPct = pct(span.start);
    return {
      project,
      startPct,
      widthPct: Math.max(1, pct(span.end) - startPct),
      urgency: urgencyForConfident(
        project.deadline as string,
        today,
        dueSoonDays,
        project.dateConfidence,
      ),
      hasDates: true,
    };
  });

  return { windowStart, windowEnd, todayPct: pct(today), rows };
}
