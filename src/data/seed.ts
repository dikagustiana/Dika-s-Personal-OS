import {
  addDays,
  format,
  getMonth,
  getYear,
  setHours,
  setMinutes,
  subDays,
} from 'date-fns';
import { getIsoWeekKey, getPreviousWeekKey } from '../logic/week';
import type { DailyLog, Entry, Project, WeeklyPlan } from './types';

const today = new Date();
const todayKey = format(today, 'yyyy-MM-dd');
const nowIso = today.toISOString();

export const PROJECT_IDS = {
  scholarship: '10000000-0000-4000-8000-000000000001',
  ielts: '10000000-0000-4000-8000-000000000002',
  research: '10000000-0000-4000-8000-000000000003',
  website: '10000000-0000-4000-8000-000000000004',
} as const;

export const HABIT_IDS = {
  ielts: '20000000-0000-4000-8000-000000000001',
  exercise: '20000000-0000-4000-8000-000000000002',
  reading: '20000000-0000-4000-8000-000000000003',
  writing: '20000000-0000-4000-8000-000000000004',
  reflection: '20000000-0000-4000-8000-000000000005',
} as const;

const currentWeek = getIsoWeekKey(today);
const lastWeek = getPreviousWeekKey(currentWeek);
const scholarshipYear = getMonth(today) > 10 ? getYear(today) + 1 : getYear(today);

function isoAt(hour: number, minute: number): string {
  return setMinutes(setHours(today, hour), minute).toISOString();
}

export const seedProjects: Project[] = [
  {
    id: PROJECT_IDS.scholarship,
    title: 'Chevening / LPDP',
    type: 'scholarship',
    status: 'active',
    deadline: `${scholarshipYear}-11-01`,
    targetMetric: 'Submit a distinctive, evidence-led application',
    order: 1,
    milestones: [
      { id: '11000000-0000-4000-8000-000000000001', text: 'Leadership essay', done: true },
      { id: '11000000-0000-4000-8000-000000000002', text: 'Networking essay', done: false },
      { id: '11000000-0000-4000-8000-000000000003', text: 'Study in the UK essay', done: false },
      { id: '11000000-0000-4000-8000-000000000004', text: 'Career plan essay', done: false },
      { id: '11000000-0000-4000-8000-000000000005', text: 'Choose UK course 1', done: true },
      { id: '11000000-0000-4000-8000-000000000006', text: 'Choose UK course 2', done: false },
      { id: '11000000-0000-4000-8000-000000000007', text: 'Choose UK course 3', done: false },
    ],
  },
  {
    id: PROJECT_IDS.ielts,
    title: 'IELTS',
    type: 'study',
    status: 'active',
    deadline: format(addDays(today, 84), 'yyyy-MM-dd'),
    targetMetric: 'IELTS Overall 7.0',
    order: 2,
    milestones: [
      { id: '12000000-0000-4000-8000-000000000001', text: 'Complete diagnostic test', done: true },
      { id: '12000000-0000-4000-8000-000000000002', text: 'Reach Writing band 6.5', done: false },
      { id: '12000000-0000-4000-8000-000000000003', text: 'Book official test', done: false },
    ],
  },
  {
    id: PROJECT_IDS.research,
    title: 'Research',
    type: 'research',
    status: 'active',
    targetMetric: 'Complete a defensible working paper',
    order: 3,
    milestones: [
      { id: '13000000-0000-4000-8000-000000000001', text: 'Lock research question', done: true },
      { id: '13000000-0000-4000-8000-000000000002', text: 'Literature map', done: false },
      { id: '13000000-0000-4000-8000-000000000003', text: 'Methods outline', done: false },
    ],
  },
  {
    id: PROJECT_IDS.website,
    title: 'Website (writing)',
    type: 'build',
    status: 'active',
    targetMetric: 'Publish consistently in my own voice',
    order: 4,
    milestones: [
      { id: '14000000-0000-4000-8000-000000000001', text: 'Define three writing pillars', done: true },
      { id: '14000000-0000-4000-8000-000000000002', text: 'Draft cornerstone essay', done: false },
      { id: '14000000-0000-4000-8000-000000000003', text: 'Manual publish checklist', done: false },
    ],
  },
];

export const seedWeeklyPlans: WeeklyPlan[] = [
  {
    week: currentWeek,
    theme: 'Protect the important work',
    goals: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        text: 'Finish the scholarship leadership essay',
        done: false,
        projectId: PROJECT_IDS.scholarship,
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        text: 'Complete two IELTS writing practices',
        done: false,
        projectId: PROJECT_IDS.ielts,
      },
      {
        id: '30000000-0000-4000-8000-000000000003',
        text: 'Map the research literature',
        done: false,
        projectId: PROJECT_IDS.research,
      },
    ],
  },
  {
    week: lastWeek,
    theme: 'Build momentum without noise',
    reviewedAt: subDays(today, 5).toISOString(),
    goals: [
      {
        id: '31000000-0000-4000-8000-000000000001',
        text: 'Complete IELTS diagnostic',
        done: true,
        projectId: PROJECT_IDS.ielts,
      },
      {
        id: '31000000-0000-4000-8000-000000000002',
        text: 'Choose first UK course',
        done: true,
        projectId: PROJECT_IDS.scholarship,
      },
      {
        id: '31000000-0000-4000-8000-000000000003',
        text: 'Draft the research question',
        done: false,
        projectId: PROJECT_IDS.research,
      },
    ],
  },
];

export const seedEntries: Entry[] = [
  {
    id: HABIT_IDS.ielts,
    type: 'habit',
    title: 'Study IELTS 1h',
    active: true,
    order: 1,
    tags: ['study'],
    createdAt: subDays(today, 40).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: HABIT_IDS.exercise,
    type: 'habit',
    title: 'Move for 30 min',
    active: true,
    order: 2,
    tags: ['health'],
    createdAt: subDays(today, 38).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: HABIT_IDS.reading,
    type: 'habit',
    title: 'Read 20 pages',
    active: true,
    order: 3,
    tags: ['learning'],
    createdAt: subDays(today, 34).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: HABIT_IDS.writing,
    type: 'habit',
    title: 'Write 300 words',
    active: true,
    order: 4,
    tags: ['craft'],
    createdAt: subDays(today, 28).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: HABIT_IDS.reflection,
    type: 'habit',
    title: 'Evening reflection',
    active: true,
    order: 5,
    tags: ['mindset'],
    createdAt: subDays(today, 20).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: '40000000-0000-4000-8000-000000000001',
    type: 'task',
    title: 'Tighten scholarship essay opening',
    priority: 'urgent',
    done: false,
    dueDate: todayKey,
    weeklyGoalId: seedWeeklyPlans[0].goals[0].id,
    projectId: PROJECT_IDS.scholarship,
    tags: ['deep-work'],
    createdAt: subDays(today, 2).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    type: 'task',
    title: 'IELTS Task 2 timed response',
    priority: 'urgent',
    done: false,
    dueDate: todayKey,
    weeklyGoalId: seedWeeklyPlans[0].goals[1].id,
    projectId: PROJECT_IDS.ielts,
    tags: ['study'],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: '40000000-0000-4000-8000-000000000003',
    type: 'task',
    title: 'Review literature matrix',
    priority: 'urgent',
    done: true,
    completedAt: isoAt(8, 20),
    dueDate: todayKey,
    weeklyGoalId: seedWeeklyPlans[0].goals[2].id,
    projectId: PROJECT_IDS.research,
    tags: ['research'],
    createdAt: subDays(today, 3).toISOString(),
    updatedAt: isoAt(8, 20),
  },
  {
    id: '40000000-0000-4000-8000-000000000004',
    type: 'task',
    title: 'Outline website essay',
    priority: 'normal',
    done: false,
    projectId: PROJECT_IDS.website,
    tags: ['writing'],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: '50000000-0000-4000-8000-000000000001',
    type: 'braindump',
    text: 'The essay needs one concrete leadership failure, not another success story.',
    tags: [],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: subDays(today, 1).toISOString(),
  },
  {
    id: '50000000-0000-4000-8000-000000000002',
    type: 'braindump',
    text: 'Ask a former awardee to pressure-test the course choices.',
    tags: [],
    createdAt: subDays(today, 2).toISOString(),
    updatedAt: subDays(today, 2).toISOString(),
  },
  {
    id: '60000000-0000-4000-8000-000000000001',
    type: 'timeblock',
    date: todayKey,
    start: '07:30',
    end: '08:00',
    label: 'Research review',
    taskId: '40000000-0000-4000-8000-000000000003',
    status: 'done',
    tags: ['research'],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: isoAt(8, 20),
  },
  {
    id: '60000000-0000-4000-8000-000000000002',
    type: 'timeblock',
    date: todayKey,
    start: '09:00',
    end: '09:30',
    label: 'Scholarship essay',
    taskId: '40000000-0000-4000-8000-000000000001',
    status: 'planned',
    tags: ['deep-work'],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: '60000000-0000-4000-8000-000000000003',
    type: 'timeblock',
    date: todayKey,
    start: '14:00',
    end: '14:30',
    label: 'Walk + reset',
    status: 'planned',
    tags: ['health'],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: '60000000-0000-4000-8000-000000000004',
    type: 'timeblock',
    date: todayKey,
    start: '19:30',
    end: '20:00',
    label: 'IELTS writing',
    taskId: '40000000-0000-4000-8000-000000000002',
    status: 'planned',
    tags: ['study'],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: nowIso,
  },
];

export const seedDailyLogs: DailyLog[] = Array.from({ length: 24 }, (_, index) => {
  const date = subDays(today, 24 - index);
  const cycle = index % 6;
  const habits: Record<string, boolean> = {
    [HABIT_IDS.ielts]: cycle !== 0,
    [HABIT_IDS.exercise]: cycle > 1,
    [HABIT_IDS.reading]: cycle !== 2,
    [HABIT_IDS.writing]: cycle === 1 || cycle >= 4,
    [HABIT_IDS.reflection]: cycle >= 3,
  };
  const completed = Object.values(habits).filter(Boolean).length;
  return {
    date: format(date, 'yyyy-MM-dd'),
    habits,
    score: Math.min(96, 38 + completed * 11 + (index % 9)),
  };
});
