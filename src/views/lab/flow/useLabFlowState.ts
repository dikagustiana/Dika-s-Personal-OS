/**
 * The Flow screen's ONE data hook — reads through the same repository seams
 * every other Lab screen uses, then hands EVERYTHING to deriveFlowState so
 * all four surfaces render from a single state object (see labFlowState.ts
 * for why: surfaces that compute their own counts disagree).
 *
 * The screen COUNTS PROBLEMS, so a failed core read renders as could-not-
 * check, never as a floor of zeros (the readResult.ts rule). The sweep read
 * degrades separately: its failure makes the cron row and S12's sweep gate
 * say "unknown" rather than hiding the whole floor.
 *
 * Reload triggers: manual, and the live store's generation — when a
 * dispatch ends, the tables changed, so the rows (the record) are re-read
 * instead of trusting the live echo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../../store/appStore';
import { useLabLiveStore } from '../../../store/labLiveStore';
import { isSupabaseConfigured } from '../../../data/supabaseRepository';
import { probeEvidenceAgents } from '../../../data/labEvidenceAgents';
import type { LabSweepBeat } from '../../../data/labEvidenceRepository';
import { readThrew, type ReadFailure, type ReadResult } from '../../../data/readResult';
import { rowsOr } from '../labUi';
import { useEvidenceData } from '../evidence/evidenceUi';
import type { LabAgent, LabProvider, LabRun } from '../../../data/labTypes';
import {
  deriveFlowState,
  type LabFlowState,
} from '../../../logic/lab/labFlowState';
import type { LabProject, LabWorkflow } from '../../../data/labEvidenceTypes';

export interface FlowData {
  /** null while core reads are in flight. */
  state: LabFlowState | null;
  /** The first failed CORE read — the screen renders could-not-check. */
  failure: ReadFailure | null;
  loading: boolean;
  /**
   * Every read RETURNED, nothing failed, and the project list is empty —
   * the fresh-install fact, distinct from loading by the readResult rule:
   * `Checking` means a read has not returned; zero projects is an ANSWER,
   * and the screen renders what that emptiness means in words. Without
   * this flag the two states collapse (state is null either way) and the
   * screen shows `Checking…` forever over a database that already said
   * "nothing here" — the live 2026-08-19 bug.
   */
  noProjects: boolean;
  projects: LabProject[];
  projectId: string;
  setProjectId: (id: string) => void;
  /** Every route (085), canonical first. Empty until the read lands. */
  workflows: LabWorkflow[];
  /** The ACTIVE route's row id — the canonical row's id when the project
   *  rides canonical (project.workflow_id null). '' while unresolved. */
  activeWorkflowId: string;
  reload: () => void;
}

export function useLabFlowState(): FlowData {
  const repository = useAppStore((store) => store.repository);
  const evidence = useEvidenceData();
  const live = useLabLiveStore((store) => store.live);
  const generation = useLabLiveStore((store) => store.generation);

  const [agents, setAgents] = useState<ReadResult<LabAgent> | null>(null);
  const [providers, setProviders] = useState<ReadResult<LabProvider> | null>(null);
  const [runs, setRuns] = useState<ReadResult<LabRun> | null>(null);
  const [workflows, setWorkflows] = useState<ReadResult<LabWorkflow> | null>(null);
  const [sweep, setSweep] = useState<ReadResult<LabSweepBeat> | null>(null);
  const [probe, setProbe] = useState<{ configured: boolean; anthropic: boolean } | null>(null);
  const [labGeneration, setLabGeneration] = useState(0);
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    let cancelled = false;
    const land = <T,>(setter: (value: T) => void) => (value: T) => {
      if (!cancelled) setter(value);
    };
    // A read that THROWS lands as a failure — a rejected promise must
    // never leave its slot null forever (`Checking…` with nothing to
    // show). Same rule as useEvidenceData, which carries the other
    // sixteen core reads.
    const threw = <T,>(label: string, setter: (result: ReadResult<T>) => void) =>
      (error: unknown) => {
        if (!cancelled) setter(readThrew(label, error));
      };
    void repository.lab.listAgents().then(land(setAgents), threw('listAgents', setAgents));
    void repository.lab.listProviders().then(land(setProviders), threw('listProviders', setProviders));
    void repository.lab.listRuns().then(land(setRuns), threw('listRuns', setRuns));
    void repository.labEvidence.listWorkflows().then(land(setWorkflows), threw('listWorkflows', setWorkflows));
    void repository.labEvidence.latestSweep().then(land(setSweep), threw('latestSweep', setSweep));
    void probeEvidenceAgents().then(land(setProbe), () => {
      // The probe catches internally and null already means "could not
      // check" on the rail — landing null keeps that honest without
      // inventing a "not configured".
      if (!cancelled) setProbe(null);
    });
    return () => {
      cancelled = true;
    };
  }, [repository, labGeneration]);

  // A finished dispatch means new rows — re-read the record.
  useEffect(() => {
    if (generation === 0) return;
    setLabGeneration((current) => current + 1);
    evidence.reload();
    // evidence.reload is stable per useEvidenceData's useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  const reload = useCallback(() => {
    setLabGeneration((current) => current + 1);
    evidence.reload();
  }, [evidence]);

  const projects = rowsOr(evidence.projects);
  const activeProject =
    projects.find((project) => project.id === projectId) ??
    projects.find((project) => project.status === 'active') ??
    projects[0];

  // The active route. workflow_id null (or pointing at a vanished row —
  // the FK's `on delete set null` makes that transient) means canonical.
  const workflowRows = rowsOr(workflows);
  const canonicalWorkflow = workflowRows.find((row) => row.isCanonical) ?? null;
  const activeWorkflow =
    (activeProject?.workflowId
      ? workflowRows.find((row) => row.id === activeProject.workflowId)
      : null) ?? canonicalWorkflow;

  const core: Array<ReadResult<unknown> | null> = [
    evidence.projects,
    evidence.questions,
    evidence.subQuestions,
    evidence.requirements,
    evidence.candidates,
    evidence.sources,
    evidence.references,
    evidence.datapoints,
    evidence.conflicts,
    evidence.claims,
    evidence.contradictions,
    evidence.outputs,
    evidence.tasks,
    evidence.modelSpecs,
    evidence.modelParams,
    evidence.modelResults,
    runs,
    providers,
    workflows,
  ];
  const loading = core.some((result) => result === null) || agents === null || sweep === null;
  const failure =
    (core.find((result) => result !== null && !result.ok) as ReadFailure | undefined) ?? null;

  const state = useMemo<LabFlowState | null>(() => {
    if (loading || failure || !activeProject) return null;
    return deriveFlowState({
      projectId: activeProject.id,
      projects,
      questions: rowsOr(evidence.questions),
      subQuestions: rowsOr(evidence.subQuestions),
      requirements: rowsOr(evidence.requirements),
      candidates: rowsOr(evidence.candidates),
      sources: rowsOr(evidence.sources),
      references: rowsOr(evidence.references),
      datapoints: rowsOr(evidence.datapoints),
      conflicts: rowsOr(evidence.conflicts),
      claims: rowsOr(evidence.claims),
      contradictions: rowsOr(evidence.contradictions),
      outputs: rowsOr(evidence.outputs),
      tasks: rowsOr(evidence.tasks),
      modelSpecs: rowsOr(evidence.modelSpecs),
      modelParams: rowsOr(evidence.modelParams),
      modelResults: rowsOr(evidence.modelResults),
      runs: rowsOr(runs),
      agents: rowsOr(agents),
      providers: rowsOr(providers),
      sweep: sweep && sweep.ok ? (sweep.rows[0] ?? null) : null,
      sweepReadFailed: Boolean(sweep && !sweep.ok),
      agentsReadFailed: Boolean(agents && !agents.ok),
      supabaseConfigured: isSupabaseConfigured,
      readFailureDetail: null,
      probe,
      live,
      now: new Date(),
      // Canonical routes derive with NO omission pass — identical to the
      // pre-085 behavior by construction.
      workflowStageCodes:
        activeWorkflow && !activeWorkflow.isCanonical ? activeWorkflow.stageCodes : null,
    });
    // The live object identity changes on every store write, which is the
    // point: a running token must appear the moment dispatch starts.
  }, [loading, failure, activeProject, activeWorkflow, projects, evidence, runs, agents, providers, sweep, probe, live]);

  return {
    state,
    failure,
    loading: loading && !failure,
    noProjects: !loading && !failure && projects.length === 0,
    projects,
    projectId: activeProject?.id ?? '',
    setProjectId,
    workflows: workflowRows,
    activeWorkflowId: activeWorkflow?.id ?? '',
    reload,
  };
}
