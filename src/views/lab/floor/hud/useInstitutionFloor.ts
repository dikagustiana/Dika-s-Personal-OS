/**
 * The floor's data loop.
 *
 * Reads the institution's rows through the repository, projects them into
 * semantic events, runs the positioner to turn those into wire events, and
 * feeds the agent store. A Supabase Realtime change re-runs the loop.
 *
 * WHY IT RE-READS RATHER THAN APPLYING THE CHANGE PAYLOAD. A Realtime
 * payload is one row; the floor's state is a function of many (an
 * assignment's status, the review that is open against it, whether anything
 * was blocked). Applying payloads incrementally would mean maintaining a
 * second copy of the pipeline's rules in the browser, and the second copy
 * is always the one that drifts. Re-reading is a handful of small queries
 * and it cannot disagree with the database.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../../../store/appStore';
import { rowsOf } from '../../../../data/readResult';
import { getSupabaseClient } from '../../../../data/supabaseRepository';
import type { InstBrief } from '../../../../data/institutionTypes';
import {
  projectAgents,
  projectMarkers,
  type FloorAgentRow,
  type FloorMarker,
  type FloorSnapshot,
} from '../../../../logic/floor/institution/project';
import { buildCampus, FALLBACK_SPEC, type FloorSpec } from '../../../../logic/floor/layout/campus';
import { mockFloorRequested, mockSnapshot } from '../../../../logic/floor/scenario/roster';
import { Positioner } from '../../../../logic/floor/scenario/positioner';
import type { CampusLayout } from '../../../../logic/floor/layout/types';
import { redactFields, redactionNote } from '../../../../logic/floor/institution/redact';
import { useAgentStore } from '../store/agentStore';
import { useUiStore } from '../store/uiStore';
import { InstitutionStream, type StreamStatus } from '../transport/institutionStream';

export interface FloorState {
  layout: CampusLayout;
  spec: FloorSpec;
  snapshot: FloorSnapshot | null;
  markers: FloorMarker[];
  brief: InstBrief | null;
  status: StreamStatus;
  /** Named empty desks: a seat the institution has and nobody fills. */
  phantoms: FloorAgentRow[];
  /** True when ?mock=1 put a synthetic institution on screen instead of rows. */
  mock: boolean;
  /** What the HUD says instead of the masked content; '' when nothing is masked. */
  redaction: string;
  reload: () => void;
}

export function useInstitutionFloor(): FloorState {
  const repository = useAppStore((state) => state.repository);
  const [spec, setSpec] = useState<FloorSpec>({ departments: [] });
  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null);
  const [brief, setBrief] = useState<InstBrief | null>(null);
  const [status, setStatus] = useState<StreamStatus>('closed');
  const [generation, setGeneration] = useState(0);
  const positionerRef = useRef<Positioner | null>(null);
  const revealInternal = useUiStore((state) => state.revealInternal);
  const mock = useMemo(
    () => (typeof window === 'undefined' ? false : mockFloorRequested(window.location.search)),
    [],
  );

  const layout = useMemo(
    () => (spec.departments.length > 0 ? buildCampus(spec) : buildCampus()),
    [spec],
  );

  // The positioner is rebuilt when the floorplan changes and only then: it
  // holds every agent's seat, and rebuilding it moves everyone.
  useEffect(() => {
    positionerRef.current = new Positioner(layout);
  }, [layout]);

  const read = useCallback(async () => {
    // ?mock=1: a synthetic institution, so the building can be worked on
    // when the pipeline is idle. It reads nothing and writes nothing.
    if (mock) {
      setSpec(FALLBACK_SPEC);
      setBrief(null);
      setSnapshot(mockSnapshot());
      return;
    }
    const [departments, seats, agents, briefs] = await Promise.all([
      repository.institution.listDepartments(),
      repository.institution.listSeats(),
      repository.lab.listAgents(),
      repository.institution.listBriefs(5),
    ]);
    const departmentRows = rowsOf(departments);
    const seatRows = rowsOf(seats);
    const agentRows = rowsOf(agents);
    const briefRows = rowsOf(briefs);

    // The floorplan is the org chart: every department with a bay, sized to
    // its seats — staffed or not, because an empty desk is still a desk.
    setSpec({
      departments: departmentRows
        .filter((department) => department.kind === 'department')
        .map((department) => ({
          slug: department.slug,
          name: department.name,
          pipelineOrder: department.pipelineOrder,
          specialistSeats: seatRows.filter(
            (seat) => seat.departmentId === department.id && seat.role === 'specialist',
          ).length,
        })),
    });

    const agentBySlug = new Map(agentRows.map((agent) => [agent.slug, agent]));
    const departmentById = new Map(departmentRows.map((department) => [department.id, department]));
    const roster: FloorAgentRow[] = seatRows.map((seat) => {
      const agent = agentBySlug.get(seat.agentSlug);
      return {
        slug: seat.agentSlug,
        name: agent?.name ?? seat.agentSlug,
        dataClass: agent?.dataClass ?? 'public',
        departmentSlug: departmentById.get(seat.departmentId)?.slug ?? null,
        role: seat.role,
        seatPurpose: seat.seatPurpose,
        staffed: Boolean(agent),
      };
    });

    // The newest brief that is actually moving, else the newest at all.
    const active = briefRows.find((row) => ['running', 'committee', 'debate'].includes(row.status)) ?? briefRows[0] ?? null;
    setBrief(active ?? null);

    if (!active) {
      setSnapshot({
        briefId: null, briefStatus: 'none', weightClass: 'standard', routing: [],
        agents: roster, assignments: [], reviews: [], submissions: [], debates: [],
        egress: [], proposals: [], corpusRecords: 0,
      });
      return;
    }

    const [assignments, reviews, submissions, debates, egress, versions, corpus] = await Promise.all([
      repository.institution.listAssignments(active.id),
      repository.institution.listReviews(active.id),
      repository.institution.listSubmissions(active.id),
      repository.institution.listDebates(active.id),
      repository.institution.listEgressBlocks(active.id),
      repository.institution.listVersions(),
      repository.institution.listCorpus({ briefId: active.id, limit: 500 }),
    ]);
    const agentById = new Map(agentRows.map((agent) => [agent.id, agent]));
    const departmentSlugById = new Map(departmentRows.map((department) => [department.id, department.slug]));

    setSnapshot({
      briefId: active.id,
      briefStatus: active.status,
      weightClass: active.weightClass,
      routing: active.routing,
      agents: roster,
      assignments: rowsOf(assignments).map((row) => ({
        id: row.id,
        agentSlug: row.agentSlug,
        departmentSlug: row.departmentId ? departmentSlugById.get(row.departmentId) ?? null : null,
        kind: row.kind,
        status: row.status,
        round: row.round,
        reworkCount: row.reworkCount,
        detail: row.detail,
        updatedAt: row.updatedAt,
      })),
      reviews: rowsOf(reviews).map((row) => ({
        id: row.id,
        kind: row.kind,
        reviewerAgentSlug: agentById.get(row.reviewerAgentId)?.slug ?? '',
        subjectAgentSlug: row.subjectAgentId ? agentById.get(row.subjectAgentId)?.slug ?? null : null,
        subjectAssignmentId: row.subjectAssignmentId,
        verdict: row.verdict,
        round: row.round,
        createdAt: row.createdAt,
      })),
      submissions: rowsOf(submissions).map((row) => ({
        id: row.id,
        fromDepartmentSlug: departmentSlugById.get(row.fromDepartmentId) ?? '',
        toDepartmentSlug: row.toDepartmentId ? departmentSlugById.get(row.toDepartmentId) ?? null : null,
        toCommittee: row.toCommittee,
        accepted: row.accepted,
        returnCount: row.returnCount,
        createdAt: row.createdAt,
      })),
      debates: rowsOf(debates).map((row) => ({
        id: row.id,
        rebuttingAgentSlug: agentById.get(row.rebuttingAgentId)?.slug ?? '',
        outcome: row.outcome,
        round: row.round,
      })),
      egress: rowsOf(egress).map((row) => ({
        id: row.id,
        agentSlug: row.agentId ? agentById.get(row.agentId)?.slug ?? null : null,
        tool: row.tool,
        createdAt: row.createdAt,
      })),
      proposals: rowsOf(versions)
        .filter((row) => row.status === 'proposed' || row.status === 'active')
        .slice(0, 40)
        .map((row) => ({
          id: row.id,
          agentSlug: agentById.get(row.agentId)?.slug ?? '',
          status: row.status,
          createdAt: row.createdAt,
        })),
      corpusRecords: rowsOf(corpus).length,
    });
  }, [repository, mock]);

  useEffect(() => {
    void read();
  }, [read, generation]);

  // Realtime: a row lands, the loop runs again.
  useEffect(() => {
    if (mock) {
      setStatus('closed');
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      setStatus('closed');
      return;
    }
    const stream = new InstitutionStream(client, {
      onChange: () => void read(),
      onStatus: (next) => setStatus(next),
    });
    stream.start();
    return () => stream.stop();
  }, [read, mock]);

  // Project → REDACT → position → the store the scene reads. Every wire
  // event here began as a row; the positioner adds WHERE, never WHAT.
  //
  // 3-C: masking happens HERE, before the event reaches the store, so no
  // surface downstream can leak internal content by forgetting to ask. The
  // agent's lane comes from the roster row, not from the event, because the
  // event is the thing being masked.
  useEffect(() => {
    const positioner = positionerRef.current;
    if (!snapshot || !positioner) return;
    const now = Date.now();
    const store = useAgentStore.getState();
    for (const semantic of projectAgents(snapshot)) {
      const seat = snapshot.agents.find((agent) => agent.slug === semantic.agentId);
      const masked = redactFields(
        { dataClass: seat?.dataClass ?? 'public' },
        { title: semantic.title, subtask: semantic.subtask },
        { reveal: revealInternal },
      );
      const event = { ...semantic, title: masked.title, subtask: masked.subtask };
      const withRole = seat ? { ...event, role: seat.role } : event;
      for (const emission of positioner.apply(withRole, now)) {
        store.ingestFrame(JSON.stringify(emission.event), emission.atMs);
      }
    }
  }, [snapshot, revealInternal]);

  const markers = useMemo(() => (snapshot ? projectMarkers(snapshot) : []), [snapshot]);
  const phantoms = useMemo(
    () => (snapshot ? snapshot.agents.filter((agent) => !agent.staffed) : []),
    [snapshot],
  );
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  const redaction = useMemo(() => {
    if (!snapshot || revealInternal) return '';
    const internal = snapshot.agents.filter(
      (agent) => agent.staffed && agent.dataClass === 'internal',
    ).length;
    return redactionNote(internal);
  }, [snapshot, revealInternal]);

  return { layout, spec, snapshot, markers, brief, status, phantoms, mock, redaction, reload };
}
