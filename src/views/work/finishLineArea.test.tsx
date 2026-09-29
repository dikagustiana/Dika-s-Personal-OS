// @vitest-environment jsdom
/**
 * FinishLineArea's tab bar, address and entity context — the parts that
 * belong to the AREA, not to any tab.
 *
 * The three tab bodies are stubbed: each has its own suite, and what is pinned
 * here is only what the area decides — which address a tab click pushes,
 * which tabs carry the process entity, what arriving and Back/Forward do to
 * the picker. These cases were written against the three-tab behaviour before
 * `isProcessTab` replaced the four `tab !== 'matrix'` checks, so they are the
 * proof that the extraction changed nothing.
 *
 * Entity codes are synthetic (ENT1, ENT2); the default is referenced through
 * DEFAULT_PROCESS_ENTITY rather than spelled.
 *
 * The simulation tab's body is NOT stubbed: the owner-only cases need the
 * real component to prove that a contributor's address mounts nothing that
 * reads.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockRepository } from '../../data/mockRepository';
import { useAppStore } from '../../store/appStore';
import { FinishLineArea } from './FinishLineArea';
import { DEFAULT_PROCESS_ENTITY } from './finishLineRoute';

vi.mock('./FinishLine', () => ({ FinishLine: () => <div data-testid="tab-body">matrix</div> }));
vi.mock('./FinishLineSwimlane', () => ({
  FinishLineSwimlane: () => <div data-testid="tab-body">swimlane</div>,
}));
vi.mock('./FinishLineNeeds', () => ({
  FinishLineNeeds: () => <div data-testid="tab-body">kebutuhan-data</div>,
}));

const address = () => `${window.location.pathname}${window.location.search}`;
const tabBody = () => screen.getByTestId('tab-body').textContent;
const clickTab = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));

function arriveAt(url: string) {
  window.history.replaceState(null, '', url);
  return render(<FinishLineArea />);
}

/** Back/Forward as the browser does it: the address changes, then popstate. */
function popTo(url: string) {
  act(() => {
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  useAppStore.setState({ viewer: { kind: 'owner' }, prosesEntity: DEFAULT_PROCESS_ENTITY });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('arriving', () => {
  it('names the matrix in the address when entered from the sidebar', () => {
    arriveAt('/');
    expect(address()).toBe('/finish-line');
    expect(tabBody()).toBe('matrix');
  });

  it('renders a bookmarked process tab as itself and adopts its entity', () => {
    arriveAt('/finish-line/kebutuhan-data?entity=ENT1');
    expect(tabBody()).toBe('kebutuhan-data');
    expect(useAppStore.getState().prosesEntity).toBe('ENT1');
  });

  it('leaves the picker alone when the bookmark is the matrix', () => {
    useAppStore.setState({ prosesEntity: 'ENT1' });
    arriveAt('/finish-line');
    expect(useAppStore.getState().prosesEntity).toBe('ENT1');
  });
});

describe('tab clicks push history, and only the process tabs carry the entity', () => {
  it('carries a non-default entity into both process tabs', () => {
    useAppStore.setState({ prosesEntity: 'ENT1' });
    arriveAt('/finish-line');
    clickTab('Swimlane');
    expect(address()).toBe('/finish-line/swimlane?entity=ENT1');
    clickTab('Kebutuhan data');
    expect(address()).toBe('/finish-line/kebutuhan-data?entity=ENT1');
  });

  it('never carries the entity into the matrix', () => {
    useAppStore.setState({ prosesEntity: 'ENT1' });
    arriveAt('/finish-line/swimlane?entity=ENT1');
    clickTab('Matrix');
    expect(address()).toBe('/finish-line');
    expect(useAppStore.getState().prosesEntity).toBe('ENT1');
  });

  it('keeps the default entity out of the address', () => {
    arriveAt('/finish-line');
    clickTab('Swimlane');
    expect(address()).toBe('/finish-line/swimlane');
  });
});

describe('Back and Forward', () => {
  it('walks the tabs and restores the entity the address names', () => {
    arriveAt('/finish-line');
    popTo('/finish-line/swimlane?entity=ENT2');
    expect(tabBody()).toBe('swimlane');
    expect(useAppStore.getState().prosesEntity).toBe('ENT2');
  });

  it('a bare process address means the default entity', () => {
    useAppStore.setState({ prosesEntity: 'ENT1' });
    arriveAt('/finish-line/swimlane?entity=ENT1');
    popTo('/finish-line/kebutuhan-data');
    expect(useAppStore.getState().prosesEntity).toBe(DEFAULT_PROCESS_ENTITY);
  });

  it('popping back to the matrix does not touch the picker', () => {
    useAppStore.setState({ prosesEntity: 'ENT1' });
    arriveAt('/finish-line/swimlane?entity=ENT1');
    popTo('/finish-line');
    expect(tabBody()).toBe('matrix');
    expect(useAppStore.getState().prosesEntity).toBe('ENT1');
  });

  it('a pop outside the area normalises to the matrix', () => {
    arriveAt('/finish-line/swimlane');
    popTo('/somewhere-else');
    expect(address()).toBe('/finish-line');
    expect(tabBody()).toBe('matrix');
  });
});

describe('the picker drives the address in place', () => {
  it('rewrites a process tab address without a history entry', () => {
    arriveAt('/finish-line/swimlane');
    const before = window.history.length;
    act(() => useAppStore.setState({ prosesEntity: 'ENT2' }));
    expect(address()).toBe('/finish-line/swimlane?entity=ENT2');
    expect(window.history.length).toBe(before);
  });

  it('leaves the matrix address alone', () => {
    arriveAt('/finish-line');
    act(() => useAppStore.setState({ prosesEntity: 'ENT2' }));
    expect(address()).toBe('/finish-line');
  });
});

const CONTRIBUTOR = { kind: 'contributor' as const, userId: 'u1', entityCodes: ['ENT1'] };
const tabLabels = () => screen.getAllByRole('button').map((button) => button.textContent);

describe('the simulation tab is owner-only', () => {
  it('is in the bar for the owner, after Kebutuhan data', () => {
    arriveAt('/finish-line');
    expect(tabLabels()).toEqual(['Matrix', 'Swimlane', 'Kebutuhan data', 'Simulasi Hari-H']);
  });

  it('is not rendered for a contributor', () => {
    useAppStore.setState({ viewer: CONTRIBUTOR });
    arriveAt('/finish-line');
    expect(tabLabels()).toEqual(['Matrix', 'Swimlane', 'Kebutuhan data']);
  });

  it('answers a contributor at its address with a sentence — no repository call, no request', () => {
    const repository = new MockRepository();
    const read = vi.spyOn(repository, 'readFinishLineSimulation');
    const upload = vi.spyOn(repository, 'uploadFinishLineSimulation');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    useAppStore.setState({ viewer: CONTRIBUTOR, repository });
    arriveAt('/finish-line/simulasi');
    expect(screen.getByText('Tab ini hanya untuk owner.')).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('mounts the simulation for the owner, which reads once', async () => {
    const repository = new MockRepository();
    const read = vi.spyOn(repository, 'readFinishLineSimulation');
    useAppStore.setState({ repository });
    arriveAt('/finish-line/simulasi');
    expect(await screen.findByText('Belum ada versi simulasi.')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('the simulation tab carries no entity', () => {
  it('a click from a process tab pushes the bare address and leaves the picker alone', () => {
    useAppStore.setState({ prosesEntity: 'ENT1' });
    arriveAt('/finish-line/swimlane?entity=ENT1');
    clickTab('Simulasi Hari-H');
    expect(address()).toBe('/finish-line/simulasi');
    expect(useAppStore.getState().prosesEntity).toBe('ENT1');
  });

  it('arriving at it does not reset the picker to the default', () => {
    useAppStore.setState({ prosesEntity: 'ENT1' });
    arriveAt('/finish-line/simulasi?entity=ENT2');
    expect(address()).toBe('/finish-line/simulasi?entity=ENT2'); // left as found; parse ignored it
    expect(useAppStore.getState().prosesEntity).toBe('ENT1');
  });

  it('a picker change while it is open does not write an entity into its address', () => {
    arriveAt('/finish-line/simulasi');
    act(() => useAppStore.setState({ prosesEntity: 'ENT2' }));
    expect(address()).toBe('/finish-line/simulasi');
  });

  it('Back and Forward walk all four tabs and restore the process entity', () => {
    useAppStore.setState({ prosesEntity: 'ENT1' });
    arriveAt('/finish-line/swimlane?entity=ENT1');
    popTo('/finish-line/simulasi');
    expect(screen.getByRole('button', { name: 'Simulasi Hari-H' }).getAttribute('aria-current')).toBe('page');
    expect(useAppStore.getState().prosesEntity).toBe('ENT1');
    popTo('/finish-line/swimlane?entity=ENT1');
    expect(tabBody()).toBe('swimlane');
    expect(useAppStore.getState().prosesEntity).toBe('ENT1');
    popTo('/finish-line/kebutuhan-data?entity=ENT2');
    expect(tabBody()).toBe('kebutuhan-data');
    expect(useAppStore.getState().prosesEntity).toBe('ENT2');
    popTo('/finish-line');
    expect(tabBody()).toBe('matrix');
  });
});
