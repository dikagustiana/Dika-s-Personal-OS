import { describe, expect, it } from 'vitest';
import { parseFsreEvent, parseFsreRun, type FsreRawFiles } from './data';
import {
  ROUTER_FILE_NAMES,
  UNVR_FILES,
  UNVR_FILE_NAMES,
  routerFiles,
  tenCompanyEvents,
  tenCompanyRun,
  unvrRun,
} from './__fixtures__/fsreFixtures';

function withReplay(files: FsreRawFiles, patch: Record<string, unknown>): FsreRawFiles {
  return { ...files, replay: { ...(files.replay as Record<string, unknown>), ...patch } };
}

function firstEvents(files: FsreRawFiles): Array<Record<string, unknown>> {
  return (files.replay as { events: Array<Record<string, unknown>> }).events;
}

describe('the provisional file shape', () => {
  it('validates and keeps every event in order', () => {
    const run = unvrRun();
    expect(run.id).toBe('unvr-dry-run');
    expect(run.events.map((e) => e.id)).toEqual(firstEvents(UNVR_FILES).map((e) => e.id));
    expect(run.stages.map((s) => s.id)[0]).toBe('manifest');
  });

  it('accepts flat numeric payload fields as figures', () => {
    const run = unvrRun();
    expect(run.events.find((e) => e.id === 'e08')?.payload?.figures).toEqual({ factsLoaded: 10142, rows: 209, unmappedConcepts: 0, rowsTraced: 209 });
    expect(run.events.find((e) => e.id === 'e09')?.payload?.figures).toEqual({ tieOutChecks: 21, passed: 18, failed: 0, skipped: 3 });
  });

  it('keeps each file’s provisional flag and source, by file', () => {
    const run = unvrRun();
    expect(run.provenance.map((p) => [p.file, p.fileName, p.provisional, p.stated])).toEqual([
      ['stages', 'stages.json', true, true],
      ['skills', 'skills.json', true, true],
      ['replay', 'replay-unvr.json', true, true],
    ]);
    expect(run.provenance[0].source).toContain('Provisional stage list written in chat');
    expect(run.provenance[1].source).toContain('Roles written in chat');
    // The replay has no top-level `source`; its note speaks for it.
    expect(run.provenance[2].source).toContain('Stopgap file written in chat');
    expect(run.timesRecorded).toBe(false);
  });

  it('drops the static figures, archetypes and partner queue: nothing can read them past this point', () => {
    const run = unvrRun();
    expect(Object.keys(run)).not.toContain('figures');
    expect(Object.keys(run)).not.toContain('archetypes');
    expect(Object.keys(run)).not.toContain('partnerQueue');
    expect(JSON.stringify(run)).not.toContain('ARC-DIST');
  });

  it('names companies from the file, never figures', () => {
    expect(unvrRun().companyNames).toEqual({ UNVR: 'Unilever Indonesia' });
  });

  it('keeps bracketed placeholders exactly as written', () => {
    const run = unvrRun();
    expect(run.events.find((e) => e.id === 'e14')?.payload?.title).toBe('[Second review issue: title not in the summary]');
  });
});

describe('the export shape (mount report §3.3)', () => {
  it('accepts router stage ids, ISO times, payload.figures, ticker null and the two extra kinds', () => {
    const run = tenCompanyRun();
    expect(run.stages.map((s) => s.id)).toEqual([
      'selected', 'doc_plan', 'intake', 'gate1', 'normalized', 'decomposed', 'benchmarked',
      'gate2', 'calibrated', 'gate3', 'packed', 'partner_reviewed', 'closed',
    ]);
    expect(run.events.some((e) => e.ticker === null && e.kind === 'proposal_logged')).toBe(true);
    expect(run.events.some((e) => e.kind === 'stage_returned')).toBe(true);
    expect(run.events.some((e) => e.kind === 'stage_blocked')).toBe(true);
    expect(run.events.every((e) => typeof e.at === 'string')).toBe(true);
    const intake = run.events.find((e) => e.id === 'SYN01-06');
    expect(intake?.payload?.figures).toEqual({ factsLoaded: 1000, rowsTraced: { value: 200, of: 209 } });
  });

  it('derives "times recorded" from the events when the file does not say', () => {
    expect(tenCompanyRun().timesRecorded).toBe(true);
    const oneUntimed = tenCompanyEvents().map((e, i) => (i === 3 ? { ...e, at: null } : e));
    const parsed = parseFsreRun(routerFiles(oneUntimed), ROUTER_FILE_NAMES);
    expect(parsed.ok && parsed.run.timesRecorded).toBe(false);
  });

  it('reads a file with no provisional flag as provisional, and says the flag was absent', () => {
    const files = routerFiles(tenCompanyEvents());
    const { provisional: _drop, ...stagesWithout } = files.stages as Record<string, unknown>;
    void _drop;
    const parsed = parseFsreRun({ ...files, stages: stagesWithout }, ROUTER_FILE_NAMES);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.run.provenance[0]).toMatchObject({ file: 'stages', provisional: true, stated: false });
    expect(parsed.run.provenance[1]).toMatchObject({ file: 'skills', provisional: false, stated: true });
  });

  it('lets an escalation without a reason fall back to its title', () => {
    const events = [{ id: 'x1', run: 'syn-wave', ticker: 'SYN01', kind: 'escalated', at: null, stageId: 'decomposed', payload: { title: 'Only a title' } }];
    const parsed = parseFsreRun(routerFiles(events), ROUTER_FILE_NAMES);
    expect(parsed.ok && parsed.run.events[0].payload).toEqual({ title: 'Only a title', reason: 'Only a title' });
  });

  it('lets an explicit figures entry win over a flat field of the same name', () => {
    const events = [{ id: 'x1', run: 'syn-wave', ticker: 'SYN01', kind: 'stage_completed', at: null, stageId: 'intake', payload: { factsLoaded: 1, figures: { factsLoaded: 2 } } }];
    const parsed = parseFsreRun(routerFiles(events), ROUTER_FILE_NAMES);
    expect(parsed.ok && parsed.run.events[0].payload?.figures).toEqual({ factsLoaded: 2 });
  });
});

describe('what is refused', () => {
  const base = () => routerFiles(tenCompanyEvents());
  const refuse = (files: FsreRawFiles) => {
    const parsed = parseFsreRun(files, ROUTER_FILE_NAMES);
    expect(parsed.ok).toBe(false);
    return parsed.ok ? '' : parsed.detail;
  };

  it('an event at a stage the stage data does not have', () => {
    const events = tenCompanyEvents().map((e, i) => (i === 0 ? { ...e, stageId: 'manifest' } : e));
    expect(refuse(withReplay(base(), { events }))).toContain('names stage "manifest"');
  });

  it('a duplicated event id', () => {
    const events = tenCompanyEvents();
    expect(refuse(withReplay(base(), { events: [...events, events[0]] }))).toContain('appears twice');
  });

  it('an event from another run', () => {
    const events = tenCompanyEvents().map((e, i) => (i === 2 ? { ...e, run: 'other' } : e));
    expect(refuse(withReplay(base(), { events }))).toContain('belongs to run "other"');
  });

  it('an unknown kind, a malformed time, and figures that are not numbers', () => {
    const at = (patch: Record<string, unknown>) => withReplay(base(), { events: tenCompanyEvents().map((e, i) => (i === 0 ? { ...e, ...patch } : e)) });
    expect(refuse(at({ kind: 'stage_teleported' }))).toContain('kind');
    expect(refuse(at({ at: 'yesterday' }))).toContain('ISO');
    expect(refuse(at({ payload: { figures: { factsLoaded: 'many' } } }))).toContain('payload.figures');
  });

  it('a stage list that is empty or repeats an id', () => {
    const files = base();
    expect(refuse({ ...files, stages: { stages: [] } })).toContain('stages.json');
    const stages = (files.stages as { stages: unknown[] }).stages;
    expect(refuse({ ...files, stages: { stages: [...stages, stages[0]] } })).toContain('appears twice');
  });

  it('a file that is not an object at all', () => {
    expect(refuse({ ...base(), skills: null })).toContain('skills.json');
  });
});

describe('one live event', () => {
  it('validates against the loaded run and normalises like the files', () => {
    const run = tenCompanyRun();
    const ok = parseFsreEvent({ id: 'live-1', run: run.id, ticker: 'SYN01', kind: 'stage_started', at: '2026-02-03T09:00:00Z', stageId: 'gate3', payload: { rows: 3 } }, run);
    expect(ok.ok && ok.event.payload?.figures).toEqual({ rows: 3 });
    expect(parseFsreEvent({ id: 'live-2', run: 'other', ticker: 'SYN01', kind: 'stage_started', at: null }, run).ok).toBe(false);
    expect(parseFsreEvent({ id: 'live-3', run: run.id, ticker: 'SYN01', kind: 'stage_started', at: null, stageId: 'nowhere' }, run).ok).toBe(false);
  });
});

describe('file names travel with the run', () => {
  it('uses the names the source passes', () => {
    const parsed = parseFsreRun(UNVR_FILES, { ...UNVR_FILE_NAMES, replay: 'replay-x.json' });
    expect(parsed.ok && parsed.run.provenance[2].fileName).toBe('replay-x.json');
  });
});
