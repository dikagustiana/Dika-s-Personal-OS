import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import type {
  FactLibraryEntry,
  Project,
  ResearchClaim,
  ResearchItem,
} from '../../../data/types';
import { useMutation } from '../../../hooks/useMutation';
import {
  MODEL_UNCONFIGURED,
  probeModel,
  type ModelCapabilities,
} from '../../../data/researchModel';
import { PROJECT_IDS } from '../../../data/seed';
import { curStage, invalidateFrom, citeCount } from '../../../logic/research/pipeline';
import { LOOPS } from '../../../logic/research/loops';
import { itemFromLibrary, libraryEntryFromItem, librarySweepCandidates } from '../../../logic/research/portfolio';
import { gatesFor, templateOf } from '../../../logic/research/templates';
import { useAppStore } from '../../../store/appStore';
import { cn } from '../../../lib/utils';
import { LibraryTab } from './LibraryTab';
import { PortfolioTab, type NewResearchInput } from './PortfolioTab';
import { ProjectTab, type RecordCycleInput } from './ProjectTab';
import { PromptsTab } from './PromptsTab';
import { useResearch } from './useResearch';

type Tab = 'portfolio' | 'project' | 'library' | 'prompts';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'project', label: 'Project' },
  { id: 'library', label: 'Library' },
  { id: 'prompts', label: 'Prompts' },
];

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * GROWTH → Research. Replaces the generic initiative page for this one project,
 * because the pipeline is the content here and a project card is not.
 *
 * "Current piece" used to be a full card holding a single input. It is now one
 * line in the header beside the research question: `workingTitle` lives on the
 * project row and already renders on the project card, so a whole card for one
 * field was the most expensive way possible to show it.
 */
export function ResearchArea() {
  const repository = useAppStore((state) => state.repository);
  const { parent, settings, projects, library, loaded, reload } = useResearch();
  const { run, isPending } = useMutation();

  const [tab, setTab] = useState<Tab>('portfolio');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ModelCapabilities>(MODEL_UNCONFIGURED);
  const [scopeQuestion, setScopeQuestion] = useState('');
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  useEffect(() => {
    void probeModel().then(setCapabilities);
  }, []);

  const selected = useMemo(
    () => projects.find((item) => item.project.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const openProject = (projectId: string) => {
    setSelectedId(projectId);
    setTab('project');
  };

  // -------------------------------------------------------------------------
  // Mutations. Every write goes through the repository's guarded path with an
  // explicit 'human' origin — see researchGuards.
  // -------------------------------------------------------------------------

  const createResearch = async (input: NewResearchInput) => {
    const created = await run('Create research project', () =>
      repository.createProject({
        domain: 'growth',
        title: input.title,
        type: 'research',
        status: 'active',
        milestones: [],
        order: projects.length + 1,
        parentId: PROJECT_IDS.research,
        priority: projects.length + 1,
      } as Omit<Project, 'id'>),
    );
    if (!created) return;
    await run('Save research meta', () =>
      repository.research.upsertMeta({
        projectId: created.id,
        template: input.template,
        question: input.question,
        output: '',
        audience: '',
        gates: gatesFor(input.template),
      }),
    );
    await reload();
    openProject(created.id);
  };

  const toggleGate = async (stage: number, criterion: number, next: boolean) => {
    if (!selected) return;
    const gates = selected.meta.gates.map((row) => row.slice());
    while (gates.length <= stage) gates.push([]);
    const row = gates[stage] ?? [];
    while (row.length <= criterion) row.push(false);
    row[criterion] = next;
    gates[stage] = row;
    await run('Update gate', () =>
      repository.research.setGates(selected.project.id, gates, 'human'),
    );
    await reload();
  };

  /**
   * Recording a cycle. A `rework` verdict confirms FIRST, then invalidates,
   * then writes a decision-log entry naming what was cleared — in that order.
   * Clearing gates silently would destroy work with no record of why.
   */
  const recordCycle = async (input: RecordCycleInput) => {
    if (!selected) return;
    const stages = templateOf(selected.meta.template).stages;
    let invalidated = 0;
    let backLabel = '';

    if (input.verdict === 'rework') {
      const stage = stages[input.from];
      backLabel = stage ? `${stage.n} ${stage.t}` : String(input.from);
      const preview = invalidateFrom(selected.meta.gates, input.from);
      const confirmed = window.confirm(
        `Rework from stage ${backLabel} will clear ${preview.invalidated} already-passed gate criteria and cannot be undone.\n\nRecord it?`,
      );
      if (!confirmed) return;
      invalidated = preview.invalidated;
      await run('Invalidate gates', () =>
        repository.research.setGates(selected.project.id, preview.gates, 'human'),
      );
    }

    const n = selected.cycles.filter((cycle) => cycle.loop === input.loop).length + 1;
    await run('Record review cycle', () =>
      repository.research.appendCycle(
        {
          projectId: selected.project.id,
          loop: input.loop,
          n,
          date: todayKey(),
          verdict: input.verdict,
          findings: input.findings,
          itemCount: selected.items.length,
          citeCount: citeCount(selected),
          invalidated,
          backLabel,
        },
        'human',
      ),
    );

    if (input.verdict === 'rework') {
      await run('Log the invalidation', () =>
        repository.research.appendLog(
          {
            projectId: selected.project.id,
            date: todayKey(),
            text: `${LOOPS[input.loop].name} cycle #${n} returned rework from stage ${backLabel}; ${invalidated} gate criteria cleared.`,
          },
          'human',
        ),
      );
    }
    await reload();
  };

  const createItem = async (input: Omit<ResearchItem, 'id'>) => {
    await run('Add register item', () => repository.research.createItem(input, 'human'));
    await reload();
  };

  const updateItem = async (id: string, patch: Partial<ResearchItem>) => {
    await run('Update register item', () => repository.research.updateItem(id, patch, 'human'));
    await reload();
  };

  const deleteItem = async (id: string) => {
    await run('Delete register item', () => repository.research.deleteItem(id));
    await reload();
  };

  const promoteItem = async (item: ResearchItem) => {
    if (!selected) return;
    await run('Promote to library', () =>
      repository.research.createLibraryEntry(
        libraryEntryFromItem(item, selected.project.title),
      ),
    );
    await reload();
  };

  const pullFact = async (fact: FactLibraryEntry, projectId: string) => {
    const target = projects.find((item) => item.project.id === projectId);
    await run('Pull fact into project', () =>
      repository.research.createItem(
        itemFromLibrary(fact, projectId, (target?.items.length ?? 0) + 1),
        'human',
      ),
    );
    await reload();
  };

  const sweepLibrary = async () => {
    const candidates = librarySweepCandidates(projects, library);
    for (const candidate of candidates) {
      await run('Sweep into library', () => repository.research.createLibraryEntry(candidate));
    }
    await reload();
  };

  const deleteLibraryEntry = async (id: string) => {
    await run('Delete library entry', () => repository.research.deleteLibraryEntry(id));
    await reload();
  };

  const createClaim = async (input: Omit<ResearchClaim, 'id'>) => {
    await run('Add claim', () => repository.research.createClaim(input, 'human'));
    await reload();
  };

  const deleteClaim = async (id: string) => {
    await run('Delete claim', () => repository.research.deleteClaim(id));
    await reload();
  };

  const appendLog = async (text: string) => {
    if (!selected) return;
    await run('Append to the decision log', () =>
      repository.research.appendLog(
        { projectId: selected.project.id, date: todayKey(), text },
        'human',
      ),
    );
    await reload();
  };

  const saveWorkingTitle = async (value: string) => {
    if (!parent) return;
    await run('Save current piece', () =>
      repository.updateProject(parent.id, { workingTitle: value || undefined }),
    );
    setTitleDraft(null);
    await reload();
  };

  const goToScope = (question: string) => {
    setScopeQuestion(question);
    setTab('prompts');
  };

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7">
        <p className="page-kicker">growth / Research</p>
        <h1 className="page-title">Research pipeline</h1>

        {/* The former "Current piece" card, folded to one line. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="surface-label">Current piece</span>
          <Input
            value={titleDraft ?? parent?.workingTitle ?? ''}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={(event) => {
              if (titleDraft !== null) void saveWorkingTitle(event.target.value.trim());
            }}
            placeholder="What you're writing right now…"
            aria-label="Current piece"
            className="h-9 max-w-md flex-1"
          />
        </div>
      </header>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-border-subtle">
        {TABS.map((item) => {
          const disabled = item.id === 'project' && !selected;
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
              className={cn(
                'min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === item.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-foreground-muted hover:text-foreground-secondary',
                disabled && 'cursor-not-allowed opacity-45 hover:text-foreground-muted',
              )}
            >
              {item.label}
              {item.id === 'project' && selected && (
                <span className="ml-2 font-normal text-foreground-muted">
                  {selected.project.title}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!loaded ? (
        <p className="text-sm text-foreground-muted">Loading…</p>
      ) : (
        <>
          {tab === 'portfolio' && (
            <>
              {projects.length === 0 && (
                // One row, not a boxed empty state: this screen is empty until
                // the first project exists, and the empty render must not be
                // the tallest one.
                <p className="mb-6 text-sm text-foreground-muted">
                  No research projects yet. Add one below, or scope a raw question first.
                </p>
              )}
              <PortfolioTab
                projects={projects}
                settings={settings}
                onSelect={openProject}
                onCreate={createResearch}
                onScope={goToScope}
                isPending={isPending}
              />
            </>
          )}

          {tab === 'project' && selected && (
            <>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    {selected.project.title}
                  </h2>
                  {selected.meta.question && (
                    <p className="mt-1 text-sm text-foreground-muted">{selected.meta.question}</p>
                  )}
                </div>
                <span className="font-mono text-xs tabular-nums text-foreground-muted">
                  stage {templateOf(selected.meta.template).stages[curStage(selected)]?.n}
                </span>
              </div>
              <ProjectTab
                research={selected}
                settings={settings}
                onToggleGate={toggleGate}
                onRecordCycle={recordCycle}
                onCreateItem={createItem}
                onUpdateItem={updateItem}
                onDeleteItem={deleteItem}
                onPromoteItem={promoteItem}
                onCreateClaim={createClaim}
                onDeleteClaim={deleteClaim}
                onAppendLog={appendLog}
                isPending={isPending}
              />
            </>
          )}

          {tab === 'library' && (
            <LibraryTab
              projects={projects}
              library={library}
              onPull={pullFact}
              onDeleteEntry={deleteLibraryEntry}
              onSweep={sweepLibrary}
              isPending={isPending}
            />
          )}

          {tab === 'prompts' && (
            <PromptsTab
              projects={projects}
              settings={settings}
              capabilities={capabilities}
              initialScopeQuestion={scopeQuestion}
            />
          )}
        </>
      )}

      {tab !== 'portfolio' && (
        <div className="mt-8">
          <Button variant="ghost" onClick={() => setTab('portfolio')}>
            Back to portfolio
          </Button>
        </div>
      )}
    </div>
  );
}
