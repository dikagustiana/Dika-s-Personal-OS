/**
 * The staged package, read in the partner room before the approve button
 * (PRD "FSRE publish path" §6.2 C). Read-only: a preview, not a sandbox.
 *
 * What it shows, top to bottom: the checks the site itself runs, as a list
 * when any fails (the site would refuse this package; the database still
 * decides the approval); the summary — cells per kind, tie-outs that differ
 * or were never checked, the workpaper gates, the provenance, the content
 * hash; the sheet tabs; the grid, every cell a glyph and a tone with the
 * legend giving the word; and, for the selected cell, its formula or its
 * source (issuer, document, period, page) and its tie-out.
 *
 * Every figure comes from packagePreview.ts already formatted: package
 * figures in the site's house format (so 4F shows what the site will), the
 * building's counts through its own formatter. No number literal and no
 * status word lives here (fsreRules.test.ts); the words are the contract's
 * lists and the building's vocabularies.
 */
import { useState } from 'react';
import type { FsrePackagePreview as PreviewData } from '../../../logic/lab/fsre/eventSource';
import {
  CELL_KIND_MARKS,
  RELEASE_STATUS_WORDS,
  activeSheetId,
  cellDetail,
  cellText,
  cellsText,
  gateMark,
  issuesShown,
  numberText,
  readPackage,
  sheetOf,
  shortHash,
  type CellSelection,
} from '../../../logic/lab/fsre/packagePreview';
import { CELL_KINDS, SHEETS, byId, type SheetId } from '../../../logic/lab/fsre/modelPackage/constants';
import { NUMBER_CONVENTION } from '../../../logic/lab/fsre/modelPackage/format';
import { cn } from '../../../lib/utils';
import { FigureRow, Glyph, PanelSection, Quiet, StatusBadge } from './fsreUi';

export function FsrePackagePreview({ preview }: { preview: PreviewData }) {
  const reading = readPackage(preview.package);
  const [sheetId, setSheetId] = useState<SheetId | null>(null);
  const [selection, setSelection] = useState<CellSelection | null>(null);

  if (!reading.ok) {
    return (
      <div role="alert" className="mt-3 rounded-sm border border-destructive/50 bg-destructive/5 p-3 text-sm text-foreground" data-package-preview="unreadable">
        <p className="font-semibold">The package cannot be shown.</p>
        <p className="mt-1">{reading.detail}</p>
      </div>
    );
  }

  const { pkg, issues, summary, sheets } = reading;
  const activeSheet = activeSheetId(sheets, sheetId);
  const sheet = activeSheet ? sheetOf(pkg, activeSheet) : undefined;
  const shown = issuesShown(issues);
  const detail = selection ? cellDetail(pkg, selection) : null;

  return (
    <div className="mt-3 text-sm" data-package-preview={pkg.meta.ticker}>
      <p className="text-foreground">
        <span className="font-medium">{pkg.meta.name}</span> · {preview.version} · {RELEASE_STATUS_WORDS[preview.status]}
      </p>
      <p className="mt-1 text-xs text-foreground-muted">
        Staged {preview.stagedAt} in {preview.waveId}. Content hash <span className="font-mono" title={preview.contentHash}>{shortHash(preview.contentHash)}…</span>
      </p>

      {issues.length ? (
        <div role="alert" className="mt-3 rounded-sm border border-destructive/50 bg-destructive/5 p-3" data-package-issues="">
          <p className="font-semibold text-foreground">The site would not show this package: {cellsText(summary.cells)} checked, and these checks failed.</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-foreground">
            {shown.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {shown.more ? <p className="mt-1 text-xs text-foreground-muted">and {numberText(shown.more)} more.</p> : null}
        </div>
      ) : (
        <p role="status" className="mt-3 text-xs text-foreground-secondary">
          Every contract rule and formula check the site runs passes on this package.
        </p>
      )}

      <PanelSection title="Summary">
        {CELL_KINDS.map((kind) => (
          <div key={kind.id} className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-1.5" data-kind-count={kind.id}>
            <span className="text-foreground-secondary">
              <Glyph glyph={CELL_KIND_MARKS[kind.id].glyph} tone={CELL_KIND_MARKS[kind.id].tone} /> {kind.label}
            </span>
            <span className="text-right font-medium tabular-nums text-foreground">{numberText(summary.byKind[kind.id])}</span>
          </div>
        ))}
        <FigureRow label="Tie-outs that differ" value={numberText(summary.tieOuts.differs)} />
        <FigureRow label="Tie-outs not checked" value={numberText(summary.tieOuts.not_checked)} />
        <FigureRow label="Tie-outs that agree" value={numberText(summary.tieOuts.agrees)} />
      </PanelSection>

      <PanelSection title="Workpaper gates">
        {summary.gates.length ? (
          <ul className="space-y-1">
            {summary.gates.map((gate) => {
              const mark = gateMark(gate);
              return (
                <li key={gate.name} className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground">{gate.name}</span>
                  <StatusBadge glyph={mark.glyph} word={mark.word} tone={mark.tone} />
                  {gate.note ? <span className="text-xs text-foreground-muted">{gate.note}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Quiet>The workpaper lists no gate.</Quiet>
        )}
      </PanelSection>

      <PanelSection title="Provenance">
        <p className="text-foreground" data-provenance={summary.provenance}>
          {summary.provenance}
          {summary.provenanceNote ? <span className="text-foreground-secondary"> — {summary.provenanceNote}</span> : null}
        </p>
      </PanelSection>

      <PanelSection title="Sheets">
        <div role="group" aria-label="Sheet" className="flex flex-wrap gap-2">
          {sheets.map((id) => {
            const entry = byId(SHEETS, id);
            const active = id === activeSheet;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                title={entry?.means}
                onClick={() => {
                  setSheetId(id);
                  setSelection(null);
                }}
                className={cn(
                  'min-h-11 rounded-sm border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface-2 text-foreground hover:bg-surface-3',
                )}
              >
                {entry?.label ?? id}
              </button>
            );
          })}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-secondary" aria-label="Cell legend">
          {CELL_KINDS.map((kind) => (
            <li key={kind.id}>
              <Glyph glyph={CELL_KIND_MARKS[kind.id].glyph} tone={CELL_KIND_MARKS[kind.id].tone} /> {kind.label}: {kind.means}
            </li>
          ))}
        </ul>
        {sheet && activeSheet ? (
          sheet.rows.length ? (
            <div className="mt-2 overflow-x-auto rounded-sm border border-border">
              <table className="w-full border-collapse text-xs tabular-nums" aria-label={`Sheet ${byId(SHEETS, activeSheet)?.label ?? activeSheet}`}>
                <thead>
                  <tr className="bg-surface-2 text-left text-foreground-secondary">
                    <th scope="col" className="sticky left-0 bg-surface-2 px-2 py-1.5 font-medium">
                      Line
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      Unit
                    </th>
                    {pkg.periods.map((period) => (
                      <th key={period.id} scope="col" className="px-2 py-1.5 text-right font-medium" data-forecast={period.forecast ? '' : undefined}>
                        {period.label}
                        {period.forecast ? <span className="text-foreground-muted"> (forecast)</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row, rowIndex) => (
                    <tr key={row.id} className="border-t border-border-subtle" data-row-style={row.style}>
                      <th scope="row" className={cn('sticky left-0 bg-card px-2 py-1 text-left font-normal text-foreground', row.style === 'total' && 'font-semibold')}>
                        {row.label}
                      </th>
                      <td className="px-2 py-1 text-foreground-muted">{row.unit}</td>
                      {row.cells.map((cell, periodIndex) => {
                        const mark = CELL_KIND_MARKS[cell.kind];
                        const selected = selection?.sheetId === activeSheet && selection.rowIndex === rowIndex && selection.periodIndex === periodIndex;
                        return (
                          <td key={pkg.periods[periodIndex]?.id ?? String(periodIndex)} className="p-0 text-right">
                            <button
                              type="button"
                              aria-pressed={selected}
                              aria-label={`${row.label}, ${pkg.periods[periodIndex]?.label ?? ''}: ${cellText(cell, row)}, ${byId(CELL_KINDS, cell.kind)?.label ?? cell.kind}`}
                              onClick={() => setSelection({ sheetId: activeSheet, rowIndex, periodIndex })}
                              data-kind={cell.kind}
                              className={cn(
                                'fsre-tone flex min-h-11 w-full items-center justify-end gap-1 px-2 text-right transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                                selected && 'bg-surface-3',
                                cell.tieOut?.status === 'differs' && 'underline decoration-destructive decoration-2 underline-offset-4',
                              )}
                              data-tone={mark.tone}
                            >
                              <span aria-hidden="true">{mark.glyph}</span>
                              <span className="text-foreground">{cellText(cell, row)}</span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Quiet>This sheet has no rows.</Quiet>
          )
        ) : null}
        <p className="mt-1 text-xs text-foreground-muted">{NUMBER_CONVENTION}</p>
      </PanelSection>

      <PanelSection title="Selected cell">
        {detail ? (
          <div data-cell-detail="">
            <p className="text-foreground">
              <span className="font-medium">{detail.row.label}</span>, {detail.period.label}: <span className="font-mono">{detail.value}</span> {detail.row.unit}
            </p>
            <p className="mt-1">
              <StatusBadge glyph={CELL_KIND_MARKS[detail.cell.kind].glyph} word={detail.kindWord} tone={CELL_KIND_MARKS[detail.cell.kind].tone} />
            </p>
            {detail.cell.formula ? (
              <p className="mt-1.5 break-all font-mono text-xs text-foreground-secondary" data-formula="">
                {detail.cell.formula}
              </p>
            ) : null}
            {detail.cell.source ? (
              <dl className="mt-1.5 space-y-0.5 text-xs" data-source="">
                <div className="flex gap-2">
                  <dt className="text-foreground-muted">Issuer</dt>
                  <dd className="text-foreground">{detail.cell.source.issuer}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-foreground-muted">Document</dt>
                  <dd className="text-foreground">{detail.cell.source.document}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-foreground-muted">Period</dt>
                  <dd className="text-foreground">{detail.cell.source.period}</dd>
                </div>
                {detail.cell.source.page !== undefined ? (
                  <div className="flex gap-2">
                    <dt className="text-foreground-muted">Page</dt>
                    <dd className="text-foreground">{numberText(detail.cell.source.page)}</dd>
                  </div>
                ) : null}
                {detail.cell.source.note ? (
                  <div className="flex gap-2">
                    <dt className="text-foreground-muted">Note</dt>
                    <dd className="text-foreground">{detail.cell.source.note}</dd>
                  </div>
                ) : null}
                {detail.cell.source.xbrlConcept ? (
                  <div className="flex gap-2">
                    <dt className="text-foreground-muted">XBRL concept</dt>
                    <dd className="font-mono text-foreground">{detail.cell.source.xbrlConcept}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {detail.cell.note ? <p className="mt-1.5 text-xs text-foreground-secondary">{detail.cell.note}</p> : null}
            {detail.tieOut ? (
              <p className="mt-1.5 text-xs text-foreground" data-tie-out={detail.cell.tieOut?.status}>
                Tie-out <StatusBadge glyph="" word={detail.tieOut.word} tone={detail.tieOut.tone} /> against {detail.tieOut.sourceText}: external {detail.tieOut.external}, difference{' '}
                {detail.tieOut.difference}.
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-foreground-muted">No tie-out on this cell.</p>
            )}
          </div>
        ) : (
          <Quiet>Select a cell in the grid to see its formula or its source and its tie-out.</Quiet>
        )}
      </PanelSection>
    </div>
  );
}
