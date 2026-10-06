/**
 * The synthetic run script: a deterministic list of AgentEvents with
 * simulated gaps (2–8 s at 1×; the speed control compresses them). Both
 * staff in each department work in parallel; the script includes one
 * escalation, one handoff per department, one result for each gate, and one
 * staff agent that goes silent for 6 simulated minutes to exercise the
 * No signal state. All companies and figures are fictitious.
 */
import type { AgentEventType } from './contract';

/** The mock's event cadence, in seconds, at 1× clock speed (brief v2 §4: every 2–8 seconds). */
export const MOCK_EVENT_GAP_SEC = [2, 8] as const;

/** The scripted silence that exercises the No signal state (brief v2 §4: 6 simulated minutes). */
export const MOCK_SILENT_STRETCH_MIN = 6;

/** An event before the transport stamps id, seq and at. Optional fields default to null. */
export type ScriptEvent = Partial<Omit<import('./contract').AgentEvent, 'id' | 'seq' | 'at'>> & {
  agentId: string;
  type: AgentEventType;
  summary: string;
};

export interface ScriptStep {
  gapSec: number;
  event: ScriptEvent;
}

export interface RunStaffIds {
  dataLead: string;
  dataStaffA: string;
  dataStaffB: string;
  router: string;
  methodology: string;
  modellingLead: string;
  modelStaffA: string;
  modelStaffB: string;
  reviewLead: string;
  tieoutChecker: string;
  sourceChecker: string;
  owner: string;
}

/** Deterministic gap cycle inside the 2–8 s the brief specifies. */
const GAP_CYCLE = [3, 5, 2, 6, 4, 7, 2, 5, 8, 3];

export function buildRunScript(
  engagementId: string,
  tickers: [string, string],
  subIndustryName: string,
  ids: RunStaffIds,
): ScriptStep[] {
  const [A, B] = tickers;
  const steps: ScriptStep[] = [];
  let cycle = 0;
  const gap = () => GAP_CYCLE[cycle++ % GAP_CYCLE.length];
  const push = (gapSec: number, event: ScriptEvent) => steps.push({ gapSec, event });
  const say = (event: Omit<ScriptEvent, 'engagementId'>) =>
    push(gap(), { engagementId, ...event });

  /* --- 1F router: manifest --- */
  say({ agentId: ids.router, ticker: A, stageId: 'manifest', type: 'task_started', summary: `Reading the ${A} filing set and opening the manifest` });
  say({ agentId: ids.router, ticker: A, stageId: 'manifest', type: 'action', summary: `Listed 3 filings on the ${A} manifest`, sourceRef: { docId: `${A}-FY2025-A`, page: 1, note: 'Contents' }, counts: { filingsListed: 3 } });
  say({ agentId: ids.router, ticker: A, stageId: 'manifest', type: 'task_done', summary: `Manifest complete for ${A}` });
  say({ agentId: ids.router, ticker: null, stageId: null, type: 'handoff', summary: `Asked the data lead to confirm the ${A} + ${B} pair for ${subIndustryName}`, waitingOn: ids.dataLead });

  /* --- B1 data: universe, then parallel intake --- */
  say({ agentId: ids.dataLead, ticker: A, stageId: 'universe', type: 'task_started', summary: `Checking the universe for the ${subIndustryName} pair` });
  say({ agentId: ids.dataLead, ticker: A, stageId: 'universe', type: 'action', summary: `Picked peer pair ${A} + ${B}; 9 candidates considered`, counts: { candidatesConsidered: 9 } });
  say({ agentId: ids.dataLead, ticker: A, stageId: 'intake', type: 'handoff', summary: `Assigned ${A} intake to ${ids.dataStaffA}` });
  say({ agentId: ids.dataLead, ticker: B, stageId: 'intake', type: 'handoff', summary: `Assigned ${B} intake to ${ids.dataStaffB}` });
  say({ agentId: ids.dataLead, ticker: null, stageId: 'universe', type: 'task_done', summary: 'Universe pair confirmed' });

  say({ agentId: ids.dataStaffA, ticker: A, stageId: 'intake', type: 'task_started', summary: `Loading ${A} XBRL facts into the dataset`, counts: { queueDepth: 1 } });
  say({ agentId: ids.dataStaffA, ticker: A, stageId: 'intake', type: 'action', summary: 'Mapping cost-of-revenue note, row 14 of 37', sourceRef: { docId: `${A}-FY2025-A`, page: 14, note: 'Cost of revenue' }, counts: { rowsMapped: 14, rowsTotal: 37 } });
  say({ agentId: ids.dataStaffB, ticker: B, stageId: 'intake', type: 'task_started', summary: `Loading ${B} XBRL facts into the dataset`, counts: { queueDepth: 1 } });
  say({ agentId: ids.dataStaffB, ticker: B, stageId: 'intake', type: 'action', summary: `Tracing ${B} facts to the statements`, sourceRef: { docId: `${B}-FY2025-A`, page: 31, note: 'Notes' }, counts: { rowsTraced: 12, rowsTotal: 24 } });
  say({ agentId: ids.dataStaffA, ticker: A, stageId: 'intake', type: 'action', summary: 'Mapping cost-of-revenue note, row 31 of 37', sourceRef: { docId: `${A}-FY2025-A`, page: 31, note: 'Cost of revenue' }, counts: { rowsMapped: 31, rowsTotal: 37 } });
  say({ agentId: ids.dataStaffB, ticker: B, stageId: 'intake', type: 'task_done', summary: `${B} intake complete`, counts: { factsLoaded: 8214, rowsTraced: 24 } });
  say({ agentId: ids.dataStaffA, ticker: A, stageId: 'intake', type: 'task_done', summary: `${A} intake complete`, counts: { factsLoaded: 10142, rowsMapped: 37, rowsTotal: 37 } });

  /* --- B1 data: normalise in parallel --- */
  say({ agentId: ids.dataStaffA, ticker: A, stageId: 'normalise', type: 'task_started', summary: `Mapping ${A} reported lines onto the house chart` });
  say({ agentId: ids.dataStaffB, ticker: B, stageId: 'normalise', type: 'task_started', summary: `Mapping ${B} reported lines onto the house chart` });
  say({ agentId: ids.dataStaffA, ticker: A, stageId: 'normalise', type: 'action', summary: `Aligned 41 of 44 ${A} lines to the house chart`, counts: { linesMapped: 41, linesTotal: 44 } });
  say({ agentId: ids.dataStaffB, ticker: B, stageId: 'normalise', type: 'action', summary: `Aligned 39 of 39 ${B} lines to the house chart`, counts: { linesMapped: 39, linesTotal: 39 } });
  say({ agentId: ids.dataStaffA, ticker: A, stageId: 'normalise', type: 'task_done', summary: `${A} normalise complete` });
  say({ agentId: ids.dataStaffB, ticker: B, stageId: 'normalise', type: 'task_done', summary: `${B} normalise complete` });

  /* --- B1 lead's first-line check, then hand off to 3F review --- */
  say({ agentId: ids.dataLead, ticker: null, stageId: 'gate-1', type: 'handoff', summary: 'First-line check on both intakes clear; handed the pair to review' });

  /* --- 3F review: Gate 1, via the tie-out and source-trace checkers --- */
  say({ agentId: ids.reviewLead, ticker: A, stageId: 'gate-1', type: 'task_started', summary: `Opening Gate 1 on ${A} intake` });
  say({ agentId: ids.reviewLead, ticker: A, stageId: 'gate-1', type: 'handoff', summary: `Asked the tie-out checker to run 21 checks on ${A}` });
  say({ agentId: ids.sourceChecker, ticker: A, stageId: 'gate-1', type: 'action', summary: `Traced ${A} cost-of-revenue note to page 14 of the FY2025 annual report`, sourceRef: { docId: `${A}-FY2025-A`, page: 14, note: 'Cost of revenue' }, counts: { rowsTraced: 37, rowsTotal: 37 } });
  say({ agentId: ids.tieoutChecker, ticker: A, stageId: 'gate-1', type: 'action', summary: 'Tie-out: balance sheet total, passed', counts: { checksPassed: 21, checksFailed: 0, checksSkipped: 0 } });
  say({ agentId: ids.tieoutChecker, ticker: A, stageId: 'gate-1', type: 'handoff', summary: 'Returned 21 of 21 checks passed to the review lead' });
  say({ agentId: ids.reviewLead, ticker: A, stageId: 'gate-1', type: 'gate_result', summary: `Gate 1 on ${A}: passed`, counts: { gatesFailed: 0, checksPassed: 21, checksFailed: 0 } });
  say({ agentId: ids.reviewLead, ticker: B, stageId: 'gate-1', type: 'task_started', summary: `Opening Gate 1 on ${B} intake` });
  say({ agentId: ids.tieoutChecker, ticker: B, stageId: 'gate-1', type: 'action', summary: 'Tie-out: balance sheet total, passed', counts: { checksPassed: 19, checksFailed: 0, checksSkipped: 0 } });
  say({ agentId: ids.reviewLead, ticker: B, stageId: 'gate-1', type: 'gate_result', summary: `Gate 1 on ${B}: passed`, counts: { gatesFailed: 0, checksPassed: 19, checksFailed: 0 } });

  /* --- 2F modelling: lead assigns, staff decompose in parallel --- */
  say({ agentId: ids.modellingLead, ticker: A, stageId: 'decomposition', type: 'handoff', summary: `Reviewed both normalises first-line; assigned ${A} decomposition to ${ids.modelStaffA}` });
  say({ agentId: ids.modelStaffA, ticker: A, stageId: 'decomposition', type: 'task_started', summary: `Splitting ${A} reported lines into operating drivers` });
  say({ agentId: ids.modelStaffA, ticker: A, stageId: 'decomposition', type: 'action', summary: `Fitted ${A} revenue drivers on 30 of 36 periods`, counts: { periodsFitted: 30, periodsTotal: 36 } });
  say({ agentId: ids.modellingLead, ticker: B, stageId: 'decomposition', type: 'handoff', summary: `Assigned ${B} decomposition to ${ids.modelStaffB}` });
  say({ agentId: ids.modelStaffB, ticker: B, stageId: 'decomposition', type: 'task_started', summary: `Splitting ${B} reported lines into operating drivers` });
  say({ agentId: ids.modelStaffB, ticker: B, stageId: 'decomposition', type: 'action', summary: `Fitted ${B} cost drivers on 12 of 36 periods`, counts: { periodsFitted: 12, periodsTotal: 36 } });

  /* --- model-staff-b now goes silent for 6 simulated minutes; the desk
     must read "No signal" after 5. Other desks keep working meanwhile. --- */
  say({ agentId: ids.modelStaffA, ticker: A, stageId: 'decomposition', type: 'task_done', summary: `${A} decomposition complete`, counts: { periodsFitted: 34, periodsTotal: 36 } });
  say({ agentId: ids.modellingLead, ticker: A, stageId: 'benchmark', type: 'action', summary: `Built ${subIndustryName} ranges from ${A} drivers`, counts: { peersCompared: 1 } });
  say({ agentId: ids.methodology, ticker: null, stageId: null, type: 'action', summary: 'Logged 1 recurring error across runs; drafted a methodology note', counts: { errorsLogged: 1 } });
  say({ agentId: ids.sourceChecker, ticker: B, stageId: 'gate-1', type: 'action', summary: `Traced 24 of 24 ${B} rows to their filings`, counts: { rowsTraced: 24, rowsTotal: 24 } });
  say({ agentId: ids.router, ticker: null, stageId: 'holdout', type: 'action', summary: 'Prepared the sealed holdout for the pair', counts: { holdoutPeriods: 6 } });
  say({ agentId: ids.dataLead, ticker: B, stageId: 'normalise', type: 'action', summary: `First-line check on ${B} normalise: clear` });
  say({ agentId: ids.reviewLead, ticker: A, stageId: 'gate-2', type: 'action', summary: `Reviewed ${A} decomposition before Gate 2` });
  say({ agentId: ids.modelStaffA, ticker: A, stageId: 'model', type: 'task_started', summary: `Building the calibrated ${A} model` });
  say({ agentId: ids.modelStaffA, ticker: A, stageId: 'model', type: 'action', summary: `Calibrated the ${A} forward mode on 36 periods`, counts: { periodsCalibrated: 36 } });
  say({ agentId: ids.modellingLead, ticker: null, stageId: 'benchmark', type: 'action', summary: `Compared ${A} and ${B} driver ranges for ${subIndustryName}`, counts: { peersCompared: 2 } });
  say({ agentId: ids.modelStaffA, ticker: A, stageId: 'model', type: 'task_done', summary: `${A} model complete` });

  /* --- the silence lifts --- */
  push(MOCK_SILENT_STRETCH_MIN * 60, { engagementId, agentId: ids.modelStaffB, ticker: B, stageId: 'decomposition', type: 'action', summary: `Fitted ${B} cost drivers on 28 of 36 periods`, counts: { periodsFitted: 28, periodsTotal: 36 } });
  say({ agentId: ids.modelStaffB, ticker: B, stageId: 'decomposition', type: 'task_done', summary: `${B} decomposition complete` });
  say({ agentId: ids.modelStaffB, ticker: B, stageId: 'model', type: 'task_started', summary: `Building the calibrated ${B} model` });
  say({ agentId: ids.modelStaffB, ticker: B, stageId: 'model', type: 'action', summary: `Calibrated the ${B} forward mode on 36 periods`, counts: { periodsCalibrated: 36 } });
  say({ agentId: ids.modelStaffB, ticker: B, stageId: 'model', type: 'task_done', summary: `${B} model complete` });

  /* --- 3F review: Gate 2 — SYNB clean, SYNA passes with an escalation --- */
  say({ agentId: ids.reviewLead, ticker: A, stageId: 'gate-2', type: 'task_started', summary: `Opening Gate 2 on ${A}` });
  say({ agentId: ids.reviewLead, ticker: A, stageId: 'gate-2', type: 'gate_result', summary: `Gate 2 on ${A}: passed with an escalation`, counts: { gatesFailed: 0, checksPassed: 14, checksFailed: 0 } });
  push(2, { engagementId, agentId: ids.reviewLead, ticker: A, stageId: 'gate-2', type: 'escalation_opened', summary: `Escalation: the ${A} decomposition fit missed 2 of 36 periods; needs your decision before Gate 3`, counts: { periodsMissed: 2 }, escalationId: `${engagementId}-esc-1` });
  say({ agentId: ids.reviewLead, ticker: B, stageId: 'gate-2', type: 'task_started', summary: `Opening Gate 2 on ${B}` });
  say({ agentId: ids.reviewLead, ticker: B, stageId: 'gate-2', type: 'gate_result', summary: `Gate 2 on ${B}: passed`, counts: { gatesFailed: 0, checksPassed: 17, checksFailed: 0 } });

  /* --- 1F router: sealed holdout --- */
  say({ agentId: ids.router, ticker: null, stageId: 'holdout', type: 'task_started', summary: `Sealing the holdout for the ${subIndustryName} pair` });
  say({ agentId: ids.router, ticker: null, stageId: 'holdout', type: 'action', summary: 'Holdout stayed sealed; no holdout value reached the models', counts: { holdoutPeriods: 6 } });
  say({ agentId: ids.router, ticker: null, stageId: 'holdout', type: 'task_done', summary: 'Holdout check complete' });

  /* --- 3F review: Gate 3 on B, then wait for the owner on A --- */
  say({ agentId: ids.reviewLead, ticker: B, stageId: 'gate-3', type: 'task_started', summary: `Opening Gate 3 on ${B}` });
  say({ agentId: ids.reviewLead, ticker: B, stageId: 'gate-3', type: 'gate_result', summary: `Gate 3 on ${B}: passed`, counts: { gatesFailed: 0, checksPassed: 20, checksFailed: 0 } });
  say({ agentId: ids.reviewLead, ticker: A, stageId: 'gate-3', type: 'waiting', summary: `Gate 3 on ${A} waits for the escalation decision`, waitingOn: ids.owner });

  /* --- 4F owner: version v1 of B is ready while the escalation is open --- */
  say({ agentId: ids.owner, ticker: B, stageId: 'sign-off', type: 'task_started', summary: `${B} v1 is ready for sign-off; Gate 3 passed` });
  say({ agentId: ids.owner, ticker: B, stageId: 'sign-off', type: 'waiting', summary: 'Waiting for the owner to approve version v1', waitingOn: null });

  return steps;
}

/**
 * Events the mock emits after the owner's override resolves the open
 * escalation. The escalation_closed event itself is emitted once, by
 * scheduleCommandFlow in mockTransport, with the real escalation id; this
 * script only walks the consequences: Gate 3 passes, the engagement reaches
 * sign-off.
 */
export function buildResolutionScript(
  engagementId: string,
  ticker: string,
  ids: RunStaffIds,
): ScriptStep[] {
  return [
    { gapSec: 3, event: { engagementId, agentId: ids.reviewLead, ticker, stageId: 'gate-3', type: 'task_started', summary: `Opening Gate 3 on ${ticker}` } },
    { gapSec: 4, event: { engagementId, agentId: ids.reviewLead, ticker, stageId: 'gate-3', type: 'gate_result', summary: `Gate 3 on ${ticker}: passed`, counts: { gatesFailed: 0, checksPassed: 20, checksFailed: 0 } } },
    { gapSec: 3, event: { engagementId, agentId: ids.owner, ticker, stageId: 'sign-off', type: 'task_started', summary: `${ticker} v1 is ready for sign-off; Gate 3 passed` } },
    { gapSec: 2, event: { engagementId, agentId: ids.owner, ticker, stageId: 'sign-off', type: 'waiting', summary: 'Waiting for the owner to approve version v1', waitingOn: null } },
  ];
}
