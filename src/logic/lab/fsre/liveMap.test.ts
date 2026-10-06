import { describe, expect, it } from 'vitest';
import stagesFile from '../../../data/fsre/stages.json';
import skillsFile from '../../../data/fsre/skills.json';
import { parseFsreRun, type FsreRun } from './data';
import { createLiveMapper, type LiveRawEvent, type SuiteEventRow } from './liveMap';
import { approvalLock, buildContext, openPartnerCount, partnerItems, reduceEvents } from './reducer';

const WAVE = 'wave-2026-09';
const NAMES = { stages: 'stages.json', skills: 'skills.json', replay: 'live' };

function emptyRun(): FsreRun {
  const parsed = parseFsreRun({ stages: stagesFile, skills: skillsFile, replay: { provisional: false, run: WAVE, events: [] } }, NAMES);
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.run;
}

/** A suite row with the fields every kind carries; `over` sets the rest. */
let nextSeq = 1;
function row(over: Partial<SuiteEventRow> & Pick<SuiteEventRow, 'kind'>): SuiteEventRow {
  return {
    seq: nextSeq++,
    wave_id: WAVE,
    company_id: 'INTP',
    stage: null,
    stage_status: null,
    from_stage: null,
    from_status: null,
    review_cycle: null,
    actor: 'router',
    ref: null,
    at: '2026-10-06T01:00:00Z',
    payload: null,
    ...over,
  };
}
const move = (stage: string, status: string, from: [string, string], over: Partial<SuiteEventRow> = {}) =>
  row({ kind: 'transition', stage, stage_status: status, from_stage: from[0], from_status: from[1], ...over });
const note = (kind: 'issue_raised' | 'escalated', ref: string, stage = 'gate2') =>
  row({ kind, stage, actor: 'review-manager', ref, payload: { title: `${ref}: finding`, detail: 'The finding.', severity: 'major' } });

function mapAll(rows: SuiteEventRow[]): LiveRawEvent[] {
  nextSeq = 1;
  const mapper = createLiveMapper(emptyRun().stages, WAVE);
  const result = mapper.map(rows);
  if (!result.ok) throw new Error(result.detail);
  return result.events;
}

/** Rows built in one place so seq numbering restarts per test. */
function rows(build: () => SuiteEventRow[]): SuiteEventRow[] {
  nextSeq = 1;
  return build();
}

function runOf(events: LiveRawEvent[]): FsreRun {
  const parsed = parseFsreRun({ stages: stagesFile, skills: skillsFile, replay: { provisional: false, run: WAVE, events } }, NAMES);
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.run;
}

describe('createLiveMapper', () => {
  it('reads a gate with an open escalated note as passed with escalation, notes first', () => {
    const events = mapAll(rows(() => [
      move('gate2', 'in_progress', ['gate2', 'pending']),
      note('issue_raised', 'RN-1'),
      note('issue_raised', 'RN-2'),
      note('escalated', 'RN-2'),
      move('gate2', 'passed', ['gate2', 'in_progress']),
    ]));
    expect(events.map((e) => e.kind)).toEqual(['stage_started', 'issue_raised', 'issue_raised', 'escalated', 'gate_passed_with_escalation']);
    expect(events.map((e) => e.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(events[4]).toMatchObject({ stageId: 'gate2', skill: 'review-manager' });
    expect(events[4]?.payload).toBeUndefined();
    expect(events[3]).toMatchObject({ ticker: 'INTP', skill: 'review-manager', payload: { ref: 'RN-2', title: 'RN-2: finding', severity: 'major' } });
  });

  it('reads a gate with notes but no escalation as passed', () => {
    const events = mapAll(rows(() => [note('issue_raised', 'RN-1', 'gate1'), move('gate1', 'passed', ['gate1', 'in_progress'])]));
    expect(events.map((e) => e.kind)).toEqual(['issue_raised', 'gate_passed']);
    expect(events[1]?.payload).toBeUndefined();
  });

  it("closes the escalation a decision names, by the building's own event id", () => {
    const run = runOf(
      mapAll(rows(() => [
        note('escalated', 'RN-2'),
        move('gate2', 'passed', ['gate2', 'in_progress']),
        row({ kind: 'decision_recorded', stage: 'gate2', actor: 'Dika', ref: 'RN-2', payload: { title: 'RN-2: decided by Dika', detail: 'decided by Dika (upheld): keep it' } }),
      ])),
    );
    expect(run.events[2]).toMatchObject({ kind: 'approved', skill: 'Dika', payload: { ref: 's1' } });
    const ctx = buildContext(run);
    expect(openPartnerCount(reduceEvents(ctx, run.events.slice(0, 2)))).toBe(1);
    const state = reduceEvents(ctx, run.events);
    expect(openPartnerCount(state)).toBe(0);
    expect(partnerItems(state).every((item) => item.state === 'decided')).toBe(true);
    expect(approvalLock(state, 'INTP').locked).toBe(false);
  });

  it('a gate passed again after the decision is a plain pass', () => {
    const events = mapAll(rows(() => [
      note('escalated', 'RN-2'),
      row({ kind: 'decision_recorded', stage: 'gate2', actor: 'Dika', ref: 'RN-2' }),
      move('gate2', 'passed', ['gate2', 'in_progress']),
    ]));
    expect(events[2]?.kind).toBe('gate_passed');
  });

  it('logs proposals at run level and decides them by change id', () => {
    const run = runOf(
      mapAll(rows(() => [
        row({ kind: 'proposal_logged', company_id: null, actor: 'guruh', ref: 'CP-wave-2026-09-001', payload: { title: 'CP-wave-2026-09-001: fs-intake 0.4.0', mode: 'script', detail: 'Why.' } }),
        row({ kind: 'decision_recorded', company_id: null, actor: 'Dika', ref: 'CP-wave-2026-09-001', payload: { title: 'CP-wave-2026-09-001: merged by Dika' } }),
      ])),
    );
    expect(run.events.map((e) => [e.kind, e.ticker, e.payload?.ref])).toEqual([
      ['proposal_logged', null, 'CP-wave-2026-09-001'],
      ['approved', null, 'CP-wave-2026-09-001'],
    ]);
    const state = reduceEvents(buildContext(run), run.events);
    expect(partnerItems(state).map((item) => item.state)).toEqual(['decided']);
  });

  it('turns an escalation for exhausted review cycles, and the decision that ends it, into building events', () => {
    const events = mapAll(rows(() => [
      move('gate3', 'escalated', ['gate3', 'failed'], { payload: { reason: 'cycle budget spent' } }),
      move('gate3', 'passed', ['gate3', 'escalated'], { payload: { reason: 'Dika: accept with a note' } }),
    ]));
    expect(events.map((e) => [e.id, e.kind])).toEqual([['s1', 'escalated'], ['s2-decision', 'approved'], ['s2', 'gate_passed']]);
    expect(events[0]?.payload).toEqual({ title: 'Gate 3: review cycles exhausted', detail: 'cycle budget spent' });
    expect(events[1]?.payload).toMatchObject({ ref: 's1', detail: 'Dika: accept with a note' });
  });

  it('draws nothing for the queue, a manifest approval or a self-redone stage', () => {
    const events = mapAll(rows(() => [
      move('selected', 'pending', ['selected', 'pending'], { actor: 'Dika' }),
      move('intake', 'pending', ['doc_plan', 'passed']),
      move('intake', 'failed', ['intake', 'in_progress']),
      move('intake', 'passed', ['intake', 'in_progress'], { payload: { figures: { rows: { value: 209, of: 209 } } } }),
    ]));
    expect(events.map((e) => [e.id, e.kind])).toEqual([['s4', 'stage_completed']]);
    expect(events[0]?.payload).toEqual({ figures: { rows: { value: 209, of: 209 } } });
  });

  it('keeps a staged package with its version, which the reducer remembers for the approve button', () => {
    const run = runOf(
      mapAll(rows(() => [
        row({
          kind: 'package_staged',
          stage: 'packed',
          stage_status: 'passed',
          ref: 'INTP-2026.1',
          payload: { title: 'INTP-2026.1 staged for partner review', detail: "Waits for Dika's approval.", figures: { unitEconomicsPeriods: { value: 2 } } },
        }),
      ])),
    );
    expect(run.events[0]).toMatchObject({ kind: 'package_staged', stageId: 'packed', payload: { ref: 'INTP-2026.1' } });
    const state = reduceEvents(buildContext(run), run.events);
    expect(state.companies.INTP?.staged).toBe('INTP-2026.1');
    expect(state.companies.INTP?.approved).toBe(false);
  });

  it("approves a company only through the approval function's event", () => {
    const events = mapAll(rows(() => [
      row({ kind: 'approved', stage: 'partner_reviewed', stage_status: 'passed', actor: 'Dika (owner, Personal OS partner room)', ref: 'INTP-2026.1' }),
    ]));
    expect(events).toEqual([
      { id: 's1', run: WAVE, ticker: 'INTP', kind: 'approved', at: '2026-10-06T01:00:00Z', stageId: 'partner_reviewed', skill: 'Dika (owner, Personal OS partner room)', source: 'fsre_status.events seq 1' },
    ]);
  });

  it('continues across polls: a resent row is skipped, a gap or a stranger is refused', () => {
    nextSeq = 1;
    const mapper = createLiveMapper(emptyRun().stages, WAVE);
    const first = [note('escalated', 'RN-2'), { ...move('gate2', 'passed', ['gate2', 'in_progress']), seq: '2' }];
    expect(mapper.map(first)).toMatchObject({ ok: true, events: [{ id: 's1' }, { id: 's2', kind: 'gate_passed_with_escalation' }] });
    expect(mapper.lastSeq()).toBe(2);
    expect(mapper.map(first)).toEqual({ ok: true, events: [] });
    const decision = row({ kind: 'decision_recorded', stage: 'gate2', actor: 'Dika', ref: 'RN-2' });
    expect(mapper.map([decision])).toMatchObject({ ok: true, events: [{ id: 's3', payload: { ref: 's1' } }] });
    expect(mapper.map([{ ...decision, seq: 5 }])).toEqual({ ok: false, detail: 'fsre_status.events: seq 5 follows 3; events are numbered without gaps' });
    expect(mapper.map([{ ...decision, seq: 4, wave_id: 'wave-2026-02' }])).toMatchObject({ ok: false });
    expect(mapper.map([{ ...decision, seq: 4, stage: 'nowhere' }])).toMatchObject({ ok: false });
    expect(mapper.map([{ ...decision, seq: 4, kind: 'deleted' }])).toMatchObject({ ok: false });
    expect(mapper.lastSeq()).toBe(3);
  });

  it("every event it makes passes the building's own parse", () => {
    const events = mapAll(rows(() => [
      move('intake', 'in_progress', ['intake', 'pending']),
      move('intake', 'passed', ['intake', 'in_progress']),
      move('gate1', 'in_progress', ['gate1', 'pending']),
      move('gate1', 'failed', ['gate1', 'in_progress'], { payload: { reason: 'G1-05 failed' } }),
      move('intake', 'returned', ['gate1', 'failed'], { payload: { reason: 'back to intake' } }),
      move('intake', 'blocked', ['intake', 'in_progress'], { payload: { reason: 'filing missing' } }),
    ]));
    expect(events.map((e) => e.kind)).toEqual(['stage_started', 'stage_completed', 'stage_started', 'gate_failed', 'stage_returned', 'stage_blocked']);
    expect(runOf(events).events).toHaveLength(6);
  });
});
