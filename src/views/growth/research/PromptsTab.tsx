import { Check, Copy, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import type { ResearchProject, ResearchSettings } from '../../../data/types';
import {
  canSend,
  sendBlockedReason,
  sendPrompt,
  type ModelCapabilities,
  type PromptKind,
} from '../../../data/researchModel';
import {
  activeRoutes,
  resolveTaskModel,
  unrecognisedTasks,
  type ModelRoute,
  type ModelRoutingTable,
} from '../../../logic/research/modelRouting';
import {
  prAllBatch,
  prBatch,
  prBrief,
  prCite,
  prContra,
  prData,
  prDigest,
  prHand,
  prLit,
  prMethod,
  prScope,
} from '../../../logic/research/prompts';

export interface PromptsTabProps {
  projects: ResearchProject[];
  settings: ResearchSettings;
  capabilities: ModelCapabilities;
  /** Task → model. Empty means every card runs on the function's default. */
  routing: ModelRoutingTable;
  /** The stored rows, for the summary and the unrecognised-task warning. */
  routingRows: ModelRoute[];
  /** The routing read failed — different from nothing being routed. */
  routingFailed?: boolean;
  /** Pre-filled question when the portfolio's scope box handed one over. */
  initialScopeQuestion?: string;
}

interface PromptCard {
  kind: PromptKind;
  title: string;
  blurb: string;
  build: () => string;
}

function CardBody({
  card,
  capabilities,
  routing,
}: {
  card: PromptCard;
  capabilities: ModelCapabilities;
  routing: ModelRoutingTable;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Whether it SENT is kept alongside the text. A refusal rendered under
  // "Model response" with the layer (c) caption reads as output the model
  // produced, when nothing was produced at all.
  const [result, setResult] = useState<{ sent: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const prompt = useMemo(() => card.build(), [card]);
  // Note what is NOT passed to either of these: the routing table. Routing
  // chooses the model; it has no say in whether a prompt may be sent, and these
  // two cannot read a routing row even by accident.
  const blocked = sendBlockedReason(card.kind, capabilities);
  const sendable = canSend(card.kind, capabilities);
  // ONE resolution for both the label and the wire, so the name shown before
  // the click cannot differ from the name that runs.
  const { model, routed, pinned, override } = resolveTaskModel(card.kind, routing, capabilities);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be denied; the prompt is on screen either way.
      setCopied(false);
    }
  };

  const send = async () => {
    setSending(true);
    const outcome = await sendPrompt({
      kind: card.kind,
      prompt,
      confirmed: true,
      // Undefined for an unrouted card, so the function picks its own default at
      // call time rather than being pinned to whatever the probe reported when
      // this tab was opened. Undefined for a browsing-gated card too, whatever
      // its routing row says — see resolveTaskModel.
      model: override,
    });
    setSending(false);
    setConfirming(false);
    setResult({
      sent: outcome.sent,
      text: outcome.sent
        ? (outcome.completion ?? '')
        : (outcome.reason ?? 'Nothing was sent, and the function gave no reason.'),
    });
  };

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-foreground">{card.title}</h3>
            <p className="mt-1 text-xs text-foreground-muted">{card.blurb}</p>
          </div>
          {/* NOT shrink-0: at 380px the model chip is the widest thing on the
              row, and a group that refuses to shrink pushed the card wider than
              the viewport. The chip truncates instead — its full value is in the
              title attribute and in the confirm step. */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {/* WHICH MODEL, BEFORE THE CLICK. A person about to spend a
                completion should not have to remember what the routing table
                says, and eleven of them is not the moment to find out. Shown
                only where a send is actually offered: on a copy-paste card the
                model is whichever one the prompt gets pasted into. */}
            {sendable && (
              <span
                className="max-w-full truncate border border-border px-1.5 py-0.5 text-[10px] text-foreground-muted sm:max-w-[12rem]"
                title={
                  pinned
                    ? `${model} — the declared browsing model. ${card.kind} re-opens sources, and the browsing declaration is about this model, so its routing row is not applied.`
                    : routed
                      ? `${model} — routed for ${card.kind} in the routing table`
                      : `${model} — the configured default; ${card.kind} has no routing row`
                }
              >
                {model || 'the configured model'}
                {routed && ' · routed'}
                {pinned && ' · not applied'}
              </span>
            )}
            {/* `sendable` ALONE. Never `sendable || isRouted(...)`.
                A routing row says WHICH model, never WHETHER a prompt may go
                out; ORing it in here puts a send button on prData the moment
                someone routes it, which is the one thing routing must not be
                able to do. The server would still refuse the send, so the
                symptom would be a button that always fails — the thing that
                teaches you to ignore the panel. modelRouting.test.ts pins the
                rule; this is the line it protects. */}
            {sendable && (
              <Button size="sm" onClick={() => setConfirming(true)} disabled={sending}>
                <Send className="size-4" />
                Send
              </Button>
            )}
          </div>
        </div>

        {/* Why there is no send button. Stated per card rather than once at the
            top: the reason differs by prompt, and a global note would read as
            applying to all of them. */}
        {blocked && <p className="mt-2 text-xs text-foreground-muted">{blocked}</p>}

        {confirming && (
          <div className="mt-3 border border-escalate bg-escalate/10 p-3">
            <p className="text-xs text-foreground-secondary">
              Send this prompt to {model || 'the configured model'}
              {pinned
                ? ' (the declared browsing model — this prompt re-opens sources, so its routing row is not applied)'
                : routed
                  ? ' (routed for this task)'
                  : ' (the configured default)'}? It is
              {' '}{prompt.length.toLocaleString()} characters, shown in full below. That is one
              completion. Nothing the model returns can verify an item, tick a gate or write a
              cycle.
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void send()} disabled={sending}>
                {sending ? 'Sending…' : 'Yes, send it'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="mt-3 text-xs font-semibold text-primary underline-offset-4 hover:underline"
        >
          {open ? 'Hide prompt' : 'Show prompt'} ({prompt.length.toLocaleString()} chars)
        </button>

        {open && (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words border border-border-subtle bg-surface-2 p-3 text-[11px] leading-5 text-foreground-secondary">
            {prompt}
          </pre>
        )}

        {result !== null && (
          <div className="mt-3">
            <span className="surface-label">
              {result.sent ? 'Model response' : 'Nothing was sent'}
            </span>
            <pre
              className={cn(
                'mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words border p-3 text-[11px] leading-5 text-foreground-secondary',
                result.sent ? 'border-border-subtle bg-card' : 'border-destructive bg-surface-2',
              )}
            >
              {result.text || '(empty)'}
            </pre>
            {result.sent ? (
              <p className="mt-1 text-xs text-foreground-muted">
                Output is layer (c) until you open the sources yourself. Nothing here has been
                written to the register.
              </p>
            ) : (
              // The layer (c) caption is deliberately NOT shown here: there is no
              // output to classify, and a caption about output invites reading the
              // failure as one. Nothing was retried either — a retry spends again.
              <p className="mt-1 text-xs text-foreground-muted">
                No completion was returned and nothing was retried automatically. The prompt above
                is unchanged and still copies.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * What is routed where, and where to change it.
 *
 * Read-only on purpose. The rows are edited in the Supabase table editor, which
 * is what makes routing a no-deploy decision; an editor screen here would be a
 * second place the same answer lives, and the one people forget to look at.
 * This block exists so the owner does not have to open the database to remember
 * what he set.
 */
function RoutingSummary({
  routingRows,
  routingFailed,
  capabilities,
}: {
  routingRows: ModelRoute[];
  routingFailed?: boolean;
  capabilities: ModelCapabilities;
}) {
  const routes = activeRoutes(routingRows);
  const unknown = unrecognisedTasks(routingRows);
  // A row for a browsing-gated task is NOT in force: the browsing declaration
  // describes the default model, so those tasks stay on it. Listing the row
  // without saying that would make this panel claim something untrue.
  const gated = routes.filter((route) => capabilities.requiresBrowsing.includes(route.task));

  return (
    <Card>
      <CardContent className="pt-5">
        <span className="surface-label">Model routing</span>
        {routingFailed ? (
          // Not "nothing is routed": that is a working state and this is not.
          <p className="mt-1 text-xs text-foreground-muted">
            The routing table could not be read, so every task below falls back to the configured
            default. Your routing rows still exist — this list failed to load.
          </p>
        ) : routes.length === 0 ? (
          <p className="mt-1 text-xs text-foreground-muted">
            Nothing is routed, so every task runs on the configured default
            {capabilities.model ? ` (${capabilities.model})` : ''}. Route a task by putting a model
            id in the <code>os_model_routing</code> row for it — no deploy, effective next reload.
            A blank row means the default, never “do not send”.
          </p>
        ) : (
          <>
            <ul className="mt-1 space-y-0.5 text-xs text-foreground-secondary">
              {routes.map((route) => {
                const notApplied = capabilities.requiresBrowsing.includes(route.task);
                return (
                  <li key={route.task} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold">{route.task}</span>
                    <span className="text-foreground-muted">→ {route.model}</span>
                    {notApplied && (
                      <span className="text-foreground-muted">(not applied)</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-foreground-muted">
              Everything else runs on the configured default
              {capabilities.model ? ` (${capabilities.model})` : ''}. Routing chooses which model;
              it cannot make a source-checking prompt sendable without web access.
            </p>
            {gated.length > 0 && (
              <p className="mt-2 border-l-2 border-escalate px-3 py-1 text-xs text-foreground-secondary">
                Not applied: {gated.map((route) => route.task).join(', ')}. These prompts re-open
                sources, and web access is declared for the configured default only — so they run
                on it whatever their row says. Delete the rows or leave them; either way they have
                no effect.
              </p>
            )}
          </>
        )}
        {unknown.length > 0 && (
          // A typo'd task name would otherwise be a setting that silently does
          // nothing — the failure mode this table has no CHECK constraint to
          // catch, reported instead of prevented so a new prompt kind stays
          // routable without a migration.
          <p className="mt-2 border-l-2 border-escalate px-3 py-1 text-xs text-foreground-secondary">
            Routing rows for unrecognised tasks: {unknown.join(', ')}. Nothing reads them — check
            the spelling against the task names above.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function PromptsTab({
  projects,
  settings,
  capabilities,
  routing,
  routingRows,
  routingFailed,
  initialScopeQuestion,
}: PromptsTabProps) {
  const [selectedId, setSelectedId] = useState(projects[0]?.project.id ?? '');
  const [scopeQuestion, setScopeQuestion] = useState(initialScopeQuestion ?? '');
  const selected = projects.find((item) => item.project.id === selectedId) ?? null;

  const cards: PromptCard[] = useMemo(() => {
    const list: PromptCard[] = [];
    if (selected) {
      list.push(
        {
          kind: 'prBrief',
          title: 'Brief',
          blurb: 'The whole project stated once — question, template, register, claims.',
          build: () => prBrief(selected),
        },
        {
          kind: 'prBatch',
          title: 'Batch verification',
          blurb: 'Every indeterminate register item in one sweep.',
          build: () => prBatch(selected),
        },
        {
          kind: 'prData',
          title: 'Data review',
          blurb: 'Re-open each source and check it as it stands today.',
          build: () => prData(selected, settings),
        },
        {
          kind: 'prCite',
          title: 'Citation review',
          blurb: 'Every source-bearing item and every layer (b) claim.',
          build: () => prCite(selected),
        },
        {
          kind: 'prMethod',
          title: 'Method review',
          blurb: 'Whether the method still fits the question.',
          build: () => prMethod(selected),
        },
        {
          kind: 'prLit',
          title: 'Literature',
          blurb: 'Recent work bearing on the question.',
          build: () => prLit(selected),
        },
        {
          kind: 'prContra',
          title: 'Contradiction',
          blurb: 'The strongest case against the current claims.',
          build: () => prContra(selected),
        },
        {
          kind: 'prHand',
          title: 'Handover',
          blurb: 'Everything a new reader needs to pick this up cold.',
          build: () => prHand(selected, settings),
        },
      );
    }
    if (projects.length > 0) {
      list.push(
        {
          kind: 'prAllBatch',
          title: 'Batch across all projects',
          blurb: 'Every indeterminate item in the portfolio at once.',
          build: () => prAllBatch(projects),
        },
        {
          kind: 'prDigest',
          title: 'Portfolio digest',
          blurb: 'Where every project stands and what is due.',
          build: () => prDigest(projects, settings),
        },
      );
    }
    return list;
  }, [projects, selected, settings]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-5">
          <p className="text-xs leading-5 text-foreground-secondary">
            Internal organisational data never goes into a third-party prompt. Cases go as stylized
            descriptions. A browsing model's output is layer (c) until you open the URL yourself.
          </p>
          <p className="mt-2 text-xs text-foreground-muted">
            {capabilities.configured
              ? `Direct sending is configured (${capabilities.model}); web access ${capabilities.browsing ? 'is declared available' : 'is NOT declared, so source-checking prompts stay copy-paste only'}.`
              : 'Direct sending is not configured. Every prompt below still builds and copies — the API is an accelerant, not a dependency.'}
          </p>
        </CardContent>
      </Card>

      <RoutingSummary
        routingRows={routingRows}
        routingFailed={routingFailed}
        capabilities={capabilities}
      />

      {/* prScope works with no project selected: it exists precisely for the
          moment before a pipeline exists. */}
      <Card>
        <CardContent className="pt-5">
          <h3 className="font-display text-sm font-semibold text-foreground">
            Scoping sweep (no project needed)
          </h3>
          <p className="mt-1 text-xs text-foreground-muted">
            Asks whether the question is answerable as posed before anything else — that answer
            saves the most wasted work — then literature, datasets, and a recommended template.
          </p>
          <Input
            value={scopeQuestion}
            onChange={(event) => setScopeQuestion(event.target.value)}
            placeholder="A raw research question…"
            aria-label="Question to scope"
            className="mt-3"
          />
        </CardContent>
      </Card>

      {scopeQuestion.trim() && (
        <CardBody
          key="scope"
          card={{
            kind: 'prScope',
            title: 'prScope',
            blurb: 'Answerability first, then literature, datasets and a template recommendation.',
            build: () => prScope(scopeQuestion.trim()),
          }}
          capabilities={capabilities}
          routing={routing}
        />
      )}

      {projects.length > 0 && (
        <label className="block">
          <span className="surface-label">Project</span>
          <select
            className="native-select mt-1 text-xs"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {projects.map((research) => (
              <option key={research.project.id} value={research.project.id}>
                {research.project.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {cards.length === 0 && !scopeQuestion.trim() && (
        <p className="text-xs text-foreground-muted">
          Add a research project, or type a question above to build a scoping prompt.
        </p>
      )}

      <div className="space-y-4">
        {cards.map((card) => (
          <CardBody
            key={card.kind}
            card={card}
            capabilities={capabilities}
            routing={routing}
          />
        ))}
      </div>
    </div>
  );
}
