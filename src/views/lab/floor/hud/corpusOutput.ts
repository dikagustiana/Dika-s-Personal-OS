/**
 * Reading an output document for the HUD.
 *
 * The standalone build fetched `/api/tasks/:id/output` from its own server.
 * There is no server. An output is a corpus record, so this reads the
 * archive through the repository — and it reads the RECORD, not a rendering
 * of it: the title, the text, the hash and the citations, exactly what a
 * later piece of work would cite.
 *
 * No react-query: the host app does not use it, and one modal does not
 * justify a second data layer (DECISIONS D-21).
 */
import { useEffect, useState } from 'react';
import { useAppStore } from '../../../../store/appStore';
import type { InstCorpusRecord } from '../../../../data/institutionTypes';

export interface OutputDocument {
  taskId: string;
  agentId: string;
  title: string;
  department: string;
  format: 'markdown';
  content: string;
  generatedAt: string;
  contentHash: string;
  dataClass: 'internal' | 'public';
}

export type OutputState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error'; detail: string }
  | { status: 'ready'; document: OutputDocument };

const toDocument = (record: InstCorpusRecord, taskId: string): OutputDocument => ({
  taskId,
  agentId: record.createdByAgentId ?? '',
  title: record.title,
  department: String(record.provenance.department ?? ''),
  format: 'markdown',
  content: record.content,
  generatedAt: record.createdAt,
  contentHash: record.contentHash,
  dataClass: record.dataClass,
});

/**
 * The output of one assignment, if it produced one. "No output yet" is a
 * normal state and is reported as `none`, never as an error and never as an
 * empty document.
 */
export function useAssignmentOutput(assignmentId: string | null): OutputState {
  const repository = useAppStore((state) => state.repository);
  const [state, setState] = useState<OutputState>({ status: 'loading' });

  useEffect(() => {
    if (!assignmentId) {
      setState({ status: 'none' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void repository.institution
      .listCorpus({ limit: 200 })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: 'error', detail: result.detail });
          return;
        }
        const record = result.rows.find((row) => row.assignmentId === assignmentId && row.kind === 'output')
          ?? result.rows.find((row) => row.assignmentId === assignmentId);
        setState(record ? { status: 'ready', document: toDocument(record, assignmentId) } : { status: 'none' });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', detail: error instanceof Error ? error.message : 'read failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, repository]);

  return state;
}
