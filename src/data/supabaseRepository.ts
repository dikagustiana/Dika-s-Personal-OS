import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { IELTS_TOPICS } from '../logic/ielts/topics';
import { createSupabaseLabEvidenceRepository } from './labEvidenceRepository';
import type { LabEvidenceRepository } from './labEvidenceRepository';
import { createSupabaseLabRepository } from './labRepository';
import type { LabRepository } from './labRepository';
import { createSupabaseResearchRepository } from './researchRepository';
import type { ResearchRepository } from './researchRepository';
import {
  guardCellNote,
  guardCellState,
  guardCellTransition,
  guardEdgeTarget,
  type CellWriteOrigin,
} from './finishLineGuards';
import { guardTimeBlock } from './timeBlockGuards';
import { okRows, readAbsence, readFailure, type ReadResult } from './readResult';
import type { RelationError } from './missingRelation';
import { isAbsentRelation } from './missingRelation';
import type {
  ProcessGateTextWrite,
  ProcessLaneTextWrite,
  ProcessNeedTextWrite,
  ProcessPhaseTextWrite,
  ProcessStepTextWrite,
  TextHistoryRow,
} from '../logic/processTextEdit';
import type { ProjectTaskWrite, Repository } from './repository';
import type {
  DailyLog,
  FinishLineAccount,
  FinishLineAccountMapRow,
  FinishLineAccountWrite,
  DateConfidence,
  Domain,
  Engagement,
  Entry,
  EntryType,
  CellActorKind,
  CellHistoryEntry,
  CollabLink,
  CellState,
  DanglingLink,
  FinishLineAgg,
  FinishLineCell,
  FinishLineDep,
  FinishLineEdge,
  FinishLineEntity,
  FinishLineItem,
  FinishLineKind,
  FinishLineStyle,
  OrphanMilestone,
  ProcessCoaRef,
  ProcessFormDef,
  ProcessGate,
  ProcessGateType,
  ProcessLane,
  ProcessNeed,
  ProcessNeedKind,
  ProcessNeedStatus,
  ProcessPhase,
  ProcessReference,
  ProcessStep,
  ProcessStepItem,
  ProcessTextHistoryEntry,
  ProcessTrack,
  ProcessTrackDef,
  IeltsBandConversion,
  IeltsError,
  IeltsErrorSkill,
  IeltsPractice,
  IeltsPracticeTopic,
  IeltsPracticeWrite,
  IeltsPrepConfig,
  IeltsPrepSkill,
  IeltsResult,
  IeltsSession,
  IeltsTopic,
  IeltsTopicKind,
  LinkedProject,
  Project,
  ProjectDocument,
  ProjectMember,
  ProjectTask,
  ShareLink,
  ShareScope,
  SharedView,
  ShareView,
  SignInEvent,
  TaskHistoryEntry,
  TaskStatus,
  WeeklyPlan,
  WebsiteCategory,
} from './types';

// Env-gated configuration. Both values ship in the client bundle by design;
// access control lives server-side (RLS checks the x-app-key header — see
// supabase/migrations/20260724000002_security.sql and REVIEW.md).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function requireConfig(): { url: string; anonKey: string } {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  }
  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}

/**
 * Asks the database whether a candidate passphrase matches the stored hash.
 * Used by the unlock gate before any repository is constructed: RLS makes
 * SELECTs return empty rather than erroring, so the gate needs an explicit
 * yes/no.
 */
export interface VerifyResult {
  valid: boolean;
  /** Set while the caller is in a temporary lockout. */
  lockedOut?: boolean;
  /** Seconds until the lockout lifts. */
  retryAfter?: number;
  attemptsRemaining?: number;
}

/**
 * One Edge Function call, with the anon key attached the way every other call
 * here attaches it. Returns the parsed body for any status the function uses
 * to mean something — the research model function answers "not configured" and
 * "needs confirmation" with real bodies the caller must read, so throwing on
 * non-2xx would discard exactly the information it needs.
 */
export async function edgeFunctionCall<T>(
  name: string,
  options: { method: 'GET' | 'POST'; body?: unknown; appKey?: string },
): Promise<T> {
  const { url, anonKey } = requireConfig();
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      // The anon key is in the public bundle and is therefore not
      // authorization. A function that spends the owner's model budget checks
      // this header the same way RLS checks it on every table.
      ...(options.appKey ? { 'x-app-key': options.appKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return (await response.json()) as T;
}

/**
 * Verification goes through the `verify-passphrase` Edge Function, which rate
 * limits it. The database RPC is no longer callable with the anon key — see
 * supabase/migrations/20260724000011_auth_rate_limit.sql.
 */
export async function verifyAppKey(candidate: string): Promise<VerifyResult> {
  const { url, anonKey } = requireConfig();
  const response = await fetch(`${url}/functions/v1/verify-passphrase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ candidate }),
  });
  if (response.status === 429) {
    const body = (await response.json()) as VerifyResult;
    return { valid: false, lockedOut: true, retryAfter: body.retryAfter };
  }
  if (!response.ok) throw new Error(`Passphrase check failed (${response.status}).`);
  return (await response.json()) as VerifyResult;
}

/**
 * Asks for a one-time link that sets a new passphrase. There is deliberately
 * nothing to return: the function answers identically whether it sent an email,
 * was inside its one-per-hour window, or found no mailbox — so the caller has
 * no result to report and must not imply one. Resolving means the request was
 * accepted, not that mail went out.
 */
export async function requestPassphraseRecovery(): Promise<void> {
  const { url, anonKey } = requireConfig();
  const response = await fetch(`${url}/functions/v1/request-passphrase-recovery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: '{}',
  });
  if (!response.ok) throw new Error(`Recovery request failed (${response.status}).`);
}

/** 'weak' is the strength floor; 'invalid' covers unknown, used and expired alike. */
export type RecoveryOutcome = 'ok' | 'weak' | 'invalid';

export interface ConsumeRecoveryResult {
  outcome: RecoveryOutcome;
  /** Whether the failed-attempt lockout was also cleared. Only set on 'ok'. */
  lockoutCleared?: boolean;
}

/**
 * Redeems a recovery token and installs the new passphrase. Neither argument is
 * logged or stored anywhere on the way through — not in the thrown error
 * either, which carries the status code only.
 */
export async function consumePassphraseRecovery(
  token: string,
  passphrase: string,
): Promise<ConsumeRecoveryResult> {
  const { url, anonKey } = requireConfig();
  const response = await fetch(`${url}/functions/v1/consume-passphrase-recovery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ token, passphrase }),
  });
  if (response.status === 400) {
    const body = (await response.json()) as { reason?: RecoveryOutcome };
    // A 400 without a reason is a malformed request rather than a bad token,
    // but the owner can do nothing different about it either way.
    return { outcome: body.reason === 'weak' ? 'weak' : 'invalid' };
  }
  if (!response.ok) throw new Error(`Recovery failed (${response.status}).`);
  const body = (await response.json()) as { lockoutCleared?: boolean };
  return { outcome: 'ok', lockoutCleared: body.lockoutCleared };
}

export function createSupabaseRepository(appKey: string): Repository {
  const { url, anonKey } = requireConfig();
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { 'x-app-key': appKey } },
  });
  return new SupabaseRepository(client);
}

/**
 * The same repository over an injected client — the seam
 * createSupabaseResearchRepository already establishes. Exists so the
 * PostgREST-error paths (the §4.6 42703 fallback above all) are testable
 * against a scripted client; production construction stays
 * createSupabaseRepository.
 */
export function createSupabaseRepositoryForClient(client: SupabaseClient): Repository {
  return new SupabaseRepository(client);
}

// --- collaborator path ------------------------------------------------------
//
// A SECOND CLIENT, NOT A SECOND REPOSITORY CLASS. A collaborator authenticates
// with a Supabase magic-link session instead of the x-app-key header; every
// read and write then flows through the same SupabaseRepository, and what they
// can reach is decided entirely by RLS and the cell trigger — the member
// policies scope reads to their entities, writes to input → figure on their
// own cells, and everything else returns empty or rejects. The owner client
// above is untouched: persistSession stays false there and the header stays.

let collaboratorClient: SupabaseClient | null = null;

/**
 * Lazy singleton: the gate needs it on mount to ask "is a collaborator
 * session already here?", and creating two GoTrue clients against the same
 * storage key would have them fight over the token refresh.
 */
export function getCollaboratorClient(): SupabaseClient {
  if (!collaboratorClient) {
    const { url, anonKey } = requireConfig();
    collaboratorClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Distinct storage key: never collides with anything the owner path
        // stores, and makes "collaborator session" greppable in devtools.
        storageKey: 'personal-os-collab-auth',
      },
    });
  }
  return collaboratorClient;
}

/**
 * Consumes a hashed sign-in token minted by the provision-collaborator Edge
 * Function (the owner hands the link over out of band; THE APP NEVER SENDS
 * EMAIL). One use, short-lived; on success the collaborator client holds a
 * persisted session exactly as if a mailed magic link had been clicked.
 */
export async function consumeCollaboratorToken(
  tokenHash: string,
): Promise<{ user?: { id: string; email?: string }; error?: string }> {
  const { data, error } = await getCollaboratorClient().auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (error) return { error: error.message };
  const user = data.user ?? data.session?.user;
  if (!user) return { error: 'No session was established' };
  return { user: { id: user.id, email: user.email ?? undefined } };
}

/** The current collaborator session's user id and email, if one exists. */
export async function getCollaboratorUser(): Promise<{ id: string; email?: string } | null> {
  const { data } = await getCollaboratorClient().auth.getSession();
  const user = data.session?.user;
  return user ? { id: user.id, email: user.email ?? undefined } : null;
}

export async function signOutCollaborator(): Promise<void> {
  await getCollaboratorClient().auth.signOut();
}

/**
 * The entity codes this session's user holds membership for — the same
 * question os_member_entities() answers inside every policy, asked once by
 * the client so the UI can scope itself. RLS lets a user read only their own
 * membership rows, so this needs no parameter and can return nothing stale.
 * UI-scoping only: the SQL policies do not care what this returned.
 */
export async function listMyMemberships(): Promise<string[]> {
  const { data, error } = await getCollaboratorClient()
    .from('os_entity_members')
    .select('entity_code')
    .order('entity_code');
  if (error) throw new Error(`listMyMemberships failed: ${error.message}`);
  return (data as { entity_code: string }[]).map((row) => row.entity_code);
}

/** The same repository class, driven by the session-bearing client. */
export function createCollaboratorRepository(): Repository {
  return new SupabaseRepository(getCollaboratorClient());
}

// --- owner-side provisioning ------------------------------------------------
//
// The management calls behind the owner's collaborator panel. Every one is a
// POST to the provision-collaborator Edge Function, which verifies the
// x-app-key owner credential server-side (same bcrypt + lockout as the
// passphrase gate) before touching anything. The app sends no email at any
// point: `create` and `link` RETURN a one-time sign-in link for the owner to
// hand over out of band.

export interface ProvisionedUser {
  userId: string;
  email: string;
  entityCodes: string[];
  /** Project grants (the second axis), listed by the same gated call. */
  projectIds: string[];
  lastSignInAt: string | null;
  createdAt: string | null;
}

export interface ProvisionLinkResult {
  userId?: string;
  email?: string;
  entityCodes?: string[];
  projectIds?: string[];
  link?: string;
  expiry?: string;
  /**
   * When the minted link stops working, ISO-8601. Advisory: the panel falls
   * back to its own one-hour default when this is absent, so a frontend that
   * ships ahead of an Edge Function redeploy still shows a real countdown.
   */
  expiresAt?: string;
  removedEntityCodes?: string[];
  removedProjectIds?: string[];
  users?: ProvisionedUser[];
  error?: string;
  retryAfter?: number;
}

export async function provisionCollaborator(
  appKey: string,
  body:
    | { action: 'create'; email: string; entityCodes: string[] }
    | { action: 'link'; email: string }
    // Revoke clears BOTH axes server-side — entities and project grants in
    // one audited action, so a half-revoked account cannot exist.
    | { action: 'revoke'; email: string }
    | { action: 'list' }
    // Project grants are provisioning actions like any other: owner-gated,
    // service-role, audited to private.os_provision_log — never a direct
    // table write from the panel, whose session state the writes must not
    // silently depend on.
    | { action: 'grant-projects'; email: string; projectIds: string[] }
    | { action: 'revoke-project'; email: string; projectId: string },
): Promise<ProvisionLinkResult> {
  return edgeFunctionCall<ProvisionLinkResult>('provision-collaborator', {
    method: 'POST',
    body,
    appKey,
  });
}

// --- row shapes -------------------------------------------------------------

interface EntryRow {
  id: string;
  type: EntryType;
  domain: Domain;
  created_at: string;
  updated_at: string;
  tags: string[];
  entry_date: string | null;
  payload: Record<string, unknown>;
}

interface DailyLogRow {
  date: string;
  domain: Domain;
  habits: Record<string, boolean>;
  score: number;
}

interface WeeklyPlanRow {
  week: string;
  domain: Domain;
  theme: string | null;
  goals: WeeklyPlan['goals'];
  reviewed_at: string | null;
}

interface ProjectRow {
  id: string;
  domain: Domain;
  // NOT NULL in the database since migration 20260804000038; possibly-absent
  // here only so a read against an un-migrated database still parses. The
  // reader falls back to 'internal' — failing CLOSED: an unclassified project
  // is treated as not collaborator-visible, never the reverse.
  engagement?: Engagement | null;
  title: string;
  type: Project['type'];
  status: Project['status'];
  start_date: string | null;
  deadline: string | null;
  target_metric: string | null;
  milestones: Project['milestones'];
  sort_order: number;
  recurring: 'monthly' | null;
  period: string | null;
  working_title: string | null;
  category: WebsiteCategory | null;
  date_confidence: DateConfidence | null;
  // Added by migration 20260724000013. Typed as possibly-absent, not just
  // possibly-null: `select *` against a database where that migration has not
  // been applied yet simply omits these keys, and the reader must survive it.
  parent_id?: string | null;
  linked_projects?: LinkedProject[] | null;
  entity_tag?: string | null;
  documents?: ProjectDocument[] | null;
  // Added by migration 20260724000014, same possibly-absent treatment: the
  // app must still render against a database that has not run it yet.
  dashboard_pinned?: boolean | null;
}

interface IeltsResultRow {
  id: string;
  date: string;
  listening: number;
  reading: number;
  writing: number;
  speaking: number;
}

interface IeltsErrorRow {
  id: string;
  date: string;
  skill: IeltsErrorSkill;
  criterion: string;
  failure_mode: string;
  quote: string;
  note: string | null;
  question_type: string | null;
  result_id: string | null;
  created_at: string;
}

// revision_of is NOT here: it moved to os_ielts_sessions (a revision is a
// property of the session, not of each mistake) and the error-row column is
// dropped by migration 20260727000028.
const IELTS_ERROR_COLUMNS =
  'id, date, skill, criterion, failure_mode, quote, note, question_type, result_id, created_at';

interface IeltsSessionRow {
  id: string;
  date: string;
  skill: IeltsErrorSkill;
  revision_of: string | null;
  raw_feedback: string | null;
  created_at: string;
}

const IELTS_SESSION_COLUMNS = 'id, date, skill, revision_of, raw_feedback, created_at';

const IELTS_PRACTICE_COLUMNS =
  'id, skill, source, attempted_on, timed, raw_score, band, duration_minutes, notes, created_at';

interface IeltsTopicRow {
  slug: string;
  skill: IeltsPrepSkill;
  kind: IeltsTopicKind;
  label: string;
  sort_order: number;
}

interface IeltsPracticeRow {
  id: string;
  skill: IeltsPrepSkill;
  source: string;
  attempted_on: string;
  timed: boolean;
  raw_score: number | null;
  // numeric(2,1) crosses PostgREST as a string, never a number.
  band: string | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
}

interface IeltsPracticeTopicRow {
  practice_id: string;
  topic_slug: string;
  attempted: number | null;
  missed: number | null;
  severity: number | null;
}

interface IeltsBandConversionRow {
  skill: IeltsBandConversion['skill'];
  raw_score: number;
  band: string | null;
}

interface IeltsConfigRow {
  test_date: string;
  target_overall: string | null;
  target_floor: string | null;
}

function rowToIeltsPractice(row: IeltsPracticeRow): IeltsPractice {
  return {
    id: row.id,
    skill: row.skill,
    source: row.source,
    attemptedOn: row.attempted_on,
    timed: row.timed,
    rawScore: row.raw_score ?? undefined,
    band: row.band === null ? undefined : Number(row.band),
    durationMinutes: row.duration_minutes ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: toIso(row.created_at),
  };
}

// --- mapping ----------------------------------------------------------------

// Postgres returns timestamptz as `2026-07-24 15:04:05.123+00:00`-style
// strings; the domain uses Date.toISOString() format everywhere (the mock
// generates them that way), so normalize on read.
function toIso(value: string): string {
  return new Date(value).toISOString();
}

function rowToEntry(row: EntryRow): Entry {
  return {
    ...row.payload,
    id: row.id,
    type: row.type,
    domain: row.domain,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    tags: row.tags,
  } as Entry;
}

// The column listEntries date filters run against. Mirrors the mock exactly:
// task -> dueDate, timeblock -> date, braindump -> UTC date of createdAt,
// habit -> null (habits always pass a date filter; see listEntries).
function entryDateFor(entry: Entry): string | null {
  switch (entry.type) {
    case 'task':
      return entry.dueDate ?? null;
    case 'timeblock':
      return entry.date;
    case 'braindump':
      return entry.createdAt.slice(0, 10);
    case 'habit':
      return null;
  }
}

// Everything that is not a shared column lives in payload, domain-shaped.
// JSON serialization drops undefined-valued keys, which reproduces the
// mock's spread-merge semantics where `{ completedAt: undefined }` clears
// the field.
function entryToRow(entry: Entry): EntryRow {
  const { id, type, domain, createdAt, updatedAt, tags, ...payload } = entry;
  return {
    id,
    type,
    domain,
    created_at: createdAt,
    updated_at: updatedAt,
    tags,
    entry_date: entryDateFor(entry),
    payload,
  };
}

function rowToDailyLog(row: DailyLogRow): DailyLog {
  return { date: row.date, domain: row.domain, habits: row.habits, score: row.score };
}

function rowToWeeklyPlan(row: WeeklyPlanRow): WeeklyPlan {
  const plan: WeeklyPlan = { week: row.week, domain: row.domain, goals: row.goals };
  if (row.theme !== null) plan.theme = row.theme;
  if (row.reviewed_at !== null) plan.reviewedAt = toIso(row.reviewed_at);
  return plan;
}

function rowToProject(row: ProjectRow): Project {
  const project: Project = {
    id: row.id,
    domain: row.domain,
    engagement: row.engagement ?? 'internal',
    title: row.title,
    type: row.type,
    status: row.status,
    milestones: row.milestones,
    order: row.sort_order,
  };
  if (row.start_date !== null) project.startDate = row.start_date;
  if (row.deadline !== null) project.deadline = row.deadline;
  if (row.target_metric !== null) project.targetMetric = row.target_metric;
  if (row.recurring !== null) project.recurring = row.recurring;
  if (row.period !== null) project.period = row.period;
  if (row.working_title !== null) project.workingTitle = row.working_title;
  if (row.category !== null) project.category = row.category;
  if (row.date_confidence !== null) project.dateConfidence = row.date_confidence;
  // Empty arrays are dropped rather than carried, matching how every other
  // absent value is handled here: the domain shape stays free of noise and
  // readers coalesce with `?? []`.
  if (row.parent_id) project.parentId = row.parent_id;
  if (Array.isArray(row.linked_projects) && row.linked_projects.length > 0) {
    project.linkedProjects = row.linked_projects;
  }
  if (row.entity_tag) project.entityTag = row.entity_tag;
  if (Array.isArray(row.documents) && row.documents.length > 0) {
    project.documents = row.documents;
  }
  // Absent (migration not applied) and false both mean "not pinned", so the
  // dashboard renders an empty pinned set instead of erroring.
  if (row.dashboard_pinned) project.dashboardPinned = true;
  return project;
}

function rowToIeltsError(row: IeltsErrorRow): IeltsError {
  const error: IeltsError = {
    id: row.id,
    date: row.date,
    skill: row.skill,
    criterion: row.criterion,
    failureMode: row.failure_mode,
    quote: row.quote,
    createdAt: toIso(row.created_at),
  };
  // Omitted rather than set to null: the domain type uses optional fields, and
  // `note: null` would satisfy neither `?string` nor a truthiness check.
  if (row.note) error.note = row.note;
  if (row.question_type) error.questionType = row.question_type;
  if (row.result_id) error.resultId = row.result_id;
  return error;
}

function rowToIeltsSession(row: IeltsSessionRow): IeltsSession {
  const session: IeltsSession = {
    id: row.id,
    date: row.date,
    skill: row.skill,
    createdAt: toIso(row.created_at),
  };
  if (row.revision_of) session.revisionOf = row.revision_of;
  if (row.raw_feedback) session.rawFeedback = row.raw_feedback;
  return session;
}

function rowToIeltsResult(row: IeltsResultRow): IeltsResult {
  return {
    id: row.id,
    date: row.date,
    listening: row.listening,
    reading: row.reading,
    writing: row.writing,
    speaking: row.speaking,
  };
}

function projectPatchToRow(patch: Partial<Project>): Partial<ProjectRow> {
  const row: Partial<ProjectRow> = {};
  if ('domain' in patch && patch.domain !== undefined) row.domain = patch.domain;
  if ('engagement' in patch && patch.engagement !== undefined) {
    row.engagement = patch.engagement;
  }
  if ('title' in patch && patch.title !== undefined) row.title = patch.title;
  if ('type' in patch && patch.type !== undefined) row.type = patch.type;
  if ('status' in patch && patch.status !== undefined) row.status = patch.status;
  if ('milestones' in patch && patch.milestones !== undefined) row.milestones = patch.milestones;
  if ('order' in patch && patch.order !== undefined) row.sort_order = patch.order;
  if ('startDate' in patch) row.start_date = patch.startDate ?? null;
  if ('deadline' in patch) row.deadline = patch.deadline ?? null;
  if ('targetMetric' in patch) row.target_metric = patch.targetMetric ?? null;
  if ('recurring' in patch) row.recurring = patch.recurring ?? null;
  if ('period' in patch) row.period = patch.period ?? null;
  if ('workingTitle' in patch) row.working_title = patch.workingTitle ?? null;
  if ('category' in patch) row.category = patch.category ?? null;
  if ('dateConfidence' in patch) row.date_confidence = patch.dateConfidence ?? null;
  if ('parentId' in patch) row.parent_id = patch.parentId ?? null;
  if ('linkedProjects' in patch) row.linked_projects = patch.linkedProjects ?? [];
  if ('entityTag' in patch) row.entity_tag = patch.entityTag ?? null;
  if ('documents' in patch) row.documents = patch.documents ?? [];
  if ('dashboardPinned' in patch) row.dashboard_pinned = patch.dashboardPinned ?? false;
  return row;
}

// --- repository -------------------------------------------------------------

class SupabaseRepository implements Repository {
  /** Research hangs off its own seam — see researchRepository.ts. */
  readonly research: ResearchRepository;

  /** Lab likewise — see labRepository.ts for its read-only-runs rule. */
  readonly lab: LabRepository;

  /** The epistemic layer — see labEvidenceRepository.ts. */
  readonly labEvidence: LabEvidenceRepository;

  constructor(private readonly client: SupabaseClient) {
    this.research = createSupabaseResearchRepository(client);
    this.lab = createSupabaseLabRepository(client);
    this.labEvidence = createSupabaseLabEvidenceRepository(client);
  }

  async listEntries(filter?: {
    type?: EntryType;
    date?: string;
    domain?: Domain;
  }): Promise<Entry[]> {
    let query = this.client.from('os_entries').select('*');
    if (filter?.domain) query = query.eq('domain', filter.domain);
    if (filter?.type) {
      query = query.eq('type', filter.type);
      // Habits ignore date filters (mock semantics); everything else
      // matches on its promoted entry_date.
      if (filter.date && filter.type !== 'habit') {
        query = query.eq('entry_date', filter.date);
      }
    } else if (filter?.date) {
      query = query.or(`type.eq.habit,entry_date.eq.${filter.date}`);
    }
    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw new Error(`listEntries failed: ${error.message}`);
    return (data as EntryRow[]).map(rowToEntry);
  }

  async getEntry(id: string): Promise<Entry | null> {
    const { data, error } = await this.client
      .from('os_entries')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getEntry failed: ${error.message}`);
    return data ? rowToEntry(data as EntryRow) : null;
  }

  async createEntry(input: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entry> {
    const now = new Date().toISOString();
    const entry = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    } as Entry;
    guardTimeBlock(entry);
    const { data, error } = await this.client
      .from('os_entries')
      .insert(entryToRow(entry))
      .select()
      .single();
    if (error) throw new Error(`createEntry failed: ${error.message}`);
    return rowToEntry(data as EntryRow);
  }

  async updateEntry(id: string, patch: Partial<Entry>): Promise<Entry> {
    const current = await this.getEntry(id);
    if (!current) throw new Error(`Entry not found: ${id}`);
    const merged = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    } as Entry;
    // Guarded on the MERGED entry: a patch adding milestoneId to a block that
    // already carries taskId is only visible against the result.
    guardTimeBlock(merged);
    const row = entryToRow(merged);
    const { data, error } = await this.client
      .from('os_entries')
      .update({
        type: row.type,
        domain: row.domain,
        tags: row.tags,
        entry_date: row.entry_date,
        payload: row.payload,
        updated_at: row.updated_at,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`updateEntry failed: ${error.message}`);
    return rowToEntry(data as EntryRow);
  }

  async deleteEntry(id: string): Promise<void> {
    const { error } = await this.client.from('os_entries').delete().eq('id', id);
    if (error) throw new Error(`deleteEntry failed: ${error.message}`);
  }

  async getDailyLog(date: string, domain: Domain): Promise<DailyLog | null> {
    const { data, error } = await this.client
      .from('os_daily_logs')
      .select('date, domain, habits, score')
      .eq('date', date)
      .eq('domain', domain)
      .maybeSingle();
    if (error) throw new Error(`getDailyLog failed: ${error.message}`);
    return data ? rowToDailyLog(data as DailyLogRow) : null;
  }

  async upsertDailyLog(log: DailyLog): Promise<DailyLog> {
    const { data, error } = await this.client
      .from('os_daily_logs')
      .upsert(
        { date: log.date, domain: log.domain, habits: log.habits, score: log.score },
        { onConflict: 'date,domain' },
      )
      .select('date, domain, habits, score')
      .single();
    if (error) throw new Error(`upsertDailyLog failed: ${error.message}`);
    return rowToDailyLog(data as DailyLogRow);
  }

  async listDailyLogs(range: {
    from: string;
    to: string;
    domain: Domain;
  }): Promise<DailyLog[]> {
    const { data, error } = await this.client
      .from('os_daily_logs')
      .select('date, domain, habits, score')
      .eq('domain', range.domain)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true });
    if (error) throw new Error(`listDailyLogs failed: ${error.message}`);
    return (data as DailyLogRow[]).map(rowToDailyLog);
  }

  async getWeeklyPlan(week: string, domain: Domain): Promise<WeeklyPlan | null> {
    const { data, error } = await this.client
      .from('os_weekly_plans')
      .select('week, domain, theme, goals, reviewed_at')
      .eq('week', week)
      .eq('domain', domain)
      .maybeSingle();
    if (error) throw new Error(`getWeeklyPlan failed: ${error.message}`);
    return data ? rowToWeeklyPlan(data as WeeklyPlanRow) : null;
  }

  async upsertWeeklyPlan(plan: WeeklyPlan): Promise<WeeklyPlan> {
    const { data, error } = await this.client
      .from('os_weekly_plans')
      .upsert(
        {
          week: plan.week,
          domain: plan.domain,
          theme: plan.theme ?? null,
          goals: plan.goals,
          reviewed_at: plan.reviewedAt ?? null,
        },
        { onConflict: 'week,domain' },
      )
      .select('week, domain, theme, goals, reviewed_at')
      .single();
    if (error) throw new Error(`upsertWeeklyPlan failed: ${error.message}`);
    return rowToWeeklyPlan(data as WeeklyPlanRow);
  }

  async listProjects(domain?: Domain): Promise<Project[]> {
    let query = this.client.from('os_projects').select('*');
    if (domain) query = query.eq('domain', domain);
    const { data, error } = await query.order('sort_order', { ascending: true });
    if (error) throw new Error(`listProjects failed: ${error.message}`);
    return (data as ProjectRow[]).map(rowToProject);
  }

  async getProject(id: string): Promise<Project | null> {
    const { data, error } = await this.client
      .from('os_projects')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getProject failed: ${error.message}`);
    return data ? rowToProject(data as ProjectRow) : null;
  }

  async createProject(input: Omit<Project, 'id'>): Promise<Project> {
    const { data, error } = await this.client
      .from('os_projects')
      .insert({
        domain: input.domain,
        engagement: input.engagement,
        title: input.title,
        type: input.type,
        status: input.status,
        start_date: input.startDate ?? null,
        deadline: input.deadline ?? null,
        target_metric: input.targetMetric ?? null,
        milestones: input.milestones,
        sort_order: input.order,
        recurring: input.recurring ?? null,
        period: input.period ?? null,
        working_title: input.workingTitle ?? null,
        category: input.category ?? null,
        // The hierarchy columns are named only when the caller supplied a
        // value. Naming them unconditionally would make every project
        // creation fail against a database that has not yet run migration
        // 20260724000013 — the columns simply would not exist.
        ...(input.parentId ? { parent_id: input.parentId } : {}),
        ...(input.entityTag ? { entity_tag: input.entityTag } : {}),
        ...(input.linkedProjects?.length ? { linked_projects: input.linkedProjects } : {}),
        ...(input.documents?.length ? { documents: input.documents } : {}),
        ...(input.dashboardPinned ? { dashboard_pinned: true } : {}),
      })
      .select()
      .single();
    if (error) throw new Error(`createProject failed: ${error.message}`);
    return rowToProject(data as ProjectRow);
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const row = projectPatchToRow(patch);
    if (Object.keys(row).length === 0) {
      const current = await this.getProject(id);
      if (!current) throw new Error(`Project not found: ${id}`);
      return current;
    }
    const { data, error } = await this.client
      .from('os_projects')
      .update(row)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`updateProject failed: ${error.message}`);
    if (!data) throw new Error(`Project not found: ${id}`);
    return rowToProject(data as ProjectRow);
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await this.client.from('os_projects').delete().eq('id', id);
    if (error) throw new Error(`deleteProject failed: ${error.message}`);
  }

  async listIeltsResults(): Promise<IeltsResult[]> {
    const { data, error } = await this.client
      .from('os_ielts_results')
      .select('id, date, listening, reading, writing, speaking')
      .order('date', { ascending: true });
    if (error) throw new Error(`listIeltsResults failed: ${error.message}`);
    return (data as IeltsResultRow[]).map(rowToIeltsResult);
  }

  async createIeltsResult(input: Omit<IeltsResult, 'id'>): Promise<IeltsResult> {
    const { data, error } = await this.client
      .from('os_ielts_results')
      .insert({
        date: input.date,
        listening: input.listening,
        reading: input.reading,
        writing: input.writing,
        speaking: input.speaking,
      })
      .select('id, date, listening, reading, writing, speaking')
      .single();
    if (error) throw new Error(`createIeltsResult failed: ${error.message}`);
    return rowToIeltsResult(data as IeltsResultRow);
  }

  async updateIeltsResult(id: string, patch: Partial<IeltsResult>): Promise<IeltsResult> {
    const row: Partial<IeltsResultRow> = {};
    if (patch.date !== undefined) row.date = patch.date;
    if (patch.listening !== undefined) row.listening = patch.listening;
    if (patch.reading !== undefined) row.reading = patch.reading;
    if (patch.writing !== undefined) row.writing = patch.writing;
    if (patch.speaking !== undefined) row.speaking = patch.speaking;
    const { data, error } = await this.client
      .from('os_ielts_results')
      .update(row)
      .eq('id', id)
      .select('id, date, listening, reading, writing, speaking')
      .maybeSingle();
    if (error) throw new Error(`updateIeltsResult failed: ${error.message}`);
    if (!data) throw new Error(`IELTS result not found: ${id}`);
    return rowToIeltsResult(data as IeltsResultRow);
  }

  async deleteIeltsResult(id: string): Promise<void> {
    const { error } = await this.client.from('os_ielts_results').delete().eq('id', id);
    if (error) throw new Error(`deleteIeltsResult failed: ${error.message}`);
  }

  async listIeltsErrors(): Promise<IeltsError[]> {
    const { data, error } = await this.client
      .from('os_ielts_errors')
      .select(IELTS_ERROR_COLUMNS)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new Error(`listIeltsErrors failed: ${error.message}`);
    return (data as IeltsErrorRow[]).map(rowToIeltsError);
  }

  /**
   * One insert for the whole paste. PostgREST returns the inserted rows in
   * request order, so the caller gets ids back for every row it sent without a
   * second read.
   */
  async createIeltsErrors(
    input: ReadonlyArray<Omit<IeltsError, 'id' | 'createdAt'>>,
  ): Promise<IeltsError[]> {
    if (input.length === 0) return [];
    const { data, error } = await this.client
      .from('os_ielts_errors')
      .insert(
        input.map((row) => ({
          date: row.date,
          skill: row.skill,
          criterion: row.criterion,
          failure_mode: row.failureMode,
          quote: row.quote,
          note: row.note ?? null,
          question_type: row.questionType ?? null,
          result_id: row.resultId ?? null,
        })),
      )
      .select(IELTS_ERROR_COLUMNS);
    if (error) throw new Error(`createIeltsErrors failed: ${error.message}`);
    return (data as IeltsErrorRow[]).map(rowToIeltsError);
  }

  async deleteIeltsError(id: string): Promise<void> {
    const { error } = await this.client.from('os_ielts_errors').delete().eq('id', id);
    if (error) throw new Error(`deleteIeltsError failed: ${error.message}`);
  }

  async listIeltsSessions(): Promise<IeltsSession[]> {
    const { data, error } = await this.client
      .from('os_ielts_sessions')
      .select(IELTS_SESSION_COLUMNS)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new Error(`listIeltsSessions failed: ${error.message}`);
    return (data as IeltsSessionRow[]).map(rowToIeltsSession);
  }

  /** Bulk like the errors — a multi-date paste creates its sessions in one insert. */
  async createIeltsSessions(
    input: ReadonlyArray<Omit<IeltsSession, 'id' | 'createdAt'>>,
  ): Promise<IeltsSession[]> {
    if (input.length === 0) return [];
    const { data, error } = await this.client
      .from('os_ielts_sessions')
      .insert(
        input.map((row) => ({
          date: row.date,
          skill: row.skill,
          revision_of: row.revisionOf ?? null,
          raw_feedback: row.rawFeedback ?? null,
        })),
      )
      .select(IELTS_SESSION_COLUMNS);
    if (error) throw new Error(`createIeltsSessions failed: ${error.message}`);
    return (data as IeltsSessionRow[]).map(rowToIeltsSession);
  }

  // --- IELTS prep: the per-question-type tracker ------------------------------

  async listIeltsTopics(): Promise<IeltsTopic[]> {
    const { data, error } = await this.client
      .from('os_ielts_topic')
      .select('slug, skill, kind, label, sort_order')
      .order('skill', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) throw new Error(`listIeltsTopics failed: ${error.message}`);
    // hasMethod is a property of the REPO's content, not of the database, so
    // it is joined in here from the same list the parity test checks. A slug
    // the repo has never heard of defaults to false: claiming a method that
    // has no file would put a dead link on a weakness row.
    // Keyed by `string`: row.slug arrives from the database and may be a slug
    // the repo has never heard of, which is the case the `?? false` below
    // exists for. A literal-union key would reject the lookup at compile time
    // and hide that case behind a cast.
    const contentByslug = new Map<string, (typeof IELTS_TOPICS)[number]>(
      IELTS_TOPICS.map((topic) => [topic.slug, topic]),
    );
    return (data as IeltsTopicRow[]).map((row) => ({
      slug: row.slug,
      skill: row.skill,
      kind: row.kind,
      label: row.label,
      sortOrder: row.sort_order,
      hasMethod: contentByslug.get(row.slug)?.hasMethod ?? false,
    }));
  }

  async listIeltsPractice(): Promise<IeltsPractice[]> {
    const { data, error } = await this.client
      .from('os_ielts_practice')
      .select(IELTS_PRACTICE_COLUMNS)
      .order('attempted_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(`listIeltsPractice failed: ${error.message}`);
    return (data as IeltsPracticeRow[]).map(rowToIeltsPractice);
  }

  async listIeltsPracticeTopics(): Promise<IeltsPracticeTopic[]> {
    const { data, error } = await this.client
      .from('os_ielts_practice_topic')
      .select('practice_id, topic_slug, attempted, missed, severity');
    if (error) throw new Error(`listIeltsPracticeTopics failed: ${error.message}`);
    return (data as IeltsPracticeTopicRow[]).map((row) => ({
      practiceId: row.practice_id,
      topicSlug: row.topic_slug,
      attempted: row.attempted ?? undefined,
      missed: row.missed ?? undefined,
      severity: row.severity ?? undefined,
    }));
  }

  async listIeltsBandConversion(): Promise<IeltsBandConversion[]> {
    const { data, error } = await this.client
      .from('os_ielts_band_conversion')
      .select('skill, raw_score, band')
      .order('skill', { ascending: true })
      .order('raw_score', { ascending: true });
    if (error) throw new Error(`listIeltsBandConversion failed: ${error.message}`);
    return (data as IeltsBandConversionRow[]).map((row) => ({
      skill: row.skill,
      rawScore: row.raw_score,
      // numeric(2,1) arrives as a string from PostgREST. Number('') is 0, so
      // the null check has to come first or a missing band becomes band 0.0 —
      // a published-looking value that would rank as the worst possible score.
      band: row.band === null ? undefined : Number(row.band),
    }));
  }

  async getIeltsPrepConfig(): Promise<IeltsPrepConfig | null> {
    const { data, error } = await this.client
      .from('os_ielts_config')
      .select('test_date, target_overall, target_floor')
      .maybeSingle();
    if (error) throw new Error(`getIeltsPrepConfig failed: ${error.message}`);
    if (!data) return null;
    const row = data as IeltsConfigRow;
    return {
      testDate: row.test_date,
      targetOverall: row.target_overall === null ? undefined : Number(row.target_overall),
      targetFloor: row.target_floor === null ? undefined : Number(row.target_floor),
    };
  }

  /**
   * ONE RPC, ONE TRANSACTION. Two inserts from the client cannot be atomic,
   * and a practice row that lost its topic rows would count toward "sessions
   * logged this week" while contributing nothing to any weakness ratio — the
   * dashboard and the weakness view would disagree with nothing to show why.
   * See migration `ielts_log_practice_rpc`; the function is SECURITY INVOKER,
   * so RLS still applies and this adds atomicity, not authority.
   */
  async createIeltsPractice(input: IeltsPracticeWrite): Promise<IeltsPractice> {
    const { data: newId, error } = await this.client.rpc('os_ielts_log_practice', {
      p_skill: input.skill,
      p_source: input.source,
      p_attempted_on: input.attemptedOn,
      p_timed: input.timed,
      p_raw_score: input.rawScore ?? null,
      p_band: input.band ?? null,
      p_duration_minutes: input.durationMinutes ?? null,
      p_notes: input.notes ?? null,
      p_topics: input.topics.map((topic) => ({
        slug: topic.topicSlug,
        attempted: topic.attempted ?? null,
        missed: topic.missed ?? null,
        severity: topic.severity ?? null,
      })),
    });
    if (error) throw new Error(`createIeltsPractice failed: ${error.message}`);

    // Read the row back rather than reconstructing it: created_at and any
    // database-side coercion belong to the database, and the caller puts this
    // object straight into the list it renders.
    const { data, error: readError } = await this.client
      .from('os_ielts_practice')
      .select(IELTS_PRACTICE_COLUMNS)
      .eq('id', newId as string)
      .single();
    if (readError) throw new Error(`createIeltsPractice read-back failed: ${readError.message}`);
    return rowToIeltsPractice(data as IeltsPracticeRow);
  }

  async deleteIeltsPractice(id: string): Promise<void> {
    // The topic rows go with it via ON DELETE CASCADE.
    const { error } = await this.client.from('os_ielts_practice').delete().eq('id', id);
    if (error) throw new Error(`deleteIeltsPractice failed: ${error.message}`);
  }

  // --- finish line: the entity matrix ----------------------------------------
  //
  // EVERY READ HERE RETURNS A THREE-WAY RESULT, never an array. A missing
  // relation is still not a crash — the frontend ships before the migration is
  // applied — but it is no longer indistinguishable from an empty table.
  //
  // These reads feed cards that COUNT PROBLEMS. `0 milestones make no pack
  // line trustworthy — None` shipped to production while the truth was 458,
  // because a failed read became `[]` on the way out of this file. The fix is
  // here, in the return type, not in the cards. See readResult.ts.

  async listFinishLineItems(): Promise<ReadResult<FinishLineItem>> {
    const { data, error } = await this.client
      .from('os_finish_line_items')
      .select('id, item, kind, parent_id, sort_order, tag, unit, dp, agg, style, flag, blocks')
      .in('kind', ['section', 'metric', 'note'])
      .order('sort_order', { ascending: true });
    if (error) return readFailure('listFinishLineItems', error);
    return okRows((data as FinishLineItemRow[]).map(rowToFinishLineItem));
  }

  async listFinishLineEntities(): Promise<ReadResult<FinishLineEntity>> {
    const { data, error } = await this.client
      .from('os_finish_line_entities')
      .select('code, label, sort_order')
      .order('sort_order', { ascending: true });
    if (error) return readFailure('listFinishLineEntities', error);
    return okRows(
      (data as { code: string; label: string; sort_order: number }[]).map((row) => ({
        code: row.code,
        label: row.label,
        order: row.sort_order,
      })),
    );
  }

  async listFinishLineCells(): Promise<ReadResult<FinishLineCell>> {
    const { data, error } = await this.client
      .from('os_finish_line_cells')
      .select(FINISH_LINE_CELL_COLUMNS);
    if (error) return readFailure('listFinishLineCells', error);
    return okRows((data as FinishLineCellRow[]).map(rowToFinishLineCell));
  }

  async listFinishLineDeps(): Promise<ReadResult<FinishLineDep>> {
    const { data, error } = await this.client
      .from('os_finish_line_deps')
      .select('cell_id, input_id');
    if (error) return readFailure('listFinishLineDeps', error);
    return okRows(
      (data as { cell_id: string; input_id: string }[]).map((row) => ({
        cellId: row.cell_id,
        inputId: row.input_id,
      })),
    );
  }

  /**
   * READ ONLY, and there is no write counterpart anywhere in this class. The
   * workbook owns data_ideal, driver_type, driver_source, pic, business and
   * is_dummy; the app displays them. If a driver is wrong it is wrong in the
   * workbook, and adding an edit path here would create the second source of
   * truth this split exists to prevent.
   *
   * Unmapped accounts (cell_id null) are returned WITH the rest — filtering
   * them out here would understate the account population and make coverage
   * look better than it is.
   */
  async listFinishLineAccounts(): Promise<ReadResult<FinishLineAccount>> {
    const { data, error } = await this.client
      .from('os_finish_line_accounts')
      .select(
        'id, cell_id, entity_code, coa_entity, coa_consol, account_name, function, nature, business, is_dummy, driver_type, driver_source, data_ideal, pic, notes, sort_order, imported_at',
      )
      .order('sort_order', { ascending: true });
    if (error) return readFailure('listFinishLineAccounts', error);
    return okRows(
      (data as FinishLineAccountRow[]).map((row) => {
        const account: FinishLineAccount = {
          id: row.id,
          accountName: row.account_name,
          isDummy: row.is_dummy,
          order: row.sort_order,
          importedAt: toIso(row.imported_at),
        };
        if (row.cell_id) account.cellId = row.cell_id;
        if (row.entity_code) account.entityCode = row.entity_code;
        if (row.coa_entity) account.coaEntity = row.coa_entity;
        if (row.coa_consol) account.coaConsol = row.coa_consol;
        if (row.function) account.function = row.function;
        if (row.nature) account.nature = row.nature;
        if (row.business) account.business = row.business;
        if (row.driver_type) account.driverType = row.driver_type;
        if (row.driver_source) account.driverSource = row.driver_source;
        if (row.data_ideal) account.dataIdeal = row.data_ideal;
        if (row.pic) account.pic = row.pic;
        if (row.notes) account.notes = row.notes;
        return account;
      }),
    );
  }

  async applyFinishLineAccountPaste(input: {
    upserts: FinishLineAccountWrite[];
    deleteIds: string[];
  }): Promise<void> {
    const table = () => this.client.from('os_finish_line_accounts');
    const touchedAt = new Date().toISOString();

    // Deletes first (replace mode only), chunked: hundreds of ids in one
    // querystring would blow the URL limit, and a half-applied delete must
    // surface as the error it is rather than being retried blind.
    for (let i = 0; i < input.deleteIds.length; i += 50) {
      const chunk = input.deleteIds.slice(i, i + 50);
      const { error } = await table().delete().in('id', chunk);
      if (error) throw new Error(`account paste delete: ${error.message}`);
    }

    for (const row of input.upserts.filter((u) => u.id)) {
      const { error } = await table()
        .update({
          cell_id: row.cellId,
          entity_code: row.entityCode ?? null,
          coa_entity: row.coaEntity ?? null,
          coa_consol: row.coaConsol ?? null,
          account_name: row.accountName,
          function: row.function ?? null,
          nature: row.nature ?? null,
          business: row.business ?? null,
          is_dummy: row.isDummy,
          driver_type: row.driverType ?? null,
          driver_source: row.driverSource ?? null,
          data_ideal: row.dataIdeal ?? null,
          pic: row.pic ?? null,
          sort_order: row.sortOrder,
          // Touched rows only — untouched rows keep their stamp, so the
          // header's "imported {date}" stays honest per row.
          imported_at: touchedAt,
        })
        .eq('id', row.id!);
      if (error) throw new Error(`account paste update: ${error.message}`);
    }

    const inserts = input.upserts.filter((u) => !u.id);
    if (inserts.length > 0) {
      const { error } = await table().insert(
        inserts.map((row) => ({
          cell_id: row.cellId,
          entity_code: row.entityCode ?? null,
          coa_entity: row.coaEntity ?? null,
          coa_consol: row.coaConsol ?? null,
          account_name: row.accountName,
          function: row.function ?? null,
          nature: row.nature ?? null,
          business: row.business ?? null,
          is_dummy: row.isDummy,
          driver_type: row.driverType ?? null,
          driver_source: row.driverSource ?? null,
          data_ideal: row.dataIdeal ?? null,
          pic: row.pic ?? null,
          sort_order: row.sortOrder,
          imported_at: touchedAt,
        })),
      );
      if (error) throw new Error(`account paste insert: ${error.message}`);
    }
  }

  async listFinishLineAccountMap(): Promise<ReadResult<FinishLineAccountMapRow>> {
    const { data, error } = await this.client
      .from('os_finish_line_account_map')
      .select('id, function, business, item_id');
    if (error) return readFailure('listFinishLineAccountMap', error);
    return okRows(
      (data as FinishLineAccountMapRowShape[]).map((row) => ({
        id: row.id,
        function: row.function,
        business: row.business,
        itemId: row.item_id,
      })),
    );
  }

  async listFinishLineEdges(): Promise<ReadResult<FinishLineEdge>> {
    const { data, error } = await this.client
      .from('os_finish_line_item_projects')
      .select('id, cell_id, project_id, milestone_id')
      .not('cell_id', 'is', null);
    if (error) return readFailure('listFinishLineEdges', error);
    return okRows(
      (data as FinishLineEdgeRow[]).map((row) => {
        const edge: FinishLineEdge = {
          id: row.id,
          cellId: row.cell_id as string,
          projectId: row.project_id,
        };
        if (row.milestone_id) edge.milestoneId = row.milestone_id;
        return edge;
      }),
    );
  }

  async listDanglingLinks(): Promise<ReadResult<DanglingLink>> {
    const { data, error } = await this.client
      .from('os_finish_line_dangling_links')
      // Exactly the columns the view exposes. It carries no project title, so
      // the UI resolves the title from the project list it already has.
      .select('id, cell_id, project_id, milestone_id');
    if (error) return readFailure('listDanglingLinks', error);
    return okRows(
      (data as DanglingLinkRow[]).map((row) => {
        const link: DanglingLink = {
          id: row.id,
          projectId: row.project_id,
          milestoneId: row.milestone_id,
        };
        if (row.cell_id) link.cellId = row.cell_id;
        return link;
      }),
    );
  }

  async listOrphanMilestones(): Promise<ReadResult<OrphanMilestone>> {
    const { data, error } = await this.client
      .from('os_finish_line_orphan_milestones')
      .select('project_id, project_title, milestone_id, milestone_text, status');
    if (error) return readFailure('listOrphanMilestones', error);
    return okRows(
      (data as OrphanRow[]).map((row) => ({
        projectId: row.project_id,
        projectTitle: row.project_title,
        milestoneId: row.milestone_id,
        milestoneText: row.milestone_text ?? '',
        status: row.status ?? '',
      })),
    );
  }

  async setFinishLineCellState(
    cellId: string,
    state: CellState,
    origin: CellWriteOrigin,
  ): Promise<FinishLineCell> {
    // Both guards run BEFORE the request, in the mutation path — a UI-only
    // check would be bypassed by the first caller that forgot. The transition
    // guard needs the current state, so read it first; the read costs one
    // round trip and buys the failure arriving as a named guard error instead
    // of a PostgREST 400. The race between read and write is closed by the
    // database trigger, which re-checks the same table — the client is the
    // fast failure, never the boundary.
    const { data: current, error: readError } = await this.client
      .from('os_finish_line_cells')
      .select('state')
      .eq('id', cellId)
      .maybeSingle();
    if (readError) throw new Error(`setFinishLineCellState failed: ${readError.message}`);
    if (!current) throw new Error(`Cell not found: ${cellId}`);
    const checked = guardCellState(state, origin);
    guardCellTransition((current as { state: CellState }).state, checked, origin);
    // updated_at / changed_at / actor are all trigger-written now; a client
    // that sent them would only have its values overwritten.
    const { data, error } = await this.client
      .from('os_finish_line_cells')
      .update({ state: checked })
      .eq('id', cellId)
      .select(FINISH_LINE_CELL_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`setFinishLineCellState failed: ${error.message}`);
    if (!data) throw new Error(`Cell not found: ${cellId}`);
    return rowToFinishLineCell(data as FinishLineCellRow);
  }

  async setFinishLineCellNote(
    cellId: string,
    note: string | undefined,
  ): Promise<FinishLineCell> {
    const { data, error } = await this.client
      .from('os_finish_line_cells')
      .update({ note: guardCellNote(note) ?? null })
      .eq('id', cellId)
      .select(FINISH_LINE_CELL_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`setFinishLineCellNote failed: ${error.message}`);
    if (!data) throw new Error(`Cell not found: ${cellId}`);
    return rowToFinishLineCell(data as FinishLineCellRow);
  }

  /**
   * BULK BY DESIGN. Authoring one edge must never cost a form — if it does the
   * table stays at 0 rows, exactly as `timeblocks` did. The picker commits the
   * whole set for a cell in one operation: clear, then insert.
   */
  async setCellEdges(
    cellId: string,
    edges: { projectId: string; milestoneId?: string }[],
  ): Promise<void> {
    // §7.1 in the mutation path: only an `input` cell can carry a milestone
    // edge. Read the target's state first — the picker already filters, but a
    // UI-only rule is one refactor from gone.
    const { data: target, error: readError } = await this.client
      .from('os_finish_line_cells')
      .select('state')
      .eq('id', cellId)
      .maybeSingle();
    if (readError) throw new Error(`setCellEdges failed: ${readError.message}`);
    if (!target) throw new Error(`Cell not found: ${cellId}`);
    guardEdgeTarget((target as { state: CellState }).state);

    // A duplicate commit is a NO-OP AT THIS LAYER, not a caught 23505. The
    // unique constraint is the backstop; relying on it would mean every
    // unchanged re-commit made a round trip that failed on purpose.
    const { data: existingRows, error: existingError } = await this.client
      .from('os_finish_line_item_projects')
      .select('id, project_id, milestone_id')
      .eq('cell_id', cellId);
    if (existingError) throw new Error(`setCellEdges failed: ${existingError.message}`);

    const key = (projectId: string, milestoneId?: string | null) =>
      `${projectId}:${milestoneId ?? ''}`;
    const existing = new Map(
      (existingRows as { id: string; project_id: string; milestone_id: string | null }[]).map(
        (row) => [key(row.project_id, row.milestone_id), row.id],
      ),
    );
    const wanted = new Map(edges.map((edge) => [key(edge.projectId, edge.milestoneId), edge]));

    const toDelete = [...existing.entries()]
      .filter(([k]) => !wanted.has(k))
      .map(([, id]) => id);
    const toInsert = [...wanted.entries()]
      .filter(([k]) => !existing.has(k))
      .map(([, edge]) => edge);

    if (toDelete.length === 0 && toInsert.length === 0) return; // unchanged

    if (toDelete.length > 0) {
      const { error } = await this.client
        .from('os_finish_line_item_projects')
        .delete()
        .in('id', toDelete);
      if (error) throw new Error(`setCellEdges failed: ${error.message}`);
    }
    if (toInsert.length > 0) {
      const { error } = await this.client.from('os_finish_line_item_projects').insert(
        toInsert.map((edge) => ({
          cell_id: cellId,
          project_id: edge.projectId,
          milestone_id: edge.milestoneId ?? null,
        })),
      );
      if (error) throw new Error(`setCellEdges failed: ${error.message}`);
    }
  }

  /**
   * THE PRIMARY AUTHORING PATH: the cells one milestone closes.
   *
   * Anchored on the milestone rather than the cell because the arithmetic says
   * so — 136 linkable cells against the in-scope milestones, and one milestone
   * routinely makes the same line trustworthy across four entities plus a
   * derived percentage row. From the cell side that is six separate pickers;
   * from here it is six ticks in one commit.
   *
   * The same two rules as `setCellEdges`, both in the mutation path:
   * only a gap-eligible cell may carry an edge, and an unchanged commit is a
   * no-op rather than a delete-then-reinsert of identical rows.
   */
  async setMilestoneEdges(
    projectId: string,
    milestoneId: string,
    cellIds: string[],
  ): Promise<void> {
    // This guard was absent entirely on this path: the cell-anchored write
    // checked the target state and the milestone-anchored one did not, so the
    // rule held only for the picker that happened to be used.
    if (cellIds.length > 0) {
      const { data: targets, error: targetError } = await this.client
        .from('os_finish_line_cells')
        .select('id, state')
        .in('id', cellIds);
      if (targetError) throw new Error(`setMilestoneEdges failed: ${targetError.message}`);
      const found = new Map(
        (targets as { id: string; state: CellState }[]).map((row) => [row.id, row.state]),
      );
      for (const cellId of cellIds) {
        const state = found.get(cellId);
        if (!state) throw new Error(`Cell not found: ${cellId}`);
        guardEdgeTarget(state);
      }
    }

    const { data: existingRows, error: existingError } = await this.client
      .from('os_finish_line_item_projects')
      .select('id, cell_id')
      .eq('project_id', projectId)
      .eq('milestone_id', milestoneId);
    if (existingError) throw new Error(`setMilestoneEdges failed: ${existingError.message}`);

    // Idempotency is computed here. The unique constraint is the BACKSTOP, not
    // the mechanism — catching 23505 would mean every unchanged re-commit made
    // a round trip that failed on purpose.
    const existing = new Map(
      (existingRows as { id: string; cell_id: string | null }[])
        .filter((row) => row.cell_id)
        .map((row) => [row.cell_id as string, row.id]),
    );
    const wanted = new Set(cellIds);
    const toDelete = [...existing.entries()]
      .filter(([cellId]) => !wanted.has(cellId))
      .map(([, id]) => id);
    const toInsert = cellIds.filter((cellId) => !existing.has(cellId));
    if (toDelete.length === 0 && toInsert.length === 0) return; // unchanged

    if (toDelete.length > 0) {
      const { error } = await this.client
        .from('os_finish_line_item_projects')
        .delete()
        .in('id', toDelete);
      if (error) throw new Error(`setMilestoneEdges failed: ${error.message}`);
    }
    if (toInsert.length > 0) {
      const { error } = await this.client.from('os_finish_line_item_projects').insert(
        toInsert.map((cellId) => ({
          cell_id: cellId,
          project_id: projectId,
          milestone_id: milestoneId,
        })),
      );
      if (error) throw new Error(`setMilestoneEdges failed: ${error.message}`);
    }
  }

  // --- operational process (per entity) --------------------------------------
  //
  // Every read is a ReadResult: migrations 20260806000050/51 land AFTER this
  // frontend ships, so a missing os_process_* relation is the expected
  // pre-deploy state and must arrive as {ok: false, reason:
  // 'missing-relation'} — the process views render that as their ordinary
  // empty state. The structure is read-only in the app; the ONE write is
  // requested_on on a need, and nothing in this section touches
  // os_finish_line_cells.
  //
  // READ ABSENCE, NOT "MISSING RELATION" — the classifier here is deliberately
  // readAbsence and not readFailure. readFailure's predicate also swallows a
  // renamed column (42703) and an unresolvable embed (PGRST200) as "not
  // deployed yet", which would render a WRONG QUERY as an ordinary empty
  // state: no error, no console line, just zero. These tables are a diagram
  // plus a register, and a diagram that silently loses its register looks
  // finished. Only 42P01 and PGRST205 — the relation genuinely is not
  // there — fold to the empty state; everything else surfaces.
  //
  // THE ONE DELIBERATE 42703 EXCEPTION (§4.6 of the entity brief): this
  // frontend ships before migration 20260806000052 adds entity_code, and the
  // process tables EXIST AND ARE POPULATED with SAMB. A select naming
  // entity_code therefore fails with 42703 — which readAbsence rightly
  // surfaces as a failure everywhere else, and which HERE, for exactly these
  // four reads, means "the multi-entity migration has not been applied yet".
  // legacyEntityRead retries once with the pre-52 column list and tags every
  // row SAMB (the backfill value 52 will write), so the swimlane renders
  // SAMB exactly as before. The views learn the mode from listProcessTracks
  // returning missing-relation while steps carry rows, and say so in one
  // visible line. Once 52 is applied this branch is dead code; it must not
  // widen — any OTHER 42703 (a typo'd column, a half-applied 52) retries
  // with the legacy list, fails again with a DIFFERENT missing column, and
  // surfaces as the failure it is.

  /**
   * Runs the entity-aware select; on exactly undefined_column (42703) —
   * the pre-52 schema — retries the legacy select and tags rows with the
   * backfill entity. Never catches anything else.
   */
  private async legacyEntityRead<Row>(
    label: string,
    entityAware: () => PromiseLike<{ data: unknown; error: RelationError | null }>,
    legacy: () => PromiseLike<{ data: unknown; error: RelationError | null }>,
  ): Promise<ReadResult<Row & { entity_code: string }>> {
    const first = await entityAware();
    if (!first.error) {
      return okRows(first.data as (Row & { entity_code: string })[]);
    }
    if (first.error.code !== '42703') return readAbsence(label, first.error);
    const retry = await legacy();
    if (retry.error) return readAbsence(label, retry.error);
    return okRows(
      (retry.data as Row[]).map((row) => ({ ...row, entity_code: 'SAMB' })),
    );
  }

  async listProcessTracks(): Promise<ReadResult<ProcessTrackDef>> {
    // No legacy retry here: the table simply does not exist before 52, and
    // that absence (42P01/PGRST205 → missing-relation) is exactly the signal
    // the views use to recognise the pre-entity state.
    const { data, error } = await this.client
      .from('os_process_tracks')
      .select('entity_code, code, label, ordinal, is_shared')
      .order('ordinal', { ascending: true });
    if (error) return readAbsence('listProcessTracks', error);
    return okRows(
      (
        data as {
          entity_code: string;
          code: string;
          label: string;
          ordinal: number;
          is_shared: boolean;
        }[]
      ).map((row) => ({
        entityCode: row.entity_code,
        code: row.code,
        label: row.label,
        ordinal: row.ordinal,
        isShared: row.is_shared,
      })),
    );
  }

  /**
   * The form vocabulary — the second axis (20260820000086). Decoration for
   * the chip, never a filter: a failed or absent read degrades to no chips
   * (readAbsence, the references pattern), and the model does not fold on it.
   */
  async listProcessForms(): Promise<ReadResult<ProcessFormDef>> {
    const { data, error } = await this.client
      .from('os_process_forms')
      .select('entity_code, code, label, ordinal')
      .order('ordinal', { ascending: true });
    if (error) return readAbsence('listProcessForms', error);
    return okRows(
      (
        data as { entity_code: string; code: string; label: string; ordinal: number }[]
      ).map((row) => ({
        entityCode: row.entity_code,
        code: row.code,
        label: row.label,
        ordinal: row.ordinal,
      })),
    );
  }

  async listProcessLanes(): Promise<ReadResult<ProcessLane>> {
    const result = await this.legacyEntityRead<Omit<ProcessLaneRow, 'entity_code'>>(
      'listProcessLanes',
      () =>
        this.client
          .from('os_process_lanes')
          .select('entity_code, key, label, description, ordinal, is_external')
          .order('ordinal', { ascending: true }),
      () =>
        this.client
          .from('os_process_lanes')
          .select('key, label, description, ordinal, is_external')
          .order('ordinal', { ascending: true }),
    );
    if (!result.ok) return result;
    return okRows(result.rows.map(rowToProcessLane));
  }

  async listProcessPhases(): Promise<ReadResult<ProcessPhase>> {
    interface PhaseRow {
      id: string;
      name: string;
      slot_from: number;
      slot_to: number;
      track: string | null;
    }
    // `track` (20260820000086) rides the entity-aware select only; its
    // migration is applied before any frontend naming it deploys, so the
    // legacy retry below stays what it has always been: the pre-52 window.
    const result = await this.legacyEntityRead<Omit<PhaseRow, 'track'> & { track?: string | null }>(
      'listProcessPhases',
      () =>
        this.client
          .from('os_process_phases')
          .select('id, entity_code, name, slot_from, slot_to, track')
          .order('slot_from', { ascending: true }),
      () =>
        this.client
          .from('os_process_phases')
          .select('id, name, slot_from, slot_to')
          .order('slot_from', { ascending: true }),
    );
    if (!result.ok) return result;
    return okRows(
      result.rows.map((row) => {
        const phase: ProcessPhase = {
          id: row.id,
          entityCode: row.entity_code,
          name: row.name,
          slotFrom: row.slot_from,
          slotTo: row.slot_to,
        };
        if (row.track) phase.track = row.track;
        return phase;
      }),
    );
  }

  async listProcessSteps(): Promise<ReadResult<ProcessStep>> {
    // The retry deliberately uses the FROZEN pre-52 list: a pre-52 table has
    // neither entity_code nor form, and rowToProcessStep treats the absent
    // form like an empty one.
    const result = await this.legacyEntityRead<
      Omit<ProcessStepRow, 'entity_code' | 'form'> & { form?: string | null }
    >(
      'listProcessSteps',
      () =>
        this.client
          .from('os_process_steps')
          .select(`entity_code, ${PROCESS_STEP_COLUMNS}`)
          .order('slot', { ascending: true }),
      () =>
        this.client
          .from('os_process_steps')
          .select(LEGACY_PROCESS_STEP_COLUMNS)
          .order('slot', { ascending: true }),
    );
    if (!result.ok) return result;
    return okRows(result.rows.map(rowToProcessStep));
  }

  async listProcessGates(): Promise<ReadResult<ProcessGate>> {
    const result = await this.legacyEntityRead<Omit<ProcessGateRow, 'entity_code'>>(
      'listProcessGates',
      () =>
        this.client
          .from('os_process_gates')
          .select('id, entity_code, type, title, sub, owner, unblock')
          .order('id', { ascending: true }),
      () =>
        this.client
          .from('os_process_gates')
          .select('id, type, title, sub, owner, unblock')
          .order('id', { ascending: true }),
    );
    if (!result.ok) return result;
    return okRows(result.rows.map(rowToProcessGate));
  }

  async listProcessNeeds(): Promise<ReadResult<ProcessNeed>> {
    const { data, error } = await this.client
      .from('os_process_needs')
      .select(PROCESS_NEED_COLUMNS);
    if (error) return readAbsence('listProcessNeeds', error);
    return okRows((data as ProcessNeedRow[]).map(rowToProcessNeed));
  }

  async listProcessStepItems(): Promise<ReadResult<ProcessStepItem>> {
    const { data, error } = await this.client
      .from('os_process_step_items')
      .select('step_id, item_id');
    if (error) return readAbsence('listProcessStepItems', error);
    return okRows(
      (data as { step_id: string; item_id: string }[]).map((row) => ({
        stepId: row.step_id,
        itemId: row.item_id,
      })),
    );
  }

  async setProcessNeedRequestedOn(id: string, requestedOn: string | null): Promise<ProcessNeed> {
    const { data, error } = await this.client
      .from('os_process_needs')
      .update({ requested_on: requestedOn })
      .eq('id', id)
      .select(PROCESS_NEED_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`setProcessNeedRequestedOn failed: ${error.message}`);
    if (!data) throw new Error(`Need not found: ${id}`);
    return rowToProcessNeed(data as ProcessNeedRow);
  }

  /**
   * The reading list. readAbsence like every process read, and the view maps
   * missing-relation to "render nothing" — the pre-apply state for migration
   * 20260806000054 is simply a page without the block.
   */
  async listProcessReferences(): Promise<ReadResult<ProcessReference>> {
    const { data, error } = await this.client
      .from('os_process_references')
      .select('id, title, url, note, sort_order')
      .order('sort_order', { ascending: true });
    if (error) return readAbsence('listProcessReferences', error);
    return okRows(
      (data as { id: string; title: string; url: string; note: string | null; sort_order: number }[]).map(
        (row) => {
          const reference: ProcessReference = {
            id: row.id,
            title: row.title,
            url: row.url,
            sortOrder: row.sort_order,
          };
          if (row.note) reference.note = row.note;
          return reference;
        },
      ),
    );
  }

  // --- process TEXT writes (structure stays migration-only) -----------------
  //
  // Each patch is typed by logic/processTextEdit.ts, which cannot name label,
  // slot, lane_key, track, entity_code or any id — so the column list below is
  // the whole writable surface and no caller can widen it. Lanes are keyed by
  // the composite (entity_code, key) that migration 52 made the PK.

  async updateProcessStepText(id: string, patch: ProcessStepTextWrite): Promise<ProcessStep> {
    const { data, error } = await this.client
      .from('os_process_steps')
      .update({
        name: patch.name,
        co: patch.co,
        risk: patch.risk,
        control: patch.control,
        note: patch.note,
        gate_id: patch.gateId,
        docs: patch.docs,
        coa: patch.coa,
        drivers: patch.drivers,
      })
      .eq('id', id)
      .select(`entity_code, ${PROCESS_STEP_COLUMNS}`)
      .maybeSingle();
    if (error) throw new Error(`updateProcessStepText failed: ${error.message}`);
    if (!data) throw new Error(`Step not found: ${id}`);
    return rowToProcessStep(data as ProcessStepRow);
  }

  async updateProcessNeedText(id: string, patch: ProcessNeedTextWrite): Promise<ProcessNeed> {
    const { data, error } = await this.client
      .from('os_process_needs')
      .update({
        item: patch.item,
        kind: patch.kind,
        src: patch.src,
        owner: patch.owner,
        status: patch.status,
        requested_on: patch.requestedOn,
      })
      .eq('id', id)
      .select(PROCESS_NEED_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`updateProcessNeedText failed: ${error.message}`);
    if (!data) throw new Error(`Need not found: ${id}`);
    return rowToProcessNeed(data as ProcessNeedRow);
  }

  async updateProcessGateText(id: string, patch: ProcessGateTextWrite): Promise<ProcessGate> {
    const { data, error } = await this.client
      .from('os_process_gates')
      .update({
        title: patch.title,
        sub: patch.sub,
        owner: patch.owner,
        unblock: patch.unblock,
      })
      .eq('id', id)
      .select('id, entity_code, type, title, sub, owner, unblock')
      .maybeSingle();
    if (error) throw new Error(`updateProcessGateText failed: ${error.message}`);
    if (!data) throw new Error(`Gate not found: ${id}`);
    return rowToProcessGate(data as ProcessGateRow);
  }

  async updateProcessLaneText(
    entityCode: string,
    key: string,
    patch: ProcessLaneTextWrite,
  ): Promise<ProcessLane> {
    const { data, error } = await this.client
      .from('os_process_lanes')
      .update({ label: patch.label, description: patch.description })
      .eq('entity_code', entityCode)
      .eq('key', key)
      .select('entity_code, key, label, description, ordinal, is_external')
      .maybeSingle();
    if (error) throw new Error(`updateProcessLaneText failed: ${error.message}`);
    if (!data) throw new Error(`Lane not found: ${entityCode}/${key}`);
    return rowToProcessLane(data as ProcessLaneRow);
  }

  async updateProcessPhaseText(id: string, patch: ProcessPhaseTextWrite): Promise<ProcessPhase> {
    const { data, error } = await this.client
      .from('os_process_phases')
      .update({ name: patch.name })
      .eq('id', id)
      .select('id, entity_code, name, slot_from, slot_to')
      .maybeSingle();
    if (error) throw new Error(`updateProcessPhaseText failed: ${error.message}`);
    if (!data) throw new Error(`Phase not found: ${id}`);
    const row = data as { id: string; entity_code: string; name: string; slot_from: number; slot_to: number };
    return {
      id: row.id,
      entityCode: row.entity_code,
      name: row.name,
      slotFrom: row.slot_from,
      slotTo: row.slot_to,
    };
  }

  /**
   * The audit append. A MISSING RELATION IS NOT AN ERROR HERE: this ships
   * before migration 20260806000055, and an edit must not be lost because its
   * log could not be written. Anything else still throws — a permission or
   * network failure on the log is worth knowing about, and by then the edit
   * itself has already been saved.
   */
  async appendProcessTextHistory(rows: TextHistoryRow[]): Promise<boolean> {
    if (rows.length === 0) return true;
    const { error } = await this.client.from('os_process_text_history').insert(
      rows.map((row) => ({
        table_name: row.tableName,
        row_id: row.rowId,
        field: row.field,
        old_value: row.oldValue,
        new_value: row.newValue,
      })),
    );
    if (!error) return true;
    if (isAbsentRelation(error)) return false;
    throw new Error(`appendProcessTextHistory failed: ${error.message}`);
  }

  // --- tasks + the project-membership axis (slice 1) ------------------------
  //
  // NO CLIENT-SIDE VISIBILITY FILTERING anywhere in this section: for a
  // collaborator JWT the reads come back scoped by RLS (granted projects
  // only) and every write is judged by the os_tasks write-guard trigger. The
  // client's guard is the ProjectTaskWrite type, which cannot even name a
  // non-allowlisted column — the fast failure; the trigger is the boundary.
  // There is deliberately no delete method — see the Repository interface.

  async listProjectTasks(projectId?: string): Promise<ReadResult<ProjectTask>> {
    let query = this.client.from('os_tasks').select(PROJECT_TASK_COLUMNS);
    if (projectId) query = query.eq('project_id', projectId);
    const { data, error } = await query
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return readFailure('listProjectTasks', error);
    return okRows((data as ProjectTaskRow[]).map(rowToProjectTask));
  }

  async createProjectTask(input: {
    projectId: string;
    title: string;
    detail?: string;
    status?: TaskStatus;
    dueDate?: string;
    assignee?: string;
    sortOrder?: number;
  }): Promise<ProjectTask> {
    const { data, error } = await this.client
      .from('os_tasks')
      .insert({
        project_id: input.projectId,
        title: input.title,
        detail: input.detail ?? '',
        status: input.status ?? 'open',
        due_date: input.dueDate ?? null,
        assignee: input.assignee ?? null,
        sort_order: input.sortOrder ?? 0,
        // created_by* / actor* / changed_at / created_at are trigger-written;
        // anything sent for them is overwritten server-side.
      })
      .select(PROJECT_TASK_COLUMNS)
      .single();
    if (error) throw new Error(`createProjectTask failed: ${error.message}`);
    return rowToProjectTask(data as ProjectTaskRow);
  }

  async updateProjectTask(id: string, patch: ProjectTaskWrite): Promise<ProjectTask> {
    const row: Record<string, unknown> = {};
    if ('title' in patch && patch.title !== undefined) row.title = patch.title;
    if ('detail' in patch && patch.detail !== undefined) row.detail = patch.detail;
    if ('status' in patch && patch.status !== undefined) row.status = patch.status;
    if ('dueDate' in patch) row.due_date = patch.dueDate ?? null;
    if ('assignee' in patch) row.assignee = patch.assignee ?? null;
    if ('sortOrder' in patch && patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
    if (Object.keys(row).length === 0) {
      const { data, error } = await this.client
        .from('os_tasks')
        .select(PROJECT_TASK_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`updateProjectTask failed: ${error.message}`);
      if (!data) throw new Error(`Task not found: ${id}`);
      return rowToProjectTask(data as ProjectTaskRow);
    }
    const { data, error } = await this.client
      .from('os_tasks')
      .update(row)
      .eq('id', id)
      .select(PROJECT_TASK_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`updateProjectTask failed: ${error.message}`);
    // A task in a non-granted project is invisible to a member: zero rows
    // matched, exactly as cross-entity cells read. Same message both ways.
    if (!data) throw new Error(`Task not found: ${id}`);
    return rowToProjectTask(data as ProjectTaskRow);
  }

  async listProjectMembers(): Promise<ReadResult<ProjectMember>> {
    // The owner reads every grant; a member's JWT reads exactly their own
    // rows. Both are RLS outcomes of the same query.
    const { data, error } = await this.client
      .from('os_project_members')
      .select('user_id, project_id, role, created_at, created_by')
      .order('created_at', { ascending: true });
    if (error) return readFailure('listProjectMembers', error);
    return okRows((data as ProjectMemberRow[]).map(rowToProjectMember));
  }

  async grantProjectMembership(userId: string, projectId: string): Promise<void> {
    // Owner-only via the app-key INSERT policy; a JWT caller gets an RLS
    // rejection here, never a row. created_by records the passphrase path,
    // which carries no uid — the literal 'owner', as on cell attribution.
    const { error } = await this.client
      .from('os_project_members')
      .upsert(
        { user_id: userId, project_id: projectId, created_by: 'owner' },
        { onConflict: 'user_id,project_id' },
      );
    if (error) throw new Error(`grantProjectMembership failed: ${error.message}`);
  }

  async revokeProjectMembership(userId: string, projectId: string): Promise<void> {
    // Revocation is the delete of one grant row; the member's next query
    // reads zero. The auth user stays — task attribution keeps its actor.
    const { error } = await this.client
      .from('os_project_members')
      .delete()
      .eq('user_id', userId)
      .eq('project_id', projectId);
    if (error) throw new Error(`revokeProjectMembership failed: ${error.message}`);
  }

  // --- the collaborator trail: four audit reads -----------------------------
  //
  // Owner-only, enforced by RLS rather than by anything here: none of these
  // four tables carries a member policy, so a collaborator's client reads zero
  // rows from each. Read-only by construction — there is no write method in
  // this section, and none of the four tables has an UPDATE or DELETE policy.
  //
  // Every one classifies with readAbsence, NOT readFailure. These tables are
  // an audit trail: a wrong query rendering as "no activity" would say nobody
  // touched anything, which is the single failure this project keeps paying
  // for. Only a genuinely absent relation (42P01 / PGRST205) folds to the
  // empty state.

  /**
   * The stored links. 42P01 until migration 20260809000071 is applied, which
   * the panel reads as "nothing stored" and falls back to its tab-local copy —
   * NOT as an error, because that is the expected state while this ships first.
   *
   * A 42703 from here would mean the table exists and a column does not, which
   * is a broken query rather than a missing feature, and readAbsence surfaces
   * it. The two are not folded together.
   */
  async listCollabLinks(): Promise<ReadResult<CollabLink>> {
    const { data, error } = await this.client
      .from('os_collab_links')
      .select('user_id, link, created_at, expires_at, used_at');
    if (error) return readAbsence('listCollabLinks', error);
    return okRows(
      (
        data as {
          user_id: string;
          link: string;
          created_at: string;
          expires_at: string | null;
          used_at: string | null;
        }[]
      ).map((row) => ({
        userId: row.user_id,
        link: row.link,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        usedAt: row.used_at,
      })),
    );
  }

  async listSignInLog(): Promise<ReadResult<SignInEvent>> {
    // 42P01 until migration 20260809000070 is applied, which is the expected
    // state while the frontend is live and the migration is not. The card
    // reads that as "the log section does not render" — see CollaboratorCard.
    const { data, error } = await this.client
      .from('os_sign_in_log')
      .select('user_id, signed_in_at')
      .order('signed_in_at', { ascending: false });
    if (error) return readAbsence('listSignInLog', error);
    return okRows(
      (data as { user_id: string; signed_in_at: string }[]).map((row) => ({
        userId: row.user_id,
        signedInAt: row.signed_in_at,
      })),
    );
  }

  async listCellHistory(): Promise<ReadResult<CellHistoryEntry>> {
    const { data, error } = await this.client
      .from('os_finish_line_cell_history')
      .select('id, cell_id, from_state, to_state, note_changed, actor_kind, actor, changed_at')
      .order('changed_at', { ascending: false });
    if (error) return readAbsence('listCellHistory', error);
    return okRows(
      (
        data as {
          id: string;
          cell_id: string;
          from_state: string | null;
          to_state: string | null;
          note_changed: boolean;
          actor_kind: string;
          actor: string | null;
          changed_at: string;
        }[]
      ).map((row) => ({
        id: row.id,
        cellId: row.cell_id,
        fromState: row.from_state,
        toState: row.to_state,
        noteChanged: row.note_changed,
        actorKind: row.actor_kind,
        actor: row.actor,
        changedAt: row.changed_at,
      })),
    );
  }

  async listTaskHistory(): Promise<ReadResult<TaskHistoryEntry>> {
    const { data, error } = await this.client
      .from('os_task_history')
      .select('id, task_id, field, from_value, to_value, actor_kind, actor, changed_at')
      .order('changed_at', { ascending: false });
    if (error) return readAbsence('listTaskHistory', error);
    return okRows(
      (
        data as {
          id: string;
          task_id: string;
          field: string;
          from_value: string;
          to_value: string;
          actor_kind: string;
          actor: string | null;
          changed_at: string;
        }[]
      ).map((row) => ({
        id: row.id,
        taskId: row.task_id,
        field: row.field,
        fromValue: row.from_value,
        toValue: row.to_value,
        actorKind: row.actor_kind,
        actor: row.actor,
        changedAt: row.changed_at,
      })),
    );
  }

  /**
   * ===========================================================================
   * THE ONE 42703 RETRY IN THIS SECTION, AND WHY IT IS NOT A WIDENED GUARD.
   * ===========================================================================
   * TWO DIFFERENT NOT-YET STATES EXIST FOR THIS TABLE AND THEY ARE HANDLED
   * SEPARATELY, on purpose:
   *
   *   42P01  the table itself is absent. Not possible today — 20260806000055
   *          is applied — but it stays classified as missing-relation, and it
   *          is the ONLY code that does.
   *   42703  the table is there and POPULATED, and actor_kind/actor are not,
   *          because migration 20260809000069 has not run yet. That is a
   *          different fact and gets a different answer: read the row without
   *          the pair and mark it unattributed, so the edit still appears in
   *          the trail.
   *
   * Folding 42703 into the missing-relation branch would have hidden real
   * edits behind an empty state, which is the failure mode isAbsentRelation
   * exists to prevent. So the retry is exact and narrow — the SAME shape as
   * legacyEntityRead above and for the same reason. It fires on 42703 alone;
   * anything else, including a second failure from the retry itself, surfaces.
   * Once 69 is applied this branch is dead code and must not widen.
   */
  async listProcessTextHistory(): Promise<ReadResult<ProcessTextHistoryEntry>> {
    type Row = {
      id: string;
      table_name: string;
      row_id: string;
      field: string;
      changed_at: string;
      actor_kind?: string | null;
      actor?: string | null;
    };
    const WITH_ACTOR = 'id, table_name, row_id, field, changed_at, actor_kind, actor';
    const WITHOUT_ACTOR = 'id, table_name, row_id, field, changed_at';
    const toEntry = (row: Row): ProcessTextHistoryEntry => ({
      id: row.id,
      tableName: row.table_name,
      rowId: row.row_id,
      field: row.field,
      actorKind: row.actor_kind ?? null,
      actor: row.actor ?? null,
      changedAt: row.changed_at,
    });

    const first = await this.client
      .from('os_process_text_history')
      .select(WITH_ACTOR)
      .order('changed_at', { ascending: false });
    if (!first.error) return okRows((first.data as Row[]).map(toEntry));
    if (first.error.code !== '42703') {
      return readAbsence('listProcessTextHistory', first.error);
    }
    const retry = await this.client
      .from('os_process_text_history')
      .select(WITHOUT_ACTOR)
      .order('changed_at', { ascending: false });
    if (retry.error) return readAbsence('listProcessTextHistory', retry.error);
    return okRows((retry.data as Row[]).map(toEntry));
  }

  // --- share links ---------------------------------------------------------
  //
  // All four go through SECURITY DEFINER functions rather than the table:
  // private.os_share_links is not exposed by PostgREST, and the functions gate
  // on os_key_valid() alone. The read-only key satisfies SELECT on every
  // public table and is refused by every one of these, in the database.
  //
  // The digest is taken inside os_share_link_create, so nothing on this side
  // can store a raw token even by mistake — the same arrangement as the
  // recovery tokens.

  async listShareLinks(): Promise<ReadResult<ShareLink>> {
    const { data, error } = await this.client.rpc('os_share_links_list');
    if (error) return readFailure('listShareLinks', error);
    return okRows((data as ShareLinkPayload[]).map(rowToShareLink));
  }

  async createShareLink(input: {
    token: string;
    view: ShareView;
    scope: ShareScope;
    label?: string;
    ttlDays: number;
  }): Promise<ShareLink> {
    const { data, error } = await this.client.rpc('os_share_link_create', {
      p_token: input.token,
      p_view: input.view,
      p_scope: input.scope,
      p_label: input.label ?? null,
      // Days, not a date. The expiry is computed by the server clock, so a
      // caller cannot mint a decade-long link by sending a decade-long date.
      p_ttl_days: input.ttlDays,
    });
    if (error) throw new Error(`createShareLink failed: ${error.message}`);
    return rowToShareLink(data as ShareLinkPayload);
  }

  async revokeShareLink(id: string): Promise<ShareLink> {
    const { data, error } = await this.client.rpc('os_share_link_revoke', { p_id: id });
    if (error) throw new Error(`revokeShareLink failed: ${error.message}`);
    return rowToShareLink(data as ShareLinkPayload);
  }

  async extendShareLink(id: string, ttlDays: number): Promise<ShareLink> {
    const { data, error } = await this.client.rpc('os_share_link_extend', {
      p_id: id,
      p_ttl_days: ttlDays,
    });
    if (error) throw new Error(`extendShareLink failed: ${error.message}`);
    return rowToShareLink(data as ShareLinkPayload);
  }
}

// --- finish line row shapes -------------------------------------------------

interface FinishLineItemRow {
  id: string;
  item: string;
  kind: FinishLineKind;
  parent_id: string | null;
  sort_order: number;
  tag: string | null;
  unit: string | null;
  dp: number | null;
  agg: FinishLineAgg | null;
  style: FinishLineStyle | null;
  flag: string | null;
  blocks: string | null;
}

interface FinishLineCellRow {
  id: string;
  item_id: string;
  entity_code: string;
  state: CellState;
  note: string | null;
  // Attribution, added by migration 20260804000039 and written only by the
  // database trigger. Possibly-absent so a read against a database that has
  // not run the migration still parses.
  actor_kind?: CellActorKind | null;
  actor?: string | null;
  changed_at?: string | null;
}

const FINISH_LINE_CELL_COLUMNS =
  'id, item_id, entity_code, state, note, actor_kind, actor, changed_at';

// --- tasks + membership row shapes ------------------------------------------

interface ProjectTaskRow {
  id: string;
  project_id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  due_date: string | null;
  assignee: string | null;
  sort_order: number;
  created_at: string;
  created_by_kind: CellActorKind;
  created_by: string | null;
  actor_kind: CellActorKind;
  actor: string | null;
  changed_at: string | null;
}

const PROJECT_TASK_COLUMNS =
  'id, project_id, title, detail, status, due_date, assignee, sort_order, created_at, created_by_kind, created_by, actor_kind, actor, changed_at';

function rowToProjectTask(row: ProjectTaskRow): ProjectTask {
  const task: ProjectTask = {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: toIso(row.created_at),
    createdByKind: row.created_by_kind,
    actorKind: row.actor_kind,
  };
  if (row.due_date) task.dueDate = row.due_date;
  if (row.assignee) task.assignee = row.assignee;
  if (row.created_by) task.createdBy = row.created_by;
  if (row.actor) task.actor = row.actor;
  if (row.changed_at) task.changedAt = toIso(row.changed_at);
  return task;
}

interface ProjectMemberRow {
  user_id: string;
  project_id: string;
  role: 'contributor';
  created_at: string;
  created_by: string;
}

function rowToProjectMember(row: ProjectMemberRow): ProjectMember {
  return {
    userId: row.user_id,
    projectId: row.project_id,
    role: row.role,
    createdAt: toIso(row.created_at),
    createdBy: row.created_by,
  };
}

interface FinishLineEdgeRow {
  id: string;
  cell_id: string | null;
  project_id: string;
  milestone_id: string | null;
}

interface FinishLineAccountRow {
  id: string;
  /** Null ⇒ unmapped. Kept, never filtered. */
  cell_id: string | null;
  entity_code: string | null;
  coa_entity: string | null;
  coa_consol: string | null;
  account_name: string;
  function: string | null;
  nature: string | null;
  business: string | null;
  is_dummy: boolean;
  driver_type: string | null;
  driver_source: string | null;
  data_ideal: string | null;
  pic: string | null;
  notes: string | null;
  sort_order: number;
  imported_at: string;
}

interface FinishLineAccountMapRowShape {
  id: string;
  function: string;
  business: string;
  item_id: string;
}

interface DanglingLinkRow {
  id: string;
  cell_id: string | null;
  project_id: string;
  milestone_id: string;
}

interface OrphanRow {
  project_id: string;
  project_title: string;
  milestone_id: string;
  milestone_text: string | null;
  status: string | null;
}

function rowToFinishLineItem(row: FinishLineItemRow): FinishLineItem {
  const item: FinishLineItem = {
    id: row.id,
    item: row.item,
    kind: row.kind,
    order: row.sort_order,
  };
  // Nulls are dropped rather than carried, matching rowToProject.
  if (row.parent_id) item.parentId = row.parent_id;
  if (row.tag) item.tag = row.tag;
  if (row.unit) item.unit = row.unit;
  if (row.dp !== null) item.dp = row.dp;
  if (row.agg) item.agg = row.agg;
  if (row.style) item.style = row.style;
  if (row.flag) item.flag = row.flag;
  if (row.blocks) item.blocks = row.blocks;
  return item;
}

function rowToFinishLineCell(row: FinishLineCellRow): FinishLineCell {
  const cell: FinishLineCell = {
    id: row.id,
    itemId: row.item_id,
    entityCode: row.entity_code,
    state: row.state,
  };
  if (row.note) cell.note = row.note;
  if (row.actor_kind) cell.actorKind = row.actor_kind;
  if (row.actor) cell.actor = row.actor;
  if (row.changed_at) cell.changedAt = toIso(row.changed_at);
  return cell;
}

// --- SAMB operational process rows -----------------------------------------

interface ProcessLaneRow {
  entity_code: string;
  key: string;
  label: string;
  description: string | null;
  ordinal: number;
  is_external: boolean;
}

function rowToProcessLane(row: ProcessLaneRow): ProcessLane {
  const lane: ProcessLane = {
    entityCode: row.entity_code,
    key: row.key,
    label: row.label,
    ordinal: row.ordinal,
    isExternal: row.is_external,
  };
  if (row.description) lane.description = row.description;
  return lane;
}

interface ProcessStepRow {
  id: string;
  entity_code: string;
  label: string;
  slot: number;
  lane_key: string;
  co: string | null;
  track: ProcessTrack;
  name: string;
  risk: string | null;
  control: string | null;
  note: string | null;
  gate_id: string | null;
  /** Optional: the legacy (pre-52) select never asks for it. */
  form?: string | null;
  docs: string[] | null;
  coa: ProcessCoaRef[] | null;
  drivers: string[] | null;
}

// `form` (20260820000086) rides the entity-aware select only — its migration
// is applied before any frontend that names it deploys, so no 42703 window
// exists and the §4.6 legacy exception stays exactly as narrow as it is.
const PROCESS_STEP_COLUMNS =
  'id, label, slot, lane_key, co, track, form, name, risk, control, note, gate_id, docs, coa, drivers';

// The legacy retry's list is FROZEN at the pre-52 table shape. It must never
// gain a column that postdates 52 (form is 86): the retry exists to serve a
// database where entity_code is missing, and asking THAT table for form
// would turn the documented SAMB fallback into a second 42703 — a hard
// failure where the fallback used to render. Caught in review of #100.
const LEGACY_PROCESS_STEP_COLUMNS =
  'id, label, slot, lane_key, co, track, name, risk, control, note, gate_id, docs, coa, drivers';

function rowToProcessStep(row: ProcessStepRow): ProcessStep {
  const step: ProcessStep = {
    id: row.id,
    entityCode: row.entity_code,
    label: row.label,
    slot: row.slot,
    laneKey: row.lane_key,
    track: row.track,
    name: row.name,
    docs: row.docs ?? [],
    coa: row.coa ?? [],
    drivers: row.drivers ?? [],
  };
  // Empty strings in the seed mean absent; dropped like nulls, matching
  // rowToProject.
  if (row.co) step.co = row.co;
  if (row.risk) step.risk = row.risk;
  if (row.control) step.control = row.control;
  if (row.note) step.note = row.note;
  if (row.gate_id) step.gateId = row.gate_id;
  if (row.form) step.form = row.form;
  return step;
}

interface ProcessGateRow {
  id: string;
  entity_code: string | null;
  type: ProcessGateType;
  title: string;
  sub: string | null;
  owner: string | null;
  unblock: string | null;
}

function rowToProcessGate(row: ProcessGateRow): ProcessGate {
  const gate: ProcessGate = { id: row.id, type: row.type, title: row.title };
  if (row.entity_code) gate.entityCode = row.entity_code;
  if (row.sub) gate.sub = row.sub;
  if (row.owner) gate.owner = row.owner;
  if (row.unblock) gate.unblock = row.unblock;
  return gate;
}

interface ProcessNeedRow {
  id: string;
  step_id: string;
  item: string;
  kind: ProcessNeedKind;
  src: string | null;
  owner: string | null;
  status: ProcessNeedStatus;
  requested_on: string | null;
}

const PROCESS_NEED_COLUMNS = 'id, step_id, item, kind, src, owner, status, requested_on';

function rowToProcessNeed(row: ProcessNeedRow): ProcessNeed {
  const need: ProcessNeed = {
    id: row.id,
    stepId: row.step_id,
    item: row.item,
    kind: row.kind,
    status: row.status,
  };
  if (row.src) need.src = row.src;
  if (row.owner) need.owner = row.owner;
  if (row.requested_on) need.requestedOn = row.requested_on;
  return need;
}

// --- share links ------------------------------------------------------------

/**
 * What the os_share_link_* functions return. jsonb rather than a row set, and
 * already camelCased on the database side, so there is no second mapping layer
 * to keep in step — see the note in 20260731000036_share_links.sql.
 *
 * There is no token_hash field, by construction rather than by omission here:
 * the functions never select it. A digest cannot be turned back into a link,
 * so shipping one to the browser would put a credential-shaped string in a
 * page that has no use for it.
 */
interface ShareLinkPayload {
  id: string;
  view: ShareView;
  scope: ShareScope | null;
  label: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

function rowToShareLink(row: ShareLinkPayload): ShareLink {
  const link: ShareLink = {
    id: row.id,
    view: row.view,
    scope: row.scope ?? {},
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
  if (row.label) link.label = row.label;
  if (row.revokedAt) link.revokedAt = row.revokedAt;
  if (row.lastSeenAt) link.lastSeenAt = row.lastSeenAt;
  return link;
}

export type SharedViewResult =
  | { ok: true; view: SharedView }
  | { ok: false; reason: string };

/**
 * Redeems a share token.
 *
 * Deliberately NOT a Repository method and deliberately not using a Supabase
 * client: the page that calls this holds a token and nothing else — no app
 * key, no session, no repository — and giving it a client would give it a
 * surface that could be pointed at a table. It posts a token and receives one
 * view's data, and that is the whole of its capability.
 *
 * The anon key still travels, as it does for every function call: it is in the
 * public bundle and is not authorization. The token is the credential, and it
 * is checked — with its expiry and its revocation — on the server, on every
 * request.
 *
 * Nothing about the scope is sent. There is no argument here through which a
 * caller could ask for a different entity, which is what makes the boundary
 * hold: the filter comes from the token's own record, server-side.
 */
export async function fetchSharedView(token: string): Promise<SharedViewResult> {
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, reason: 'unavailable' };
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/share-view`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  let body: { ok?: boolean; reason?: string } & Partial<SharedView>;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!body?.ok || !body.data || !body.view) {
    return { ok: false, reason: body?.reason ?? 'unavailable' };
  }
  return {
    ok: true,
    view: {
      view: body.view,
      scope: body.scope ?? {},
      expiresAt: body.expiresAt ?? '',
      data: body.data,
    },
  };
}
