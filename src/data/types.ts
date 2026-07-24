export type EntryType = 'task' | 'habit' | 'braindump' | 'timeblock';

// The two fully separate worlds: WORK = the day job (SAMB, finance), GROWTH =
// self-development (university, scholarship, research, website). Every
// user-owned record carries one, and every query filters by the active one —
// data never crosses between them.
export type Domain = 'work' | 'growth';

export interface BaseEntry {
  id: string;
  type: EntryType;
  domain: Domain;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface TaskEntry extends BaseEntry {
  type: 'task';
  title: string;
  priority: 'urgent' | 'normal';
  done: boolean;
  completedAt?: string;
  dueDate?: string;
  weeklyGoalId?: string;
  projectId?: string;
}

export interface HabitEntry extends BaseEntry {
  type: 'habit';
  title: string;
  active: boolean;
  order: number;
}

export interface BrainDumpEntry extends BaseEntry {
  type: 'braindump';
  text: string;
}

export type TimeBlockCategory = 'deep-work' | 'meeting' | 'break' | 'admin';

export interface TimeBlockEntry extends BaseEntry {
  type: 'timeblock';
  date: string;
  start: string;
  end: string;
  label: string;
  taskId?: string;
  status: 'planned' | 'done' | 'skipped';
  category?: TimeBlockCategory; // duration is derived from start–end, never stored
}

export type Entry = TaskEntry | HabitEntry | BrainDumpEntry | TimeBlockEntry;

export interface DailyLog {
  date: string;
  domain: Domain; // part of the key — two independent daily scores per day
  habits: Record<string, boolean>;
  score: number;
}

export interface WeeklyGoal {
  id: string;
  text: string;
  done: boolean;
  projectId?: string;
}

export interface WeeklyPlan {
  week: string;
  domain: Domain; // part of the key — each workspace plans its own week
  theme?: string;
  goals: WeeklyGoal[];
  reviewedAt?: string;
}

export type MilestoneStatus = 'not-started' | 'in-progress' | 'blocked' | 'done';

// Escalation targets. 'pak-jo-bu-lenny' = board level (both names shown
// together). 'other' = other departments — the milestone `note` carries the
// specific department name; there is deliberately no separate field for it.
export type EscalateTo =
  | 'none'
  | 'pak-jo-bu-lenny'
  | 'mbak-muti'
  | 'pak-teddy'
  | 'other';

export interface Milestone {
  id: string;
  text: string;
  done: boolean; // kept for backward compatibility; always === (status === 'done')
  dueDate?: string;
  status: MilestoneStatus;
  note?: string; // what's left / the blocker / which "other" department
  escalateTo?: EscalateTo; // flag independent of status; absent means 'none'
}

// The DDS site sections a Website piece belongs to (Website projects only).
export type WebsiteCategory =
  | 'finance'
  | 'accounting'
  | 'green-transition'
  | 'development-finance'
  | 'critical-thinking'
  | 'next-big-thing'
  | 'books';

export interface Project {
  id: string;
  domain: Domain;
  title: string;
  type: 'scholarship' | 'study' | 'research' | 'build' | 'other';
  status: 'active' | 'paused' | 'done';
  startDate?: string; // YYYY-MM-DD — Gantt bar start (project-level)
  deadline?: string;
  targetMetric?: string;
  milestones: Milestone[]; // escalateTo is only meaningful on WORK projects
  order: number;
  recurring?: 'monthly'; // monthly-close cycles (WORK); absent = one-off project
  period?: string; // YYYY-MM period a recurring project belongs to
  workingTitle?: string; // current piece being worked on (Research, Website)
  category?: WebsiteCategory; // Website only — which DDS site section
}

// A single IELTS practice result. The overall band is always DERIVED from the
// four skills (mean rounded to the nearest 0.5) and never stored.
export interface IeltsResult {
  id: string;
  date: string; // YYYY-MM-DD
  listening: number; // 0–9 in 0.5 steps
  reading: number;
  writing: number;
  speaking: number;
}
