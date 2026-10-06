/**
 * The command composer and a desk's command thread (brief v2 WO-3).
 *
 * To is fixed to the chosen agent. Cc is the agent's lead, added
 * automatically and not removable, so the lead's consistency check stays
 * intact; leads, the router and methodology have no Cc. An override needs a
 * reason and shows the workpaper note it will be recorded under. The thread
 * shows each command's trail, Sent → Received → Done or Declined, with times;
 * a declined command shows its placeholder rule and the rule's one-line
 * explanation.
 *
 * Ported from the GLM workspace (src/panels/Composer.tsx at 5b5d186).
 */
import { useState } from 'react';
import type { Agent, Command } from '../../../data/fsreTransport/contract';
import { formatDateLong, formatHHMM } from '../../../logic/lab/fsre/format';
import { COMMAND_STATUS_GLYPHS, COMMAND_STATUS_TONES } from '../../../logic/lab/fsre/glyphs';
import { leadOfAgent } from '../../../logic/lab/fsre/liveView';
import { COMMAND_KINDS, COMMAND_KIND_WORDS, COMMAND_STATUS_WORDS, DECLINE_RULES, PLACEHOLDER_RULE_NOTE, workpaperNoteText, type CommandKindV, type CommandStatusV } from '../../../logic/lab/fsre/statuses';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { Glyph, Quiet } from './fsreUi';
import { useFsreLiveStore } from './useFsreLiveStore';

const FIELD = 'mt-1 w-full rounded-sm border border-border bg-card px-2 py-1.5 text-sm text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function FsreComposer({ agent, agents, engagementId, onSent }: { agent: Agent; agents: readonly Agent[]; engagementId: string | null; onSent?: () => void }) {
  const transport = useFsreLiveStore((s) => s.transport);
  const refreshLists = useFsreLiveStore((s) => s.refreshLists);
  const now = useFsreLiveStore((s) => s.now);
  const [kind, setKind] = useState<CommandKindV>('instruction');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lead = leadOfAgent(agent, agents);
  const canSend = Boolean(text.trim()) && !busy && (kind !== 'override' || Boolean(reason.trim()));

  const send = async () => {
    if (!transport || !canSend) return;
    setBusy(true);
    setError(null);
    try {
      await transport.sendCommand({ toAgentId: agent.id, engagementId, kind, text: text.trim(), reason: kind === 'override' ? reason.trim() : null });
      setText('');
      setReason('');
      setKind('instruction');
      await refreshLists();
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-5 rounded-lg border border-border bg-surface-2 p-3" aria-label={`Command composer for ${agent.title}`}>
      <h3 className="surface-label">Command composer</h3>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-foreground-secondary">To</dt>
          <dd className="text-foreground">
            {agent.title}
            {agent.assignedTicker ? ` (${agent.assignedTicker})` : ''} — fixed
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-foreground-secondary">Cc</dt>
          <dd className="text-foreground">{lead ? `${lead.title} — added automatically, not removable` : '— (no lead above this agent)'}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Command kind">
        {COMMAND_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            onClick={() => setKind(option)}
            className={cn(
              'min-h-11 rounded-sm border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              kind === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-surface-3',
            )}
          >
            {COMMAND_KIND_WORDS[option]}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm">
        <span className="text-foreground-secondary">Message</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} className={cn(FIELD, 'min-h-16')} aria-label="Command text" placeholder="What should the agent do or answer?" />
      </label>
      {kind === 'override' ? (
        <>
          <label className="mt-2 block text-sm">
            <span className="text-foreground-secondary">Reason (required)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className={cn(FIELD, 'min-h-16')} aria-label="Override reason" />
          </label>
          <p className="fsre-tone mt-1 text-xs" data-tone="escalated">
            Will be recorded in the workpaper as {workpaperNoteText(formatDateLong(now))}
          </p>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="fsre-tone mt-2 text-xs" data-tone="escalated">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="secondary" className="mt-3 min-h-11" onClick={send} disabled={!canSend}>
        {busy ? 'Sending…' : 'Send command'}
      </Button>
      {lead ? <p className="mt-2 text-xs text-foreground-muted">Commands to this desk go to {lead.title} as Cc automatically.</p> : null}
    </section>
  );
}

function TrailStep({ status, at, reached }: { status: CommandStatusV; at: string | null; reached: boolean }) {
  return (
    <li className={cn('inline-flex items-center gap-1', reached ? 'text-foreground' : 'text-foreground-muted')} aria-current={reached ? 'step' : undefined}>
      {reached ? <Glyph glyph={COMMAND_STATUS_GLYPHS[status]} tone={COMMAND_STATUS_TONES[status]} /> : <span aria-hidden="true">·</span>}
      {COMMAND_STATUS_WORDS[status]}
      {at ? ` ${formatHHMM(at)}` : ''}
    </li>
  );
}

/** One command per row: kind, time, text, reason; the trail; the response, the declined rule, the workpaper note. */
export function FsreCommandThread({ commands }: { commands: readonly Command[] }) {
  if (!commands.length) return <Quiet>No commands for this agent yet.</Quiet>;
  return (
    <ul className="space-y-2">
      {commands.map((command) => {
        const received = command.status !== 'sent';
        return (
          <li key={command.id} className="rounded-sm border border-border-subtle p-2.5">
            <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
              <span>
                {COMMAND_KIND_WORDS[command.kind]}
                {command.engagementId ? ` · ${command.engagementId}` : ''}
              </span>
              <time>{formatHHMM(command.at)}</time>
            </div>
            <p className="mt-1 text-sm text-foreground">“{command.text}”</p>
            {command.reason ? <p className="text-xs text-foreground-secondary">Reason: {command.reason}</p> : null}
            <ol className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label="Status trail">
              <TrailStep status="sent" at={command.at} reached />
              <TrailStep status="received" at={received ? command.statusAt : null} reached={received} />
              {command.status === 'declined' ? (
                <TrailStep status="declined" at={command.statusAt} reached />
              ) : (
                <TrailStep status="done" at={command.status === 'done' ? command.statusAt : null} reached={command.status === 'done'} />
              )}
            </ol>
            {command.status === 'declined' && command.declinedRule ? (
              <p className="fsre-tone mt-1.5 text-xs" data-tone="escalated" title={PLACEHOLDER_RULE_NOTE}>
                Declined under {DECLINE_RULES[command.declinedRule].label}: {command.response}
              </p>
            ) : null}
            {command.status === 'done' && command.response ? <p className="mt-1.5 text-xs text-foreground">{command.response}</p> : null}
            {command.workpaperNote ? <p className="mt-1 text-xs text-foreground-secondary">Workpaper: {command.workpaperNote}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
