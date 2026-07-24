export type EntryType = 'task' | 'habit' | 'braindump' | 'timeblock';

export interface BaseEntry {
  id: string;
  type: EntryType;
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

export interface TimeBlockEntry extends BaseEntry {
  type: 'timeblock';
  date: string;
  start: string;
  end: string;
  label: string;
  taskId?: string;
  status: 'planned' | 'done' | 'skipped';
}

export type Entry = TaskEntry | HabitEntry | BrainDumpEntry | TimeBlockEntry;

export interface DailyLog {
  date: string;
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

export interface Project {
  id: string;
  title: string;
  type: 'scholarship' | 'study' | 'research' | 'build' | 'other';
  status: 'active' | 'paused' | 'done';
  deadline?: string;
  targetMetric?: string;
  milestones: Milestone[];
  order: number;
}
