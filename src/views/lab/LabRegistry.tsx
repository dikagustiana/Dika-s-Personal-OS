/**
 * F1 — the registry. Agent cards with integrity checking.
 *
 * THE DEPENDENCY CHECKER SHIPS IN V1, not later: the registry's job is to be
 * trusted, and a registry that renders a prompt delegating to an agent that
 * does not exist — without saying so — is a prettier version of the problem
 * Lab replaces. Phantoms render twice: a summary banner at the top and a
 * badge on each referencing card.
 *
 * Create/edit is INLINE EXPANSION, not a modal — there is no modal in this
 * codebase beyond the nav drawer, and the one form worth showing is worth
 * showing in the page's own flow. data_class has NO preselected value: the
 * form refuses to submit until the boundary decision is made by hand, which
 * is the UI face of the column's no-default rule.
 */
import { Plus, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { EmptyRow } from '../../components/ui/EmptyRow';
import { Input } from '../../components/ui/Input';
import { useMutation } from '../../hooks/useMutation';
import type { LabAgent, LabAgentWrite, LabDataClass } from '../../data/labTypes';
import { phantomReport } from '../../logic/lab/labDeps';
import { useAppStore } from '../../store/appStore';
import { CouldNotCheck, Checking } from '../work/finishLineUi';
import { DataClassChip, PhantomBadge, ProviderChip, RunStatusChip, rowsOr, useLabData } from './labUi';

type ClassFilter = 'all' | LabDataClass;
type ActiveFilter = 'all' | 'active' | 'inactive';

interface AgentDraft {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** '' until the owner chooses — the form cannot submit while it is. */
  dataClass: '' | LabDataClass;
  defaultProviderId: string;
  isActive: boolean;
}

const EMPTY_DRAFT: AgentDraft = {
  slug: '',
  name: '',
  description: '',
  systemPrompt: '',
  dataClass: '',
  defaultProviderId: '',
  isActive: true,
};

function draftOf(agent: LabAgent): AgentDraft {
  return {
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    dataClass: agent.dataClass,
    defaultProviderId: agent.defaultProviderId ?? '',
    isActive: agent.isActive,
  };
}

export function LabRegistry() {
  const repository = useAppStore((state) => state.repository);
  const setLabView = useAppStore((state) => state.setLabView);
  const setLabRunFocus = useAppStore((state) => state.setLabRunFocus);
  const { providers, agents, chains, runs, reload } = useLabData();
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  /** null = closed; 'new' = create form; an id = that card's edit form. */
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const { run: mutate, isPending } = useMutation();

  const providerRows = rowsOr(providers);
  const agentRows = rowsOr(agents);
  const runRows = rowsOr(runs);

  const report = useMemo(
    () => phantomReport(agentRows, rowsOr(chains)),
    [agentRows, chains],
  );

  const runStatsByAgent = useMemo(() => {
    const stats = new Map<string, { total: number; last: (typeof runRows)[number] }>();
    // runs arrive newest first, so the first sighting is the latest run.
    for (const run of runRows) {
      const existing = stats.get(run.agentId);
      if (existing) existing.total += 1;
      else stats.set(run.agentId, { total: 1, last: run });
    }
    return stats;
  }, [runRows]);

  const providersById = useMemo(
    () => new Map(providerRows.map((provider) => [provider.id, provider])),
    [providerRows],
  );

  const visible = agentRows.filter((agent) => {
    if (classFilter !== 'all' && agent.dataClass !== classFilter) return false;
    if (activeFilter === 'active' && !agent.isActive) return false;
    if (activeFilter === 'inactive' && agent.isActive) return false;
    return true;
  });
  const hidden = agentRows.length - visible.length;

  const startCreate = () => {
    setDraft(EMPTY_DRAFT);
    setEditing('new');
  };
  const startEdit = (agent: LabAgent) => {
    setDraft(draftOf(agent));
    setEditing(agent.id);
  };

  const submit = async () => {
    if (!draft.dataClass) return;
    const input: LabAgentWrite = {
      slug: draft.slug.trim(),
      name: draft.name.trim(),
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      dataClass: draft.dataClass,
      defaultProviderId: draft.defaultProviderId || null,
      isActive: draft.isActive,
    };
    const saved = await mutate(
      editing === 'new' ? 'Create agent' : 'Update agent',
      () =>
        editing === 'new'
          ? repository.lab.createAgent(input, providerRows)
          : repository.lab.updateAgent(editing as string, input, providerRows),
    );
    if (!saved) return; // draft stays on screen, safe to retry
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    reload();
  };

  /**
   * The boundary at the form: an internal draft locks the provider select to
   * the Anthropic row. Not a tooltip on hover — a sentence that is always
   * there, because the rule is structural and reads as such.
   */
  const anthropicId = providerRows.find((provider) => provider.name === 'anthropic')?.id ?? '';
  const isInternalDraft = draft.dataClass === 'internal';
  const effectiveProviderId = isInternalDraft ? anthropicId : draft.defaultProviderId;

  const form = (
    <Card className="mb-5 border-primary/30">
      <CardHeader>
        <CardTitle>{editing === 'new' ? 'New agent' : `Edit — ${draft.name || draft.slug}`}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
              Slug
              <Input
                value={draft.slug}
                onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                placeholder="senior-finance-analyst"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                required
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
              Name
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
              />
            </label>
          </div>
          <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
            Trigger description
            <textarea
              className="min-h-20 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="When should this agent fire? Cite siblings as (their-slug) — the checker reads this."
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
            System prompt
            <textarea
              className="min-h-40 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft.systemPrompt}
              onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
              required
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
              Data class
              <select
                className="native-select"
                value={draft.dataClass}
                onChange={(event) =>
                  setDraft({ ...draft, dataClass: event.target.value as AgentDraft['dataClass'] })
                }
                required
              >
                {/* No default. The empty option is unsubmittable (required),
                    so the boundary decision is always made by hand. */}
                <option value="" disabled>
                  pilih — internal atau public
                </option>
                <option value="internal">internal — SAMB data, Anthropic only</option>
                <option value="public">public — boleh provider mana pun</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-foreground-secondary">
              Default provider
              <select
                className="native-select"
                value={effectiveProviderId}
                onChange={(event) => setDraft({ ...draft, defaultProviderId: event.target.value })}
                disabled={isInternalDraft}
              >
                <option value="">— none —</option>
                {providerRows.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} · {provider.model}
                  </option>
                ))}
              </select>
              {isInternalDraft && (
                <span className="text-[11px] font-normal normal-case leading-4 text-foreground-muted">
                  Internal data — Anthropic only. Enforced in the database, not just here.
                </span>
              )}
            </label>
          </div>
          {editing !== 'new' && (
            <label className="flex items-center gap-2 text-xs font-semibold text-foreground-secondary">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
              />
              Active
            </label>
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isPending || !draft.dataClass}>
              {editing === 'new' ? 'Create agent' : 'Save changes'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Batal
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">Lab / Registry</p>
          <h1 className="page-title">Agent registry</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
            Portable prompt artifacts, versioned and runnable. Internal agents are pinned to
            Anthropic by the database — the badge is the boundary, not a preference.
          </p>
        </div>
        <Button className="mt-4 md:mt-0" onClick={startCreate}>
          <Plus className="size-4" />
          New agent
        </Button>
      </header>

      {report.all.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-escalate/40 bg-card p-4 shadow-card">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-escalate" />
          <div>
            <p className="text-sm font-semibold text-escalate">
              {report.all.length} phantom dependenc{report.all.length > 1 ? 'ies' : 'y'}
            </p>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              Referenced by prompts or chains but not in the registry:{' '}
              <span className="text-foreground-secondary">{report.all.join(', ')}</span>. A prompt
              that delegates to a missing agent fails silently at run time — create them or edit
              the references out.
            </p>
          </div>
        </div>
      )}

      {editing !== null && form}

      <div
        className="mb-4 flex flex-wrap items-center gap-3"
        role="group"
        aria-label="Filter registry"
      >
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <span className="sr-only">Filter by data class</span>
          <select
            className="native-select text-xs"
            value={classFilter}
            onChange={(event) => setClassFilter(event.target.value as ClassFilter)}
          >
            <option value="all">Semua kelas</option>
            <option value="internal">internal</option>
            <option value="public">public</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <span className="sr-only">Filter by active state</span>
          <select
            className="native-select text-xs"
            value={activeFilter}
            onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
          >
            <option value="all">Aktif & nonaktif</option>
            <option value="active">Aktif saja</option>
            <option value="inactive">Nonaktif saja</option>
          </select>
        </label>
        <span className="text-xs tabular-nums text-foreground-muted">
          {visible.length} agent{visible.length === 1 ? '' : 's'}
          {hidden > 0 ? ` · ${hidden} disembunyikan filter` : ''}
        </span>
      </div>

      {agents === null ? (
        <Checking label="Registry" />
      ) : !agents.ok ? (
        <Card>
          <CardContent className="pt-5">
            <CouldNotCheck label="Registry" failure={agents} />
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <EmptyRow
          label="Registry"
          clause={
            agentRows.length === 0
              ? 'belum ada agent — buat yang pertama'
              : 'tidak ada yang lolos filter'
          }
          action={agentRows.length === 0 ? 'New agent' : undefined}
          onAction={agentRows.length === 0 ? startCreate : undefined}
        />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          {visible.map((agent) => {
            const stats = runStatsByAgent.get(agent.id);
            const provider = agent.defaultProviderId
              ? providersById.get(agent.defaultProviderId)
              : undefined;
            const phantoms = report.byAgentId[agent.id] ?? [];
            return (
              <Card key={agent.id} className={agent.isActive ? undefined : 'opacity-60'}>
                <CardHeader>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{agent.name}</CardTitle>
                      <DataClassChip dataClass={agent.dataClass} />
                      {!agent.isActive && (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
                          nonaktif
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-foreground-muted">
                      {agent.slug} · v{agent.version}
                    </p>
                  </div>
                  <PhantomBadge slugs={phantoms} />
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-3 text-sm leading-6 text-foreground-secondary">
                    {agent.description || '—'}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                    {provider ? <ProviderChip name={provider.name} /> : <span>no provider</span>}
                    {stats ? (
                      <>
                        <RunStatusChip status={stats.last.status} />
                        <span className="tabular-nums">{stats.total} runs</span>
                      </>
                    ) : (
                      <span>belum pernah dijalankan</span>
                    )}
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!agent.isActive}
                      onClick={() => {
                        setLabRunFocus({ agentSlug: agent.slug });
                        setLabView('run');
                      }}
                    >
                      Run
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(agent)}>
                      Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
