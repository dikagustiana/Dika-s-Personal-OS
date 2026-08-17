/**
 * Lab's shared surface pieces: the chip vocabulary and the one data hook the
 * four screens read through. Chips follow the house convention stated in
 * finishLineUi: FILLED = present/actionable, OUTLINED = everything that is a
 * label rather than a state. Tones come from the token layer and only from
 * it — success is done, escalate is in-flight/attention, destructive is
 * failed/violation.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { ReadResult } from '../../data/readResult';
import type {
  LabAgent,
  LabChain,
  LabDataClass,
  LabProvider,
  LabRun,
  LabRunStatus,
} from '../../data/labTypes';
import { cn } from '../../lib/utils';

export const LAB_CHIP =
  'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]';

/**
 * data_class is the boundary column, so its chip is the loudest label on a
 * card: internal is FILLED (this agent's runs are guarded), public is
 * outlined. Neither is an error tone — the boundary is a property, not a
 * problem.
 */
export function DataClassChip({ dataClass }: { dataClass: LabDataClass }) {
  return (
    <span
      className={cn(
        LAB_CHIP,
        dataClass === 'internal'
          ? 'bg-primary-dim text-primary'
          : 'border border-border text-foreground-secondary',
      )}
    >
      {dataClass}
    </span>
  );
}

const RUN_TONE: Record<LabRunStatus, string> = {
  ok: 'border border-success/40 text-success',
  error: 'border border-destructive/40 text-destructive',
  running: 'border border-escalate/40 text-escalate',
  queued: 'border border-border text-foreground-muted',
};

export function RunStatusChip({ status }: { status: LabRunStatus }) {
  return <span className={cn(LAB_CHIP, RUN_TONE[status])}>{status}</span>;
}

export function ProviderChip({ name }: { name: string }) {
  return <span className={cn(LAB_CHIP, 'border border-border text-foreground-secondary')}>{name}</span>;
}

/** The integrity warning: this card cites agents that do not exist. */
export function PhantomBadge({ slugs }: { slugs: readonly string[] }) {
  if (slugs.length === 0) return null;
  return (
    <span
      className={cn(LAB_CHIP, 'border border-escalate/40 text-escalate')}
      title={`Referenced but not in the registry: ${slugs.join(', ')}`}
    >
      {slugs.length} phantom{slugs.length > 1 ? 's' : ''}
    </span>
  );
}

/**
 * The four collections every Lab screen reads, each a ReadResult so a failed
 * read can never render as an empty registry (see readResult.ts). null means
 * the read has not returned — the screens render Checking for it.
 */
export interface LabData {
  providers: ReadResult<LabProvider> | null;
  agents: ReadResult<LabAgent> | null;
  chains: ReadResult<LabChain> | null;
  runs: ReadResult<LabRun> | null;
  reload: () => void;
}

export function useLabData(): LabData {
  const repository = useAppStore((state) => state.repository);
  const [providers, setProviders] = useState<ReadResult<LabProvider> | null>(null);
  const [agents, setAgents] = useState<ReadResult<LabAgent> | null>(null);
  const [chains, setChains] = useState<ReadResult<LabChain> | null>(null);
  const [runs, setRuns] = useState<ReadResult<LabRun> | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // The four reads race freely; each lands in its own slot so one slow
    // table does not blank the others.
    void repository.lab.listProviders().then((result) => {
      if (!cancelled) setProviders(result);
    });
    void repository.lab.listAgents().then((result) => {
      if (!cancelled) setAgents(result);
    });
    void repository.lab.listChains().then((result) => {
      if (!cancelled) setChains(result);
    });
    void repository.lab.listRuns().then((result) => {
      if (!cancelled) setRuns(result);
    });
    return () => {
      cancelled = true;
    };
  }, [repository, generation]);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  return { providers, agents, chains, runs, reload };
}

/** rows or [] — for computing over a result whose failure is handled elsewhere. */
export function rowsOr<T>(result: ReadResult<T> | null): T[] {
  return result && result.ok ? result.rows : [];
}
