/**
 * The industries board (brief v2 WO-5): how far each sub-industry has been
 * modelled, grouped by chain group in chain order, with sticky group headers
 * and a sticky column header. Progress is never a percentage: "Stage 7 of 13"
 * with a segmented bar. "Open in the building" filters the building to that
 * engagement; rows with no engagement offer a New engagement prefilled with
 * the sub-industry.
 *
 * Ported from the GLM workspace (src/panels/IndustriesView.tsx at 5b5d186).
 */
import { Fragment, useEffect } from 'react';
import type { IndustryProgressRow } from '../../../data/fsreTransport/contract';
import { formatCount, formatNumber } from '../../../logic/lab/fsre/format';
import { FOLDER_GLYPHS, LIVE_GATE_GLYPHS, LIVE_GATE_TONES, LOCK_GLYPH } from '../../../logic/lab/fsre/glyphs';
import { LIVE_GATE_STAGES } from '../../../logic/lab/fsre/liveReducer';
import { INDUSTRIES_COLUMNS, gateShortName, industriesGroups, industriesTopLine, openableEngagement, stageSegments } from '../../../logic/lab/fsre/liveView';
import { FOLDER_STATUS_WORDS, gateStatusLabel } from '../../../logic/lab/fsre/statuses';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { Glyph } from './fsreUi';
import { useFsreLiveStore } from './useFsreLiveStore';
import { useFsreOfficeStore } from './useFsreOfficeStore';

type Company = IndustryProgressRow['companies'][number];

function StageBar({ stageIndex, stagesTotal }: { stageIndex: number; stagesTotal: number }) {
  const text = `Stage ${formatNumber(stageIndex)} of ${formatNumber(stagesTotal)}`;
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={text}>
      <span className="inline-flex gap-px" aria-hidden="true">
        {stageSegments(stageIndex, stagesTotal).map((reached, index) => (
          <span key={index} className={cn('inline-block h-2.5 w-1.5 rounded-[1px]', reached ? 'bg-primary' : 'bg-surface-3')} />
        ))}
      </span>
      <span className="text-xs text-foreground-secondary">{text}</span>
    </span>
  );
}

function CompanyCell({ company }: { company: Company }) {
  const gates = [company.gates.g1, company.gates.g2, company.gates.g3];
  return (
    <div className="min-w-52">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{company.ticker}</span>
        <StageBar stageIndex={company.stageIndex} stagesTotal={company.stagesTotal} />
      </div>
      <p className="mt-0.5 text-xs text-foreground">
        {LIVE_GATE_STAGES.map((stage, index) => {
          const status = gates[index] ?? 'pending';
          return (
            <span key={stage.id} className="mr-2 inline-flex items-center gap-1">
              <Glyph glyph={LIVE_GATE_GLYPHS[status]} tone={LIVE_GATE_TONES[status]} />
              {gateShortName(index)} {gateStatusLabel(status, company.escalationsOpen)}
            </span>
          );
        })}
        {company.escalationsOpen ? (
          <span className="fsre-tone mr-2" data-tone="escalated">
            <Glyph glyph={LOCK_GLYPH} tone="escalated" /> {formatCount(company.escalationsOpen, 'escalation')} open
          </span>
        ) : null}
        {company.publishedVersion ? (
          <span className="fsre-tone" data-tone="done">
            <Glyph glyph={FOLDER_GLYPHS.published} tone="done" /> {FOLDER_STATUS_WORDS.published.toLowerCase()} {company.publishedVersion}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function Row({ row, onOpen, onNewEngagement, engagementId }: { row: IndustryProgressRow; onOpen: (id: string) => void; onNewEngagement: (name: string) => void; engagementId: string | null }) {
  return (
    <tr className="border-b border-border-subtle align-top">
      <td className="px-4 py-3">
        <div className="font-medium text-foreground">
          {row.subIndustryName}
          {row.covered ? (
            <span className="fsre-tone ml-2 text-xs font-semibold" data-tone="done">
              ★ Covered
            </span>
          ) : null}
        </div>
        <div className="text-xs text-foreground-secondary">
          {row.subIndustryCode} · {formatCount(row.companies.length, 'company', 'companies')} of {formatNumber(row.targetCompanies)}
        </div>
      </td>
      <td className="px-4 py-3">
        {row.companies.length ? (
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
            {row.companies.map((company) => (
              <CompanyCell key={company.ticker} company={company} />
            ))}
            {engagementId ? (
              <Button type="button" variant="secondary" size="sm" className="ml-auto min-h-11" onClick={() => onOpen(engagementId)}>
                Open in the building
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-foreground-secondary">Not started</span>
            <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => onNewEngagement(row.subIndustryName)}>
              + New engagement
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function FsreIndustries() {
  const progress = useFsreLiveStore((s) => s.progress);
  const engagements = useFsreLiveStore((s) => s.engagements);
  const state = useFsreLiveStore((s) => s.state);
  const refreshLists = useFsreLiveStore((s) => s.refreshLists);
  const setLiveView = useFsreOfficeStore((s) => s.setLiveView);
  const setIndustriesFilter = useFsreOfficeStore((s) => s.setIndustriesFilter);
  const openEngagementDialog = useFsreOfficeStore((s) => s.openEngagementDialog);

  // Opening the board is the owner's action: one refresh, never a timer (FX-8).
  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  const top = industriesTopLine(progress, engagements, state);
  const openInBuilding = (engagementId: string) => {
    setIndustriesFilter(engagementId);
    setLiveView('building');
  };

  return (
    <section aria-label="Industries board" className="min-w-0">
      <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
        <div>
          <p className="surface-label">Sub-industries covered</p>
          <p className="text-sm font-semibold text-foreground">
            {formatNumber(top.covered)} of {formatNumber(top.total)} <span className="font-normal text-foreground-secondary">(covered = at least 2 published)</span>
          </p>
        </div>
        <div>
          <p className="surface-label">Engagements running</p>
          <p className="text-sm font-semibold text-foreground">{formatNumber(top.running)}</p>
        </div>
        <div>
          <p className="surface-label">Escalations open</p>
          <p className="fsre-tone text-sm font-semibold" data-tone={top.escalationsOpen ? 'escalated' : 'neutral'}>
            {top.escalationsOpen ? <Glyph glyph={LOCK_GLYPH} tone="escalated" /> : null} {formatNumber(top.escalationsOpen)}
          </p>
        </div>
        <p className="max-w-md text-xs text-foreground-secondary">“Open in the building” filters the building to that engagement; desks of other engagements are dimmed and labelled.</p>
      </div>

      <div className="mt-4 max-h-[70vh] overflow-auto rounded-lg border border-border bg-card shadow-card">
        <table className="w-full border-collapse text-sm" aria-label="Sub-industries by chain group">
          <thead className="sticky top-0 z-20 bg-surface-2">
            <tr>
              <th className="px-4 py-2 text-left">
                <span className="surface-label">Sub-industry</span>
              </th>
              <th className="px-4 py-2 text-left">
                <span className="surface-label">Progress</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {industriesGroups(progress).map(({ group, rows }) => (
              <Fragment key={group}>
                <tr className="sticky top-9 z-10 bg-surface-3">
                  <th colSpan={INDUSTRIES_COLUMNS} scope="colgroup" className="px-4 py-1.5 text-left">
                    <span className="surface-label">{group}</span>
                  </th>
                </tr>
                {rows.map((row) => (
                  <Row key={row.subIndustryCode} row={row} onOpen={openInBuilding} onNewEngagement={(name) => openEngagementDialog(name)} engagementId={openableEngagement(row, engagements)} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-foreground-muted">Each company’s bar shows the highest stage it has reached, never a percentage.</p>
    </section>
  );
}
