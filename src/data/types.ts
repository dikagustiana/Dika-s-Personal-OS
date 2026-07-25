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

/**
 * How much a date can be trusted.
 *
 * Most 2027 scholarship dates are placeholders, and rendering an exact
 * countdown against an invented deadline invites confident action on a date
 * nobody published. `confirmed` dates count down and can turn overdue-red;
 * `estimated` dates render with a `~`; `unknown` renders "TBC" and never
 * counts down at all.
 *
 * An absent value means `confirmed`, so real WORK deadlines (monthly-close
 * cycles) keep behaving exactly as they always have — only dates explicitly
 * marked otherwise soften.
 */
export type DateConfidence = 'confirmed' | 'estimated' | 'unknown';

// Escalation targets. 'pak-jo-bu-lenny' = board level (both names shown
// together). 'other' = other departments — the milestone `note` carries the
// specific department name; there is deliberately no separate field for it.
export type EscalateTo =
  | 'none'
  | 'pak-jo-bu-lenny'
  | 'mbak-muti'
  | 'pak-teddy'
  | 'other';

/**
 * A reference link, on a project or on a single milestone.
 *
 * A link, never a file. The app stores no binaries and uploads nothing: the
 * "upload document" affordance takes a label and a URL (typically a Drive
 * link) and appends one of these. `addedAt` is an ISO timestamp.
 */
export interface ProjectDocument {
  label: string;
  url: string;
  addedAt: string;
}

/**
 * A soft pointer from one project to another.
 *
 * Informational only, by an explicit decision: nothing reads this to decide
 * whether a milestone or project may be marked done, and nothing ever should.
 * Personal OS is not a project-management tool — a link is a note plus a way
 * to get there, not a dependency.
 */
export interface LinkedProject {
  projectId: string;
  note?: string;
}

export interface Milestone {
  id: string;
  text: string;
  done: boolean; // kept for backward compatibility; always === (status === 'done')
  /**
   * Legacy single date. Superseded by `endDate`, but never rewritten in
   * place: milestones that only ever had a dueDate keep it and still render
   * and count down correctly. Read through `milestoneEnd()`, never directly.
   */
  dueDate?: string;
  dateConfidence?: DateConfidence; // absent means 'confirmed'
  status: MilestoneStatus;
  note?: string; // what's left / the blocker / which "other" department
  escalateTo?: EscalateTo; // flag independent of status; absent means 'none'
  /** Free text, per milestone — deliberately not an enum, not a project field. */
  pic?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD — the tracked finish date; replaces dueDate
  documents?: ProjectDocument[]; // milestone-level links, separate from the project's
  // "Days left" is never stored anywhere. It is computed from endDate at
  // render time, the same way the daily score and the IELTS band are.
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
  dateConfidence?: DateConfidence; // covers startDate + deadline; absent = 'confirmed'
  targetMetric?: string;
  milestones: Milestone[]; // escalateTo is only meaningful on WORK projects
  order: number;
  recurring?: 'monthly'; // monthly-close cycles (WORK); absent = one-off project
  period?: string; // YYYY-MM period a recurring project belongs to
  workingTitle?: string; // current piece being worked on (Research, Website)
  category?: WebsiteCategory; // Website only — which DDS site section
  /** Parent project id. One level is enough at this app's scale; never self. */
  parentId?: string;
  /** Soft, non-blocking pointers to related projects. Absent means none. */
  linkedProjects?: LinkedProject[];
  /** Free text (an entity, a client, a theme) — grouping/filtering only. */
  entityTag?: string;
  /** Project-level reference links, distinct from a milestone's own. */
  documents?: ProjectDocument[];
  /**
   * Shown in the WORK dashboard's project card. An explicit choice, not a
   * ranking — see migration 20260724000014. Close-cycle projects are never
   * pinnable; Section 2 of the dashboard owns those.
   */
  dashboardPinned?: boolean;
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
