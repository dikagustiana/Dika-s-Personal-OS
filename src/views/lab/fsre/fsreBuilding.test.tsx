// @vitest-environment jsdom
/**
 * The FSRE building on screen, through the real event sources, the real
 * reducer and the real components:
 *
 *   - the BUNDLED replay, which since brief 04 is the real export from
 *     fsre-skills (src/data/fsre/): expected values are read from its files;
 *   - GLM's PROVISIONAL files, kept as a fixture, for what only that shape
 *     carries (a provisional label per file, bracketed placeholders, "times
 *     not recorded");
 *   - a synthetic ten-company run.
 *
 * Each case names the rule it holds (mount report §3.2 and the brief's
 * seven rules).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplaySource, liveSource, replaySource, type FsreEventSource } from '../../../logic/lab/fsre/eventSource';
import {
  PROVISIONAL_FILES,
  REAL_DATA,
  ROUTER_FILE_NAMES,
  UNVR_FILE_NAMES,
  routerFiles,
  tenCompanyEvents,
} from '../../../logic/lab/fsre/__fixtures__/fsreFixtures';
import { FsreBuilding } from './FsreBuilding';
import { useFsreViewStore } from './useFsreViewStore';

const tenCompanies = createReplaySource({ id: 'syn', label: 'Ten companies', fileNames: ROUTER_FILE_NAMES, files: async () => routerFiles(tenCompanyEvents()) });
const provisional = createReplaySource({ id: 'provisional', label: 'Provisional fixture', fileNames: UNVR_FILE_NAMES, files: async () => PROVISIONAL_FILES });

/* What the real export says, read from its files rather than retyped. */
type RawEvent = { id: string; kind: string; stageId?: string; payload?: { title?: string; figures?: Record<string, unknown> } };
const REAL_EVENTS: readonly RawEvent[] = REAL_DATA.replay.events;
const TICKER = REAL_DATA.replay.company.ticker;
const ESCALATED_TITLES = REAL_EVENTS.filter((e) => e.kind === 'escalated').map((e) => e.payload?.title ?? '');
const PROPOSAL_TITLES = REAL_EVENTS.filter((e) => e.kind === 'proposal_logged').map((e) => e.payload?.title ?? '');
const FIRST_ESCALATION = REAL_EVENTS.findIndex((e) => e.kind === 'escalated') + 1;

beforeEach(() => {
  useFsreViewStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function open(sources: readonly FsreEventSource[] = [replaySource, liveSource]) {
  render(<FsreBuilding sources={sources} />);
  await screen.findByRole('group', { name: 'Replay controls' });
}

const progress = () => screen.getByText(/events? applied$/).textContent;
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const chip = (id: string) => document.querySelector<HTMLElement>(`[data-chip="${id}"]`);
const folderChips = () => [...document.querySelectorAll<HTMLElement>('[data-chip^="folders:"]')];
const panel = () => within(screen.getByRole('complementary', { name: 'Selection details' }));
const floorOf = (element: HTMLElement) => element.closest<HTMLElement>('[data-floor]')?.dataset.floor;

describe('the bundled replay: the real export (brief 04)', () => {
  it('opens at the end of the run, every figure derived from its events', async () => {
    await open();
    expect(REAL_EVENTS).toHaveLength(50);
    expect(progress()).toBe('50 events of 50 events applied');
    const metrics = within(screen.getByLabelText('Run metrics'));
    expect(metrics.getByText('Companies in this run').nextElementSibling?.textContent).toBe('1');
    // replay-unvr.json, e006 (intake stage_completed): factsLoaded 45996.
    expect(metrics.getByText('Facts loaded').nextElementSibling?.textContent).toBe('45.996');
    // replay-unvr.json, e008 (gate1 gate_passed): 386 / 371 / 0 / 15.
    expect(metrics.getByText('Tie-out checks').nextElementSibling?.textContent).toBe('386 checks: 371 passed, 0 failed, 15 skipped');
  });

  it('labels nothing provisional and says nothing about times, because the files say so (rule 6)', async () => {
    await open();
    const notes = within(screen.getByRole('list', { name: 'About this data' }));
    expect(notes.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Replay of a recorded run. Nothing is running now; the building moves only when an event is applied.',
    ]);
  });

  it('reads Gate 1 as passed and Gates 2 and 3 as passed with escalation', async () => {
    await open();
    expect(chip('gate:gate1')?.textContent).toContain('Gate 1: Passed');
    for (const gate of ['gate2', 'gate3']) {
      expect(chip(`gate:${gate}`)?.dataset.tone).toBe('escalated');
      expect(chip(`gate:${gate}`)?.textContent).toContain('⚠');
      expect(chip(`gate:${gate}`)?.textContent).toContain('Passed with escalation');
    }
  });

  it('seats the owner in the partner room and the router in the lobby', async () => {
    await open();
    expect(floorOf(screen.getByRole('button', { name: 'partner, agent, Idle' }))).toBe('f4');
    expect(floorOf(screen.getByRole('button', { name: /^fs-reverse-engineering, agent, / }))).toBe('f1');
  });

  it('lists every escalated note and both proposals in the partner room, titles as written', async () => {
    await open();
    click(/^Partner room:/);
    for (const title of [...ESCALATED_TITLES, ...PROPOSAL_TITLES]) expect(panel().getAllByText(title).length, title).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-partner-item]')).toHaveLength(ESCALATED_TITLES.length + PROPOSAL_TITLES.length);
  });
});

describe('the provisional shape, from GLM’s files kept as a fixture (rule 6)', () => {
  it('names WHICH file is provisional, with each file’s own source, and says times were not recorded', async () => {
    await open([provisional]);
    const notes = within(screen.getByRole('list', { name: 'About this data' }));
    expect(notes.getByText(/^Provisional: Stage list \(stages\.json\)\. Provisional stage list written in chat/)).toBeTruthy();
    expect(notes.getByText(/^Provisional: Skill roles \(skills\.json\)\. Roles written in chat/)).toBeTruthy();
    expect(notes.getByText(/^Provisional: Replay events \(replay-unvr\.json\)\. Stopgap file written in chat/)).toBeTruthy();
    expect(notes.getByText(/Times were not recorded/)).toBeTruthy();
  });

  it('shows placeholders exactly as written', async () => {
    await open([provisional]);
    click(/^Partner room:/);
    expect(panel().getByText('[Proposal 1: title not in the summary]')).toBeTruthy();
    expect(panel().getByText('[Proposal 2: title not in the summary]')).toBeTruthy();
  });

  it('still reads its flat payload figures', async () => {
    await open([provisional]);
    expect(within(screen.getByLabelText('Run metrics')).getByText('Facts loaded').nextElementSibling?.textContent).toBe('10.142');
  });
});

describe('with no event, nothing moves and no figure is shown (rule 1)', () => {
  it('after Restart: no folder, no ticker, no replay figure, and the metrics say so in words', async () => {
    await open();
    click('Restart the replay from the beginning');
    expect(progress()).toBe('0 events of 50 events applied');
    expect(folderChips()).toHaveLength(0);
    expect(document.querySelector('[data-chip^="pile:"]')).toBeNull();
    const text = document.body.textContent ?? '';
    for (const absent of [TICKER, REAL_DATA.replay.company.name, '45.996', '976', '386 checks', ESCALATED_TITLES[0], PROPOSAL_TITLES[0]]) {
      expect(text, absent).not.toContain(absent);
    }
    expect(screen.getByText(/^No event applied yet\./)).toBeTruthy();
    expect(screen.getByText('No figures yet')).toBeTruthy();
  });

  it('one step applies one event, and a step back takes it away again', async () => {
    await open();
    click('Restart the replay from the beginning');
    click('Step forward one event');
    expect(progress()).toBe('1 event of 50 events applied');
    expect(chip('folders:desk:idx-universe')?.textContent).toContain(`${TICKER} · In progress`);
    click('Step back one event');
    expect(progress()).toBe('0 events of 50 events applied');
    expect(folderChips()).toHaveLength(0);
  });
});

describe('escalations are never softened (rule 3)', () => {
  it('is amber with ⚠ and words on the folder, documents on the partner desk, and counted in the badge', async () => {
    await open();
    const folder = chip('folders:desk:review-manager');
    expect(folder?.dataset.tone).toBe('escalated');
    expect(folder?.textContent).toContain('⚠');
    expect(folder?.textContent).toContain(`${TICKER} · Escalated`);
    expect(chip('pile:escalation')?.textContent).toContain('13 escalations (+10 not drawn)');
    expect(chip('pile:proposal')?.textContent).toContain('2 proposals');
    expect(screen.getByTestId('fsre-badge').textContent).toBe('15');
    expect(screen.getByRole('button', { name: /^Partner room: 15 items waiting, 13 escalations among them$/ })).toBeTruthy();
  });

  it('locks approval and writes every reason out', async () => {
    await open();
    click(/^Partner room:/);
    const lock = panel().getByText(new RegExp(`Approval locked for ${TICKER}: 13 open escalations`)).closest('[role="note"]');
    for (const title of ESCALATED_TITLES) expect(lock?.textContent, title).toContain(title);
    expect(panel().getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', true);
  });

  it('keeps the reviewer escalated after its gates passed with escalation — never done', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'review-manager, agent, Escalated' })).toBeTruthy();
  });

  it('keeps a lone gate escalation escalated too (ten companies)', async () => {
    await open([tenCompanies]);
    expect(screen.getByRole('button', { name: 'reviewer, agent, Escalated' })).toBeTruthy();
    expect(chip('gate:gate2')?.textContent).toContain('Gate 2: Passed with escalation');
  });
});

describe('ten companies', () => {
  it('draws ten folders as seven stacks, sums the facts and counts every open item', async () => {
    await open([tenCompanies]);
    expect(folderChips()).toHaveLength(7);
    expect(chip('folders:desk:decomposer')?.textContent).toContain('2 folders · 2 escalated');
    const metrics = within(screen.getByLabelText('Run metrics'));
    expect(metrics.getByText('Facts loaded').nextElementSibling?.textContent).toBe('47.000');
    expect(metrics.getByText('Companies in this run').nextElementSibling?.textContent).toBe('10');
    expect(screen.getByTestId('fsre-badge').textContent).toBe('5');
  });

  it('finds SYN05 by ticker and opens its folder, approved', async () => {
    await open([tenCompanies]);
    const search = screen.getByRole('combobox', { name: /Search by ticker/ });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'SYN05' } });
    const option = screen.getByRole('option', { name: /SYN05 — Synthetic company 5/ });
    fireEvent.mouseDown(option);
    expect(panel().getByRole('heading', { name: 'SYN05 — Synthetic company 5' })).toBeTruthy();
    expect(panel().getAllByText('Approved').length).toBeGreaterThan(0);
    expect(panel().queryByText(/Approval locked for SYN05/)).toBeNull();
  });

  it("keeps SYN03's gate failure on record after it passes", async () => {
    await open([tenCompanies]);
    fireEvent.click(panel().getByRole('button', { name: /^SYN03,/ }));
    expect(panel().getByText('On record, in order: Failed, then passed. A later result never erases an earlier one.')).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: /Stage timeline for SYN03/ })).getByRole('button', { name: /Gate 1/ }).textContent).toContain('Failed');
  });

  it('locks approval per ticker, with that ticker’s own reason', async () => {
    await open([tenCompanies]);
    fireEvent.click(panel().getByRole('button', { name: /^SYN07,/ }));
    expect(panel().getByText(/Approval locked for SYN07: 1 open escalation/).closest('[role="note"]')?.textContent).toContain('SYN07 ranges are too wide to sign off.');
    expect(panel().queryByText(/SYN04 archetype/)).toBeNull();
  });

  it('filters the company list by the search text', async () => {
    await open([tenCompanies]);
    fireEvent.change(screen.getByRole('combobox', { name: /Search by ticker/ }), { target: { value: 'syn1' } });
    expect(panel().getAllByRole('button', { name: /^SYN\d\d,/ }).map((b) => b.getAttribute('aria-label')?.split(',')[0])).toEqual(['SYN10']);
  });
});

describe('every state is glyph + word (rule 4)', () => {
  it('on the stage screen, the timeline and every chip', async () => {
    for (const sources of [[replaySource], [tenCompanies]]) {
      await open(sources);
      for (const cell of document.querySelectorAll('.fsre-stage-cell')) {
        expect(cell.querySelector('[aria-hidden="true"]')?.textContent).toMatch(/\S/);
        expect(cell.textContent).toMatch(/Done|Current|Pending|Escalated|Failed|Blocked|Returned/);
      }
      for (const el of document.querySelectorAll('[data-chip]')) {
        expect(el.querySelector('[aria-hidden="true"]')?.textContent, el.getAttribute('data-chip') ?? '').toMatch(/\S/);
      }
      cleanup();
      useFsreViewStore.getState().reset();
    }
  });
});

describe('keyboard and targets', () => {
  it('puts a named button over every agent, gate room, folder stack and the partner room', async () => {
    await open();
    expect(screen.getAllByRole('button', { name: /, agent, / })).toHaveLength(REAL_DATA.skills.skills.length);
    expect(screen.getAllByRole('button', { name: /gate room/ })).toHaveLength(3);
    expect(screen.getByRole('button', { name: `${TICKER} folder, Escalated` })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Partner room, 15 items waiting$/ })).toBeTruthy();
    for (const hit of document.querySelectorAll('.fsre-hit')) expect(hit.tagName).toBe('BUTTON');
  });

  it('selects from the drawing: an agent opens its panel with its role from the skill data', async () => {
    await open();
    click('fs-intake, agent, Done');
    expect(panel().getByRole('heading', { name: 'fs-intake' })).toBeTruthy();
    const role = REAL_DATA.skills.skills.find((skill) => skill.name === 'fs-intake')?.role ?? '';
    expect(panel().getByText(role)).toBeTruthy();
  });
});

describe('the live source before M5', () => {
  it('says it is not connected and draws no building', async () => {
    await open();
    click(/^Live pipeline/);
    expect(await screen.findByText(/The live feed is not connected yet/)).toBeTruthy();
    expect(document.querySelectorAll('.fsre-floor')).toHaveLength(0);
  });
});

describe('motion only on events (and none under reduced motion)', () => {
  const stepToFirstEscalation = () => {
    click('Restart the replay from the beginning');
    for (let i = 0; i < FIRST_ESCALATION; i += 1) click('Step forward one event');
  };

  it('does not move on load, and moves when an event is applied', async () => {
    await open();
    expect(document.querySelector('.fsre-flash, .fsre-arrive')).toBeNull();
    stepToFirstEscalation();
    expect(document.querySelector('.fsre-flash')).not.toBeNull();
  });

  it('never moves when the reader asked for less motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    await open();
    stepToFirstEscalation();
    expect(document.querySelector('.fsre-flash, .fsre-arrive')).toBeNull();
  });

  it('pauses itself at the end of playback', async () => {
    vi.useFakeTimers();
    try {
      render(<FsreBuilding sources={[replaySource]} />);
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      click('Restart the replay from the beginning');
      click('Play the replay');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(progress()).toBe('50 events of 50 events applied');
      expect(screen.getByRole('button', { name: 'Play the replay' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
