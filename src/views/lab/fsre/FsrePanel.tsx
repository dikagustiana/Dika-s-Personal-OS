/**
 * The details panel: what is selected in the building, or the company list
 * when nothing is. Every figure comes from the reducer's state; every state
 * is glyph + word; placeholders in the data ("[Proposal 1: …]") are shown
 * exactly as written; every number goes through the one formatter.
 *
 * The approval lock is written out IN FULL, per ticker: every open
 * escalation's reason, never only the latest (the source kept one). The
 * buttons are disabled — this is a replay; decisions arrive as events.
 */
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import type { FsreEvent } from '../../../logic/lab/fsre/events';
import { formatFigure } from '../../../logic/lab/fsre/format';
import {
  AGENT_GLYPHS,
  AGENT_TONES,
  FOLDER_GLYPHS,
  FOLDER_TONES,
  GATE_GLYPHS,
  GATE_TONES,
  ISSUE_STATE_GLYPHS,
  ISSUE_STATE_TONES,
  ITEM_STATE_GLYPHS,
  ITEM_STATE_TONES,
  LOCK_GLYPH,
  PARTNER_KIND_GLYPHS,
  PARTNER_KIND_TONES,
  STAGE_GLYPHS,
  STAGE_TONES,
} from '../../../logic/lab/fsre/glyphs';
import { FLOOR_LABELS, resolveDesk } from '../../../logic/lab/fsre/layout';
import { PANEL } from '../../../logic/lab/fsre/geometry';
import {
  agentEventIndexes,
  approvalLock,
  folderStatus,
  gateSummary,
  partnerItems,
  type CompanyState,
  type FsreContext,
  type FsreState,
  type PartnerItem,
} from '../../../logic/lab/fsre/reducer';
import type { FsreSelection } from '../../../logic/lab/fsre/scene';
import { whereIs } from '../../../logic/lab/fsre/scene';
import { filterCompanies } from '../../../logic/lab/fsre/search';
import {
  AGENT_STATUS_WORDS,
  FOLDER_STATUS_WORDS,
  GATE_RESULT_WORDS,
  ISSUE_STATE_WORDS,
  ITEM_STATE_WORDS,
  PARTNER_KIND_WORDS,
  STAGE_STATUS_WORDS,
  figureLabel,
  type AgentStatus,
} from '../../../logic/lab/fsre/statuses';
import { countText, deskLabel, eventSources, gateHistoryText, hasMany, recentLines, stageName } from '../../../logic/lab/fsre/viewModel';
import { FigureRow, LinkRow, PanelSection, Quiet, StatusBadge } from './fsreUi';

interface FsrePanelProps {
  ctx: FsreContext;
  state: FsreState;
  events: readonly FsreEvent[];
  cursor: number;
  selection: FsreSelection | null;
  query: string;
  agentStatuses: Record<string, AgentStatus>;
  onSelect: (selection: FsreSelection | null) => void;
}

function Heading({ kicker, title, badge }: { kicker: string; title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="surface-label">{kicker}</p>
        <h2 className="mt-1 break-words font-display text-card-heading font-semibold text-foreground">{title}</h2>
      </div>
      {badge}
    </div>
  );
}

function BackToList({ onSelect }: { onSelect: (selection: null) => void }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-3 mb-2 h-11" onClick={() => onSelect(null)}>
      ← All companies
    </Button>
  );
}

/* ---------- the approval lock, written out ---------- */

function ApprovalLock({ state, company }: { state: FsreState; company: CompanyState }) {
  const lock = approvalLock(state, company.ticker);
  if (lock.locked) {
    return (
      <div className="fsre-tone rounded-sm border border-escalate/40 bg-escalate/5 p-2.5" data-tone="escalated" role="note">
        <p className="font-semibold">
          {LOCK_GLYPH} Approval locked for {company.ticker}: {countText(lock.reasons.length, 'open escalation')}
        </p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-foreground">
          {lock.reasons.map((reason) => (
            <li key={`${reason.ticker ?? 'run'}:${reason.eventId}`}>
              <span className="font-medium">{reason.title}</span> — {reason.reason}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (company.approved) {
    return <StatusBadge glyph={FOLDER_GLYPHS.approved} word={FOLDER_STATUS_WORDS.approved} tone={FOLDER_TONES.approved} />;
  }
  return <Quiet>Not locked: no escalation is open for {company.ticker}.</Quiet>;
}

/* ---------- folder ---------- */

function FolderPanel({ ctx, state, events, cursor, company, onSelect }: { ctx: FsreContext; state: FsreState; events: readonly FsreEvent[]; cursor: number; company: CompanyState; onSelect: FsrePanelProps['onSelect'] }) {
  const status = folderStatus(state, company);
  const where = whereIs(ctx, company);
  const figures = Object.entries(company.figures);
  const sources = eventSources(events, cursor, company.ticker);
  const gateStages = ctx.plan.gateStageIds.filter((stageId) => gateSummary(company, stageId).results.length);
  return (
    <div>
      <BackToList onSelect={onSelect} />
      <Heading
        kicker="Company folder"
        title={company.name ? `${company.ticker} — ${company.name}` : company.ticker}
        badge={<StatusBadge glyph={FOLDER_GLYPHS[status]} word={FOLDER_STATUS_WORDS[status]} tone={FOLDER_TONES[status]} />}
      />

      <PanelSection title="Where it is">
        <p className="text-foreground">
          {where.stage ?? 'No stage yet'}{' '}
          <StatusBadge glyph={STAGE_GLYPHS[where.status]} word={STAGE_STATUS_WORDS[where.status]} tone={STAGE_TONES[where.status]} className="ml-1" />
        </p>
        {company.deskKey ? <p className="mt-1 text-foreground-secondary">Folder on {deskLabel(ctx.plan, company.deskKey)}.</p> : null}
      </PanelSection>

      <PanelSection title="Figures">
        {figures.length ? figures.map(([key, figure]) => <FigureRow key={key} label={figureLabel(key)} value={formatFigure(figure)} />) : <Quiet>No figure reported yet.</Quiet>}
      </PanelSection>

      <PanelSection title="Gates on record">
        {gateStages.length ? (
          <ul className="space-y-2">
            {gateStages.map((stageId) => {
              const summary = gateSummary(company, stageId);
              return (
                <li key={stageId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{stageName(ctx.plan, stageId)}</span>
                    <StatusBadge glyph={GATE_GLYPHS[summary.worst]} word={GATE_RESULT_WORDS[summary.worst]} tone={GATE_TONES[summary.worst]} />
                  </div>
                  {hasMany(summary.results) ? <p className="mt-0.5 text-xs text-foreground-secondary">On record, in order: {gateHistoryText(summary.results)}. A later result never erases an earlier one.</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Quiet>No gate has reported for {company.ticker} yet.</Quiet>
        )}
      </PanelSection>

      <PanelSection title={countText(company.issues.length, 'review issue')}>
        {company.issues.length ? (
          <ul className="space-y-2">
            {company.issues.map((issue) => (
              <li key={issue.eventId}>
                <StatusBadge glyph={ISSUE_STATE_GLYPHS[issue.state]} word={ISSUE_STATE_WORDS[issue.state]} tone={ISSUE_STATE_TONES[issue.state]} />
                <p className="mt-1 font-medium text-foreground">{issue.title}</p>
                {issue.detail ? <p className="text-foreground-secondary">{issue.detail}</p> : null}
                <p className="text-xs text-foreground-muted">
                  {[stageName(ctx.plan, issue.stageId), issue.raisedBy ? `raised by ${issue.raisedBy}` : null].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>No issue raised.</Quiet>
        )}
      </PanelSection>

      <PanelSection title="Escalations and proposals">
        <PartnerList ctx={ctx} items={partnerItems(state).filter((item) => item.ticker === company.ticker)} empty={`Nothing raised for ${company.ticker}.`} />
      </PanelSection>

      <PanelSection title="Publication">
        <Button variant="secondary" className="h-11 w-full" disabled>
          Approve for publication
        </Button>
        <div className="mt-2">
          <ApprovalLock state={state} company={company} />
        </div>
      </PanelSection>

      <PanelSection title="Read from">
        {sources.length ? (
          <ul className="space-y-1 text-xs text-foreground-secondary">
            {sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        ) : (
          <Quiet>No event for {company.ticker} names its source.</Quiet>
        )}
      </PanelSection>
    </div>
  );
}

/* ---------- partner items ---------- */

function PartnerList({ ctx, items, empty }: { ctx: FsreContext; items: PartnerItem[]; empty: string }) {
  if (!items.length) return <Quiet>{empty}</Quiet>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key} className="rounded-sm border border-border p-2.5" data-partner-item={item.key}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge glyph={PARTNER_KIND_GLYPHS[item.kind]} word={PARTNER_KIND_WORDS[item.kind]} tone={PARTNER_KIND_TONES[item.kind]} />
            <StatusBadge glyph={ITEM_STATE_GLYPHS[item.state]} word={ITEM_STATE_WORDS[item.state]} tone={ITEM_STATE_TONES[item.state]} />
            <span className="text-xs text-foreground-muted">{[item.ticker ?? 'Whole run', stageName(ctx.plan, item.stageId)].filter(Boolean).join(' · ')}</span>
          </div>
          <p className="mt-1.5 font-medium text-foreground">{item.title}</p>
          {item.reason ? <p className="mt-0.5 text-foreground">{item.reason}</p> : null}
          {item.detail && item.detail !== item.reason ? <p className="mt-0.5 text-foreground-secondary">{item.detail}</p> : null}
          <p className="mt-0.5 text-xs text-foreground-muted">
            {[item.raisedBy ? `Raised by ${item.raisedBy}` : null, item.mode ? `Mode: ${item.mode}` : null].filter(Boolean).join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  );
}

function PartnerPanel({ ctx, state, onSelect }: { ctx: FsreContext; state: FsreState; onSelect: FsrePanelProps['onSelect'] }) {
  const items = partnerItems(state);
  const open = items.filter((item) => item.state === 'open');
  const companies = state.companyOrder.map((ticker) => state.companies[ticker]);
  return (
    <div>
      <BackToList onSelect={onSelect} />
      <Heading kicker="Waiting for the owner" title="Partner room" />
      <PanelSection title={`Waiting for you (${countText(open.length, 'item')})`}>
        <PartnerList ctx={ctx} items={items} empty="Nothing is waiting." />
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" className="h-11" disabled>
            Approve
          </Button>
          <Button variant="ghost" className="h-11" disabled>
            Dismiss
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-foreground-muted">Replay: decisions arrive as the pipeline's own events, not from here.</p>
      </PanelSection>
      <PanelSection title="Approval for publication">
        {companies.length ? (
          <ul className="space-y-2">
            {companies.map((company) => (
              <li key={company.ticker}>
                <ApprovalLock state={state} company={company} />
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>No company has appeared yet.</Quiet>
        )}
        <p className="mt-2 text-xs text-foreground-muted">Only the owner can approve or publish.</p>
      </PanelSection>
    </div>
  );
}

/* ---------- agent ---------- */

function AgentPanel({ ctx, state, events, cursor, skill, status, onSelect }: { ctx: FsreContext; state: FsreState; events: readonly FsreEvent[]; cursor: number; skill: string; status: AgentStatus; onSelect: FsrePanelProps['onSelect'] }) {
  const role = ctx.run.skills.find((s) => s.name === skill)?.role ?? null;
  const floorId = ctx.plan.floorOfSkill[skill];
  const stages = ctx.plan.stageOrder.filter((stageId) => ctx.plan.stageRunners[stageId]?.includes(skill));
  const inHand = state.agents[skill]?.activeTickers ?? [];
  const history = recentLines(ctx, events, agentEventIndexes(ctx, events, cursor, skill), PANEL.recentEvents);
  return (
    <div>
      <BackToList onSelect={onSelect} />
      <Heading
        kicker={floorId ? `Agent · ${FLOOR_LABELS[floorId]}` : 'Agent'}
        title={skill}
        badge={<StatusBadge glyph={AGENT_GLYPHS[status]} word={AGENT_STATUS_WORDS[status]} tone={AGENT_TONES[status]} />}
      />
      <PanelSection title="Role">{role ? <p className="text-foreground">{role}</p> : <Quiet>No role in the skill data.</Quiet>}</PanelSection>
      <PanelSection title="Stages it runs">
        {stages.length ? <p className="text-foreground">{stages.map((stageId) => stageName(ctx.plan, stageId)).join(', ')}</p> : <Quiet>None in the stage data.</Quiet>}
      </PanelSection>
      <PanelSection title={`In its hands (${countText(inHand.length, 'company', 'companies')})`}>
        {inHand.length ? (
          <ul>
            {inHand.map((ticker) => (
              <li key={ticker}>
                <LinkRow onPress={() => onSelect({ kind: 'folder', ticker })} label={`Open the ${ticker} folder`}>
                  <span className="font-medium">{ticker}</span>
                </LinkRow>
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>No company right now.</Quiet>
        )}
      </PanelSection>
      <PanelSection title={`Events that touched it (${countText(history.total, 'event')})`}>
        {history.lines.length ? (
          <ul className="space-y-1.5">
            {history.lines.map((line) => (
              <li key={line.id} className="border-b border-border-subtle pb-1.5 last:border-b-0">
                <p className="text-foreground">
                  {line.kind} <span className="text-foreground-muted">· {line.where}</span>
                </p>
                {line.detail ? <p className="text-xs text-foreground-secondary">{line.detail}</p> : null}
              </li>
            ))}
            {history.earlier ? <li className="text-xs text-foreground-muted">and {countText(history.earlier, 'earlier event')}</li> : null}
          </ul>
        ) : (
          <Quiet>No event has touched it yet.</Quiet>
        )}
      </PanelSection>
    </div>
  );
}

/* ---------- gate room ---------- */

function GatePanel({ ctx, state, stageId, onSelect }: { ctx: FsreContext; state: FsreState; stageId: string; onSelect: FsrePanelProps['onSelect'] }) {
  const companies = state.companyOrder.map((ticker) => state.companies[ticker]);
  const reported = companies.filter((company) => gateSummary(company, stageId).results.length);
  const waiting = companies.length - reported.length;
  return (
    <div>
      <BackToList onSelect={onSelect} />
      <Heading kicker="Gate room" title={stageName(ctx.plan, stageId) ?? stageId} />
      <PanelSection title={`Results (${countText(reported.length, 'company', 'companies')})`}>
        {reported.length ? (
          <ul>
            {reported.map((company) => {
              const summary = gateSummary(company, stageId);
              const latest = summary.latestRecord;
              return (
                <li key={company.ticker} className="border-b border-border-subtle py-1.5 last:border-b-0">
                  <LinkRow onPress={() => onSelect({ kind: 'folder', ticker: company.ticker })} label={`Open the ${company.ticker} folder`}>
                    <span className="font-medium">{company.ticker}</span>
                    <StatusBadge glyph={GATE_GLYPHS[summary.worst]} word={GATE_RESULT_WORDS[summary.worst]} tone={GATE_TONES[summary.worst]} />
                  </LinkRow>
                  {hasMany(summary.results) ? <p className="px-2 text-xs text-foreground-secondary">On record: {gateHistoryText(summary.results)}.</p> : null}
                  {latest && Object.keys(latest.figures).length ? (
                    <div className="px-2">
                      {Object.entries(latest.figures).map(([key, figure]) => (
                        <FigureRow key={key} label={figureLabel(key)} value={formatFigure(figure)} />
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Quiet>No company has reached this gate yet.</Quiet>
        )}
        {waiting && reported.length ? <p className="mt-2 text-xs text-foreground-muted">{countText(waiting, 'company', 'companies')} not at this gate yet.</p> : null}
      </PanelSection>
    </div>
  );
}

/* ---------- a desk's stack of folders ---------- */

function DeskPanel({ ctx, state, deskKey, onSelect }: { ctx: FsreContext; state: FsreState; deskKey: string; onSelect: FsrePanelProps['onSelect'] }) {
  const desk = resolveDesk(ctx.plan, deskKey);
  const here = state.companyOrder.filter((ticker) => {
    const key = state.companies[ticker].deskKey;
    return key !== null && resolveDesk(ctx.plan, key).key === desk.key;
  });
  return (
    <div>
      <BackToList onSelect={onSelect} />
      <Heading kicker={FLOOR_LABELS[desk.floorId]} title={`Folders on ${deskLabel(ctx.plan, desk.key)}`} />
      <PanelSection title={countText(here.length, 'folder')}>
        <CompanyRows state={state} ctx={ctx} tickers={here} onSelect={onSelect} />
      </PanelSection>
    </div>
  );
}

/* ---------- the company list ---------- */

function CompanyRows({ ctx, state, tickers, onSelect }: { ctx: FsreContext; state: FsreState; tickers: string[]; onSelect: FsrePanelProps['onSelect'] }) {
  return (
    <ul>
      {tickers.map((ticker) => {
        const company = state.companies[ticker];
        const status = folderStatus(state, company);
        const where = whereIs(ctx, company);
        return (
          <li key={ticker}>
            <LinkRow onPress={() => onSelect({ kind: 'folder', ticker })} label={`${ticker}, ${FOLDER_STATUS_WORDS[status]}`}>
              <span className="min-w-0">
                <span className="font-medium text-foreground">{ticker}</span>
                <span className="block truncate text-xs text-foreground-muted">{[company.name, where.stage].filter(Boolean).join(' · ')}</span>
              </span>
              <StatusBadge glyph={FOLDER_GLYPHS[status]} word={FOLDER_STATUS_WORDS[status]} tone={FOLDER_TONES[status]} />
            </LinkRow>
          </li>
        );
      })}
    </ul>
  );
}

function CompanyList({ ctx, state, query, onSelect }: { ctx: FsreContext; state: FsreState; query: string; onSelect: FsrePanelProps['onSelect'] }) {
  const all = state.companyOrder.length;
  const matches = filterCompanies(state, query);
  return (
    <div>
      <Heading kicker="Companies" title={query.trim() ? `Matching “${query.trim()}”` : 'Every company in this run'} />
      <PanelSection title={countText(matches.length, 'company', 'companies')}>
        {matches.length ? (
          <CompanyRows ctx={ctx} state={state} tickers={matches.map((c) => c.ticker)} onSelect={onSelect} />
        ) : all ? (
          <Quiet>No company matches “{query.trim()}”.</Quiet>
        ) : (
          <Quiet>No company has appeared yet. A folder appears when an event names its ticker.</Quiet>
        )}
      </PanelSection>
      <p className="mt-4 text-xs text-foreground-muted">Select an agent, a folder, a gate room or the partner room in the building to see it here.</p>
    </div>
  );
}

/* ---------- the switch ---------- */

export function FsrePanel({ ctx, state, events, cursor, selection, query, agentStatuses, onSelect }: FsrePanelProps) {
  let body: React.ReactNode;
  switch (selection?.kind) {
    case 'folder': {
      const company = state.companies[selection.ticker];
      body = company ? (
        <FolderPanel ctx={ctx} state={state} events={events} cursor={cursor} company={company} onSelect={onSelect} />
      ) : (
        <div>
          <BackToList onSelect={onSelect} />
          <Quiet>{selection.ticker} has no folder at this point of the replay.</Quiet>
        </div>
      );
      break;
    }
    case 'agent':
      body = <AgentPanel ctx={ctx} state={state} events={events} cursor={cursor} skill={selection.skill} status={agentStatuses[selection.skill] ?? 'idle'} onSelect={onSelect} />;
      break;
    case 'gate':
      body = <GatePanel ctx={ctx} state={state} stageId={selection.stageId} onSelect={onSelect} />;
      break;
    case 'partner':
      body = <PartnerPanel ctx={ctx} state={state} onSelect={onSelect} />;
      break;
    case 'desk':
      body = <DeskPanel ctx={ctx} state={state} deskKey={selection.deskKey} onSelect={onSelect} />;
      break;
    default:
      body = <CompanyList ctx={ctx} state={state} query={query} onSelect={onSelect} />;
  }
  return (
    <Card className="p-5" aria-label="Details">
      {body}
    </Card>
  );
}
