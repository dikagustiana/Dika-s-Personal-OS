/**
 * F5 — Evidence. The epistemic layer's manual-entry surface: what stands
 * behind every number, per project.
 *
 * Build-order note (the brief's, kept on purpose): this screen exists to
 * prove the model works with HAND-ENTERED records before any extraction
 * agent runs. The agents (LOCATOR, EXTRACTOR, LITERATURE, REVIEWER,
 * DRAFTER) come after the owner has walked one real project through here —
 * their database write-rails are already in force either way.
 */
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { useMutation } from '../../../hooks/useMutation';
import { useAppStore } from '../../../store/appStore';
import { cn } from '../../../lib/utils';
import { CouldNotCheck, Checking } from '../../work/finishLineUi';
import { rowsOr } from '../labUi';
import { EvidenceClaims } from './EvidenceClaims';
import { EvidenceDatapoints } from './EvidenceDatapoints';
import { EvidenceOutputs } from './EvidenceOutputs';
import { EvidenceSources } from './EvidenceSources';
import { FIELD_LABEL, useEvidenceData } from './evidenceUi';

type EvidenceTab = 'datapoints' | 'claims' | 'outputs' | 'sources';

const TABS: Array<{ id: EvidenceTab; label: string }> = [
  { id: 'datapoints', label: 'Datapoints' },
  { id: 'claims', label: 'Claims' },
  { id: 'outputs', label: 'Outputs' },
  { id: 'sources', label: 'Sources' },
];

export function LabEvidence() {
  const repository = useAppStore((state) => state.repository);
  const data = useEvidenceData();
  const [tab, setTab] = useState<EvidenceTab>('datapoints');
  const [projectId, setProjectId] = useState('');
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: '', researchQuestion: '' });
  const { run: mutate, isPending } = useMutation();

  const projects = rowsOr(data.projects);
  // The first active project is the default context; an explicit pick wins.
  const activeProject =
    projects.find((project) => project.id === projectId) ??
    projects.find((project) => project.status === 'active') ??
    projects[0];

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">Lab / Evidence</p>
          <h1 className="page-title">Evidence</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
            Which datapoint supports which claim, verified against what, gone stale when. A number
            with nothing standing behind it does not leave this system — that is enforced in the
            database, not requested in a prompt.
          </p>
        </div>
        <Button className="mt-4 md:mt-0" onClick={() => setShowProjectForm((open) => !open)}>
          <Plus className="size-4" />
          New project
        </Button>
      </header>

      {showProjectForm && (
        <Card className="mb-5 border-primary/30">
          <CardContent className="pt-5">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate('Create project', () =>
                  repository.labEvidence.createProject({
                    name: projectDraft.name.trim(),
                    researchQuestion: projectDraft.researchQuestion.trim(),
                  }),
                ).then((saved) => {
                  if (!saved) return;
                  setProjectDraft({ name: '', researchQuestion: '' });
                  setShowProjectForm(false);
                  setProjectId(saved.id);
                  data.reload();
                });
              }}
            >
              <label className={FIELD_LABEL}>
                Name
                <Input
                  value={projectDraft.name}
                  onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })}
                  required
                />
              </label>
              <label className={`${FIELD_LABEL} grow`}>
                Research question
                <Input
                  value={projectDraft.researchQuestion}
                  onChange={(event) =>
                    setProjectDraft({ ...projectDraft, researchQuestion: event.target.value })
                  }
                />
              </label>
              <Button type="submit" size="sm" disabled={isPending}>
                Create
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {data.projects === null ? (
        <Checking label="Evidence" />
      ) : !data.projects.ok ? (
        <Card>
          <CardContent className="pt-5">
            <CouldNotCheck label="Evidence" failure={data.projects} />
          </CardContent>
        </Card>
      ) : !activeProject ? (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-foreground-muted">
              Belum ada proyek riset — buat satu, lalu masukkan komitmennya sebagai klaim layer A.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-foreground-muted">
              <span className="sr-only">Project</span>
              <select
                className="native-select"
                value={activeProject.id}
                onChange={(event) => setProjectId(event.target.value)}
                aria-label="Project"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.status})
                  </option>
                ))}
              </select>
            </label>
            {activeProject.researchQuestion && (
              <span className="text-xs text-foreground-muted">{activeProject.researchQuestion}</span>
            )}
          </div>

          <div className="mb-5 flex gap-1 border-b border-border-subtle" role="tablist" aria-label="Evidence sections">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
                className={cn(
                  'border-b-2 px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === entry.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-foreground-muted hover:text-foreground-secondary',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {tab === 'datapoints' && <EvidenceDatapoints data={data} />}
          {tab === 'claims' && <EvidenceClaims data={data} projectId={activeProject.id} />}
          {tab === 'outputs' && <EvidenceOutputs data={data} projectId={activeProject.id} />}
          {tab === 'sources' && <EvidenceSources data={data} projectId={activeProject.id} />}
        </>
      )}
    </div>
  );
}
