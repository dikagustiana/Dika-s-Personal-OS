import { describe, expect, it } from 'vitest';
import { parseFsreEvent, parseFsreRun, type FsreRawFiles } from './data';
import {
  ROUTER_FILE_NAMES,
  PROVISIONAL_FILES,
  REAL_DATA,
  UNVR_FILE_NAMES,
  routerFiles,
  tenCompanyEvents,
  tenCompanyRun,
  provisionalRun,
  realRun,
} from './__fixtures__/fsreFixtures';

function withReplay(files: FsreRawFiles, patch: Record<string, unknown>): FsreRawFiles {
  return { ...files, replay: { ...(files.replay as Record<string, unknown>), ...patch } };
}

function firstEvents(files: FsreRawFiles): Array<Record<string, unknown>> {
  return (files.replay as { events: Array<Record<string, unknown>> }).events;
}

describe('the provisional file shape (GLM fixture, __fixtures__/provisional/)', () => {
  it('validates and keeps every event in order', () => {
    const run = provisionalRun();
    expect(run.id).toBe('unvr-dry-run');
    expect(run.events.map((e) => e.id)).toEqual(firstEvents(PROVISIONAL_FILES).map((e) => e.id));
    expect(run.stages.map((s) => s.id)[0]).toBe('manifest');
  });

  it('accepts flat numeric payload fields as figures', () => {
    const run = provisionalRun();
    expect(run.events.find((e) => e.id === 'e08')?.payload?.figures).toEqual({ factsLoaded: 10142, rows: 209, unmappedConcepts: 0, rowsTraced: 209 });
    expect(run.events.find((e) => e.id === 'e09')?.payload?.figures).toEqual({ tieOutChecks: 21, passed: 18, failed: 0, skipped: 3 });
  });

  it('keeps each file’s provisional flag and source, by file', () => {
    const run = provisionalRun();
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
    const run = provisionalRun();
    expect(Object.keys(run)).not.toContain('figures');
    expect(Object.keys(run)).not.toContain('archetypes');
    expect(Object.keys(run)).not.toContain('partnerQueue');
    expect(JSON.stringify(run)).not.toContain('ARC-DIST');
  });

  it('names companies from the file, never figures', () => {
    expect(provisionalRun().companyNames).toEqual({ UNVR: 'Unilever Indonesia' });
  });

  it('keeps bracketed placeholders exactly as written', () => {
    const run = provisionalRun();
    expect(run.events.find((e) => e.id === 'e14')?.payload?.title).toBe('[Second review issue: title not in the summary]');
  });
});

describe('the real export, bundled in src/data/fsre/ (brief 04)', () => {
  const run = realRun();
  const raw = REAL_DATA.replay.events;

  it('validates and keeps every event in order', () => {
    expect(run.id).toBe(REAL_DATA.replay.run);
    expect(run.events.map((e) => e.id)).toEqual(raw.map((e) => e.id));
    expect(run.events).toHaveLength(50);
    expect(run.stages.map((s) => s.id)).toEqual(REAL_DATA.stages.stages.map((s) => s.id));
  });

  it('says no file is provisional, and keeps each file’s own source', () => {
    expect(run.provenance.map((p) => [p.file, p.provisional, p.stated])).toEqual([
      ['stages', false, true],
      ['skills', false, true],
      ['replay', false, true],
    ]);
    expect(run.provenance.map((p) => p.source)).toEqual([REAL_DATA.stages.source, REAL_DATA.skills.source, REAL_DATA.replay.source]);
  });

  it('records times as the file says: the router timed its events, review notes and proposals carry none', () => {
    expect(run.timesRecorded).toBe(REAL_DATA.replay.timesRecorded);
    const untimed = run.events.filter((e) => e.at === null);
    expect(untimed).toHaveLength(raw.filter((e) => e.at === null).length);
    expect(new Set(untimed.map((e) => e.kind))).toEqual(new Set(['issue_raised', 'escalated', 'proposal_logged']));
    expect(run.events.filter((e) => e.at !== null).every((e) => !Number.isNaN(Date.parse(e.at ?? '')))).toBe(true);
  });

  it('keeps payload.figures as written, {value, of} included', () => {
    const intake = run.events.find((e) => e.kind === 'stage_completed' && e.stageId === 'intake');
    const rawIntake = raw.find((e) => e.kind === 'stage_completed' && e.stageId === 'intake');
    expect(intake?.payload?.figures).toEqual(rawIntake?.payload?.figures);
    expect(intake?.payload?.figures?.rowsTraced).toEqual({ value: 976, of: 976 });
  });

  it('puts the two proposals at run level (ticker null)', () => {
    expect(run.events.filter((e) => e.ticker === null).map((e) => e.kind)).toEqual(['proposal_logged', 'proposal_logged']);
  });

  it('gives every escalation a reason: the export writes a detail beside the title, which stands in for it', () => {
    const escalations = run.events.filter((e) => e.kind === 'escalated');
    expect(escalations).toHaveLength(13);
    for (const e of escalations) {
      expect(e.payload?.detail).toBeTruthy();
      expect(e.payload?.reason).toBe(e.payload?.detail);
    }
  });

  it('falls back to the title for an escalation that has no detail either', () => {
    const [stage] = REAL_DATA.stages.stages;
    const parsed = parseFsreRun(
      {
        stages: REAL_DATA.stages,
        skills: REAL_DATA.skills,
        replay: { provisional: false, run: 'r', events: [{ id: 'e1', run: 'r', ticker: 'X', kind: 'escalated', stageId: stage?.id, payload: { title: 'Only a title' } }] },
      },
      { stages: 'stages.json', skills: 'skills.json', replay: 'replay.json' },
    );
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.run.events[0]?.payload?.reason).toBe('Only a title');
  });

  it("keeps the export's own note on its times", () => {
    expect(run.timesNote).toBe(REAL_DATA.replay.timesNote);
    expect(run.timesNote).toContain('Review notes and proposals carry at: null');
  });

  it('sends no escalation count as a figure: the building counts the escalated events', () => {
    for (const e of run.events) expect(Object.keys(e.payload?.figures ?? {})).not.toContain('escalatedNotes');
  });

  it('keeps the seats named in skills.json', () => {
    expect(run.skills.filter((s) => s.seat).map((s) => [s.name, s.seat])).toEqual(
      REAL_DATA.skills.skills.filter((s) => 'seat' in s).map((s) => [s.name, (s as { seat: string }).seat]),
    );
  });

  it('drops the static figures and archetypes here too', () => {
    expect(Object.keys(run)).not.toContain('figures');
    expect(Object.keys(run)).not.toContain('archetypes');
    expect(run.companyNames).toEqual({ [REAL_DATA.replay.company.ticker]: REAL_DATA.replay.company.name });
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
    const parsed = parseFsreRun(PROVISIONAL_FILES, { ...UNVR_FILE_NAMES, replay: 'replay-x.json' });
    expect(parsed.ok && parsed.run.provenance[2].fileName).toBe('replay-x.json');
  });
});
