// The frozen wire contract (A-2), validated at every transport boundary (B-2).
// Objects are strict: an adapter that adds a field is an adapter that broke
// the contract, and the event is dropped, not partially applied.
import { z } from 'zod';

export const OFFICE_STATES = [
  'OFFICE_IDLE',
  'OFFICE_WALKING',
  'OFFICE_WORKING',
  'OFFICE_COLLABORATING',
  'OFFICE_DELIVERING',
  'OFFICE_ERROR',
] as const;

export type OfficeState = (typeof OFFICE_STATES)[number];

export function isKnownState(s: string): s is OfficeState {
  return (OFFICE_STATES as readonly string[]).includes(s);
}

export const HexCoordSchema = z
  .object({
    q: z.number().int(),
    r: z.number().int(),
  })
  .strict();

export const TaskDetailsSchema = z
  .object({
    title: z.string(),
    department: z.string(),
    progressPercentage: z.number().min(0).max(100),
    activeSubtask: z.string(),
    tokensUsed: z.number().int().nonnegative(),
  })
  .strict();

export const CanonicalEventSchema = z
  .object({
    eventId: z.string().min(1),
    timestamp: z.string().datetime({ offset: true }),
    agentId: z.string().min(1),
    agentRole: z.string(),
    // Any string validates; an unknown value renders as OFFICE_ERROR with an
    // UNKNOWN_STATE badge (B-2). It is never mapped to a nearby state.
    currentState: z.string().min(1),
    currentLocationHex: HexCoordSchema,
    targetDestinationHex: HexCoordSchema.nullable(),
    // Opaque task id. Null when the agent has no task (idle); see DECISIONS.md.
    currentTaskId: z.string().nullable(),
    // Non-null only while collaborating; all agents sharing it meet at one cluster.
    collaborationGroupId: z.string().nullable(),
    taskDetails: TaskDetailsSchema,
  })
  .strict();

export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;
export type HexCoordWire = z.infer<typeof HexCoordSchema>;
export type TaskDetails = z.infer<typeof TaskDetailsSchema>;

export type ParseResult = { ok: true; event: CanonicalEvent } | { ok: false; reason: string; raw: unknown };

/** Validate one inbound frame (string or already-parsed JSON). Never throws. */
export function parseCanonicalEvent(input: unknown): ParseResult {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (e) {
      return { ok: false, reason: `not JSON: ${(e as Error).message}`, raw: input };
    }
  }
  const res = CanonicalEventSchema.safeParse(value);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { ok: false, reason: issues, raw: value };
  }
  return { ok: true, event: res.data };
}
