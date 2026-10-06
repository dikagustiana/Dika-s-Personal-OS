// @vitest-environment jsdom
/**
 * The FSRE building's place in the app: a Lab view ('fsre'), owner only,
 * lazy, with no URL of its own. Renders the real App so the nav, the branch
 * in App.tsx and the lazy boundary are what is under test.
 *
 * The contributor cases set `labView: 'fsre'` directly in the store — the
 * one way a contributor could get there, since their nav never offers the
 * Lab — and prove they see a sentence and nothing of the replay: no
 * building, no ticker, no figure, no request, and the building never even
 * mounted (it would have moved the view store's cursor to the end).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { MockRepository } from './data/mockRepository';
import { REAL_DATA } from './logic/lab/fsre/__fixtures__/fsreFixtures';
import { useAppStore } from './store/appStore';
import { useFsreViewStore } from './views/lab/fsre/useFsreViewStore';

const CONTRIBUTOR = { kind: 'contributor' as const, userId: 'u1', entityCodes: ['ENT1'] };

/* Text only the bundled replay could put on screen (src/data/fsre/, the real export). */
const firstTitle = (kind: string) => (REAL_DATA.replay.events as ReadonlyArray<{ kind: string; payload?: { title?: string } }>).find((e) => e.kind === kind)?.payload?.title ?? '';
const REPLAY_TEXT = [
  REAL_DATA.replay.company.ticker,
  REAL_DATA.replay.company.name,
  REAL_DATA.replay.run,
  '45.996',
  firstTitle('escalated'),
  firstTitle('proposal_logged'),
  'events applied',
];

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  useFsreViewStore.getState().reset();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAppStore.setState({ viewer: { kind: 'owner' }, area: 'work', workspace: 'work', labView: 'registry' });
  window.history.replaceState(null, '', '/');
});

describe('the owner', () => {
  it('opens the building from its Lab nav entry, with no new address', async () => {
    useAppStore.setState({ viewer: { kind: 'owner' }, area: 'lab', labView: 'registry', repository: new MockRepository() });
    render(<App />);
    const entry = screen.getAllByRole('button', { name: 'FSRE building' })[0];
    fireEvent.click(entry);
    expect(await screen.findByRole('heading', { level: 1, name: 'FSRE building' })).toBeTruthy();
    expect(await screen.findByText(`${REAL_DATA.replay.events.length} events of ${REAL_DATA.replay.events.length} events applied`)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'FSRE building' })[0].getAttribute('aria-current')).toBe('page');
    expect(useAppStore.getState().labView).toBe('fsre');
    expect(window.location.pathname).toBe('/');
  });
});

describe('a contributor', () => {
  it('sent to the building by store state sees only the owner-only notice — nothing of the replay', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    useAppStore.setState({ viewer: CONTRIBUTOR, area: 'lab', labView: 'fsre', repository: new MockRepository() });
    render(<App />);

    expect(screen.getByText('This view is for the owner only.')).toBeTruthy();
    // Let any lazy import that was (wrongly) started settle before looking.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(document.querySelector('.fsre-floor')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'FSRE building' })).toBeNull();
    const text = document.body.textContent ?? '';
    for (const replayText of REPLAY_TEXT) {
      expect(replayText.length, 'a replay string to look for').toBeGreaterThan(0);
      expect(text, replayText).not.toContain(replayText);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    // The building never mounted: it sets the cursor to the end of the run on load.
    expect(useFsreViewStore.getState().cursor).toBe(0);
  });

  it('has no FSRE entry in the nav', () => {
    useAppStore.setState({ viewer: CONTRIBUTOR, area: 'lab', labView: 'fsre', repository: new MockRepository() });
    render(<App />);
    expect(screen.queryByRole('button', { name: 'FSRE building' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'FSRE' })).toBeNull();
  });
});
