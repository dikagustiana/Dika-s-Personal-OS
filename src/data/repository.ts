import type { ResearchRepository } from './researchRepository';
import type { CellWriteOrigin } from './finishLineGuards';
import type { ReadResult } from './readResult';
import type {
  CellState,
  DailyLog,
  DanglingLink,
  Domain,
  Entry,
  EntryType,
  FinishLineAccount,
  FinishLineAccountMapRow,
  FinishLineAccountWrite,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  IeltsError,
  IeltsResult,
  IeltsSession,
  OrphanMilestone,
  ProcessGate,
  ProcessLane,
  ProcessNeed,
  ProcessPhase,
  ProcessStep,
  ProcessStepItem,
  ProcessTrackDef,
  Project,
  ProjectMember,
  ProjectTask,
  ShareLink,
  ShareScope,
  ShareView,
  TaskStatus,
  WeeklyPlan,
} from './types';

/**
 * The writable surface of a task. Exactly the columns the SQL trigger's
 * allowlist accepts from a member (minus the trigger-owned attribution
 * columns) — the type and the allowlist must not drift apart, because this
 * type is the fast failure and the trigger is the boundary.
 */
export interface ProjectTaskWrite {
  title?: string;
  detail?: string;
  status?: TaskStatus;
  dueDate?: string | null;
  assignee?: string | null;
  sortOrder?: number;
}

export interface Repository {
  listEntries(filter?: {
    type?: EntryType;
    date?: string;
    domain?: Domain;
  }): Promise<Entry[]>;
  getEntry(id: string): Promise<Entry | null>;
  createEntry(input: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entry>;
  updateEntry(id: string, patch: Partial<Entry>): Promise<Entry>;
  deleteEntry(id: string): Promise<void>;

  // Daily logs are keyed by (date, domain): two independent scores per day.
  getDailyLog(date: string, domain: Domain): Promise<DailyLog | null>;
  upsertDailyLog(log: DailyLog): Promise<DailyLog>;
  listDailyLogs(range: { from: string; to: string; domain: Domain }): Promise<DailyLog[]>;

  // Weekly plans are keyed by (week, domain).
  getWeeklyPlan(week: string, domain: Domain): Promise<WeeklyPlan | null>;
  upsertWeeklyPlan(plan: WeeklyPlan): Promise<WeeklyPlan>;

  listProjects(domain?: Domain): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: Omit<Project, 'id'>): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  /**
   * The research subsystem's own seam. Separate interface rather than thirty
   * more methods here — see researchRepository.ts, which also holds the
   * append-only and write-origin invariants.
   */
  readonly research: ResearchRepository;

  // IELTS practice results (GROWTH). Sorted by date ascending.
  listIeltsResults(): Promise<IeltsResult[]>;
  createIeltsResult(input: Omit<IeltsResult, 'id'>): Promise<IeltsResult>;
  updateIeltsResult(id: string, patch: Partial<IeltsResult>): Promise<IeltsResult>;
  deleteIeltsResult(id: string): Promise<void>;

  // IELTS error occurrences. Patterns are derived on read, never stored.
  listIeltsErrors(): Promise<IeltsError[]>;
  /**
   * BULK, deliberately. The entry path is one paste of a whole marking
   * response producing eight or fourteen rows; a per-row create would turn one
   * action into fourteen round trips and fourteen chances to half-commit.
   */
  createIeltsErrors(
    input: ReadonlyArray<Omit<IeltsError, 'id' | 'createdAt'>>,
  ): Promise<IeltsError[]>;
  deleteIeltsError(id: string): Promise<void>;

  /**
   * IELTS practice sessions — the denominator. Sessions are counted from
   * THESE rows, never from distinct error dates: a clean session produces no
   * error row, and missing it understates practice and makes `isolated`
   * unreachable. Created as a side effect of committing a paste (bulk, like
   * the errors, for the multi-date paste case); a zero-error paste writes one
   * after a one-tap skill prompt.
   */
  listIeltsSessions(): Promise<IeltsSession[]>;
  createIeltsSessions(
    input: ReadonlyArray<Omit<IeltsSession, 'id' | 'createdAt'>>,
  ): Promise<IeltsSession[]>;

  /**
   * Finish line — the entity matrix and the road to it.
   *
   * EVERY READ HERE RETURNS `ReadResult`, NOT AN ARRAY.
   *
   * These reads all feed cards that COUNT PROBLEMS, and an empty array cannot
   * tell such a card whether it found nothing or failed to look. That is not
   * hypothetical: the live build rendered `0 milestones make no pack line
   * trustworthy — None` while the truth was 458, because the read degraded to
   * `[]` and the copy turned the failure into good news.
   *
   * A missing relation is still not a crash — the frontend ships before a
   * migration is applied — but it now arrives as `{ok: false, reason:
   * 'missing-relation'}` so the card can say COULD NOT CHECK and, critically,
   * show no number at all. See readResult.ts.
   *
   * The structure is seeded by migration 20260726000023. There is no create or
   * delete for line items — a row in the app but not in the pack is a row
   * nobody can explain.
   */
  listFinishLineItems(): Promise<ReadResult<FinishLineItem>>;
  listFinishLineEntities(): Promise<ReadResult<FinishLineEntity>>;
  listFinishLineCells(): Promise<ReadResult<FinishLineCell>>;
  listFinishLineDeps(): Promise<ReadResult<FinishLineDep>>;
  listFinishLineEdges(): Promise<ReadResult<FinishLineEdge>>;
  /**
   * Account-level detail underneath the cells. The workbook stays
   * authoritative: no field it owns is editable inline, and the ONE write
   * path is an explicit paste of rows copied from the sheet —
   * applyFinishLineAccountPaste, below. A paste is a button, not a cron:
   * the owner triggers it and imported_at records when.
   */
  listFinishLineAccounts(): Promise<ReadResult<FinishLineAccount>>;
  listFinishLineAccountMap(): Promise<ReadResult<FinishLineAccountMapRow>>;

  /**
   * Commits a parsed, previewed paste. Rows with an id update (imported_at
   * refreshed); rows without insert; deleteIds is non-empty ONLY in
   * replace-all mode — upsert mode cannot delete by construction. cell_id is
   * stored exactly as resolved by the diff; cell STATES are never touched.
   */
  applyFinishLineAccountPaste(input: {
    upserts: FinishLineAccountWrite[];
    deleteIds: string[];
  }): Promise<void>;
  listDanglingLinks(): Promise<ReadResult<DanglingLink>>;
  listOrphanMilestones(): Promise<ReadResult<OrphanMilestone>>;

  /**
   * The state write. `origin` is required and only 'human' is accepted — see
   * finishLineGuards. A rollup that disagrees raises a contradiction for a
   * person; it never writes the state.
   */
  setFinishLineCellState(
    cellId: string,
    state: CellState,
    origin: CellWriteOrigin,
  ): Promise<FinishLineCell>;
  setFinishLineCellNote(cellId: string, note: string | undefined): Promise<FinishLineCell>;

  /** Bulk, deliberately: one edge must never cost a form. Replaces the set. */
  setCellEdges(cellId: string, edges: { projectId: string; milestoneId?: string }[]): Promise<void>;
  /** The same operation inverted, from a milestone. */
  setMilestoneEdges(projectId: string, milestoneId: string, cellIds: string[]): Promise<void>;

  /**
   * =========================================================================
   * OPERATIONAL PROCESS (PER ENTITY) — swimlane structure + the data-needs
   * register.
   * =========================================================================
   * Every read returns ReadResult for the same reason the finish-line reads
   * do: the frontend ships before migration 20260806000050 is applied, and a
   * missing relation must arrive as {ok: false, reason: 'missing-relation'}
   * — which both process views render as their ordinary empty state — never
   * as a crash and never as a silent [].
   *
   * The structure is read-only in the app (composed outside, seeded by
   * migration). The ONE write is requestedOn on a need. There is no create,
   * no delete, no structure editor, and nothing here may ever write a
   * Finish line cell state.
   */
  /**
   * The per-entity track vocabulary (os_process_tracks, migration 52).
   * missing-relation from THIS read while steps carry rows is how the views
   * recognise the pre-entity schema (§4.6): render SAMB as before, plus one
   * visible line saying multi-entity is not active yet.
   */
  listProcessTracks(): Promise<ReadResult<ProcessTrackDef>>;
  listProcessLanes(): Promise<ReadResult<ProcessLane>>;
  listProcessPhases(): Promise<ReadResult<ProcessPhase>>;
  listProcessSteps(): Promise<ReadResult<ProcessStep>>;
  listProcessGates(): Promise<ReadResult<ProcessGate>>;
  listProcessNeeds(): Promise<ReadResult<ProcessNeed>>;
  /**
   * The step → Finish line bridge. Read whole and joined in memory: 45 rows
   * against 30 steps, needed in both directions (a cell panel asks "which
   * steps feed this row", a step panel asks "which rows does this feed"),
   * and a per-row query would be one round trip per open panel.
   */
  listProcessStepItems(): Promise<ReadResult<ProcessStepItem>>;
  /** null clears the date. Returns the updated need. */
  setProcessNeedRequestedOn(id: string, requestedOn: string | null): Promise<ProcessNeed>;

  /**
   * =========================================================================
   * TASKS AND THE PROJECT-MEMBERSHIP AXIS (slice 1).
   * =========================================================================
   * THERE IS NO deleteProjectTask, ON PURPOSE. A task ends as `done` or
   * `cancelled`; removal would orphan its history. The interface not having
   * the method is the client half of the rule — the database half is the
   * absence of any member DELETE policy.
   *
   * project scoping is not passed as trust: for a collaborator the list is
   * scoped by RLS regardless of the filter argument, and creates/updates are
   * judged by the SQL trigger. The filter exists so the owner's per-project
   * card does one read, not one read per project.
   */
  listProjectTasks(projectId?: string): Promise<ReadResult<ProjectTask>>;
  createProjectTask(input: {
    projectId: string;
    title: string;
    detail?: string;
    status?: TaskStatus;
    dueDate?: string;
    assignee?: string;
    sortOrder?: number;
  }): Promise<ProjectTask>;
  /** Patch is allowlisted by type; projectId is deliberately not patchable. */
  updateProjectTask(id: string, patch: ProjectTaskWrite): Promise<ProjectTask>;

  /**
   * The project-membership grants. A collaborator's repository can call
   * listProjectMembers and receives exactly their own rows (RLS); grant and
   * revoke require the app key and fail for a JWT, the same shape as every
   * other owner-only write.
   *
   * THE PANEL DOES NOT USE grant/revoke: since the zero-grant incident,
   * panel grants travel through the provision-collaborator Edge Function
   * (audited to private.os_provision_log, loud on a dead session). These
   * methods remain because the capability exists in SQL for the owner key
   * and the mock's trigger-mirror tests exercise it — they model the
   * boundary, not the panel's transport.
   */
  listProjectMembers(): Promise<ReadResult<ProjectMember>>;
  grantProjectMembership(userId: string, projectId: string): Promise<void>;
  revokeProjectMembership(userId: string, projectId: string): Promise<void>;

  /**
   * =========================================================================
   * SHARE LINKS. FOUR MANAGEMENT CALLS, AND NO READING CALL.
   * =========================================================================
   * These belong to the OWNER: minting, listing, extending and cutting off.
   * Redeeming a token is deliberately absent from this interface, because it
   * is not something the app does — a recipient's page holds no repository,
   * no app key and no Supabase client, and reaches the Edge Function
   * directly. See fetchSharedView in supabaseRepository.
   *
   * Every one of these is refused by the read-only credential added in
   * 20260728000034, checked in the database rather than here: a credential
   * that can create a credential is the same credential.
   */
  listShareLinks(): Promise<ReadResult<ShareLink>>;
  /**
   * The token is generated by the CALLER and passed in, because it is shown
   * once and then only its digest survives. Nothing returned from here can
   * reconstruct it — which is the point, and is why the create surface has to
   * hold on to the value it generated rather than reading it back.
   */
  createShareLink(input: {
    token: string;
    view: ShareView;
    scope: ShareScope;
    label?: string;
    ttlDays: number;
  }): Promise<ShareLink>;
  revokeShareLink(id: string): Promise<ShareLink>;
  /** A revoked link is not extendable — reissue instead. Enforced in SQL. */
  extendShareLink(id: string, ttlDays: number): Promise<ShareLink>;
}
