/**
 * The director's room: shared surface pieces and the one data hook.
 *
 * Chips follow the house convention (finishLineUi, labUi): FILLED means
 * present or actionable, OUTLINED means a label rather than a state.
 * Nothing here decides anything — the rules live in
 * supabase/functions/_shared/institution/ and in the database. This file
 * shows what they decided.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../../store/appStore';
import type { ReadResult } from '../../../data/readResult';
import type {
  InstAgentVersion,
  InstBrief,
  InstDepartment,
  InstEvaluation,
  InstEvaluationRun,
  InstSeat,
} from '../../../data/institutionTypes';
import type { LabAgent } from '../../../data/labTypes';
import { cn } from '../../../lib/utils';

export const INST_CHIP =
  'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]';

const STATUS_TONE: Record<InstBrief['status'], string> = {
  intake: 'border border-border text-foreground-muted',
  running: 'border border-escalate/40 text-escalate',
  committee: 'border border-escalate/40 text-escalate',
  debate: 'border border-escalate/40 text-escalate',
  director: 'bg-primary-dim text-primary',
  approved: 'border border-success/40 text-success',
  published: 'bg-success/15 text-success',
  rejected: 'border border-destructive/40 text-destructive',
  failed: 'border border-destructive/40 text-destructive',
  paused: 'border border-border text-foreground-muted',
};

export function BriefStatusChip({ status }: { status: InstBrief['status'] }) {
  return <span className={cn(INST_CHIP, STATUS_TONE[status])}>{status}</span>;
}

export function WeightChip({ weightClass, overridden }: { weightClass: string; overridden?: boolean }) {
  return (
    <span
      className={cn(INST_CHIP, 'border border-border text-foreground-secondary')}
      title={overridden ? 'the director overrode the class the program office chose' : undefined}
    >
      {weightClass}
      {overridden ? ' (director)' : ''}
    </span>
  );
}

const VERSION_TONE: Record<InstAgentVersion['status'], string> = {
  proposed: 'bg-escalate/15 text-escalate',
  active: 'border border-success/40 text-success',
  retired: 'border border-border text-foreground-muted',
  rejected: 'border border-destructive/40 text-destructive',
};

export function VersionStatusChip({ status }: { status: InstAgentVersion['status'] }) {
  return <span className={cn(INST_CHIP, VERSION_TONE[status])}>{status}</span>;
}

export function LaneChip({ dataClass }: { dataClass: 'internal' | 'public' }) {
  return (
    <span
      className={cn(
        INST_CHIP,
        dataClass === 'internal' ? 'bg-primary-dim text-primary' : 'border border-border text-foreground-secondary',
      )}
    >
      {dataClass}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: 'blocking' | 'material' | 'minor' }) {
  const tone =
    severity === 'blocking'
      ? 'bg-destructive/15 text-destructive'
      : severity === 'material'
        ? 'border border-escalate/40 text-escalate'
        : 'border border-border text-foreground-muted';
  return <span className={cn(INST_CHIP, tone)}>{severity}</span>;
}

/**
 * Cost against estimate. The comparison is the point: a number on its own
 * says nothing about whether the run behaved.
 */
export function CostAgainstEstimate({ estimate, actual }: { estimate: number | null; actual: number }) {
  if (estimate === null) {
    return (
      <span className="text-foreground-muted">
        ${actual.toFixed(4)} <span className="text-[11px]">(no estimate was recorded)</span>
      </span>
    );
  }
  const ratio = estimate > 0 ? actual / estimate : Number.POSITIVE_INFINITY;
  const over = ratio > 1.5;
  return (
    <span className={over ? 'text-destructive' : 'text-foreground'}>
      ${actual.toFixed(4)} <span className="text-foreground-muted">of ${estimate.toFixed(4)} estimated</span>
      {Number.isFinite(ratio) ? <span className="ml-1 text-[11px]">({ratio.toFixed(2)}×)</span> : null}
    </span>
  );
}

export interface InstitutionData {
  departments: ReadResult<InstDepartment> | null;
  seats: ReadResult<InstSeat> | null;
  briefs: ReadResult<InstBrief> | null;
  versions: ReadResult<InstAgentVersion> | null;
  evaluations: ReadResult<InstEvaluation> | null;
  evaluationRuns: ReadResult<InstEvaluationRun> | null;
  agents: ReadResult<LabAgent> | null;
  reload: () => void;
}

/**
 * Every read is a ReadResult and lands in its own slot, so one missing
 * relation renders as COULD NOT CHECK on that card rather than as an empty
 * institution. null means the read has not returned yet.
 */
export function useInstitutionData(): InstitutionData {
  const repository = useAppStore((state) => state.repository);
  const [departments, setDepartments] = useState<ReadResult<InstDepartment> | null>(null);
  const [seats, setSeats] = useState<ReadResult<InstSeat> | null>(null);
  const [briefs, setBriefs] = useState<ReadResult<InstBrief> | null>(null);
  const [versions, setVersions] = useState<ReadResult<InstAgentVersion> | null>(null);
  const [evaluations, setEvaluations] = useState<ReadResult<InstEvaluation> | null>(null);
  const [evaluationRuns, setEvaluationRuns] = useState<ReadResult<InstEvaluationRun> | null>(null);
  const [agents, setAgents] = useState<ReadResult<LabAgent> | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const set = <T,>(setter: (value: ReadResult<T> | null) => void) => (result: ReadResult<T>) => {
      if (!cancelled) setter(result);
    };
    void repository.institution.listDepartments().then(set(setDepartments));
    void repository.institution.listSeats().then(set(setSeats));
    void repository.institution.listBriefs().then(set(setBriefs));
    void repository.institution.listVersions().then(set(setVersions));
    void repository.institution.listEvaluations().then(set(setEvaluations));
    void repository.institution.listEvaluationRuns().then(set(setEvaluationRuns));
    void repository.lab.listAgents().then(set(setAgents));
    return () => {
      cancelled = true;
    };
  }, [repository, generation]);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  return { departments, seats, briefs, versions, evaluations, evaluationRuns, agents, reload };
}

export function rowsOr<T>(result: ReadResult<T> | null): T[] {
  return result && result.ok ? result.rows : [];
}

/** A relative timestamp that never lies about precision. */
export function when(iso: string | null): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(then).toISOString().slice(0, 10);
}
