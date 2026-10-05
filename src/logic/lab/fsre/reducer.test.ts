import { describe, expect, it } from 'vitest';
import type { FsreEvent } from './events';
import { deskKeyForGate, deskKeyForSkill } from './layout';
import {
  agentEventIndexes,
  agentStatus,
  approvalLock,
  buildContext,
  createInitialState,
  createStateCache,
  effectiveStageStatus,
  folderStatus,
  foldersByDesk,
  gateBreakdown,
  gateSummary,
  isRefusedApproval,
  openPartnerCount,
  partnerItems,
  partnerKey,
  reduceEvent,
  reduceEvents,
  runTotals,
  stageAggregate,
  type FsreContext,
  type FsreState,
} from './reducer';
import { filterCompanies, searchResults, selectionForResult } from './search';
import { FACTS_BY_TICKER, UNVR_FILES, syn, tenCompanyRun, unvrRun } from './__fixtures__/fsreFixtures';

/* ---------- the UNVR replay (ported from the source's reducer.test.ts) ---------- */

const unvr = unvrRun();
const uctx = buildContext(unvr);
const all = unvr.events;
const after = (count: number) => reduceEvents(uctx, all.slice(0, count));
const eventOf = (id: string): FsreEvent => {
  const event = all.find((e) => e.id === id);
  if (!event) throw new Error(`Event ${id} missing from the replay`);
  return event;
};
const UNVR = (state: FsreState) => state.companies.UNVR;
const extra = (event: Partial<FsreEvent> & Pick<FsreEvent, 'id' | 'kind'>): FsreEvent => ({ run: unvr.id, ticker: 'UNVR', at: null, ...event });

describe('the reducer, on the UNVR replay', () => {
  it('is deterministic: folding the same events twice gives the same state', () => {
    expect(reduceEvents(uctx, all)).toEqual(reduceEvents(uctx, all));
  });

  it('changes nothing when no event is applied', () => {
    const initial = createInitialState(uctx);
    const none = reduceEvents(uctx, []);
    expect(none).toEqual(initial);
    expect(none.companyOrder).toEqual([]);
    expect(Object.keys(none.agents).every((skill) => agentStatus(uctx, none, skill) === 'idle')).toBe(true);
    expect(partnerItems(none)).toEqual([]);
    expect(runTotals(none).figures).toEqual({});
    expect(foldersByDesk(none)).toEqual({});
  });

  it('shows no folder before an event names the company, then moves it as stages start', () => {
    expect(after(0).companies.UNVR).toBeUndefined();
    expect(UNVR(after(1)).deskKey).toBe(deskKeyForSkill('fs-reverse-engineering'));
    expect(UNVR(after(3)).deskKey).toBe(deskKeyForSkill('idx-universe'));
    expect(UNVR(after(12)).deskKey).toBe(deskKeyForSkill('fs-driver-decomposition'));
  });

  it('feeds the intake payload into the facts total', () => {
    expect(runTotals(after(7)).figures.factsLoaded).toBeUndefined();
    expect(runTotals(after(8)).figures.factsLoaded?.value).toBe(10142);
  });

  it('records the gate 1 result and its tie-out figures', () => {
    const state = after(9);
    expect(gateSummary(UNVR(state), 'gate-1').worst).toBe('passed');
    expect(UNVR(state).gates[0].figures).toEqual({ tieOutChecks: 21, passed: 18, failed: 0, skipped: 3 });
    expect(runTotals(state).figures.tieOutChecks?.value).toBe(21);
  });

  it('raises review issues and stalls the stage runner until it escalates', () => {
    expect(UNVR(after(13)).issues).toHaveLength(1);
    expect(agentStatus(uctx, after(13), 'fs-driver-decomposition')).toBe('stalled');
    expect(UNVR(after(14)).issues).toHaveLength(2);
    const escalated = after(15);
    expect(agentStatus(uctx, escalated, 'fs-driver-decomposition')).toBe('escalated');
    expect(effectiveStageStatus(UNVR(escalated), 'decomposition')).toBe('escalated');
  });

  it('turns an escalation into a partner-room item and locks approval with the reason', () => {
    const before = after(14);
    expect(approvalLock(before, 'UNVR').locked).toBe(false);
    expect(partnerItems(before)).toHaveLength(0);
    const state = reduceEvent(uctx, before, eventOf('e15'));
    const items = partnerItems(state);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'escalation', ticker: 'UNVR', key: 'UNVR:e15', state: 'open' });
    expect(items[0].reason).toContain('ARC-PROC fitted 0 of 36 identity periods');
    // Titled with THIS company's first open issue at the stage.
    expect(items[0].title).toBe('UNVR, Decomposition: Archetype misfit');
    const lock = approvalLock(state, 'UNVR');
    expect(lock.locked).toBe(true);
    expect(lock.reasons.map((r) => r.reason).join(' ')).toContain('ARC-PROC fitted 0 of 36 identity periods');
    expect(runTotals(state).escalationsOpen).toBe(1);
  });

  it('adds proposals to the partner room, verbatim', () => {
    const state = after(17);
    expect(openPartnerCount(state)).toBe(3);
    expect(partnerItems(state).filter((i) => i.kind === 'proposal').map((i) => i.title)).toEqual([
      '[Proposal 1: title not in the summary]',
      '[Proposal 2: title not in the summary]',
    ]);
    expect(agentStatus(uctx, state, 'guruh')).toBe('done');
  });

  it('ends the full replay on the recorded end state', () => {
    const final = reduceEvents(uctx, all);
    const totals = runTotals(final);
    expect(totals).toMatchObject({ companies: 1, escalationsOpen: 1, itemsWaiting: 3 });
    expect(totals.figures.factsLoaded?.value).toBe(10142);
    expect(gateBreakdown(final, 'gate-1').passed).toBe(1);
    expect(folderStatus(final, UNVR(final))).toBe('escalated');
    expect(UNVR(final).deskKey).toBe(deskKeyForSkill('fs-driver-decomposition'));
    expect(approvalLock(final, 'UNVR').locked).toBe(true);
    expect(effectiveStageStatus(UNVR(final), 'decomposition')).toBe('escalated');
    expect(effectiveStageStatus(UNVR(final), 'intake')).toBe('done');
    expect(effectiveStageStatus(UNVR(final), 'gate-2')).toBe('pending');
    expect(agentStatus(uctx, final, 'peer-benchmark')).toBe('idle');
    expect(agentStatus(uctx, final, 'fs-intake')).toBe('done');
  });

  it('ends with a partner room that matches the recorded queue in kind, count and proposal titles', () => {
    const recorded = (UNVR_FILES.replay as { partnerQueue: Array<{ kind: string; title: string }> }).partnerQueue;
    const derived = partnerItems(reduceEvents(uctx, all));
    expect(derived.map((i) => i.kind)).toEqual(recorded.map((i) => i.kind));
    expect(derived.filter((i) => i.kind === 'proposal').map((i) => i.title)).toEqual(recorded.filter((i) => i.kind === 'proposal').map((i) => i.title));
  });

  it('counts distinct tickers as the companies in the run', () => {
    const one = reduceEvents(uctx, all);
    expect(runTotals(one).companies).toBe(1);
    const two = reduceEvent(uctx, one, { ...all[0], id: 'x01', ticker: 'OTHER' });
    expect(runTotals(two).companies).toBe(2);
  });

  it('refuses approval while the escalation is open, and accepts it once the escalation is decided', () => {
    const escalated = reduceEvents(uctx, all);
    const approve = extra({ id: 'a01', kind: 'approved', skill: 'owner' });
    expect(isRefusedApproval(escalated, approve)).toBe(true);
    // Refused means NOTHING changed — the same object comes back.
    expect(reduceEvent(uctx, escalated, approve)).toBe(escalated);

    const decided = reduceEvent(uctx, escalated, extra({ id: 'd01', kind: 'approved', skill: 'owner', payload: { ref: 'e15' } }));
    expect(approvalLock(decided, 'UNVR').locked).toBe(false);
    expect(partnerItems(decided).find((i) => i.eventId === 'e15')?.state).toBe('decided');
    expect(openPartnerCount(decided)).toBe(2);
    expect(agentStatus(uctx, decided, 'fs-driver-decomposition')).not.toBe('escalated');

    const approved = reduceEvent(uctx, decided, approve);
    expect(UNVR(approved).approved).toBe(true);
    expect(folderStatus(approved, UNVR(approved))).toBe('approved');

    const published = reduceEvent(uctx, approved, extra({ id: 'p01', kind: 'published', skill: 'owner' }));
    expect(folderStatus(published, UNVR(published))).toBe('published');
    // The last stage's skill ("owner" in this stage list) owns the partner desk.
    expect(UNVR(published).deskKey).toBe(deskKeyForSkill('owner'));
  });

  it('a ref that names nothing open changes nothing', () => {
    const final = reduceEvents(uctx, all);
    expect(reduceEvent(uctx, final, extra({ id: 'd02', kind: 'approved', payload: { ref: 'no-such-item' } }))).toBe(final);
  });

  it('handles a gate passed with escalation as escalated, never a clean pass', () => {
    const initial = createInitialState(uctx);
    const state = reduceEvent(uctx, initial, extra({ id: 'g01', kind: 'gate_passed_with_escalation', stageId: 'gate-2', skill: 'review-manager', payload: { reason: 'Ranges are too wide to sign off.' } }));
    expect(gateSummary(UNVR(state), 'gate-2').worst).toBe('escalated');
    expect(approvalLock(state, 'UNVR').locked).toBe(true);
    expect(effectiveStageStatus(UNVR(state), 'gate-2')).toBe('escalated');
    expect(openPartnerCount(state)).toBe(1);
    // The reviewer completed the gate, and still reads escalated — never done.
    expect(state.agents['review-manager'].completed).toBe(1);
    expect(agentStatus(uctx, state, 'review-manager')).toBe('escalated');
  });
});

/* ---------- invariants ---------- */

describe('stepping', () => {
  const run = tenCompanyRun();
  const ctx = buildContext(run);
  const events = run.events;

  it('step back then forward returns the same state as reducing the prefix', () => {
    expect(events.length).toBeGreaterThan(64); // past the first checkpoint
    const cache = createStateCache(ctx);
    for (let k = 1; k <= events.length; k += 1) {
      const fresh = reduceEvents(ctx, events.slice(0, k));
      expect(cache.stateAt(events, k)).toEqual(fresh);
      cache.stateAt(events, k - 1); // step back
      expect(cache.stateAt(events, k)).toEqual(fresh); // and forward again
    }
  });

  it('jumps anywhere and agrees with a fresh reduction', () => {
    const cache = createStateCache(ctx);
    for (const k of [events.length, 3, 97, 0, 64, 65, 12, events.length - 1]) {
      expect(cache.stateAt(events, k)).toEqual(reduceEvents(ctx, events.slice(0, k)));
    }
  });

  it('keeps the shared prefix when events are appended (a live feed)', () => {
    const cache = createStateCache(ctx);
    const head = events.slice(0, 80);
    cache.stateAt(head, head.length);
    const longer = [...head, ...events.slice(80)];
    expect(cache.stateAt(longer, longer.length)).toEqual(reduceEvents(ctx, events));
  });

  it('copies only what an event touches', () => {
    const before = reduceEvents(ctx, events.slice(0, 40));
    const next = reduceEvent(ctx, before, events[40]);
    const touched = events[40].ticker;
    for (const ticker of before.companyOrder) {
      if (ticker !== touched) expect(next.companies[ticker]).toBe(before.companies[ticker]);
    }
  });
});

describe('an escalation always yields a partner-room item and locks approval', () => {
  const check = (ctx: FsreContext, events: readonly FsreEvent[]) => {
    let state = createInitialState(ctx);
    let seen = 0;
    for (const event of events) {
      state = reduceEvent(ctx, state, event);
      if (event.kind !== 'escalated' && event.kind !== 'gate_passed_with_escalation') continue;
      seen += 1;
      const item = partnerItems(state).find((i) => i.key === partnerKey(event.ticker, event.id));
      expect(item, event.id).toMatchObject({ kind: 'escalation', state: 'open' });
      const tickers = event.ticker ? [event.ticker] : state.companyOrder;
      for (const ticker of tickers) {
        const lock = approvalLock(state, ticker);
        expect(lock.locked).toBe(true);
        expect(lock.reasons.some((r) => r.eventId === event.id)).toBe(true);
      }
    }
    return seen;
  };

  it('on the UNVR replay', () => {
    expect(check(uctx, all)).toBe(1);
  });

  it('on the ten-company run', () => {
    const run = tenCompanyRun();
    expect(check(buildContext(run), run.events)).toBe(3);
  });

  it('for a run-level escalation (ticker null), which locks every company', () => {
    const run = tenCompanyRun();
    const ctx = buildContext(run);
    const runEscalation: FsreEvent = { id: 'run-esc', run: run.id, ticker: null, kind: 'escalated', at: null, stageId: 'gate3', skill: 'reviewer', payload: { reason: 'The wave as a whole needs a decision.' } };
    expect(check(ctx, [...run.events, runEscalation])).toBe(4);
    const state = reduceEvents(ctx, [...run.events, runEscalation]);
    expect(approvalLock(state, 'SYN05').reasons.map((r) => r.reason)).toEqual(['The wave as a whole needs a decision.']);
  });
});

/* ---------- ten companies ---------- */

describe('a run with ten companies (SYN01..SYN10, interleaved)', () => {
  const run = tenCompanyRun();
  const ctx = buildContext(run);
  const final = reduceEvents(ctx, run.events);
  const T = (n: number) => final.companies[syn(n)];

  it('has ten folders, in the order the events first named them', () => {
    expect(final.companyOrder).toEqual(Array.from({ length: 10 }, (_, i) => syn(i + 1)));
    const folders = Object.values(foldersByDesk(final)).flat();
    expect(folders.sort()).toEqual([...final.companyOrder].sort());
  });

  it('groups folders per desk with the right counts', () => {
    const byDesk = foldersByDesk(final);
    expect(Object.fromEntries(Object.entries(byDesk).map(([desk, tickers]) => [desk, tickers]))).toEqual({
      [deskKeyForSkill('partner')]: ['SYN01'],
      [deskKeyForSkill('normaliser')]: ['SYN02', 'SYN10'],
      [deskKeyForGate('gate1')]: ['SYN03', 'SYN05'],
      [deskKeyForSkill('decomposer')]: ['SYN04', 'SYN09'],
      [deskKeyForSkill('intaker')]: ['SYN06'],
      [deskKeyForGate('gate2')]: ['SYN07'],
      [deskKeyForSkill('sourcer')]: ['SYN08'],
    });
  });

  it('finds SYN05 by ticker and selects its folder', () => {
    expect(filterCompanies(final, 'syn05').map((c) => c.ticker)).toEqual(['SYN05']);
    expect(filterCompanies(final, 'Synthetic company 5').map((c) => c.ticker)).toEqual(['SYN05']);
    const results = searchResults(ctx, final, 'SYN05');
    expect(results[0]).toMatchObject({ type: 'company', id: 'SYN05' });
    expect(selectionForResult(ctx, results[0])).toEqual({ kind: 'folder', ticker: 'SYN05' });
    expect(filterCompanies(final, '')).toHaveLength(10);
  });

  it('approves per ticker: SYN05 and SYN01 approved, the escalated SYN07 and SYN09 refused', () => {
    expect(T(5).approved).toBe(true);
    expect(T(1).approved).toBe(true);
    expect(T(7).approved).toBe(false);
    expect(T(9).approved).toBe(false);
    expect(T(2).approved).toBe(false);
    expect(approvalLock(final, 'SYN05').locked).toBe(false);
    expect(approvalLock(final, 'SYN07').reasons.map((r) => r.reason)).toEqual(['SYN07 ranges are too wide to sign off.']);
  });

  it('sums the facts across companies — never the latest one alone', () => {
    const expected = Object.values(FACTS_BY_TICKER).reduce((a, b) => a + b, 0);
    expect(runTotals(final).figures.factsLoaded).toEqual({ value: expected, of: null, companies: 9 });
    expect(runTotals(final).figures.rowsTraced).toEqual({ value: 200 * 9, of: 209 * 9, companies: 9 });
  });

  it("keeps SYN03's gate failure visible after it passes on the second try", () => {
    const summary = gateSummary(T(3), 'gate1');
    expect(summary.results.map((g) => g.result)).toEqual(['failed', 'passed']);
    expect(summary.worst).toBe('failed');
    expect(summary.latest).toBe('passed');
    expect(gateBreakdown(final, 'gate1')).toEqual({ pending: 2, passed: 7, failed: 1, escalated: 0 }); // SYN06, SYN08 not there yet
  });

  it('keeps every escalation per ticker, titled with its own issue', () => {
    expect(partnerItems(final).filter((i) => i.kind === 'escalation').map((i) => [i.key, i.title])).toEqual([
      ['SYN04:SYN04-12', 'SYN04, Decomposed: SYN04 own issue'],
      ['SYN09:SYN09-12', 'SYN09, Decomposed: SYN09 own issue'],
      ['SYN07:SYN07-14', 'SYN07, Gate 2'],
    ]);
    expect(openPartnerCount(final)).toBe(5);
    expect(runTotals(final).escalationsOpen).toBe(3);
  });

  it('keeps run-level and per-ticker proposals apart', () => {
    const proposals = partnerItems(final).filter((i) => i.kind === 'proposal');
    expect(proposals.map((i) => i.key)).toEqual(['run:run-proposal-1', 'SYN02:SYN02-09']);
    expect(proposals[0].title).toBe('[Run proposal: title not in the export]');
  });

  it('derives every agent from the companies it holds', () => {
    const status = (skill: string) => agentStatus(ctx, final, skill);
    expect(status('reviewer')).toBe('escalated'); // SYN07's gate escalation is open
    expect(status('decomposer')).toBe('escalated');
    expect(status('normaliser')).toBe('stalled'); // SYN10 blocked, SYN02 in hand
    expect(final.agents.normaliser.activeTickers).toEqual(['SYN02', 'SYN10']);
    expect(status('sourcer')).toBe('working');
    expect(status('intaker')).toBe('done');
    expect(status('learner')).toBe('done');
  });

  it('reads folder statuses per ticker', () => {
    const status = (n: number) => folderStatus(final, T(n));
    expect([1, 3, 4, 5, 7, 8, 9, 10].map(status)).toEqual(['published', 'in-progress', 'escalated', 'approved', 'escalated', 'in-progress', 'escalated', 'blocked']);
  });

  it('aggregates a stage to its worst company', () => {
    expect(stageAggregate(final, 'decomposed')).toBe('escalated');
    expect(stageAggregate(final, 'normalized')).toBe('blocked');
    // SYN03 failed gate 1 and later passed: the stage still shows the failure on record.
    expect(stageAggregate(final, 'gate1')).toBe('failed');
    expect(effectiveStageStatus(T(3), 'gate1')).toBe('failed');
    expect(folderStatus(final, T(3))).toBe('in-progress');
    expect(stageAggregate(final, 'closed')).toBe('pending');
  });

  it("derives an agent's history by scanning, without storing it", () => {
    const indexes = agentEventIndexes(ctx, run.events, run.events.length, 'sourcer');
    expect(indexes.length).toBe(19); // 9 companies × start + complete, + SYN08's start
    expect(indexes.every((i) => run.events[i].skill === 'sourcer')).toBe(true);
    expect(JSON.stringify(final.agents)).not.toContain('"events"');
  });
});
