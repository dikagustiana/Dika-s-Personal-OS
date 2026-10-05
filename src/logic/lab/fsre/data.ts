/**
 * FSRE BUILDING — THE INPUT FILES, VALIDATED AND NORMALISED.
 *
 * The source app cast its JSON to types (`as unknown as`) and trusted it.
 * Here every file goes through a zod schema, and what comes out is the core's
 * own shape (FsreRun). Two generations of file are accepted:
 *
 *   PROVISIONAL (today, src/data/fsre/): figures as flat numeric payload
 *   fields, a single `company`, `ticker` always set, `at: null`, a top-level
 *   `figures` block and a `partnerQueue`.
 *
 *   EXPORT (brief 04 / mount report §3.3): `payload.figures`, `ticker: null`
 *   for run-level proposals, ISO `at`, `stage_returned` / `stage_blocked`,
 *   and router stage ids (selected, doc_plan, intake, gate1, …).
 *
 * What is deliberately DROPPED on the way in: the replay's top-level
 * `figures`, `archetypes` and `partnerQueue`. They are static numbers and
 * items written beside the events, and the building is a pure function of
 * events (rule 1): the source read them straight into four surfaces, so at
 * cursor 0 its wall counter already said "10.142 Facts". Nothing downstream
 * of this module can reach them.
 *
 * Provenance travels with the run: each file's `provisional` flag and
 * `source` are kept so the screen can say WHICH file is provisional. A file
 * that does not state the flag is treated as provisional, and the note says
 * the flag was absent — an export that wants to read as final has to say so.
 */
import { z } from 'zod';
import { FSRE_EVENT_KINDS, type FsreEvent, type FsreFigure, type FsrePayload } from './events';
import type { FsreFileKey } from './statuses';

/* ---------- normalised shapes (what the core consumes) ---------- */

export interface FsreStage {
  id: string;
  name: string;
  order: number;
  /** Skills that run the stage; the first is its runner. */
  skills: string[];
}

export interface FsreSkill {
  name: string;
  role: string;
}

export interface FsreProvenance {
  file: FsreFileKey;
  fileName: string;
  provisional: boolean;
  /** False when the file did not carry a `provisional` flag at all. */
  stated: boolean;
  source: string | null;
}

export interface FsreRun {
  id: string;
  label: string;
  /** In pipeline order. */
  stages: FsreStage[];
  skills: FsreSkill[];
  /** Ticker → company name, where a file names one. Names, never figures. */
  companyNames: Record<string, string>;
  events: FsreEvent[];
  timesRecorded: boolean;
  provenance: FsreProvenance[];
}

export type FsreParseResult = { ok: true; run: FsreRun } | { ok: false; reason: 'invalid-data'; detail: string };

/* ---------- schemas ---------- */

const finite = z.number().finite();

const figureSchema = z.union([finite, z.object({ value: finite, of: finite.optional() })]);

const stageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: finite,
  skills: z.array(z.string().min(1)),
});

const stagesFileSchema = z.object({
  provisional: z.boolean().optional(),
  source: z.string().optional(),
  stages: z.array(stageSchema).min(1),
});

const skillsFileSchema = z.object({
  provisional: z.boolean().optional(),
  source: z.string().optional(),
  skills: z.array(z.object({ name: z.string().min(1), role: z.string() })),
});

const isoTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'not an ISO date-time');

const rawEventSchema = z.object({
  id: z.string().min(1),
  run: z.string().min(1),
  ticker: z.string().min(1).nullable().optional(),
  kind: z.enum(FSRE_EVENT_KINDS),
  at: isoTime.nullable().optional(),
  stageId: z.string().min(1).optional(),
  skill: z.string().min(1).optional(),
  payload: z.record(z.unknown()).optional(),
  source: z.string().optional(),
});
type RawEvent = z.infer<typeof rawEventSchema>;

const companySchema = z.object({ ticker: z.string().min(1), name: z.string().min(1) });

const replayFileSchema = z.object({
  provisional: z.boolean().optional(),
  source: z.string().optional(),
  note: z.string().optional(),
  run: z.string().min(1),
  label: z.string().optional(),
  company: companySchema.optional(),
  companies: z.array(companySchema).optional(),
  timesRecorded: z.boolean().optional(),
  events: z.array(rawEventSchema),
});

/* ---------- payloads ---------- */

const PAYLOAD_TEXT_FIELDS = ['title', 'detail', 'mode', 'ref', 'severity', 'reason'] as const;

/**
 * Text fields are kept when they are strings; figures come from
 * `payload.figures` and, for the provisional file, from flat numeric fields.
 * An explicit `figures` entry wins over a flat field of the same name.
 * Anything else in a payload is ignored rather than guessed at.
 */
function normalisePayload(raw: Record<string, unknown> | undefined, kind: RawEvent['kind']): FsrePayload | undefined {
  if (!raw) return undefined;
  const payload: FsrePayload = {};
  for (const field of PAYLOAD_TEXT_FIELDS) {
    const value = raw[field];
    if (typeof value === 'string') payload[field] = value;
  }
  const figures: Record<string, FsreFigure> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) figures[key] = value;
  }
  const nested = z.record(figureSchema).safeParse(raw.figures);
  if (raw.figures !== undefined && !nested.success) {
    throw new Error(`payload.figures is not a map of numbers or {value, of}: ${nested.error.issues[0]?.message ?? ''}`);
  }
  if (nested.success) Object.assign(figures, nested.data);
  if (Object.keys(figures).length > 0) payload.figures = figures;
  // An escalation without a reason still has to say why it locks approval:
  // the title is the next-best words, and they are the export's own.
  if (kind === 'escalated' && payload.reason === undefined && payload.title !== undefined) {
    payload.reason = payload.title;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function normaliseEvent(raw: RawEvent): FsreEvent {
  const event: FsreEvent = {
    id: raw.id,
    run: raw.run,
    ticker: raw.ticker ?? null,
    kind: raw.kind,
    at: raw.at ?? null,
  };
  if (raw.stageId !== undefined) event.stageId = raw.stageId;
  if (raw.skill !== undefined) event.skill = raw.skill;
  const payload = normalisePayload(raw.payload, raw.kind);
  if (payload) event.payload = payload;
  if (raw.source !== undefined) event.source = raw.source;
  return event;
}

/* ---------- the run ---------- */

export interface FsreRawFiles {
  stages: unknown;
  skills: unknown;
  replay: unknown;
}

export interface FsreFileNames {
  stages: string;
  skills: string;
  replay: string;
}

function describeZodError(file: string, error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.join('.') || '(root)';
  return `${file}: ${path} — ${issue?.message ?? 'invalid'}`;
}

function provenanceOf(file: FsreFileKey, fileName: string, flag: boolean | undefined, source: string | null): FsreProvenance {
  return { file, fileName, provisional: flag ?? true, stated: flag !== undefined, source };
}

/**
 * Validate the three files and normalise them into one run. Cross-file
 * checks: every event belongs to the file's run, ids are unique, and every
 * stage an event names exists in the stage data — an event at an unknown
 * stage would have to be drawn somewhere invented, so the run is refused.
 */
export function parseFsreRun(raw: FsreRawFiles, fileNames: FsreFileNames, label?: string): FsreParseResult {
  const stagesParsed = stagesFileSchema.safeParse(raw.stages);
  if (!stagesParsed.success) return { ok: false, reason: 'invalid-data', detail: describeZodError(fileNames.stages, stagesParsed.error) };
  const skillsParsed = skillsFileSchema.safeParse(raw.skills);
  if (!skillsParsed.success) return { ok: false, reason: 'invalid-data', detail: describeZodError(fileNames.skills, skillsParsed.error) };
  const replayParsed = replayFileSchema.safeParse(raw.replay);
  if (!replayParsed.success) return { ok: false, reason: 'invalid-data', detail: describeZodError(fileNames.replay, replayParsed.error) };

  const stagesFile = stagesParsed.data;
  const skillsFile = skillsParsed.data;
  const replay = replayParsed.data;

  const stageIds = new Set<string>();
  for (const stage of stagesFile.stages) {
    if (stageIds.has(stage.id)) return { ok: false, reason: 'invalid-data', detail: `${fileNames.stages}: stage id "${stage.id}" appears twice` };
    stageIds.add(stage.id);
  }

  const eventIds = new Set<string>();
  const events: FsreEvent[] = [];
  for (const [index, rawEvent] of replay.events.entries()) {
    const where = `${fileNames.replay}: events.${index} (${rawEvent.id})`;
    if (rawEvent.run !== replay.run) return { ok: false, reason: 'invalid-data', detail: `${where} belongs to run "${rawEvent.run}", not "${replay.run}"` };
    if (eventIds.has(rawEvent.id)) return { ok: false, reason: 'invalid-data', detail: `${where}: the id appears twice` };
    eventIds.add(rawEvent.id);
    if (rawEvent.stageId !== undefined && !stageIds.has(rawEvent.stageId)) {
      return { ok: false, reason: 'invalid-data', detail: `${where} names stage "${rawEvent.stageId}", which is not in ${fileNames.stages}` };
    }
    try {
      events.push(normaliseEvent(rawEvent));
    } catch (error) {
      return { ok: false, reason: 'invalid-data', detail: `${where}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  const companyNames: Record<string, string> = {};
  for (const company of [...(replay.company ? [replay.company] : []), ...(replay.companies ?? [])]) {
    companyNames[company.ticker] = company.name;
  }

  // The replay's own provenance: its `source` if it has one, else its note,
  // else what its first event says it was read from.
  const replaySource = replay.source ?? replay.note ?? replay.events.find((event) => event.source)?.source ?? null;

  return {
    ok: true,
    run: {
      id: replay.run,
      label: label ?? replay.label ?? replay.run,
      stages: [...stagesFile.stages].sort((a, b) => a.order - b.order),
      skills: skillsFile.skills.map((skill) => ({ name: skill.name, role: skill.role })),
      companyNames,
      events,
      // Not stated → true only if every event carries a time.
      timesRecorded: replay.timesRecorded ?? events.every((event) => event.at !== null),
      provenance: [
        provenanceOf('stages', fileNames.stages, stagesFile.provisional, stagesFile.source ?? null),
        provenanceOf('skills', fileNames.skills, skillsFile.provisional, skillsFile.source ?? null),
        provenanceOf('replay', fileNames.replay, replay.provisional, replaySource),
      ],
    },
  };
}

/**
 * One live event, validated alone (milestone M5 will feed these through
 * here before they reach the reducer). Stage ids are checked against the
 * run already loaded.
 */
export function parseFsreEvent(raw: unknown, run: Pick<FsreRun, 'id' | 'stages'>): { ok: true; event: FsreEvent } | { ok: false; detail: string } {
  const parsed = rawEventSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, detail: describeZodError('event', parsed.error) };
  if (parsed.data.run !== run.id) return { ok: false, detail: `event ${parsed.data.id} belongs to run "${parsed.data.run}", not "${run.id}"` };
  if (parsed.data.stageId !== undefined && !run.stages.some((stage) => stage.id === parsed.data.stageId)) {
    return { ok: false, detail: `event ${parsed.data.id} names an unknown stage "${parsed.data.stageId}"` };
  }
  try {
    return { ok: true, event: normaliseEvent(parsed.data) };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
