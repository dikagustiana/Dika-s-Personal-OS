import { Check, Copy, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
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
}: {
  card: PromptCard;
  capabilities: ModelCapabilities;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const prompt = useMemo(() => card.build(), [card]);
  const blocked = sendBlockedReason(card.kind, capabilities);
  const sendable = canSend(card.kind, capabilities);

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
    const outcome = await sendPrompt({ kind: card.kind, prompt, confirmed: true });
    setSending(false);
    setConfirming(false);
    setResult(outcome.sent ? (outcome.completion ?? '') : (outcome.reason ?? 'Nothing was sent.'));
  };

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-foreground">{card.title}</h3>
            <p className="mt-1 text-xs text-foreground-muted">{card.blurb}</p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
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
              Send this prompt to {capabilities.model || 'the configured model'}? It is
              {' '}{prompt.length.toLocaleString()} characters, shown in full below. Nothing the
              model returns can verify an item, tick a gate or write a cycle.
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
            <span className="surface-label">Model response</span>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words border border-border-subtle bg-card p-3 text-[11px] leading-5 text-foreground-secondary">
              {result || '(empty)'}
            </pre>
            <p className="mt-1 text-xs text-foreground-muted">
              Output is layer (c) until you open the sources yourself. Nothing here has been
              written to the register.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PromptsTab({
  projects,
  settings,
  capabilities,
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
          <CardBody key={card.kind} card={card} capabilities={capabilities} />
        ))}
      </div>
    </div>
  );
}
