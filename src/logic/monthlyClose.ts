import { format } from 'date-fns';
import type { Repository } from '../data/repository';
import type { Milestone, Project } from '../data/types';

// The recurring monthly-close cycle: five entity closes plus consolidation.
export const CLOSE_ENTITIES = ['BMG', 'OKI', 'KGR', 'NMG', 'KBF'] as const;

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

/**
 * The close period a given date belongs to, as YYYY-MM. Cycles generate on
 * the 22nd for THAT month's close, so before the 22nd the pending period is
 * still the previous month (its milestones run to the 8th of this month).
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

/** Day D in the month AFTER the period ("deadlines anchored to the 8th"). */
function nextMonthDay(period: string, day: number): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7)); // 1-based
  return format(new Date(year, month, day), 'yyyy-MM-dd');
}

function milestone(text: string, dueDate: string): Milestone {
  return {
    id: crypto.randomUUID(),
    text,
    done: false,
    status: 'not-started',
    dueDate,
  };
}

/**
 * The six project inputs for one close period, milestones ordered by
 * deadline. Consolidation ends with "Approve TB" then "Build monthly review
 * deck" — deadline-ordered, not locked.
 */
export function buildMonthlyCloseInputs(period: string): Array<Omit<Project, 'id'>> {
  const label = periodLabel(period);
  const entityProjects = CLOSE_ENTITIES.map<Omit<Project, 'id'>>((entity, index) => ({
    domain: 'work',
    title: `${label} — ${entity}`,
    type: 'other',
    status: 'active',
    deadline: nextMonthDay(period, 8),
    milestones: [
      milestone('Close the books', nextMonthDay(period, 5)),
      milestone('TB final & reconciled', nextMonthDay(period, 8)),
    ],
    order: 100 + index,
    recurring: 'monthly',
    period,
  }));

  const consolidation: Omit<Project, 'id'> = {
    domain: 'work',
    title: `${label} — Consolidation`,
    type: 'other',
    status: 'active',
    deadline: nextMonthDay(period, 9),
    milestones: [
      milestone('Collect entity TBs', nextMonthDay(period, 6)),
      milestone('Eliminations & consolidated TB', nextMonthDay(period, 7)),
      milestone('Approve TB', nextMonthDay(period, 8)),
      milestone('Build monthly review deck', nextMonthDay(period, 9)),
    ],
    order: 100 + CLOSE_ENTITIES.length,
    recurring: 'monthly',
    period,
  };

  return [...entityProjects, consolidation];
}

/** True when no recurring project exists yet for the period. */
export function needsGeneration(existing: Project[], period: string): boolean {
  return !existing.some(
    (project) => project.recurring === 'monthly' && project.period === period,
  );
}

/**
 * Generates the current period's close cycle if it does not exist yet.
 * Idempotent: a period is generated at most once (guarded by needsGeneration);
 * items from older periods are left untouched so unfinished work stays
 * visible as overdue. Returns the created projects (empty when up to date).
 */
export async function ensureMonthlyClose(
  repository: Repository,
  now: Date,
): Promise<Project[]> {
  const period = targetPeriod(now);
  const existing = await repository.listProjects('work');
  if (!needsGeneration(existing, period)) return [];
  const created: Project[] = [];
  for (const input of buildMonthlyCloseInputs(period)) {
    created.push(await repository.createProject(input));
  }
  return created;
}
