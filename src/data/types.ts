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
  /**
   * 'parked' exists for research: a parked project keeps its gates, register
   * and decision log intact, which is the expensive thing to lose when coming
   * back to work abandoned for months. See migration 20260724000016.
   */
  status: 'active' | 'paused' | 'parked' | 'done';
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
  /** Research portfolio ordering (1 = highest). Absent on other projects. */
  priority?: number;
  /** Research parent only: max concurrently active children. Absent = default. */
  wipLimit?: number;
  /** Research parent only: months before a verified item goes stale. */
  staleMonths?: number;
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

// ---------------------------------------------------------------------------
// Research pipeline
//
// A research project is an ordinary Project parented to the Research project,
// so it inherits nesting, the Gantt, countdowns, pinning and documents. These
// types carry only what a Project cannot: the gate matrix, the evidence
// register, the claims ledger, the review-cycle history and the decision log.
// ---------------------------------------------------------------------------

/** What a register item is, which decides whether it counts toward citations. */
export type ResearchItemType =
  | 'parameter'
  | 'dataset'
  | 'dokumen'
  | 'paper'
  | 'wawancara'
  | 'baseline';

/** IND = indeterminate, V = verified, NA = established as unavailable. */
export type ResearchItemStatus = 'IND' | 'V' | 'NA';

/** (a) baseline in use · (b) verified with source · (c) hypothesis/inference. */
export type ClaimLayer = 'a' | 'b' | 'c';

export type CycleVerdict = 'clean' | 'rework';

export interface ResearchMeta {
  projectId: string;
  template: string;
  question: string;
  output: string;
  audience: string;
  /**
   * Outer index = stage, inner = criterion, both positional against the
   * template. Never store criterion text alongside it — the text lives in the
   * template so an edit propagates, and copying it here would freeze it.
   */
  gates: boolean[][];
}

export interface ResearchItem {
  id: string;
  projectId: string;
  name: string;
  unit: string;
  type: ResearchItemType;
  /** Critical items block stage 00's gate while still IND. */
  crit: boolean;
  status: ResearchItemStatus;
  value: string;
  source: string;
  /** Free-form reference period ("2024", "Q3 2025") — deliberately not a date. */
  asof: string;
  note: string;
  order: number;
}

export interface ResearchClaim {
  id: string;
  projectId: string;
  text: string;
  layer: ClaimLayer;
  /** The evidence attached to the claim; empty is itself a citation finding. */
  ev: string;
  order: number;
}

/**
 * One recorded review cycle. APPEND-ONLY — there is deliberately no update or
 * delete in the repository. itemCount and citeCount are snapshots taken when
 * the cycle ran, which is how loopDue detects work added since; they cannot be
 * recomputed after the fact.
 */
export interface ResearchCycle {
  id: string;
  projectId: string;
  loop: string;
  n: number;
  date: string; // YYYY-MM-DD
  verdict: CycleVerdict;
  findings: string;
  itemCount: number;
  citeCount: number;
  invalidated: number;
  backLabel: string;
}

/** APPEND-ONLY, same reasoning as ResearchCycle. */
export interface ResearchLogEntry {
  id: string;
  projectId: string;
  date: string; // YYYY-MM-DD
  text: string;
}

/** A verified fact promoted for reuse across projects. Not project-scoped. */
export interface FactLibraryEntry {
  id: string;
  name: string;
  unit: string;
  value: string;
  source: string;
  asof: string;
  /** Name, not an id: provenance must survive deleting the source project. */
  fromProject: string;
}

/** Everything the pipeline logic needs about one research project at once. */
export interface ResearchProject {
  project: Project;
  meta: ResearchMeta;
  items: ResearchItem[];
  claims: ResearchClaim[];
  cycles: ResearchCycle[];
  log: ResearchLogEntry[];
}

/** Portfolio settings, read from the Research parent row. */
export interface ResearchSettings {
  wipLimit: number;
  staleMonths: number;
}

export const RESEARCH_DEFAULTS: ResearchSettings = { wipLimit: 2, staleMonths: 12 };

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

/**
 * Writing splits into Task 1 and Task 2 — they fail in completely different
 * ways even though IELTS bands them together. Declared here rather than in the
 * taxonomy so the data layer owns its own row shape and the logic layer imports
 * downward, as it already does for IeltsResult.
 */
export type IeltsErrorSkill =
  | 'listening'
  | 'reading'
  | 'writing_task1'
  | 'writing_task2'
  | 'speaking';

/**
 * ONE LOGGED OCCURRENCE of a marked error. Patterns are never stored: every
 * class in logic/ielts/classify.ts is derived on read from these rows, the same
 * way overallBand and days-left are derived everywhere else in this app. A
 * stored classification goes stale the moment the next session is logged, and a
 * stale classification is worse than none because it will be trusted.
 */
export interface IeltsError {
  id: string;
  date: string; // YYYY-MM-DD — the session date, also the session identity
  skill: IeltsErrorSkill;
  /** Layer 1. Free text at the boundary; validated against the taxonomy. */
  criterion: string;
  /**
   * Layer 2, or the literal 'UNCLASSIFIED'. Not a database enum, deliberately:
   * UNCLASSIFIED has to be able to reach the table or the taxonomy stops
   * improving.
   */
  failureMode: string;
  /** Verbatim, never paraphrased. `[absent: …]` where nothing is quotable. */
  quote: string;
  note?: string;
  /** Only meaningful for listening and reading. */
  questionType?: string;
  /**
   * The date of the piece this session rewrites. Nullable, and the field that
   * makes classification possible: the same mode in two different essays has
   * not generalised, while the same mode in one essay and its own rewrite means
   * direct feedback was not applied. Different problems, different fixes.
   */
  revisionOf?: string;
  /**
   * Nullable ON PURPOSE. A standalone Tuesday reading session logs its errors
   * with no accompanying score row — os_ielts_results stays full-mock-only.
   */
  resultId?: string;
  createdAt: string;
}
