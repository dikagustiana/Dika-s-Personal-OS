/**
 * 1-E — THE DIRECTOR'S ROOM.
 *
 * Where finished work lands: the output, its provenance tree, every review
 * across every department including peer reviews and debates, eval scores,
 * actual cost against estimate, and every pending proposal with its diff.
 * The director approves, rejects or publishes, and a rejection carries a
 * reason — those reasons are the only external check on the committee.
 *
 * THIS SCREEN DECIDES NOTHING. Approve, reject and publish are one
 * key-gated database function (os_inst_brief_decide); promotion is another
 * (os_inst_version_promote). Both re-check the app key inside the database,
 * so the buttons here are a way of calling them and not a second
 * implementation of the rule. Every read is a ReadResult: a missing
 * relation says COULD NOT CHECK rather than rendering an empty institution.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { EmptyRow } from '../../../components/ui/EmptyRow';
import { Checking, CouldNotCheck } from '../../work/finishLineUi';
import { useMutation } from '../../../hooks/useMutation';
import { useAppStore } from '../../../store/appStore';
import { rowsOf } from '../../../data/readResult';
import type {
  InstAssignment,
  InstBrief,
  InstCorpusRecord,
  InstDebate,
  InstEgressBlock,
  InstEvent,
  InstReview,
  InstSubmission,
} from '../../../data/institutionTypes';
import {
  BriefStatusChip,
  CostAgainstEstimate,
  LaneChip,
  SeverityChip,
  VersionStatusChip,
  WeightChip,
  rowsOr,
  useInstitutionData,
  when,
} from './institutionUi';
import { checkRoster } from '../../../logic/institution/roster';
import { cn } from '../../../lib/utils';

type Tab = 'briefs' | 'proposals' | 'roster' | 'evaluations';

export function InstitutionDirector() {
  const repository = useAppStore((state) => state.repository);
  const data = useInstitutionData();
  const { run, status } = useMutation();
  const [tab, setTab] = useState<Tab>('briefs');
  const [openBrief, setOpenBrief] = useState<string | null>(null);

  const briefs = rowsOr(data.briefs);
  const versions = rowsOr(data.versions);
  const agents = rowsOr(data.agents);
  const proposals = versions.filter((version) => version.status === 'proposed');
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const decide = async (brief: InstBrief, decision: 'approved' | 'rejected' | 'published', reason: string | null) => {
    const done = await run(`${decision} brief`, () => repository.institution.decideBrief(brief.id, decision, reason));
    if (done === undefined) return;
    data.reload();
  };

  const promote = async (versionId: string) => {
    const done = await run('Promote version', () => repository.institution.promoteVersion(versionId));
    if (done === undefined) return;
    data.reload();
  };

  const reject = async (versionId: string, reason: string) => {
    const done = await run('Reject version', () => repository.institution.rejectVersion(versionId, reason));
    if (done === undefined) return;
    data.reload();
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Director's room</h1>
          <p className="text-xs text-foreground-muted">
            Finished work, its provenance, every review, and the upgrades waiting on you. Nothing here changed while
            you were away: an agent keeps running its current version until you promote a proposal.
          </p>
        </div>
        <nav className="flex gap-1" aria-label="Director's room sections">
          {(
            [
              ['briefs', `Briefs${briefs.length ? ` (${briefs.length})` : ''}`],
              ['proposals', `Proposals${proposals.length ? ` (${proposals.length})` : ''}`],
              ['roster', 'Roster'],
              ['evaluations', 'Evaluations'],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === id ? 'bg-primary-dim text-primary' : 'text-foreground-secondary hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'briefs' && (
        <section className="space-y-3">
          {data.briefs === null ? (
            <Checking label="Briefs" />
          ) : !data.briefs.ok ? (
            <Card>
              <CardContent className="py-3">
                <CouldNotCheck label="Briefs" failure={data.briefs} />
              </CardContent>
            </Card>
          ) : briefs.length === 0 ? (
            <Card>
              <CardContent className="py-3">
                <EmptyRow
                  label="Briefs"
                  clause="No question has been put to the institution yet."
                />
              </CardContent>
            </Card>
          ) : (
            briefs.map((brief) => (
              <BriefCard
                key={brief.id}
                brief={brief}
                open={openBrief === brief.id}
                onToggle={() => setOpenBrief(openBrief === brief.id ? null : brief.id)}
                onDecide={decide}
                busy={status === 'pending'}
              />
            ))
          )}
        </section>
      )}

      {tab === 'proposals' && (
        <section className="space-y-3">
          {data.versions === null ? (
            <Checking label="Proposals" />
          ) : !data.versions.ok ? (
            <Card>
              <CardContent className="py-3">
                <CouldNotCheck label="Proposals" failure={data.versions} />
              </CardContent>
            </Card>
          ) : proposals.length === 0 ? (
            <Card>
              <CardContent className="py-3">
                <EmptyRow label="Proposals" clause="Nothing is waiting on you. Every agent runs the version you approved." />
              </CardContent>
            </Card>
          ) : (
            proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                agentName={agentById.get(proposal.agentId)?.slug ?? proposal.agentId}
                liveVersion={agentById.get(proposal.agentId)?.version ?? null}
                onPromote={() => promote(proposal.id)}
                onReject={(reason) => reject(proposal.id, reason)}
                busy={status === 'pending'}
              />
            ))
          )}
        </section>
      )}

      {tab === 'roster' && <RosterPanel data={data} />}
      {tab === 'evaluations' && <EvaluationsPanel data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// one brief, and everything behind it
// ---------------------------------------------------------------------------

interface BriefDetail {
  assignments: InstAssignment[];
  reviews: InstReview[];
  submissions: InstSubmission[];
  debates: InstDebate[];
  corpus: InstCorpusRecord[];
  egress: InstEgressBlock[];
  events: InstEvent[];
  failed: string[];
}

function BriefCard({
  brief,
  open,
  onToggle,
  onDecide,
  busy,
}: {
  brief: InstBrief;
  open: boolean;
  onToggle: () => void;
  onDecide: (brief: InstBrief, decision: 'approved' | 'rejected' | 'published', reason: string | null) => Promise<void>;
  busy: boolean;
}) {
  const repository = useAppStore((state) => state.repository);
  const [detail, setDetail] = useState<BriefDetail | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const [assignments, reviews, submissions, debates, corpus, egress, events] = await Promise.all([
      repository.institution.listAssignments(brief.id),
      repository.institution.listReviews(brief.id),
      repository.institution.listSubmissions(brief.id),
      repository.institution.listDebates(brief.id),
      repository.institution.listCorpus({ briefId: brief.id }),
      repository.institution.listEgressBlocks(brief.id),
      repository.institution.listEvents(brief.id),
    ]);
    // A failed read is named, never rendered as an absence — the whole
    // point of ReadResult (see readResult.ts).
    const failed: string[] = [];
    const take = <T,>(label: string, result: { ok: boolean } | null): T[] => {
      if (result && !result.ok) failed.push(label);
      return rowsOf(result as never) as T[];
    };
    setDetail({
      assignments: take<InstAssignment>('assignments', assignments),
      reviews: take<InstReview>('reviews', reviews),
      submissions: take<InstSubmission>('submissions', submissions),
      debates: take<InstDebate>('debates', debates),
      corpus: take<InstCorpusRecord>('corpus', corpus),
      egress: take<InstEgressBlock>('egress blocks', egress),
      events: take<InstEvent>('events', events),
      failed,
    });
  }, [brief.id, repository]);

  useEffect(() => {
    if (open && detail === null) void load();
  }, [open, detail, load]);

  const canApprove = brief.status === 'director';
  const canPublish = brief.status === 'approved';

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <BriefStatusChip status={brief.status} />
          <WeightChip weightClass={brief.weightClass} overridden={brief.classOverriddenByDirector} />
          <LaneChip dataClass={brief.dataClass} />
          <span className="text-[11px] text-foreground-muted">{when(brief.createdAt)}</span>
        </div>
        <CardTitle className="text-sm">{brief.brief.restated || brief.question}</CardTitle>
        {brief.brief.restated && brief.brief.restated !== brief.question && (
          <p className="text-xs text-foreground-muted">Asked as: {brief.question}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-foreground-muted">
            Route: {brief.routing.length > 0 ? brief.routing.join(' → ') : 'not routed'}
          </span>
          <CostAgainstEstimate estimate={brief.costEstimateUsd} actual={brief.costActualUsd} />
          <span className="text-foreground-muted">{brief.stepsTaken} steps</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <button
          type="button"
          onClick={onToggle}
          className="text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? 'Hide the record' : 'Show the record — provenance, every review, debates, blocks'}
        </button>

        {open && detail === null && <p className="text-xs text-foreground-muted">Reading…</p>}
        {open && detail !== null && <BriefRecord brief={brief} detail={detail} />}

        {(canApprove || canPublish) && (
          <div className="space-y-2 border-t border-border-subtle pt-3">
            <label className="block text-xs text-foreground-secondary" htmlFor={`reason-${brief.id}`}>
              Reason (required to reject — rejection reasons are the only external check on the committee)
            </label>
            <textarea
              id={`reason-${brief.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="What is wrong with this, or why you are approving it."
            />
            <div className="flex flex-wrap gap-2">
              {canApprove && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => void onDecide(brief, 'approved', reason || null)}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() => void onDecide(brief, 'rejected', reason)}
                  >
                    Reject
                  </Button>
                </>
              )}
              {canPublish && (
                <Button size="sm" disabled={busy} onClick={() => void onDecide(brief, 'published', reason || null)}>
                  Publish
                </Button>
              )}
            </div>
          </div>
        )}
        {brief.directorDecision && (
          <p className="text-xs text-foreground-muted">
            You {brief.directorDecision} this {when(brief.decidedAt)}
            {brief.directorReason ? `: ${brief.directorReason}` : '.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BriefRecord({ brief, detail }: { brief: InstBrief; detail: BriefDetail }) {
  const outputs = detail.corpus.filter((record) => record.kind === 'output');
  const retrievals = detail.corpus.filter((record) => record.kind === 'retrieval');
  const executions = detail.corpus.filter((record) => record.kind === 'execution');

  return (
    <div className="space-y-4 text-xs">
      {detail.failed.length > 0 && (
        <p className="text-escalate">
          Could not check: {detail.failed.join(', ')}. What is shown below is incomplete, and this is not a clean bill.
        </p>
      )}

      {brief.brief.assumptions && brief.brief.assumptions.length > 0 && (
        <section>
          <h3 className="surface-label">Stated assumptions</h3>
          <ol className="ml-4 list-decimal space-y-0.5 text-foreground-secondary">
            {brief.brief.assumptions.map((assumption, index) => (
              <li key={index}>{assumption}</li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h3 className="surface-label">The work, department by department</h3>
        {detail.assignments.length === 0 ? (
          <p className="text-foreground-muted">Nothing has been assigned yet.</p>
        ) : (
          <ul className="space-y-1">
            {detail.assignments.map((assignment) => (
              <li key={assignment.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[11px] text-foreground-muted">{assignment.kind}</span>
                <span className="font-semibold">{assignment.agentSlug}</span>
                <span className="text-foreground-muted">{assignment.status}</span>
                {assignment.reworkCount > 0 && <span className="text-escalate">rework ×{assignment.reworkCount}</span>}
                {assignment.refusalReason && <span className="text-destructive">{assignment.refusalReason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="surface-label">Reviews</h3>
        {detail.reviews.length === 0 ? (
          <p className="text-foreground-muted">No review has been recorded.</p>
        ) : (
          <ul className="space-y-2">
            {detail.reviews.map((review) => (
              <li key={review.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold uppercase tracking-wide text-[10px] text-foreground-muted">{review.kind}</span>
                  <span>{review.verdict}</span>
                  <span className="text-foreground-muted">round {review.round}</span>
                </div>
                <p className="text-foreground-secondary">{review.summary}</p>
                {review.findings.length > 0 && (
                  <ul className="ml-3 mt-1 space-y-1">
                    {review.findings.map((finding, index) => (
                      <li key={index} className="flex flex-wrap items-baseline gap-2">
                        <SeverityChip severity={finding.severity} />
                        <span className="italic text-foreground-muted">{finding.claim}</span>
                        <span>{finding.finding}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.debates.length > 0 && (
        <section>
          <h3 className="surface-label">Debate</h3>
          <ul className="space-y-1">
            {detail.debates.map((debate) => (
              <li key={debate.id}>
                <span className="font-semibold">{debate.outcome ?? 'not yet weighed'}</span>
                <span className="text-foreground-muted"> · round {debate.round}</span>
                <p className="text-foreground-secondary">{debate.rebuttal}</p>
                {debate.weighing && <p className="text-foreground-muted">Weighed: {debate.weighing}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="surface-label">
          Provenance — {detail.corpus.length} record{detail.corpus.length === 1 ? '' : 's'} ({retrievals.length}{' '}
          retrieved, {executions.length} executed, {outputs.length} output)
        </h3>
        {detail.corpus.length === 0 ? (
          <p className="text-foreground-muted">
            Nothing is archived for this brief. Every claim in an output has to resolve to a record here, so an output
            with an empty archive behind it is not finished.
          </p>
        ) : (
          <ul className="space-y-1">
            {detail.corpus.map((record) => (
              <li key={record.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[10px] text-foreground-muted">{record.kind}</span>
                <LaneChip dataClass={record.dataClass} />
                <span className="font-semibold">{record.title}</span>
                {record.url && (
                  <a
                    href={record.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    source
                  </a>
                )}
                {record.httpStatus !== null && <span className="text-foreground-muted">HTTP {record.httpStatus}</span>}
                {record.fetchedAt && <span className="text-foreground-muted">{when(record.fetchedAt)}</span>}
                <span className="font-mono text-[10px] text-foreground-muted" title={record.contentHash}>
                  sha256 {record.contentHash.slice(0, 12)}…
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.egress.length > 0 && (
        <section>
          <h3 className="surface-label text-destructive">
            Blocked outbound calls (B-4) — {detail.egress.length}
          </h3>
          <p className="text-foreground-muted">
            An internal-lane agent tried to put internal content in front of a third party. The call did not go. A
            pattern of these means work was routed to the wrong lane, and the program office should see it.
          </p>
          <ul className="space-y-0.5">
            {detail.egress.map((block) => (
              <li key={block.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[10px]">{block.tool}</span>
                <span className="text-foreground-secondary">{block.matchedExcerpt}</span>
                <span className="text-foreground-muted">{when(block.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// proposals (B-1)
// ---------------------------------------------------------------------------

function ProposalCard({
  proposal,
  agentName,
  liveVersion,
  onPromote,
  onReject,
  busy,
}: {
  proposal: import('../../../data/institutionTypes').InstAgentVersion;
  agentName: string;
  liveVersion: number | null;
  onPromote: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  busy: boolean;
}) {
  const [reason, setReason] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VersionStatusChip status={proposal.status} />
          <CardTitle className="text-sm">{agentName}</CardTitle>
          <span className="text-[11px] text-foreground-muted">
            proposed by {proposal.proposedBy} · {when(proposal.createdAt)}
            {liveVersion !== null ? ` · running v${liveVersion}` : ''}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-foreground-secondary">{proposal.rationale}</p>
        <pre className="overflow-x-auto rounded-md border border-border-subtle bg-surface px-2 py-1 font-mono text-[11px] leading-5 text-foreground-secondary">
          {proposal.diff || '(no diff recorded)'}
        </pre>
        <button
          type="button"
          onClick={() => setShowPrompt(!showPrompt)}
          className="text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showPrompt ? 'Hide the full prompt' : 'Show the full prompt this would install'}
        </button>
        {showPrompt && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-surface px-2 py-1 text-[11px] leading-5">
            {proposal.systemPrompt}
          </pre>
        )}
        {(proposal.evalScoreBefore !== null || proposal.evalScoreAfter !== null) && (
          <p className="text-foreground-muted">
            Held-fixed set: before {proposal.evalScoreBefore ?? '—'}, after {proposal.evalScoreAfter ?? '—'}
          </p>
        )}
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason, if you are rejecting this"
            className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void onPromote()}>
              Approve and promote
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy || reason.trim().length < 5}
              onClick={() => void onReject(reason)}
            >
              Reject
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// roster and evaluations
// ---------------------------------------------------------------------------

function RosterPanel({ data }: { data: ReturnType<typeof useInstitutionData> }) {
  if (data.departments === null || data.seats === null || data.agents === null) return <Checking label="Roster" />;
  if (!data.departments.ok) {
    return (
      <Card>
        <CardContent className="py-3">
          <CouldNotCheck label="Departments" failure={data.departments} />
        </CardContent>
      </Card>
    );
  }
  if (!data.seats.ok) {
    return (
      <Card>
        <CardContent className="py-3">
          <CouldNotCheck label="Seats" failure={data.seats} />
        </CardContent>
      </Card>
    );
  }
  const agents = rowsOr(data.agents).map((agent) => ({
    slug: agent.slug,
    dataClass: agent.dataClass,
    isActive: agent.isActive,
  }));
  const report = checkRoster(data.departments.rows, data.seats.rows, agents);

  return (
    <div className="space-y-3">
      {report.problems.length > 0 && (
        <Card>
          <CardContent className="space-y-1 py-3 text-xs">
            <h3 className="surface-label text-destructive">Roster problems</h3>
            {report.problems.map((problem, index) => (
              <p key={index}>
                <span className="font-semibold">{problem.subject}</span> — {problem.detail}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      {report.byDepartment.map((department) => (
        <Card key={department.slug}>
          <CardHeader className="gap-1">
            <CardTitle className="text-sm">{department.name}</CardTitle>
            <p className="text-xs text-foreground-muted">
              Lead: {department.lead}
              {department.leadStaffed ? '' : ' — empty desk, the program office staffs it on the first brief that needs this department'}
            </p>
          </CardHeader>
          <CardContent className="text-xs">
            <p className="text-foreground-secondary">
              {department.specialists.length === 0
                ? 'No specialist seats.'
                : department.specialists.map((slug) => (
                    <span key={slug} className={cn('mr-2', department.empty.includes(slug) && 'text-foreground-muted')}>
                      {slug}
                      {department.empty.includes(slug) ? ' (empty desk)' : ''}
                    </span>
                  ))}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EvaluationsPanel({ data }: { data: ReturnType<typeof useInstitutionData> }) {
  if (data.evaluations === null) return <Checking label="Evaluations" />;
  if (!data.evaluations.ok) {
    return (
      <Card>
        <CardContent className="py-3">
          <CouldNotCheck label="Evaluations" failure={data.evaluations} />
        </CardContent>
      </Card>
    );
  }
  const evaluations = data.evaluations.rows;
  const runs = rowsOr(data.evaluationRuns);
  const agents = rowsOr(data.agents);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="py-3 text-xs text-foreground-muted">
          The held-fixed set. No agent writes to it and no agent reads the rubric — the rubric lives in a schema the
          API cannot reach, and the score is computed inside the database. It is the only instrument that tells a real
          upgrade from drift, which is why it does not change when the agents do.
        </CardContent>
      </Card>
      {evaluations.length === 0 ? (
        <Card>
          <CardContent className="py-3">
            <EmptyRow label="Evaluations" clause="The set is empty." />
          </CardContent>
        </Card>
      ) : (
        evaluations.map((evaluation) => {
          const mine = runs.filter((entry) => entry.evaluationId === evaluation.id);
          return (
            <Card key={evaluation.id}>
              <CardHeader className="gap-1">
                <CardTitle className="text-sm">{evaluation.slug}</CardTitle>
                <p className="text-xs text-foreground-muted">{evaluation.departmentSlug ?? 'any department'}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-foreground-secondary">{evaluation.task}</p>
                <p className="text-foreground-muted">Expected: {evaluation.expectedAnswer}</p>
                {mine.length > 0 && (
                  <ul className="space-y-0.5">
                    {mine.slice(0, 8).map((entry) => (
                      <li key={entry.id} className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold">{agentById.get(entry.agentId)?.slug ?? entry.agentId}</span>
                        <span className="text-foreground-muted">{entry.phase}</span>
                        <span>{entry.score === null ? 'unscored' : entry.score.toFixed(3)}</span>
                        <span className="text-foreground-muted">{when(entry.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
