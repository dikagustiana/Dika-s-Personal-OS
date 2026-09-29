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
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
