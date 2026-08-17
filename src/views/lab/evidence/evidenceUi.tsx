/**
 * The Evidence screen's shared pieces: chips for the epistemic vocabulary
 * and the one data hook its tabs read through. Chip discipline as
 * everywhere: filled = the state that carries weight, outlined = a label.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../../store/appStore';
import type { ReadResult } from '../../../data/readResult';
import type {
  LabClaim,
  LabClaimContradiction,
  LabClaimLayer,
  LabCommitmentSource,
  LabDatapoint,
  LabDatapointConflict,
  LabDatapointStatus,
  LabOutput,
  LabProject,
  LabReference,
  LabSourceDocument,
  LabTask,
} from '../../../data/labEvidenceTypes';
import { cn } from '../../../lib/utils';
import { LAB_CHIP } from '../labUi';

const DATAPOINT_TONE: Record<LabDatapointStatus, string> = {
  // V is the earned state — filled. IND is the honest default — outlined
  // amber, because unverified is a fact to see, not an error. NA is a real
  // answer (sought, not available), muted.
  V: 'bg-primary-dim text-primary',
  IND: 'border border-escalate/40 text-escalate',
  NA: 'border border-border text-foreground-muted',
};

export function DatapointStatusChip({ status }: { status: LabDatapointStatus }) {
  return <span className={cn(LAB_CHIP, DATAPOINT_TONE[status])}>{status}</span>;
}

const LAYER_TONE: Record<LabClaimLayer, string> = {
  // A is a public commitment — filled, it carries external weight.
  // B and C are outlined; C is not a lesser category, only a different one.
  A: 'bg-primary-dim text-primary',
  B: 'border border-border text-foreground-secondary',
  C: 'border border-border-subtle text-foreground-muted',
};

export function LayerChip({ layer }: { layer: LabClaimLayer }) {
  return <span className={cn(LAB_CHIP, LAYER_TONE[layer])}>{layer}</span>;
}

export function ClaimStatusChip({ status }: { status: LabClaim['status'] }) {
  return (
    <span
      className={cn(
        LAB_CHIP,
        status === 'approved'
          ? 'border border-success/40 text-success'
          : status === 'reviewed'
            ? 'border border-border text-foreground-secondary'
            : 'border border-border-subtle text-foreground-muted',
      )}
    >
      {status}
    </span>
  );
}

export function StaleChip() {
  return <span className={cn(LAB_CHIP, 'border border-escalate/40 text-escalate')}>stale</span>;
}

/** Every collection the tabs read, each a ReadResult; null = still loading. */
export interface EvidenceData {
  projects: ReadResult<LabProject> | null;
  sources: ReadResult<LabSourceDocument> | null;
  references: ReadResult<LabReference> | null;
  commitments: ReadResult<LabCommitmentSource> | null;
  datapoints: ReadResult<LabDatapoint> | null;
  conflicts: ReadResult<LabDatapointConflict> | null;
  claims: ReadResult<LabClaim> | null;
  contradictions: ReadResult<LabClaimContradiction> | null;
  outputs: ReadResult<LabOutput> | null;
  tasks: ReadResult<LabTask> | null;
  reload: () => void;
}

export function useEvidenceData(): EvidenceData {
  const repository = useAppStore((state) => state.repository);
  const [projects, setProjects] = useState<ReadResult<LabProject> | null>(null);
  const [sources, setSources] = useState<ReadResult<LabSourceDocument> | null>(null);
  const [references, setReferences] = useState<ReadResult<LabReference> | null>(null);
  const [commitments, setCommitments] = useState<ReadResult<LabCommitmentSource> | null>(null);
  const [datapoints, setDatapoints] = useState<ReadResult<LabDatapoint> | null>(null);
  const [conflicts, setConflicts] = useState<ReadResult<LabDatapointConflict> | null>(null);
  const [claims, setClaims] = useState<ReadResult<LabClaim> | null>(null);
  const [contradictions, setContradictions] = useState<ReadResult<LabClaimContradiction> | null>(null);
  const [outputs, setOutputs] = useState<ReadResult<LabOutput> | null>(null);
  const [tasks, setTasks] = useState<ReadResult<LabTask> | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const seam = repository.labEvidence;
    const land = <T,>(setter: (result: T) => void) => (result: T) => {
      if (!cancelled) setter(result);
    };
    void seam.listProjects().then(land(setProjects));
    void seam.listSourceDocuments().then(land(setSources));
    void seam.listReferences().then(land(setReferences));
    void seam.listCommitmentSources().then(land(setCommitments));
    void seam.listDatapoints().then(land(setDatapoints));
    void seam.listConflicts().then(land(setConflicts));
    void seam.listClaims().then(land(setClaims));
    void seam.listContradictions().then(land(setContradictions));
    void seam.listOutputs().then(land(setOutputs));
    void seam.listTasks().then(land(setTasks));
    return () => {
      cancelled = true;
    };
  }, [repository, generation]);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  return {
    projects,
    sources,
    references,
    commitments,
    datapoints,
    conflicts,
    claims,
    contradictions,
    outputs,
    tasks,
    reload,
  };
}

export const FIELD_LABEL = 'grid gap-1.5 text-xs font-semibold text-foreground-secondary';
export const TEXTAREA =
  'rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
