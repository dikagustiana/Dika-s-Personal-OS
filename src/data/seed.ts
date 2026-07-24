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
import type { DailyLog, Entry, IeltsResult, Project, WeeklyPlan } from './types';

const today = new Date();
const todayKey = format(today, 'yyyy-MM-dd');
const nowIso = today.toISOString();

export const PROJECT_IDS = {
  scholarship: '10000000-0000-4000-8000-000000000001', // Chevening
  ielts: '10000000-0000-4000-8000-000000000002',
  research: '10000000-0000-4000-8000-000000000003',
  website: '10000000-0000-4000-8000-000000000004',
  uni: '10000000-0000-4000-8000-000000000006',
  lpdp: '10000000-0000-4000-8000-000000000007',
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

export const WORK_HABIT_ID = '20000000-0000-4000-8000-000000000006';
export const WORK_PROJECT_ID = '10000000-0000-4000-8000-000000000005';

export const seedProjects: Project[] = [
  {
    id: WORK_PROJECT_ID,
    domain: 'work',
    title: 'SAMB — Finance Ops',
    type: 'other',
    status: 'active',
    targetMetric: 'Close the month with zero open items',
    order: 1,
    milestones: [
      {
        id: '15000000-0000-4000-8000-000000000001',
        text: 'Rebuild the WORK project list here',
        done: false,
        status: 'not-started',
      },
    ],
  },
  {
    id: PROJECT_IDS.scholarship,
    domain: 'growth',
    title: 'Chevening',
    type: 'scholarship',
    status: 'active',
    startDate: format(subDays(today, 45), 'yyyy-MM-dd'),
    deadline: `${scholarshipYear}-11-01`,
    targetMetric: 'Submit a distinctive, evidence-led application',
    order: 1,
    milestones: [
      { id: '11000000-0000-4000-8000-000000000001', text: 'Leadership essay', done: true, status: 'done' },
      { id: '11000000-0000-4000-8000-000000000002', text: 'Networking essay', done: false, status: 'not-started' },
      { id: '11000000-0000-4000-8000-000000000003', text: 'Study in the UK essay', done: false, status: 'not-started' },
      { id: '11000000-0000-4000-8000-000000000004', text: 'Career plan essay', done: false, status: 'not-started' },
      { id: '11000000-0000-4000-8000-000000000005', text: 'Choose UK course 1', done: true, status: 'done' },
      { id: '11000000-0000-4000-8000-000000000006', text: 'Choose UK course 2', done: false, status: 'not-started' },
      { id: '11000000-0000-4000-8000-000000000007', text: 'Choose UK course 3', done: false, status: 'not-started' },
    ],
  },
  {
    id: PROJECT_IDS.lpdp,
    domain: 'growth',
    title: 'LPDP',
    type: 'scholarship',
    status: 'active',
    startDate: format(subDays(today, 20), 'yyyy-MM-dd'),
    deadline: format(addDays(today, 150), 'yyyy-MM-dd'),
    targetMetric: 'Submit a complete LPDP application',
    order: 6,
    milestones: [
      { id: '16000000-0000-4000-8000-000000000001', text: 'Study the current LPDP requirements', done: false, status: 'not-started' },
      { id: '16000000-0000-4000-8000-000000000002', text: 'Draft the study plan essay', done: false, status: 'not-started' },
    ],
  },
  {
    id: PROJECT_IDS.uni,
    domain: 'growth',
    title: 'Uni Applications',
    type: 'study',
    status: 'active',
    startDate: format(subDays(today, 10), 'yyyy-MM-dd'),
    deadline: format(addDays(today, 120), 'yyyy-MM-dd'),
    targetMetric: 'Three complete applications submitted',
    order: 7,
    milestones: [
      { id: '17000000-0000-4000-8000-000000000001', text: 'Shortlist target programmes', done: false, status: 'not-started' },
      { id: '17000000-0000-4000-8000-000000000002', text: 'Request reference letters', done: false, status: 'not-started' },
    ],
  },
  {
    id: PROJECT_IDS.ielts,
    domain: 'growth',
    title: 'IELTS',
    type: 'study',
    status: 'active',
    startDate: format(subDays(today, 30), 'yyyy-MM-dd'),
    deadline: format(addDays(today, 84), 'yyyy-MM-dd'),
    targetMetric: 'IELTS Overall 7.0',
    order: 2,
    milestones: [
      { id: '12000000-0000-4000-8000-000000000001', text: 'Complete diagnostic test', done: true, status: 'done' },
      { id: '12000000-0000-4000-8000-000000000002', text: 'Reach Writing band 6.5', done: false, status: 'not-started' },
      { id: '12000000-0000-4000-8000-000000000003', text: 'Book official test', done: false, status: 'not-started' },
    ],
  },
  {
    id: PROJECT_IDS.research,
    domain: 'growth',
    title: 'Research',
    type: 'research',
    status: 'active',
    targetMetric: 'Complete a defensible working paper',
    order: 3,
    milestones: [
      { id: '13000000-0000-4000-8000-000000000001', text: 'Lock research question', done: true, status: 'done' },
      { id: '13000000-0000-4000-8000-000000000002', text: 'Literature map', done: false, status: 'not-started' },
      { id: '13000000-0000-4000-8000-000000000003', text: 'Methods outline', done: false, status: 'not-started' },
    ],
  },
  {
    id: PROJECT_IDS.website,
    domain: 'growth',
    title: 'Website (writing)',
    type: 'build',
    status: 'active',
    targetMetric: 'Publish consistently in my own voice',
    order: 4,
    milestones: [
      { id: '14000000-0000-4000-8000-000000000001', text: 'Define three writing pillars', done: true, status: 'done' },
      { id: '14000000-0000-4000-8000-000000000002', text: 'Draft cornerstone essay', done: false, status: 'not-started' },
      { id: '14000000-0000-4000-8000-000000000003', text: 'Manual publish checklist', done: false, status: 'not-started' },
    ],
  },
];

export const seedWeeklyPlans: WeeklyPlan[] = [
  {
    week: currentWeek,
    domain: 'growth',
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
    domain: 'growth',
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
    id: WORK_HABIT_ID,
    type: 'habit',
    domain: 'work',
    title: 'Zero documents require approval by 15:00',
    active: true,
    order: 1,
    tags: ['work'],
    createdAt: subDays(today, 10).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: HABIT_IDS.ielts,
    type: 'habit',
    domain: 'growth',
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
    domain: 'growth',
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
    domain: 'growth',
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
    domain: 'growth',
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
    domain: 'growth',
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
    domain: 'growth',
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
    domain: 'growth',
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
    domain: 'growth',
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
    domain: 'growth',
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
    domain: 'growth',
    text: 'The essay needs one concrete leadership failure, not another success story.',
    tags: [],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: subDays(today, 1).toISOString(),
  },
  {
    id: '50000000-0000-4000-8000-000000000002',
    type: 'braindump',
    domain: 'growth',
    text: 'Ask a former awardee to pressure-test the course choices.',
    tags: [],
    createdAt: subDays(today, 2).toISOString(),
    updatedAt: subDays(today, 2).toISOString(),
  },
  {
    id: '60000000-0000-4000-8000-000000000001',
    type: 'timeblock',
    domain: 'growth',
    date: todayKey,
    start: '19:00',
    end: '19:30',
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
    domain: 'growth',
    date: todayKey,
    start: '20:00',
    end: '20:30',
    label: 'Scholarship essay',
    taskId: '40000000-0000-4000-8000-000000000001',
    status: 'planned',
    category: 'deep-work',
    tags: ['deep-work'],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: '60000000-0000-4000-8000-000000000003',
    type: 'timeblock',
    domain: 'growth',
    date: todayKey,
    start: '21:00',
    end: '21:30',
    label: 'Walk + reset',
    status: 'planned',
    category: 'break',
    tags: ['health'],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: nowIso,
  },
  {
    id: '60000000-0000-4000-8000-000000000004',
    type: 'timeblock',
    domain: 'growth',
    date: todayKey,
    start: '22:00',
    end: '22:30',
    label: 'IELTS writing',
    taskId: '40000000-0000-4000-8000-000000000002',
    status: 'planned',
    tags: ['study'],
    createdAt: subDays(today, 1).toISOString(),
    updatedAt: nowIso,
  },
];

export const seedIeltsResults: IeltsResult[] = [
  {
    id: '70000000-0000-4000-8000-000000000001',
    date: format(subDays(today, 21), 'yyyy-MM-dd'),
    listening: 6.5,
    reading: 6.0,
    writing: 5.5,
    speaking: 6.0,
  },
  {
    id: '70000000-0000-4000-8000-000000000002',
    date: format(subDays(today, 10), 'yyyy-MM-dd'),
    listening: 7.0,
    reading: 6.5,
    writing: 6.0,
    speaking: 6.0,
  },
  {
    id: '70000000-0000-4000-8000-000000000003',
    date: format(subDays(today, 3), 'yyyy-MM-dd'),
    listening: 7.0,
    reading: 7.0,
    writing: 6.0,
    speaking: 6.5,
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
    domain: 'growth' as const,
    habits,
    score: Math.min(96, 38 + completed * 11 + (index % 9)),
  };
});
