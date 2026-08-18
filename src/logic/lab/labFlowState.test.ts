// The Flow state's honesty rules, pinned:
//
//  §1 Every stage state is DERIVED BY QUERY over the epistemic rows — no
//     tracking table exists to read. These tests hand the deriver raw rows
//     and assert the thirteen verdicts, the front line, and the counts.
//  §2 A blocked stage NAMES its blocker and the offending record id.
//  §3 The WIP figure is a ratio of two KNOWN numbers; nothing in the state
//     is a percentage-complete or an ETA (there is no field to render one
//     from — asserted by shape).
//  §4 Refusals reach the console FROM THE RUN ROWS (083) — the persisted
//     column, not the response body — so they survive a reload.
import { describe, expect, it } from 'vitest';
import type { LabRun } from '../../data/labTypes';
import { deriveFlowState, STAGES, type FlowInput } from './labFlowState';
import { IND_WIP_CAP_DISPLAY } from './labConfig';

const NOW = new Date('2026-08-18T12:00:00Z');

function baseInput(overrides: Partial<FlowInput> = {}): FlowInput {
  return {
    projectId: 'p1',
    projects: [
      { id: 'p1', name: 'Proyek', researchQuestion: '', status: 'active', wipSlot: 1 },
    ],
    questions: [],
    subQuestions: [],
    requirements: [],
    candidates: [],
    sources: [],
    references: [],
    datapoints: [],
    conflicts: [],
    claims: [],
    contradictions: [],
    outputs: [],
    tasks: [],
    modelSpecs: [],
    modelParams: [],
    modelResults: [],
    runs: [],
    agents: [],
    providers: [],
    sweep: { ranAt: '2026-08-18T02:00:00Z', rowsDemoted: 0 },
    sweepReadFailed: false,
    agentsReadFailed: false,
    supabaseConfigured: false,
    readFailureDetail: null,
    probe: null,
    live: null,
    now: NOW,
    ...overrides,
  };
}

function datapoint(id: string, status: 'IND' | 'V' | 'NA', retrievedAt = '2026-08-17T00:00:00Z') {
  return {
    id,
    value: 7.3,
    unit: '%',
    year: 2025,
    geography: 'ID',
    definitionScope: 'a definition scope long enough for the gate',
    sourceDocumentId: 'src-1',
    locator: 'tab 2.1',
    retrievedAt,
    status,
    verificationNote: status === 'V' ? 'checked' : '',
    verifiedAt: status === 'V' ? '2026-08-17T00:00:00Z' : null,
    volatilityClass: 'volatile' as const,
    extractionMethod: 'manual' as const,
    internalCheckPassed: null,
  };
}

function claim(id: string, status: 'draft' | 'reviewed' | 'approved', datapointIds: string[] = []) {
  return {
    id,
    projectId: 'p1',
    statement: `claim ${id}`,
    layer: 'B' as const,
    commitmentSourceId: null,
    evidenceDirection: 'supports' as const,
    status,
    approvedByHumanAt: status === 'approved' ? '2026-08-17T00:00:00Z' : null,
    createdByRunId: null,
    inferenceStep: 'the matched figure sits below the capacity figure on the same basis',
    datapointIds,
    referenceIds: [],
  };
}

function run(partial: Partial<LabRun> & Pick<LabRun, 'id' | 'agentId'>): LabRun {
  return {
    providerId: 'prov-1',
    parentRunId: null,
    chainId: null,
    stepIndex: null,
    input: '',
    output: '',
    status: 'ok',
    model: 'claude-sonnet-4-5',
    error: null,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.001,
    durationMs: 900,
    refusals: [],
    createdAt: '2026-08-18T10:00:00Z',
    ...partial,
  };
}

describe('§1 stage states derive by query, and the front line is counted', () => {
  it('a fresh project fronts at S0 with everything downstream idle or barred', () => {
    const state = deriveFlowState(baseInput());
    expect(state.stages).toHaveLength(13);
    expect(state.stages[0].status).toBe('idle');
    expect(state.orchestration.frontLine?.code).toBe('S0');
    // S11 is barred, not hidden: zero approved claims names the project.
    const draft = state.stages[11];
    expect(draft.status).toBe('blocked');
    expect(draft.blockers[0].recordId).toBe('p1');
    expect(state.orchestration.doneCount).toBe(0);
  });

  it('the owner queue holds the front line at S5 while IND rows wait', () => {
    const state = deriveFlowState(
      baseInput({
        questions: [{ id: 'q1', projectId: 'p1', rawStatement: 'raw', framedQuestion: 'framed', framingSource: 'owner_written' }],
        subQuestions: [{ id: 'sq1', questionId: 'q1', statement: 's', falsifier: 'an observation that would show this wrong', position: 0 }],
        requirements: [
          { id: 'r1', subQuestionId: 'sq1', description: 'd', kind: 'datapoint', satisfiedByDatapointId: null, satisfiedByReferenceId: null, satisfiedByModelResultId: null, satisfiedAt: null },
        ],
        sources: [{ id: 'src-1', title: 'Yearbook', publisher: 'BPS', publicationDate: null, docType: 'government_report', url: '', localSnapshotPath: 'snap', snapshotHash: 'h', retrievedAt: '2026-08-17T00:00:00Z', lastRecheckedAt: null, contentChangedAt: null }],
        datapoints: [datapoint('dp-v', 'V'), datapoint('dp-ind', 'IND')],
      }),
    );
    expect(state.stages[5].status).toBe('attention');
    expect(state.orchestration.frontLine?.code).toBe('S5');
    expect(state.stages[5].headline).toContain(`1/${IND_WIP_CAP_DISPLAY} WIP`);
  });

  it('an idle optional stage is passed by, never pinning the front line', () => {
    const state = deriveFlowState(
      baseInput({
        questions: [{ id: 'q1', projectId: 'p1', rawStatement: 'raw', framedQuestion: 'framed', framingSource: 'owner_written' }],
        subQuestions: [{ id: 'sq1', questionId: 'q1', statement: 's', falsifier: 'an observation that would show this wrong', position: 0 }],
        requirements: [
          { id: 'r1', subQuestionId: 'sq1', description: 'd', kind: 'datapoint', satisfiedByDatapointId: null, satisfiedByReferenceId: null, satisfiedByModelResultId: null, satisfiedAt: null },
        ],
        sources: [{ id: 'src-1', title: 'Yearbook', publisher: 'BPS', publicationDate: null, docType: 'government_report', url: '', localSnapshotPath: 'snap', snapshotHash: 'h', retrievedAt: '2026-08-17T00:00:00Z', lastRecheckedAt: null, contentChangedAt: null }],
        references: [{ id: 'ref-1', title: 't', authors: '', container: '', publicationYear: null, doi: '', url: '', verificationLevel: 'full_text_read', fullTextPath: 'p' }],
        datapoints: [datapoint('dp-v', 'V')],
        claims: [claim('c1', 'reviewed', ['dp-v'])], // S8 done, S10 attention
      }),
    );
    // S7 Model has no specs (idle) but S8+ carries work — the line moves on.
    expect(state.stages[7].status).toBe('idle');
    expect(state.orchestration.frontLine?.code).not.toBe('S7');
    expect(state.orchestration.frontLine?.code).toBe('S9');
  });
});

describe('§2 blocked stages name the blocker and the record', () => {
  it('S4 blocks at the WIP cap, naming the head of the verification queue', () => {
    const queue = Array.from({ length: IND_WIP_CAP_DISPLAY }, (_, index) =>
      datapoint(`dp-${index}`, 'IND', `2026-08-0${(index % 9) + 1}T00:00:00Z`),
    );
    const state = deriveFlowState(baseInput({ datapoints: queue }));
    const extract = state.stages[4];
    expect(extract.status).toBe('blocked');
    expect(extract.blockers[0].reason).toContain(`WIP cap: ${IND_WIP_CAP_DISPLAY}`);
    expect(extract.blockers[0].reason).toContain('Verifikasi');
    // The record named is the OLDEST queued datapoint — the next thing to do.
    expect(extract.blockers[0].recordId).toBe('dp-0');
    expect(state.orchestration.indOpen).toBe(IND_WIP_CAP_DISPLAY);
  });

  it('S10 blocks on an open DIRECT contradiction, naming it and the opposing claim', () => {
    const state = deriveFlowState(
      baseInput({
        datapoints: [datapoint('dp-v', 'V')],
        claims: [claim('c-approved', 'approved', ['dp-v']), claim('c-other', 'reviewed', ['dp-v'])],
        contradictions: [
          { id: 'contra-1', claimAId: 'c-approved', claimBId: 'c-other', severity: 'direct', status: 'open', resolutionNote: '' },
        ],
      }),
    );
    const approve = state.stages[10];
    expect(approve.status).toBe('blocked');
    expect(approve.blockers[0].recordId).toBe('c-other');
    expect(approve.blockers[0].reason).toContain('contra-1');
    expect(approve.blockers[0].reason).toContain('c-approved');
  });

  it('S12 blocks on a stale sweep, and the refusal names the SWEEP, not the data', () => {
    const state = deriveFlowState(
      baseInput({
        datapoints: [datapoint('dp-v', 'V')],
        claims: [claim('c1', 'approved', ['dp-v'])],
        outputs: [
          { id: 'out-1', projectId: 'p1', outputType: 'briefing', content: 'In 2025 utilisation stood at 7.3 percent.', status: 'draft', stale: false, generatedByRunId: null, claimIds: ['c1'], subQuestionIds: [] },
        ],
        sweep: { ranAt: '2026-08-15T12:00:00Z', rowsDemoted: 0 }, // 72h old
      }),
    );
    const finalize = state.stages[12];
    expect(finalize.status).toBe('blocked');
    const sweepBlocker = finalize.blockers.find((blocker) => blocker.reason.includes('SWEEP'));
    expect(sweepBlocker?.reason).toContain('72 jam');
    expect(sweepBlocker?.recordId).toBe('out-1');
  });

  it('S12 re-runs G-NUMBER against the CURRENT cited set — an unlinked claim resurfaces by token', () => {
    const state = deriveFlowState(
      baseInput({
        datapoints: [datapoint('dp-v', 'V')],
        claims: [claim('c1', 'approved', ['dp-v'])],
        outputs: [
          // 9,100 has nothing behind it: the save-time backing moved on.
          { id: 'out-1', projectId: 'p1', outputType: 'briefing', content: 'Capacity reached 9,100 units.', status: 'draft', stale: false, generatedByRunId: null, claimIds: ['c1'], subQuestionIds: [] },
        ],
      }),
    );
    const gNumber = state.stages[12].blockers.find((blocker) => blocker.reason.includes('9,100'));
    expect(gNumber).toBeDefined();
    expect(gNumber?.recordId).toBe('out-1');
  });
});

describe('§3 nothing invents work-completion progress', () => {
  it('the state carries counted facts only — no percent, no ETA fields', () => {
    const state = deriveFlowState(baseInput());
    const flat = JSON.stringify(state).toLowerCase();
    expect(flat).not.toContain('percentcomplete');
    expect(flat).not.toContain('"eta"');
    expect(flat).not.toContain('remainingms');
    // The one ratio allowed is known/known: IND against the cap.
    expect(state.orchestration.indCap).toBe(IND_WIP_CAP_DISPLAY);
  });
});

describe('§4 the console derives from persisted rows', () => {
  const agents = [
    { id: 'a-ex', slug: 'evidence-extractor', name: 'Extractor', description: '', systemPrompt: '', dataClass: 'internal' as const, defaultProviderId: 'prov-1', version: 1, isActive: true, createdAt: '', updatedAt: '' },
  ];
  const providers = [
    { id: 'prov-1', name: 'anthropic' as const, adapter: 'anthropic' as const, baseUrl: '', model: 'claude-sonnet-4-5', costInPerMtok: 3, costOutPerMtok: 15, isActive: true },
  ];

  it('refusals on run rows become quiet REFUSED lines with the agent attached', () => {
    const state = deriveFlowState(
      baseInput({
        agents,
        providers,
        runs: [
          run({ id: 'r1', agentId: 'a-ex', refusals: ['value=9100 — echo check: this number does not appear in the selected text'] }),
        ],
      }),
    );
    const refused = state.log.filter((line) => line.level === 'REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused[0].agentSlug).toBe('evidence-extractor');
    expect(refused[0].text).toContain('echo check');
    // And the run line itself is OK — a refusal is not an error.
    expect(state.log.find((line) => line.run?.id === 'r1')?.level).toBe('OK');
  });

  it('an error run keeps its row visible with the server text — never idle-looking', () => {
    const state = deriveFlowState(
      baseInput({ agents, providers, runs: [run({ id: 'r2', agentId: 'a-ex', status: 'error', error: 'Model call failed (429).' })] }),
    );
    const line = state.log.find((entry) => entry.run?.id === 'r2');
    expect(line?.text).toContain('Model call failed (429).');
  });

  it('usage aggregates per RESOLVED model string from the run log', () => {
    const state = deriveFlowState(
      baseInput({
        agents,
        providers,
        runs: [
          run({ id: 'r1', agentId: 'a-ex', model: 'claude-sonnet-4-5', costUsd: 0.02, tokensIn: 1000, tokensOut: 500 }),
          run({ id: 'r2', agentId: 'a-ex', model: 'claude-sonnet-4-5', costUsd: 0.01, tokensIn: 400, tokensOut: 100 }),
          run({ id: 'r3', agentId: 'a-ex', model: 'kimi-k2-0905-preview', costUsd: 0.001, tokensIn: 50, tokensOut: 20 }),
        ],
      }),
    );
    expect(state.usage).toHaveLength(2);
    expect(state.usage[0]).toMatchObject({ model: 'claude-sonnet-4-5', runs: 2, tokensIn: 1400, tokensOut: 600 });
    expect(state.usage[0].usd).toBeCloseTo(0.03);
  });

  it('the roster stands on the fixed agent set; a violated boundary is named', () => {
    const state = deriveFlowState(
      baseInput({
        agents: [{ ...agents[0], dataClass: 'public' }],
        providers,
      }),
    );
    expect(state.agents).toHaveLength(9);
    expect(state.agents.map((row) => row.slug)).toContain('evidence-drafter');
    expect(state.services.boundary.state).toBe('violated');
    expect(state.services.boundary.violations[0]).toContain('evidence-extractor');
  });

  it('a live chain step surfaces as the WAIT line with its step ordinal', () => {
    const state = deriveFlowState(
      baseInput({
        live: { agentSlug: 'evidence-locator', action: 'run', chainId: 'ch1', stepIndex: 1, stepCount: 3, startedAt: NOW.getTime() - 5000 },
      }),
    );
    const wait = state.log.find((line) => line.level === 'WAIT');
    expect(wait?.text).toContain('langkah 2 dari 3');
    expect(state.stages[3].running).toBe(true); // locator's station S3
  });

  it('a FAILED sweep read says could-not-check, never "belum pernah"', () => {
    const state = deriveFlowState(
      baseInput({
        datapoints: [datapoint('dp-v', 'V')],
        claims: [claim('c1', 'approved', ['dp-v'])],
        outputs: [
          { id: 'out-1', projectId: 'p1', outputType: 'briefing', content: '', status: 'draft', stale: false, generatedByRunId: null, claimIds: ['c1'], subQuestionIds: [] },
        ],
        sweep: null,
        sweepReadFailed: true,
      }),
    );
    const blocker = state.stages[12].blockers.find((entry) => entry.reason.includes('tidak bisa dibaca'));
    expect(blocker).toBeDefined();
    expect(state.stages[12].detail[0]).toContain('tidak bisa dicek');
    expect(state.stages[12].detail[0]).not.toContain('belum pernah tercatat.');
  });

  it('STAGES stays thirteen, and the sweep heartbeat feeds the cron row', () => {
    expect(STAGES).toHaveLength(13);
    const state = deriveFlowState(baseInput({ sweep: null }));
    expect(state.services.cron.state).toBe('never');
    const failed = deriveFlowState(baseInput({ sweep: null, sweepReadFailed: true }));
    expect(failed.services.cron.state).toBe('unknown');
  });
});
