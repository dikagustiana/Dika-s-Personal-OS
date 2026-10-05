import { describe, expect, it } from 'vitest';
import type { FsreEvent } from './events';
import { DOC_SHEET, FOLDER_STACK } from './geometry';
import { FLOOR_DISPLAY_ORDER, deskKeyForGate, deskKeyForSkill } from './layout';
import { buildContext, createInitialState, reduceEvent, reduceEvents, type FsreState } from './reducer';
import { agentStatuses, buildFloorScene, focusTickerOf, stageCells, touchedBy, wallFigures, type FloorScene, type FsreSelection } from './scene';
import { AGENT_STATUS_WORDS, FOLDER_STATUS_WORDS, GATE_RESULT_WORDS } from './statuses';
import { tenCompanyRun, unvrRun } from './__fixtures__/fsreFixtures';

const run = tenCompanyRun();
const ctx = buildContext(run);
const final = reduceEvents(ctx, run.events);

function scenes(state: FsreState, selection: FsreSelection | null = null): FloorScene[] {
  const view = { selection, agentStatuses: agentStatuses(ctx, state), focusTicker: focusTickerOf(selection) };
  return FLOOR_DISPLAY_ORDER.map((floorId) => buildFloorScene(ctx, state, floorId, view));
}

const allChips = (list: FloorScene[]) => list.flatMap((scene) => scene.chips);
const allItems = (list: FloorScene[]) => list.flatMap((scene) => scene.items);

describe('with no event, nothing moves and no figure is shown', () => {
  const empty = scenes(createInitialState(ctx));

  it('draws no folder, no document pile and no folder chip', () => {
    expect(allItems(empty).filter((item) => item.kind === 'folders' || item.kind === 'pile')).toEqual([]);
    expect(allChips(empty).filter((chip) => chip.id.startsWith('folders:') || chip.id.startsWith('pile:'))).toEqual([]);
  });

  it('shows every agent idle and every gate pending', () => {
    const chips = allChips(empty);
    expect(chips.filter((c) => c.id.startsWith('agent:')).every((c) => c.text.endsWith(AGENT_STATUS_WORDS.idle))).toBe(true);
    expect(chips.filter((c) => c.id.startsWith('gate:')).every((c) => c.text.endsWith(GATE_RESULT_WORDS.pending))).toBe(true);
  });

  it('leaves the wall counter empty and the stage screen pending', () => {
    expect(wallFigures(createInitialState(ctx), null)).toEqual([]);
    expect(stageCells(ctx, createInitialState(ctx), null).every((cell) => cell.status === 'pending')).toBe(true);
    const counter = empty.flatMap((s) => s.walls).find((w) => w.body.content === 'figures');
    expect(counter?.body).toEqual({ content: 'figures', entries: [] });
  });

  it('contains no digit anywhere a figure could appear', () => {
    let text = JSON.stringify(allChips(empty).map((c) => c.text)) + JSON.stringify(empty.map((s) => s.tag));
    // Names may carry digits ("Gate 1", "4F"): they are data and labels, not figures.
    for (const stage of run.stages) text = text.split(stage.name).join('');
    text = text.replace(/\b(B1|[1-4]F)\b/g, '');
    expect(text).not.toMatch(/\d/);
  });
});

describe('ten companies on the floors', () => {
  const list = scenes(final);
  const folderItems = allItems(list).filter((item) => item.kind === 'folders');

  it('draws one stack per occupied desk, ten folders in all, at most three boxes high', () => {
    expect(folderItems).toHaveLength(7);
    for (const item of folderItems) {
      if (item.kind === 'folders') expect(item.boxes.length).toBeLessThanOrEqual(FOLDER_STACK.maxDrawn);
    }
    const chips = allChips(list).filter((c) => c.id.startsWith('folders:'));
    const counted = chips.reduce((sum, chip) => sum + (chip.text.match(/^(\d+) folders/) ? Number(chip.text.match(/^(\d+)/)?.[1]) : 1), 0);
    expect(counted).toBe(10);
  });

  it('labels a stack with its count and its most urgent status, in words', () => {
    const decomposer = allChips(list).find((c) => c.id === `folders:${deskKeyForSkill('decomposer')}`);
    expect(decomposer).toMatchObject({ glyph: '⚠', tone: 'escalated', text: `2 folders · 2 ${FOLDER_STATUS_WORDS.escalated.toLowerCase()}` });
    const single = allChips(list).find((c) => c.id === `folders:${deskKeyForGate('gate2')}`);
    expect(single?.text).toBe(`SYN07 · ${FOLDER_STATUS_WORDS.escalated}`);
  });

  it('makes a single folder select its ticker and a stack select the desk', () => {
    const hits = list.flatMap((s) => s.hits);
    expect(hits.find((h) => h.id === `folders:${deskKeyForGate('gate2')}`)?.selection).toEqual({ kind: 'folder', ticker: 'SYN07' });
    const stack = hits.find((h) => h.id === `folders:${deskKeyForGate('gate1')}`);
    expect(stack?.selection).toEqual({ kind: 'desk', deskKey: deskKeyForGate('gate1') });
    expect(stack?.label).toContain('SYN03, SYN05');
  });

  it('piles the open escalations and proposals on the partner desk, in words', () => {
    const partner = list.find((s) => s.floorId === 'f4');
    expect(partner?.chips.find((c) => c.id === 'pile:escalation')).toMatchObject({ glyph: '⚠', tone: 'escalated', text: '3 escalations' });
    expect(partner?.chips.find((c) => c.id === 'pile:proposal')).toMatchObject({ glyph: '✎', text: '2 proposals' });
    expect(partner?.tag).toEqual(['4F Partner room', '3 escalations', '2 proposals']);
  });

  it('draws at most three sheets per pile and says how many are not drawn', () => {
    const more: FsreEvent[] = ['a', 'b', 'c'].map((suffix) => ({ id: `more-${suffix}`, run: run.id, ticker: 'SYN02', kind: 'escalated', at: null, stageId: 'normalized', skill: 'normaliser' }));
    const crowded = scenes(reduceEvents(ctx, more, final)).find((s) => s.floorId === 'f4');
    const pile = crowded?.items.find((i) => i.kind === 'pile' && i.pile === 'escalation');
    expect(pile && pile.kind === 'pile' && pile.sheets.length).toBe(DOC_SHEET.maxDrawn);
    expect(crowded?.chips.find((c) => c.id === 'pile:escalation')?.text).toBe('6 escalations (+3 not drawn)');
  });

  it('gives every chip a glyph and a word', () => {
    for (const chip of allChips(list)) {
      expect(chip.glyph, chip.id).toBeTruthy();
      expect(chip.text, chip.id).toMatch(/[A-Za-z]/);
    }
  });

  it('shows the gate rooms as the worst result on record', () => {
    const chips = allChips(list);
    expect(chips.find((c) => c.id === 'gate:gate1')?.text).toBe(`Gate 1: ${GATE_RESULT_WORDS.failed}`);
    expect(chips.find((c) => c.id === 'gate:gate2')).toMatchObject({ glyph: '⚠', text: `Gate 2: ${GATE_RESULT_WORDS.escalated}` });
  });

  it('sums the wall counter, or speaks for the selected company', () => {
    expect(wallFigures(final, null).find((e) => e.key === 'factsLoaded')?.value).toBe('47.000');
    expect(wallFigures(final, final.companies.SYN05).find((e) => e.key === 'factsLoaded')?.value).toBe('5.000');
  });

  it('rings the selected folder on its own floor only', () => {
    const selected = scenes(final, { kind: 'folder', ticker: 'SYN05' });
    expect(selected.filter((s) => s.ring !== null).map((s) => s.floorId)).toEqual(['f3']);
    expect(selected.flatMap((s) => s.hits).filter((h) => h.selected).map((h) => h.id)).toEqual([`folders:${deskKeyForGate('gate1')}`]);
    const single = scenes(final, { kind: 'folder', ticker: 'SYN07' });
    expect(single.flatMap((s) => s.hits).filter((h) => h.selected).map((h) => h.id)).toEqual([`folders:${deskKeyForGate('gate2')}`]);
  });
});

describe('motion follows events only', () => {
  const uctx = buildContext(unvrRun());
  const events = unvrRun().events;

  it('names nothing when no event was applied', () => {
    const state = createInitialState(uctx);
    expect(touchedBy(uctx, state, state, null)).toEqual({ chips: new Set(), arrivals: new Set() });
  });

  it('names the folder that arrived on another floor and the agents whose status changed', () => {
    const before = reduceEvents(uctx, events.slice(0, 9)); // folder in the 3F gate room
    const afterStart = reduceEvent(uctx, before, events[9]); // e10: normalising starts on 2F
    const touched = touchedBy(uctx, before, afterStart, events[9]);
    expect(touched.arrivals).toEqual(new Set([deskKeyForSkill('fs-normalize')]));
    expect(touched.chips.has('agent:fs-normalize')).toBe(true);
    // A move along the same floor is not an arrival.
    const sameFloor = reduceEvents(uctx, events.slice(0, 4));
    expect(touchedBy(uctx, sameFloor, reduceEvent(uctx, sameFloor, events[4]), events[4]).arrivals.size).toBe(0);
  });

  it('names nothing for a refused approval', () => {
    const final = reduceEvents(uctx, events);
    const approve: FsreEvent = { id: 'a', run: 'unvr-dry-run', ticker: 'UNVR', kind: 'approved', at: null };
    expect(touchedBy(uctx, final, reduceEvent(uctx, final, approve), approve).chips.size).toBe(0);
  });
});
