/**
 * Test fixtures for the FSRE building core. Imported by tests only.
 *
 * UNVR_FILES mirrors the provisional input files in their raw shape (flat
 * numeric payload fields, a top-level `figures` block and a `partnerQueue`),
 * so the ported source tests run before the files themselves are bundled.
 *
 * ROUTER_FILES and tenCompanyRun() use the EXPORT shape (mount report §3.3):
 * router stage ids, `payload.figures`, ISO `at`, `ticker: null` for a
 * run-level proposal, and `stage_returned` / `stage_blocked`. Their skill
 * names are invented on purpose: if the core still worked only because a
 * provisional skill name was spelled somewhere in it, these runs would show
 * it.
 */
import type { FsreRawFiles, FsreRun } from '../data';
import { parseFsreRun } from '../data';

const CHAT = 'Chat summary of the fsre-skills dry-run report and build log (read 30 Sep 2026). Not verified against the files.';

type RawEvent = Record<string, unknown>;

function unvrEvent(id: string, kind: string, stageId: string | undefined, skill: string, payload?: Record<string, unknown>): RawEvent {
  return {
    id,
    run: 'unvr-dry-run',
    ticker: 'UNVR',
    kind,
    at: null,
    source: CHAT,
    ...(stageId ? { stageId } : {}),
    skill,
    ...(payload ? { payload } : {}),
  };
}

const UNVR_STAGES: Array<[string, string, string]> = [
  ['manifest', 'Manifest', 'fs-reverse-engineering'],
  ['universe', 'Universe', 'idx-universe'],
  ['sourcing', 'Sourcing', 'data-sourcing'],
  ['intake', 'Intake', 'fs-intake'],
  ['gate-1', 'Gate 1', 'review-manager'],
  ['normalise', 'Normalise', 'fs-normalize'],
  ['decomposition', 'Decomposition', 'fs-driver-decomposition'],
  ['benchmark', 'Benchmark', 'peer-benchmark'],
  ['model', 'Model', 'financial-modeling'],
  ['gate-2', 'Gate 2', 'review-manager'],
  ['holdout', 'Holdout', 'fs-reverse-engineering'],
  ['gate-3', 'Gate 3', 'review-manager'],
  ['sign-off', 'Sign-off', 'owner'],
];

const UNVR_SKILLS: Array<[string, string]> = [
  ['fs-reverse-engineering', 'Router: runs the stage sequence, keeps the holdout values away from the other skills, and hands work between them.'],
  ['idx-universe', 'Lists IDX companies by sub-industry and picks the ones a wave will model.'],
  ['data-sourcing', "Finds each company's filings and records where every document came from."],
  ['fs-intake', 'Loads XBRL facts into the dataset and ties them out against the statements.'],
  ['fs-normalize', 'Maps reported concepts onto one set of lines so companies can be compared.'],
  ['fs-driver-decomposition', "Splits reported lines into operating drivers using the company's archetype."],
  ['peer-benchmark', 'Builds sub-industry ranges for each driver from two or more companies.'],
  ['financial-modeling', 'Builds the calibrated historical model and its forward mode.'],
  ['review-manager', 'Runs the three gates and raises issues or escalations to the owner.'],
  ['guruh', 'Logs errors across runs and proposes methodology changes between waves.'],
];

export const UNVR_FILES: FsreRawFiles = {
  stages: {
    provisional: true,
    source: "Provisional stage list written in chat. Replace with the router's state machine from fs-reverse-engineering.",
    stages: UNVR_STAGES.map(([id, name, skill], index) => ({ id, name, order: index + 1, skills: [skill] })),
  },
  skills: {
    provisional: true,
    source: "Roles written in chat from the suite's design; not taken from the skill files.",
    skills: UNVR_SKILLS.map(([name, role]) => ({ name, role })),
  },
  replay: {
    provisional: true,
    run: 'unvr-dry-run',
    company: { ticker: 'UNVR', name: 'Unilever Indonesia' },
    timesRecorded: false,
    archetypes: ['ARC-DIST', 'ARC-PROC', 'ARC-ASSET'],
    figures: { factsLoaded: { value: 10142, source: CHAT } },
    events: [
      unvrEvent('e01', 'stage_started', 'manifest', 'fs-reverse-engineering'),
      unvrEvent('e02', 'stage_completed', 'manifest', 'fs-reverse-engineering'),
      unvrEvent('e03', 'stage_started', 'universe', 'idx-universe'),
      unvrEvent('e04', 'stage_completed', 'universe', 'idx-universe'),
      unvrEvent('e05', 'stage_started', 'sourcing', 'data-sourcing'),
      unvrEvent('e06', 'stage_completed', 'sourcing', 'data-sourcing', { filings: 5 }),
      unvrEvent('e07', 'stage_started', 'intake', 'fs-intake'),
      unvrEvent('e08', 'stage_completed', 'intake', 'fs-intake', { factsLoaded: 10142, rows: 209, unmappedConcepts: 0, rowsTraced: 209 }),
      unvrEvent('e09', 'gate_passed', 'gate-1', 'review-manager', { tieOutChecks: 21, passed: 18, failed: 0, skipped: 3 }),
      unvrEvent('e10', 'stage_started', 'normalise', 'fs-normalize'),
      unvrEvent('e11', 'stage_completed', 'normalise', 'fs-normalize'),
      unvrEvent('e12', 'stage_started', 'decomposition', 'fs-driver-decomposition'),
      unvrEvent('e13', 'issue_raised', 'decomposition', 'review-manager', { title: 'Archetype misfit', detail: 'ARC-PROC fitted 0 of 36 identity periods.' }),
      unvrEvent('e14', 'issue_raised', 'decomposition', 'review-manager', { title: '[Second review issue: title not in the summary]' }),
      unvrEvent('e15', 'escalated', 'decomposition', 'fs-driver-decomposition', {
        reason: 'ARC-PROC fitted 0 of 36 identity periods. The process archetype needs volume and capacity disclosures that a brand owner does not make.',
      }),
      unvrEvent('e16', 'proposal_logged', undefined, 'guruh', { title: '[Proposal 1: title not in the summary]', mode: 'flag-only' }),
      unvrEvent('e17', 'proposal_logged', undefined, 'guruh', { title: '[Proposal 2: title not in the summary]', mode: 'flag-only' }),
    ],
    partnerQueue: [
      { kind: 'escalation', title: 'UNVR, driver decomposition: archetype misfit', detail: 'ARC-PROC fitted 0 of 36 identity periods. Raised by review-manager.', source: CHAT },
      { kind: 'proposal', title: '[Proposal 1: title not in the summary]', detail: "Flag-only. Applies between waves, after the owner's approval.", source: CHAT },
      { kind: 'proposal', title: '[Proposal 2: title not in the summary]', detail: "Flag-only. Applies between waves, after the owner's approval.", source: CHAT },
    ],
    note: 'Stopgap file written in chat. Replace with the export from fsre-skills when it runs.',
  },
};

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
