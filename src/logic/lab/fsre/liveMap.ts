/**
 * FSRE BUILDING — THE SUITE'S EVENTS, IN THE BUILDING'S WORDS.
 *
 * The live feed (milestone M5) reads fsre_status.events: one row per
 * pipeline_event the router recorded (fsre-skills contract 17). The building
 * reads its own contract (events.ts). This module translates the one into
 * the other the way the replay exporter (scripts/fsre/export-replay.py)
 * translates the run log, so a live run and its replay read alike:
 *
 *   transition to in_progress          stage_started
 *   transition to passed, at a gate    gate_passed, or gate_passed_with_escalation
 *                                      while an escalated note of that gate is open
 *   transition to passed               stage_completed
 *   transition to failed, at a gate    gate_failed
 *   transition to returned / blocked   stage_returned / stage_blocked
 *   transition to escalated            escalated ("review cycles exhausted")
 *   transition out of escalated        approved with a ref (the owner's decision),
 *                                      then the move itself
 *   issue_raised, escalated,           the same kinds
 *   proposal_logged
 *   decision_recorded                  approved with a ref: the building id of the
 *                                      escalation it decides, or the change id
 *   package_staged                     package_staged, ref = the package version (the
 *                                      partner room's approve button names it)
 *   approved                           approved, without a ref (the approval function)
 *
 * NOT DRAWN: `pending` (the queue between stages; the next stage_started
 * moves the folder), a manifest approval (a transition to the same state by
 * someone other than the router), and a preparer stage that failed its own
 * checks (it is redone in place).
 *
 * STATEFUL ON PURPOSE. Two translations need what came before: whether a
 * gate passed with an escalation still open (the suite records a gate's
 * notes before its result, CP-wave-2026-02-007 amendment 2) and which
 * building event a decision closes. The mapper keeps both, so each poll
 * continues exactly where the last one stopped. Rows arrive from the
 * network, so each is validated here; the building's own parse
 * (parseFsreEvent) checks the result again.
 */
import { z } from 'zod';
import type { FsreStage } from './data';
import type { FsreEventKind } from './events';

const GATE_ID = /^gate\d+$/;

const suiteRowSchema = z.object({
  seq: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/).transform(Number)]),
  wave_id: z.string().min(1),
  company_id: z.string().min(1).nullable(),
  kind: z.enum(['transition', 'issue_raised', 'escalated', 'proposal_logged', 'decision_recorded', 'package_staged', 'approved']),
  stage: z.string().min(1).nullable(),
  stage_status: z.string().min(1).nullable(),
  from_stage: z.string().min(1).nullable(),
  from_status: z.string().min(1).nullable(),
  review_cycle: z.number().int().nullable(),
  actor: z.string().min(1),
  ref: z.string().min(1).nullable(),
  at: z.string().nullable(),
  payload: z.record(z.unknown()).nullable(),
});
export type SuiteEventRow = z.infer<typeof suiteRowSchema>;

/** One building event before the building's own parse: the shape of a replay file's entry. */
export interface LiveRawEvent {
  id: string;
  run: string;
  ticker: string | null;
  kind: FsreEventKind;
  at: string | null;
  stageId?: string;
  skill?: string;
  payload?: Record<string, unknown>;
  source: string;
}

export type LiveMapResult = { ok: true; events: LiveRawEvent[] } | { ok: false; detail: string };

export interface LiveMapper {
  /** Translate the next rows, in seq order. Rows at or below the last seq seen are skipped (a poll may resend). */
  map(rows: readonly unknown[]): LiveMapResult;
  /** The highest seq translated so far; the next poll asks for rows after it. */
  lastSeq(): number;
}

export const LIVE_SOURCE_NAME = 'fsre_status.events';

function text(payload: Record<string, unknown> | null, field: string): string | undefined {
  const value = payload?.[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function createLiveMapper(stages: readonly FsreStage[], run: string): LiveMapper {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  let last = 0;
  /** company|gate → suite refs of escalated notes still open there. */
  const openNotes = new Map<string, Set<string>>();
  /** company|suite ref → the building id of its `escalated` event. */
  const escalationIds = new Map<string, string>();
  /** company|stage → the building id of the `escalated` a move to `escalated` raised there. */
  const cycleEscalations = new Map<string, string>();

  const key = (company: string | null, part: string) => `${company ?? ''}|${part}`;

  function translate(row: SuiteEventRow): LiveRawEvent[] {
    const id = `s${row.seq}`;
    const base = { run, ticker: row.company_id, at: row.at, source: `${LIVE_SOURCE_NAME} seq ${row.seq}` };
    const stageId = row.stage ?? undefined;
    const runner = stageId ? stageById.get(stageId)?.skills[0] : undefined;
    const figures = row.payload && typeof row.payload.figures === 'object' && row.payload.figures !== null ? row.payload.figures : undefined;
    const reason = text(row.payload, 'reason');

    switch (row.kind) {
      case 'issue_raised':
      case 'escalated': {
        const payload = {
          title: text(row.payload, 'title'),
          detail: text(row.payload, 'detail'),
          severity: text(row.payload, 'severity'),
          ref: row.ref ?? undefined,
        };
        if (row.kind === 'escalated' && row.ref && stageId) {
          const open = openNotes.get(key(row.company_id, stageId)) ?? new Set<string>();
          open.add(row.ref);
          openNotes.set(key(row.company_id, stageId), open);
          escalationIds.set(key(row.company_id, row.ref), id);
        }
        return [{ ...base, id, kind: row.kind, stageId, skill: row.actor, payload }];
      }
      case 'proposal_logged':
        return [{
          ...base,
          id,
          kind: 'proposal_logged',
          ticker: null,
          skill: row.actor,
          payload: { title: text(row.payload, 'title'), mode: text(row.payload, 'mode'), detail: text(row.payload, 'detail'), ref: row.ref ?? undefined },
        }];
      case 'decision_recorded': {
        if (!row.ref) return [];
        const escalation = escalationIds.get(key(row.company_id, row.ref));
        if (escalation) {
          for (const open of openNotes.values()) open.delete(row.ref);
        }
        return [{
          ...base,
          id,
          kind: 'approved',
          stageId,
          skill: row.actor,
          payload: { ref: escalation ?? row.ref, title: text(row.payload, 'title'), detail: text(row.payload, 'detail') },
        }];
      }
      case 'approved':
        return [{ ...base, id, kind: 'approved', stageId, skill: row.actor, payload: { title: text(row.payload, 'title'), detail: text(row.payload, 'detail') } }];
      case 'package_staged':
        if (!row.ref) return [];
        return [{
          ...base,
          id,
          kind: 'package_staged',
          stageId,
          skill: row.actor,
          payload: { ref: row.ref, title: text(row.payload, 'title'), detail: text(row.payload, 'detail'), ...(figures ? { figures } : {}) },
        }];
      case 'transition':
        break;
    }

    if (!stageId || !row.stage_status) return [];
    if (row.actor !== 'router' && row.from_stage === row.stage && row.from_status === row.stage_status) return [];
    const out: LiveRawEvent[] = [];
    const cycleKey = key(row.company_id, stageId);
    if (row.from_status === 'escalated' && row.from_stage === stageId && cycleEscalations.has(cycleKey)) {
      out.push({
        ...base,
        id: `${id}-decision`,
        kind: 'approved',
        stageId,
        skill: row.actor,
        payload: { ref: cycleEscalations.get(cycleKey), title: 'Decided by the owner', detail: reason },
      });
      cycleEscalations.delete(cycleKey);
    }
    const gate = GATE_ID.test(stageId);
    const name = stageById.get(stageId)?.name ?? stageId;
    switch (row.stage_status) {
      case 'in_progress':
        out.push({ ...base, id, kind: 'stage_started', stageId, skill: runner });
        break;
      case 'passed': {
        if (gate) {
          const open = openNotes.get(cycleKey)?.size ?? 0;
          out.push({
            ...base,
            id,
            kind: open > 0 ? 'gate_passed_with_escalation' : 'gate_passed',
            stageId,
            skill: runner,
            ...(figures ? { payload: { figures } } : {}),
          });
        } else {
          out.push({ ...base, id, kind: 'stage_completed', stageId, skill: runner, ...(figures ? { payload: { figures } } : {}) });
        }
        break;
      }
      case 'failed':
        if (gate) out.push({ ...base, id, kind: 'gate_failed', stageId, skill: runner, payload: { reason } });
        break;
      case 'returned':
        out.push({ ...base, id, kind: 'stage_returned', stageId, skill: runner, payload: { reason } });
        break;
      case 'blocked':
        out.push({ ...base, id, kind: 'stage_blocked', stageId, skill: runner, payload: { reason } });
        break;
      case 'escalated':
        cycleEscalations.set(cycleKey, id);
        out.push({ ...base, id, kind: 'escalated', stageId, skill: runner, payload: { title: `${name}: review cycles exhausted`, detail: reason } });
        break;
    }
    return out;
  }

  return {
    lastSeq: () => last,
    map(rows) {
      const events: LiveRawEvent[] = [];
      for (const [index, raw] of rows.entries()) {
        const parsed = suiteRowSchema.safeParse(raw);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          return { ok: false, detail: `${LIVE_SOURCE_NAME} row ${index}: ${issue?.path.join('.') || '(root)'} — ${issue?.message ?? 'invalid'}` };
        }
        const row = parsed.data;
        if (row.seq <= last) continue;
        if (row.seq !== last + 1) return { ok: false, detail: `${LIVE_SOURCE_NAME}: seq ${row.seq} follows ${last}; events are numbered without gaps` };
        if (row.wave_id !== run) return { ok: false, detail: `${LIVE_SOURCE_NAME}: seq ${row.seq} belongs to ${row.wave_id}, not ${run}` };
        if (row.stage && !stageById.has(row.stage)) return { ok: false, detail: `${LIVE_SOURCE_NAME}: seq ${row.seq} names an unknown stage "${row.stage}"` };
        events.push(...translate(row).map(dropUndefined));
        last = row.seq;
      }
      return { ok: true, events };
    },
  };
}

/** JSON-shaped events: an absent field is absent, never `undefined`. */
function dropUndefined(event: LiveRawEvent): LiveRawEvent {
  const out = Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) as unknown as LiveRawEvent;
  if (event.payload) {
    const payload = Object.fromEntries(Object.entries(event.payload).filter(([, value]) => value !== undefined));
    if (Object.keys(payload).length > 0) out.payload = payload;
    else delete out.payload;
  }
  return out;
}
