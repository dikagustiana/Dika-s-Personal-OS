/**
 * Test fixtures for the FSRE building core. Imported by tests only.
 *
 * UNVR_FILES are the bundled provisional input files in their raw shape
 * (flat numeric payload fields, a top-level `figures` block and a
 * `partnerQueue`), which the ported source tests run against.
 *
 * ROUTER_FILES and tenCompanyRun() use the EXPORT shape (mount report §3.3):
 * router stage ids, `payload.figures`, ISO `at`, `ticker: null` for a
 * run-level proposal, and `stage_returned` / `stage_blocked`. Their skill
 * names are invented on purpose: if the core still worked only because a
 * provisional skill name was spelled somewhere in it, these runs would show
 * it.
 */
import replayJson from '../../../../data/fsre/replay-unvr.json';
import skillsJson from '../../../../data/fsre/skills.json';
import stagesJson from '../../../../data/fsre/stages.json';
import type { FsreRawFiles, FsreRun } from '../data';
import { parseFsreRun } from '../data';

/**
 * The bundled provisional files themselves (src/data/fsre/, copied unchanged
 * from the GLM build). Until step 3 this was a hand-written mirror.
 */
export const UNVR_FILES: FsreRawFiles = { stages: stagesJson, skills: skillsJson, replay: replayJson };

type RawEvent = Record<string, unknown>;

export const UNVR_FILE_NAMES = { stages: 'stages.json', skills: 'skills.json', replay: 'replay-unvr.json' } as const;

/* ---------- the router's stage ids, invented skill names ---------- */

const ROUTER_STAGES: Array<[string, string, string]> = [
  ['selected', 'Selected', 'router'],
  ['doc_plan', 'Document plan', 'sourcer'],
  ['intake', 'Intake', 'intaker'],
  ['gate1', 'Gate 1', 'reviewer'],
  ['normalized', 'Normalised', 'normaliser'],
  ['decomposed', 'Decomposed', 'decomposer'],
  ['benchmarked', 'Benchmarked', 'benchmarker'],
  ['gate2', 'Gate 2', 'reviewer'],
  ['calibrated', 'Calibrated', 'calibrator'],
  ['gate3', 'Gate 3', 'reviewer'],
  ['packed', 'Packed', 'router'],
  ['partner_reviewed', 'Partner reviewed', 'partner'],
  ['closed', 'Closed', 'partner'],
];

export const ROUTER_SKILLS = ['router', 'sourcer', 'intaker', 'reviewer', 'normaliser', 'decomposer', 'benchmarker', 'calibrator', 'learner'];

export function routerFiles(events: RawEvent[], run = 'syn-wave'): FsreRawFiles {
  return {
    stages: { provisional: false, source: 'Synthetic router state machine for tests.', stages: ROUTER_STAGES.map(([id, name, skill], index) => ({ id, name, order: (index + 1) * 10, skills: [skill] })) },
    skills: { provisional: false, source: 'Synthetic roles for tests.', skills: ROUTER_SKILLS.map((name) => ({ name, role: `Synthetic role of ${name}.` })) },
    replay: {
      provisional: false,
      source: 'Synthetic run for tests.',
      run,
      companies: Array.from({ length: 10 }, (_, i) => ({ ticker: syn(i + 1), name: `Synthetic company ${i + 1}` })),
      events,
    },
  };
}

export const ROUTER_FILE_NAMES = { stages: 'stages.json', skills: 'skills.json', replay: 'replay-syn.json' } as const;

export function syn(n: number): string {
  return `SYN${String(n).padStart(2, '0')}`;
}

/* ---------- ten companies, interleaved ---------- */

type Step = { kind: string; stageId?: string; skill?: string; payload?: Record<string, unknown> };

const start = (stageId: string, skill: string): Step => ({ kind: 'stage_started', stageId, skill });
const complete = (stageId: string, skill: string, figures?: Record<string, unknown>): Step => ({
  kind: 'stage_completed',
  stageId,
  skill,
  ...(figures ? { payload: { figures } } : {}),
});

/** Facts each company's intake reports; SYN08 never reaches intake. */
export const FACTS_BY_TICKER: Record<string, number> = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [syn(i + 1), (i + 1) * 1000]).filter(([ticker]) => ticker !== 'SYN08'),
);

function prefix(n: number): Step[] {
  return [
    start('selected', 'router'),
    complete('selected', 'router'),
    start('doc_plan', 'sourcer'),
    complete('doc_plan', 'sourcer'),
    start('intake', 'intaker'),
    complete('intake', 'intaker', { factsLoaded: n * 1000, rowsTraced: { value: 200, of: 209 } }),
  ];
}

const gate1Passed: Step = { kind: 'gate_passed', stageId: 'gate1', skill: 'reviewer', payload: { figures: { tieOutChecks: 21, passed: 21, failed: 0, skipped: 0 } } };
const throughBenchmark: Step[] = [
  start('normalized', 'normaliser'),
  complete('normalized', 'normaliser'),
  start('decomposed', 'decomposer'),
  complete('decomposed', 'decomposer'),
  start('benchmarked', 'benchmarker'),
  complete('benchmarked', 'benchmarker'),
];

/**
 * Where each company ends, by design (the tests compare against this, not
 * against the reducer's own output):
 *   SYN01 published → partner desk        SYN06 waits at the intake desk
 *   SYN02 at normalised (proposal logged)  SYN07 gate 2 passed WITH ESCALATION, approval refused
 *   SYN03 gate 1 FAILED, returned, passed  SYN08 still at the document plan
 *   SYN04 escalated at decomposed          SYN09 escalated at decomposed, approval refused
 *   SYN05 approved after gate 1            SYN10 blocked at normalised
 * plus one run-level proposal (ticker null).
 */
export const SCRIPTS: Record<string, Step[]> = {
  SYN01: [
    ...prefix(1),
    gate1Passed,
    ...throughBenchmark,
    { kind: 'gate_passed', stageId: 'gate2', skill: 'reviewer' },
    start('calibrated', 'calibrator'),
    complete('calibrated', 'calibrator'),
    { kind: 'gate_passed', stageId: 'gate3', skill: 'reviewer' },
    start('packed', 'router'),
    complete('packed', 'router'),
    { kind: 'approved', skill: 'partner' },
    { kind: 'published', skill: 'partner' },
  ],
  SYN02: [...prefix(2), gate1Passed, start('normalized', 'normaliser'), { kind: 'proposal_logged', skill: 'learner', payload: { title: '[SYN02 proposal: title not in the export]', mode: 'flag-only' } }],
  SYN03: [
    ...prefix(3),
    { kind: 'gate_failed', stageId: 'gate1', skill: 'reviewer', payload: { figures: { tieOutChecks: 21, passed: 17, failed: 4, skipped: 0 } } },
    { kind: 'stage_returned', stageId: 'intake', skill: 'reviewer' },
    complete('intake', 'intaker', { factsLoaded: 3000, rowsTraced: { value: 200, of: 209 } }),
    gate1Passed,
  ],
  SYN04: [
    ...prefix(4),
    gate1Passed,
    start('normalized', 'normaliser'),
    complete('normalized', 'normaliser'),
    start('decomposed', 'decomposer'),
    { kind: 'issue_raised', stageId: 'decomposed', skill: 'reviewer', payload: { title: 'SYN04 own issue' } },
    { kind: 'escalated', stageId: 'decomposed', skill: 'decomposer', payload: { reason: 'SYN04 archetype does not fit.' } },
  ],
  SYN05: [...prefix(5), gate1Passed, { kind: 'approved', skill: 'partner' }],
  SYN06: [...prefix(6)],
  SYN07: [
    ...prefix(7),
    gate1Passed,
    ...throughBenchmark,
    { kind: 'gate_passed_with_escalation', stageId: 'gate2', skill: 'reviewer', payload: { reason: 'SYN07 ranges are too wide to sign off.' } },
    { kind: 'approved', skill: 'partner' },
  ],
  SYN08: [start('selected', 'router'), complete('selected', 'router'), start('doc_plan', 'sourcer')],
  SYN09: [
    ...prefix(9),
    gate1Passed,
    start('normalized', 'normaliser'),
    complete('normalized', 'normaliser'),
    start('decomposed', 'decomposer'),
    { kind: 'issue_raised', stageId: 'decomposed', skill: 'reviewer', payload: { title: 'SYN09 own issue' } },
    { kind: 'escalated', stageId: 'decomposed', skill: 'decomposer' },
    { kind: 'approved', skill: 'partner' },
  ],
  SYN10: [...prefix(10), gate1Passed, start('normalized', 'normaliser'), { kind: 'stage_blocked', stageId: 'normalized', skill: 'normaliser' }],
};

const BASE_TIME = Date.parse('2026-02-02T08:00:00+07:00');

/** Round-robin: every company's first step, then every company's second, and so on. */
export function tenCompanyEvents(run = 'syn-wave'): RawEvent[] {
  const tickers = Object.keys(SCRIPTS);
  const longest = Math.max(...tickers.map((t) => SCRIPTS[t].length));
  const events: RawEvent[] = [];
  for (let step = 0; step < longest; step += 1) {
    for (const ticker of tickers) {
      const s = SCRIPTS[ticker][step];
      if (!s) continue;
      events.push({ id: `${ticker}-${String(step + 1).padStart(2, '0')}`, run, ticker, ...s });
    }
    if (step === 5) {
      events.push({ id: 'run-proposal-1', run, ticker: null, kind: 'proposal_logged', skill: 'learner', payload: { title: '[Run proposal: title not in the export]', mode: 'flag-only' } });
    }
  }
  return events.map((event, index) => ({ ...event, at: new Date(BASE_TIME + index * 60_000).toISOString(), source: `runs/${run}/events.jsonl` }));
}

export function parsedOrThrow(files: FsreRawFiles, names: { stages: string; skills: string; replay: string }): FsreRun {
  const parsed = parseFsreRun(files, names);
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.run;
}

export function unvrRun(): FsreRun {
  return parsedOrThrow(UNVR_FILES, UNVR_FILE_NAMES);
}

export function tenCompanyRun(): FsreRun {
  return parsedOrThrow(routerFiles(tenCompanyEvents()), ROUTER_FILE_NAMES);
}
