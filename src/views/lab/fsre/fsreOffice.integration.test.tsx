// @vitest-environment jsdom
/**
 * INTEGRATION tests, in jsdom with fake timers — not end-to-end. They render
 * the real building over the real mock transport, reducer and components,
 * and drive the mock clock with fake timers; no browser lays anything out
 * and nothing is measured. They cover brief v2 WO-6's list: the synthetic run
 * renders; the desk panel opens; a command goes Sent → Done; a declined
 * command shows its rule; a blocked engagement cannot start; the industries
 * list scrolls and filters the building; replay mode still works.
 *
 * The same flows were run end to end in a real browser (Chromium, through
 * Playwright, at 1400×1000 and 390×844) for the v2 port; how, and what they
 * showed, is in docs/lab/fsre-building-v2-port.md. Playwright is not a
 * dependency of this repository.
 *
 * Ported from the GLM workspace's src/e2e/app.test.tsx (5b5d186) and renamed
 * by brief v2.1 FX-12: GLM called these "e2e".
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REAL_DATA } from '../../../logic/lab/fsre/__fixtures__/fsreFixtures';
import { FsreBuilding } from './FsreBuilding';
import { useFsreLiveStore } from './useFsreLiveStore';
import { useFsreOfficeStore } from './useFsreOfficeStore';
import { useFsreViewStore } from './useFsreViewStore';

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function press(name: string | RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await vi.advanceTimersByTimeAsync(20);
  });
}

async function openSynthetic(): Promise<void> {
  render(<FsreBuilding />);
  await act(async () => {
    fireEvent.click(within(screen.getByRole('group', { name: 'Mode' })).getByRole('button', { name: 'Synthetic' }));
    await vi.advanceTimersByTimeAsync(50);
  });
}

const chipText = (deskId: string) => document.querySelector<HTMLElement>(`[data-chip="${deskId}"]`)?.textContent ?? '';
const panel = () => within(screen.getByRole('complementary', { name: 'Selection details' }));

async function messageAgent(agentId: string, text: string, kind?: 'Question' | 'Override', reason?: string): Promise<void> {
  await press(/Message an agent/);
  fireEvent.change(screen.getByRole('combobox', { name: 'Pick an agent' }), { target: { value: agentId } });
  if (kind) fireEvent.click(screen.getByRole('button', { name: kind }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Command text' }), { target: { value: text } });
  if (reason) fireEvent.change(screen.getByRole('textbox', { name: 'Override reason' }), { target: { value: reason } });
  await press('Send command');
}

beforeEach(() => {
  vi.useFakeTimers();
  useFsreViewStore.getState().reset();
  useFsreOfficeStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useFsreLiveStore.getState().stop();
  useFsreOfficeStore.getState().reset();
  vi.useRealTimers();
});

describe('replay mode (unchanged behaviour)', () => {
  it('opens on the recorded run with its controls and its source label', async () => {
    vi.useRealTimers();
    render(<FsreBuilding />);
    const total = REAL_DATA.replay.events.length;
    expect(await screen.findByText(`${total} events of ${total} events applied`)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Replay of replay-unvr\.json/ })).toBeTruthy();
    // Two buttons say "live" now: the disabled Live office MODE, and the live pipeline feed RUN under Replay.
    expect(within(screen.getByRole('group', { name: 'Mode' })).getByRole('button', { name: /Live office/ }).hasAttribute('disabled')).toBe(true);
    expect(within(screen.getByRole('group', { name: 'Runs' })).getByRole('button', { name: /Live pipeline/ }).textContent).toContain('not connected');
  });
});

describe('synthetic mode', () => {
  it('renders the synthetic run: banner, roster desks and events moving desks', async () => {
    await openSynthetic();
    expect(screen.getByText(/Synthetic run: fictitious companies/)).toBeTruthy();
    expect(chipText('desk:data-lead')).toContain('Data lead');
    expect(chipText('desk:model-staff-a')).toContain('Modelling staff · SYNA');
    expect(document.body.textContent).toContain('Idle, no assignment');

    await advance(30_000);
    expect(screen.getAllByRole('button', { name: /desk, Working$/ }).length).toBeGreaterThan(0);
    // FX-7: facts loaded is the sum over both companies (8.214 + 10.142).
    await advance(50_000);
    expect(screen.getByRole('region', { name: 'Run metrics' }).textContent).toContain('18.356');
  });

  it('opens the desk panel from a desk click', async () => {
    await openSynthetic();
    await advance(5_000);
    fireEvent.click(screen.getByRole('button', { name: /^Data lead desk/ }));
    expect(panel().getByRole('heading', { name: 'Data lead' })).toBeTruthy();
    expect(panel().getByText('Command composer')).toBeTruthy();
    expect(panel().getByText(/Data lead — fixed/)).toBeTruthy();
  });

  it('walks a command through Sent → Received → Done in the thread', async () => {
    await openSynthetic();
    await advance(2_000);
    await messageAgent('review-lead', 'How is the SYNB tie-out going?', 'Question');
    fireEvent.click(screen.getByRole('button', { name: /^Review lead desk/ }));
    expect(panel().getByText('“How is the SYNB tie-out going?”')).toBeTruthy();
    await advance(15_000);
    const thread = panel().getByText('“How is the SYNB tie-out going?”').closest('li');
    expect(thread?.textContent).toContain('Sent');
    expect(thread?.textContent).toContain('Received');
    expect(thread?.textContent).toContain('Done');
    expect(thread?.textContent).toContain('on track');
  });

  it('declines a gate-bypass ask and shows the placeholder rule', async () => {
    await openSynthetic();
    await advance(2_000);
    await messageAgent('review-lead', 'Skip the tie-out at Gate 2');
    fireEvent.click(screen.getByRole('button', { name: /^Review lead desk/ }));
    await advance(10_000);
    expect(panel().getAllByText(/Declined under R2 — gate bypass \(placeholder\)/).length).toBeGreaterThan(0);
    expect(panel().getAllByText(/A gate or a tie-out cannot be skipped/).length).toBeGreaterThan(0);
    // FX-14: the declined line says, on hover, that the rule is the mock's placeholder.
    const declined = panel().getAllByText(/^Declined under/).find((element) => element.hasAttribute('title'));
    expect(declined?.getAttribute('title')).toContain('Placeholder');
  });

  it('refuses to start a blocked engagement and shows the reason', async () => {
    await openSynthetic();
    await press(/New engagement/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Ticker or company name' }), { target: { value: 'MOCKX' } });
    await press('Propose');
    expect(screen.getAllByText(/On the conflict list/).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Start engagement' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Start is disabled/)).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Ticker or company name' }), { target: { value: 'SYNE' } });
    await press('Propose');
    expect(screen.getAllByText(/Archetype not built yet/).length).toBeGreaterThan(0);
  });

  it('starts a clear engagement and staffs the desks', async () => {
    await openSynthetic();
    await advance(2_000);
    await press(/New engagement/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Ticker or company name' }), { target: { value: 'SYNC' } });
    await press('Propose');
    const start = screen.getByRole('button', { name: 'Start engagement' }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    await press('Start engagement');
    expect(screen.getByText(/Engagement started/)).toBeTruthy();
    // FX-14: the plan card shows the engagement as it now is.
    expect(within(screen.getByRole('region', { name: 'Plan' })).getByText('Running')).toBeTruthy();
    await advance(20_000);
    expect(screen.getAllByRole('button', { name: /^Modelling staff · SYND desk/ }).length).toBeGreaterThan(0);
  });

  it('runs to an escalation and a locked approval, then publishes after the override', async () => {
    await openSynthetic();
    await press('10×');
    await advance(80_000); // about 13 simulated minutes at 10×

    await press(/^Partner room:/);
    expect(panel().getByText('Open escalations (1)')).toBeTruthy();
    // FX-3: the partner room shows the real count, never a softened one.
    expect(panel().getByText(/G2 Passed, 1 escalation open/)).toBeTruthy();
    expect(panel().queryByText(/0 escalations open/)).toBeNull();
    // FX-7: the bell and the partner room's button say the same event-derived count.
    expect(screen.getByRole('button', { name: 'Partner room: 1 item waiting' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Partner room, 1 item waiting' })).toBeTruthy();
    // FX-7: the gate metrics name the engagement they show.
    expect(screen.getByRole('region', { name: 'Run metrics' }).textContent?.match(/Gate \d · SYNA \+ SYNB/g)?.length).toBe(3);
    // FX-6: the button is visibly locked, with its reason.
    expect((panel().getByRole('button', { name: /Approve version v1/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(panel().getByText(/Locked: 1 escalation open on SYNA\. Resolve it first\./)).toBeTruthy();

    await press(/Message an agent/);
    fireEvent.change(screen.getByRole('combobox', { name: 'Pick an agent' }), { target: { value: 'review-lead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Override' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Command text' }), { target: { value: 'Close the escalation: treat the missed SYNA periods as flag-only' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Override reason' }), { target: { value: 'Immaterial for the wave; flag them.' } });
    expect(screen.getByText(/Will be recorded in the workpaper as Owner instruction/)).toBeTruthy();
    await press('Send command');

    await advance(30_000); // the escalation closes, Gate 3 passes, sign-off waits
    await press(/^Partner room:/);
    const approve = panel().getByRole('button', { name: /Approve version v1/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false); // FX-6: unlocked once the escalation is closed
    await act(async () => {
      fireEvent.click(approve);
      await vi.advanceTimersByTimeAsync(700);
    });
    await press('Industries');
    await advance(100);
    // Both cement companies now show the published version v1.
    expect(screen.getAllByText(/published v1$/).length).toBe(2);
  }, 30_000);

  it('flashes a desk once per event, and not again on coming back from the industries board (review R7)', async () => {
    await openSynthetic();
    await advance(30_000);
    await press('Pause');
    await press('Industries');
    await press('Building');
    expect(document.querySelectorAll('.fsre-flash')).toHaveLength(0);
    await press('1×');
    await advance(10_000);
    expect(document.querySelectorAll('.fsre-flash').length).toBeGreaterThan(0);
  });

  it('scrolls the building inside its own section on a narrow screen, never the page (FX-11)', async () => {
    await openSynthetic();
    const building = screen.getByRole('region', { name: 'The building' });
    expect(building.firstElementChild?.className).toContain('overflow-x-auto');
    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: 'Mode' })).getByRole('button', { name: 'Replay' }));
      await vi.advanceTimersByTimeAsync(50);
    });
    vi.useRealTimers();
    const replayBuilding = await screen.findByRole('region', { name: 'The building' });
    expect(replayBuilding.firstElementChild?.className).toContain('overflow-x-auto');
  });

  it('withdraws a proposed plan when the dialog is closed with ✕ (FX-14)', async () => {
    await openSynthetic();
    await press(/New engagement/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Ticker or company name' }), { target: { value: 'SYNL' } });
    await press('Propose');
    await press('Close: New engagement');
    const transport = useFsreLiveStore.getState().transport;
    const proposals = (await transport?.listEngagements())?.filter((e) => e.plan.tickers.includes('SYNL')) ?? [];
    expect(proposals.map((e) => e.status)).toEqual(['cancelled']);
  });

  it('filters the building from the industries list, which scrolls', async () => {
    await openSynthetic();
    await press('Industries');
    expect(screen.getByText(/Sub-industries covered/)).toBeTruthy();
    // FX-14: "companies", not "companys".
    expect(document.body.textContent).toContain('companies of 2');
    expect(document.body.textContent).not.toContain('companys');
    expect(screen.getByText('Synthetic paper')).toBeTruthy();
    const scroller = document.querySelector('.max-h-\\[70vh\\]');
    expect(scroller?.className).toContain('overflow-auto');
    const [first] = screen.getAllByRole('button', { name: 'Open in the building' });
    fireEvent.click(first);
    expect(screen.getByText(/Building filtered to/)).toBeTruthy();
    expect(document.body.textContent).toContain('other work:');
  });
});
