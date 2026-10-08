// @vitest-environment jsdom
/**
 * The staged package on screen in the partner room: the summary, the sheet
 * tabs, the grid with its legend, the selected cell's source or formula and
 * tie-out, the issues above the grid when the site's checks fail, and a
 * package that cannot be read at all. The package is the suite's SYNTHETIC
 * golden case (SYNP).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import synp from '../../../logic/lab/fsre/__fixtures__/synp.SYNTHETIC.package.json';
import type { FsrePackagePreview as PreviewData } from '../../../logic/lab/fsre/eventSource';
import { EVENT_KIND_WORDS } from '../../../logic/lab/fsre/statuses';
import { FsrePackagePreview } from './FsrePackagePreview';

const PKG = synp as Record<string, unknown>;
const preview = (over: Partial<PreviewData> = {}): PreviewData => ({
  company: 'SYNP',
  version: 'SYNP-FY25-r1-SYNTHETIC',
  waveId: 'wave-golden',
  status: 'staged',
  contentHash: 'c'.repeat(64),
  stagedAt: '2026-10-08T10:00:00+00:00',
  package: PKG,
  ...over,
});

afterEach(cleanup);

describe('FsrePackagePreview', () => {
  it('names the release, its status in the building’s words, and the content hash', () => {
    render(<FsrePackagePreview preview={preview()} />);
    expect(screen.getByText(/Synthetic Process Co \(SYNTHETIC\)/)).toBeTruthy();
    expect(screen.getByText(new RegExp(EVENT_KIND_WORDS.package_staged))).toBeTruthy();
    expect(screen.getByTitle('c'.repeat(64)).textContent).toBe('cccccccccccc…');
    expect(screen.getByRole('status').textContent).toMatch(/passes on this package/);
    expect(document.querySelector('[data-package-issues]')).toBeNull();
  });

  it('summarises cells per kind, tie-outs and the workpaper gates, and says the provenance', () => {
    render(<FsrePackagePreview preview={preview()} />);
    const sourced = document.querySelector('[data-kind-count="sourced"]');
    expect(sourced?.textContent).toMatch(/Sourced/);
    expect(sourced?.textContent).not.toMatch(/Sourced\s*0$/);
    expect(screen.getByText('Tie-outs that differ').nextElementSibling?.textContent).toBe('0');
    expect(screen.getByText('Gate 1: intake and tie-out')).toBeTruthy();
    expect(screen.getByText('Partner review')).toBeTruthy();
    expect(document.querySelector('[data-provenance]')?.getAttribute('data-provenance')).toBe('synthetic');
    expect(document.querySelector('[data-provenance]')?.textContent).toContain('SYNTHETIC');
  });

  it('offers the sheets as tabs, draws the grid with a glyph per cell kind, and the legend with the word', () => {
    render(<FsrePackagePreview preview={preview()} />);
    const tabs = within(screen.getByRole('group', { name: 'Sheet' }));
    expect(tabs.getAllByRole('button').map((b) => b.textContent)).toEqual(['Reported', 'Model', 'Assumptions']);
    expect(tabs.getByRole('button', { name: 'Reported' }).getAttribute('aria-pressed')).toBe('true');
    const grid = screen.getByRole('table', { name: 'Sheet Reported' });
    expect(within(grid).getByRole('rowheader', { name: 'Revenue' })).toBeTruthy();
    expect(grid.querySelectorAll('button[data-kind="sourced"]').length).toBeGreaterThan(0);
    expect(screen.getByRole('list', { name: 'Cell legend' }).textContent).toMatch(/Sourced.*Formula.*Assumption.*Missing/);
    fireEvent.click(tabs.getByRole('button', { name: 'Model' }));
    expect(screen.getByRole('table', { name: 'Sheet Model' }).querySelectorAll('button[data-kind="formula"]').length).toBeGreaterThan(0);
    fireEvent.click(tabs.getByRole('button', { name: 'Assumptions' }));
    expect(screen.getByText('This sheet has no rows.')).toBeTruthy();
  });

  it('shows the selected cell’s source, then a formula cell’s formula and tie-out', () => {
    render(<FsrePackagePreview preview={preview()} />);
    expect(screen.getByText(/Select a cell in the grid/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Revenue, FY 24: 8\.100\.000, Sourced$/ }));
    const detail = document.querySelector('[data-cell-detail]') as HTMLElement;
    expect(detail.textContent).toContain('Revenue');
    expect(within(detail).getByText('Issuer').nextElementSibling?.textContent).toContain('SYNTHETIC');
    expect(detail.querySelector('[data-source]')).toBeTruthy();
    expect(detail.querySelector('[data-formula]')).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Sheet' })).getByRole('button', { name: 'Model' }));
    const tied = screen.getByRole('table', { name: 'Sheet Model' }).querySelector('tr[data-row-style="total"] button, button[aria-label^="Gross profit"]') as HTMLElement;
    fireEvent.click(tied);
    const next = document.querySelector('[data-cell-detail]') as HTMLElement;
    expect(next.querySelector('[data-formula]')?.textContent).toMatch(/^=/);
    expect(next.querySelector('[data-tie-out]')?.textContent).toMatch(/Tie-out.*Agrees/);
  });

  it('lists the site’s failed checks above the grid instead of hiding the package', () => {
    const broken = JSON.parse(JSON.stringify(PKG)) as { meta: { chainStage: string } };
    broken.meta.chainStage = 'nowhere';
    render(<FsrePackagePreview preview={preview({ package: broken as unknown as Record<string, unknown> })} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/The site would not show this package/);
    expect(alert.textContent).toContain('meta.chainStage');
    expect(screen.getByRole('table', { name: 'Sheet Reported' })).toBeTruthy();
  });

  it('says when the package cannot be read at all, and draws no grid', () => {
    render(<FsrePackagePreview preview={preview({ package: { meta: { ticker: 'X' } } })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/cannot be shown.*shape of a model package/);
    expect(screen.queryByRole('table')).toBeNull();
  });
});
