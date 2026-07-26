import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import type { ResearchProject, ResearchSettings } from '../../../data/types';
import { critIND, dueLoops, nextAction, parkCandidate } from '../../../logic/research/pipeline';
import { loopDue } from '../../../logic/research/pipeline';
import { LOOPS, type LoopKey } from '../../../logic/research/loops';
import { TEMPLATES, TPL_KEYS, type TemplateKey } from '../../../logic/research/templates';
import { GateMap } from './GateMap';
import { cn } from '../../../lib/utils';

export interface NewResearchInput {
  title: string;
  template: TemplateKey;
  question: string;
}

export interface PortfolioTabProps {
  projects: ResearchProject[];
  settings: ResearchSettings;
  onSelect: (projectId: string) => void;
  onCreate: (input: NewResearchInput) => Promise<void>;
  onScope: (question: string) => void;
  isPending: boolean;
}

function Stat({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="px-4 py-3">
      <p className="font-display text-xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="surface-label mt-0.5">{caption}</p>
    </div>
  );
}

export function PortfolioTab({
  projects,
  settings,
  onSelect,
  onCreate,
  onScope,
  isPending,
}: PortfolioTabProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<TemplateKey>('min');
  const [question, setQuestion] = useState('');
  const [scopeQuestion, setScopeQuestion] = useState('');

  const active = projects.filter((item) => item.project.status === 'active');
  const withBlockers = active.filter((item) => critIND(item).length > 0);
  const overWip = active.length > settings.wipLimit;
  const park = useMemo(() => (overWip ? parkCandidate(projects) : null), [overWip, projects]);

  const reviews = useMemo(
    () =>
      projects.flatMap((research) =>
        dueLoops(research, settings).map((loop) => ({
          research,
          loop,
          why: loopDue(research, loop, settings).why,
        })),
      ),
    [projects, settings],
  );

  const submit = async () => {
    if (!title.trim()) return;
    await onCreate({ title: title.trim(), template, question: question.trim() });
    setTitle('');
    setQuestion('');
    setTemplate('min');
    setAdding(false);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border-subtle shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <div className={cn('bg-card', overWip && 'bg-escalate/15')}>
          <Stat value={`${active.length}/${settings.wipLimit}`} caption="Active · WIP limit" />
        </div>
        <div className="bg-card">
          <Stat value={`${withBlockers.length}`} caption="Active with blockers" />
        </div>
        <div className="bg-card">
          <Stat value={`${projects.length}`} caption="Total research" />
        </div>
        <div className="bg-card">
          <Stat value={`${reviews.length}`} caption="Reviews due" />
        </div>
      </div>

      {park && (
        <Card className="border-escalate">
          <CardContent className="pt-5">
            <p className="text-sm text-foreground">
              Over the WIP limit. The one to park is{' '}
              <button
                type="button"
                onClick={() => onSelect(park.project.id)}
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                {park.project.title}
              </button>{' '}
              — {critIND(park).length > 0 ? 'it has an open blocker' : 'it is lowest priority'}.
              Parking keeps its gates, register and decision log intact.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-5">
          <h2 className="font-display text-card-heading font-semibold text-foreground">Gate map</h2>
          <p className="mb-4 mt-1 text-xs text-foreground-muted">
            Filled = gate passed · part-filled = criteria checked · thick border = current stage ·
            stripes = open blocker at stage 00.
          </p>
          {projects.length > 0 ? (
            <GateMap projects={projects} onSelect={onSelect} />
          ) : (
            <p className="text-xs text-foreground-muted">No research projects yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <h2 className="mb-3 font-display text-card-heading font-semibold text-foreground">
            Next action
          </h2>
          {projects.length === 0 ? (
            <p className="text-xs text-foreground-muted">Nothing in the pipeline.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {projects.map((research) => {
                const action = nextAction(research);
                return (
                  <li key={research.project.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
                    <button
                      type="button"
                      onClick={() => onSelect(research.project.id)}
                      className="shrink-0 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      {research.project.title}
                    </button>
                    <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground-muted">
                      {action.stage.n} {action.stage.t}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-foreground-secondary">
                      {action.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <h2 className="mb-3 font-display text-card-heading font-semibold text-foreground">
            Reviews due
          </h2>
          {reviews.length === 0 ? (
            <p className="text-xs text-foreground-muted">
              Nothing due. Review loops are a trigger for you, not for a scheduler — nothing here
              runs on its own.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {reviews.map(({ research, loop, why }) => (
                <li key={`${research.project.id}-${loop}`} className="py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <button
                      type="button"
                      onClick={() => onSelect(research.project.id)}
                      className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      {research.project.title}
                    </button>
                    <span className="rounded-sm bg-escalate px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-escalate-foreground">
                      {LOOPS[loop as LoopKey].name}
                    </span>
                  </div>
                  {/* The console's own wording, verbatim: it names the trigger. */}
                  <p className="mt-1 text-xs text-foreground-muted">{why}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-card-heading font-semibold text-foreground">
                Start something
              </h2>
              <p className="mt-1 text-xs text-foreground-muted">
                Scope a raw question first if the template is not obvious yet.
              </p>
            </div>
            <Button
              variant={adding ? 'secondary' : 'default'}
              onClick={() => setAdding((current) => !current)}
            >
              <Plus className="size-4" />
              {adding ? 'Cancel' : 'New research'}
            </Button>
          </div>

          {adding && (
            <div className="mt-4 grid gap-3 border-t border-border-subtle pt-4">
              <label className="block">
                <span className="surface-label">Title</span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Short name for the project"
                  className="mt-1"
                />
              </label>
              <label className="block">
                <span className="surface-label">Research question</span>
                <Input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="What is actually being asked?"
                  className="mt-1"
                />
              </label>
              <label className="block">
                <span className="surface-label">Method template</span>
                <select
                  className="native-select mt-1 text-xs"
                  value={template}
                  onChange={(event) => setTemplate(event.target.value as TemplateKey)}
                >
                  {TPL_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {TEMPLATES[key].name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-foreground-muted">
                  {TEMPLATES[template].desc}
                </span>
              </label>
              <div>
                <Button onClick={() => void submit()} disabled={isPending || !title.trim()}>
                  Create research project
                </Button>
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-border-subtle pt-4">
            <span className="surface-label">Cold-start scoping sweep</span>
            <p className="mt-1 text-xs text-foreground-muted">
              Builds a prompt that asks whether the question is answerable as posed before anything
              else. No project needed.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Input
                value={scopeQuestion}
                onChange={(event) => setScopeQuestion(event.target.value)}
                placeholder="A raw research question…"
                className="min-w-[16rem] flex-1"
              />
              <Button
                variant="secondary"
                onClick={() => onScope(scopeQuestion.trim())}
                disabled={!scopeQuestion.trim()}
              >
                Build scope prompt
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
