import { Check, ChevronDown, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { EmptyRow } from '../ui/EmptyRow';
import type { IeltsError } from '../../data/types';
import {
  CLASS_LABEL,
  CLASS_MEANING,
  CLASS_REMEDY,
  MIN_SESSIONS_TO_CLASSIFY,
  checklistText,
  occurrenceLabel,
  patternsForSkill,
  pendingProposals,
  preSubmitChecklist,
  type ModePattern,
  type PatternClass,
} from '../../logic/ielts/classify';
import {
  IELTS_ERROR_SKILLS,
  IELTS_ERROR_TAXONOMY,
  parseProposal,
} from '../../logic/ielts/taxonomy';
import { cn } from '../../lib/utils';

/**
 * What to work on — the question this screen answers on opening.
 *
 * A count is not an answer, so nothing here leads with one. Every mode carries
 * its CLASS, ordered by urgency rather than by count, because the remedy
 * differs per class and applying the wrong remedy is the failure this whole
 * feature exists to prevent.
 *
 * Nothing rendered here is stored. Classes are recomputed from the rows on
 * every read — see logic/ielts/classify.ts.
 */

// Escalate = needs attention, muted = considered and dismissed. No new colour
// literals: the two roles the palette already has are the two roles here.
const CLASS_TONE: Record<PatternClass, string> = {
  'correction-resistant': 'border-destructive/40 bg-destructive/5',
  induced: 'border-escalate/40 bg-escalate/5',
  unresolved: 'border-border',
  'within-session-cluster': 'border-border',
  'too-early': 'border-border-subtle',
  isolated: 'border-border-subtle',
};

const CLASS_TEXT: Record<PatternClass, string> = {
  'correction-resistant': 'text-destructive',
  induced: 'text-escalate',
  unresolved: 'text-foreground',
  'within-session-cluster': 'text-foreground',
  'too-early': 'text-foreground-muted',
  isolated: 'text-foreground-muted',
};

function PatternRow({ pattern }: { pattern: ModePattern }) {
  const remedy =
    pattern.patternClass === 'too-early'
      ? (pattern.tooEarlyReason ?? CLASS_REMEDY['too-early'])
      : CLASS_REMEDY[pattern.patternClass];

  return (
    <div className={cn('border-l-2 py-2 pl-3', CLASS_TONE[pattern.patternClass])}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {/* The stable identifier, never prettified — a reworded name is a
            different count, and showing a different string here is how the
            owner would learn the wrong one. */}
        <code className="text-xs font-semibold text-foreground">{pattern.mode}</code>
        <span className="text-xs tabular-nums text-foreground-muted">
          {occurrenceLabel(pattern.occurrences, pattern.sessions)}
        </span>
      </div>
      <p className={cn('mt-1 text-[11px] font-bold uppercase tracking-wider', CLASS_TEXT[pattern.patternClass])}>
        {CLASS_LABEL[pattern.patternClass]}
        {pattern.causedByFeedback && pattern.patternClass !== 'induced' && (
          <span className="ml-2 font-semibold normal-case tracking-normal text-escalate">
            first appeared in a rewrite
          </span>
        )}
      </p>
      <p className="mt-1 text-xs leading-5 text-foreground-secondary">{remedy}</p>
      {/* THE RULE IS SHOWN FOR unresolved ONLY. For a correction-resistant mode
          explanation has already failed twice; showing it again is the mistake
          the class exists to name. Its remedy is the checklist below. */}
      {pattern.patternClass === 'unresolved' && pattern.definition && (
        <p className="mt-1 text-xs leading-5 text-foreground-muted">{pattern.definition.rule}</p>
      )}
    </div>
  );
}

function SkillSection({ errors }: { errors: readonly IeltsError[] }) {
  const groups = useMemo(
    () => IELTS_ERROR_SKILLS.map((skill) => patternsForSkill(skill, errors)),
    [errors],
  );
  const [showIsolated, setShowIsolated] = useState(false);

  const active = groups.filter((group) => group.patterns.length > 0);
  if (active.length === 0) return null;

  return (
    <div className="space-y-6">
      {active.map((group) => {
        const taxonomy = IELTS_ERROR_TAXONOMY[group.skill];
        // Collapsed by default. Isolated exists so he can see it was considered
        // and dismissed; presented with equal weight beside a six-times-flagged
        // pattern it is the failure the feature is meant to prevent.
        const isolated = group.patterns.filter((p) => p.patternClass === 'isolated');
        const shown = group.patterns.filter((p) => p.patternClass !== 'isolated');

        return (
          <div key={group.skill}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border-subtle pb-1.5">
              <h3 className="surface-label">{taxonomy.label}</h3>
              <span className="text-xs tabular-nums text-foreground-muted">
                {group.sessions} {group.sessions === 1 ? 'session' : 'sessions'} logged
                {/* No percentage, rate or trend below the threshold — with one
                    session a percentage is arithmetic theatre. */}
                {group.sessions < MIN_SESSIONS_TO_CLASSIFY &&
                  `; classification needs ${MIN_SESSIONS_TO_CLASSIFY}`}
              </span>
            </div>

            <div className="mt-2 space-y-1.5">
              {shown.map((pattern) => (
                <PatternRow key={pattern.mode} pattern={pattern} />
              ))}
            </div>

            {isolated.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowIsolated((current) => !current)}
                  className="inline-flex items-center gap-1 rounded-sm text-xs text-foreground-muted underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={showIsolated}
                >
                  <ChevronDown
                    className={cn('size-3 transition-transform duration-150', showIsolated && 'rotate-180')}
                    aria-hidden
                  />
                  {isolated.length} isolated {isolated.length === 1 ? 'slip' : 'slips'}, considered and
                  dismissed
                </button>
                {showIsolated && (
                  <div className="mt-1.5 space-y-1.5">
                    {isolated.map((pattern) => (
                      <PatternRow key={pattern.mode} pattern={pattern} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Only rendered when a row actually carries a question_type, so
                this never appears as an empty axis. */}
            {group.byQuestionType.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle pt-2">
                <span className="surface-label">By question type</span>
                {group.byQuestionType.map((entry) => (
                  <span key={entry.type} className="text-xs text-foreground-secondary">
                    {entry.type}
                    <span className="ml-1.5 tabular-nums text-foreground-muted">
                      {entry.occurrences}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Checklist({ errors }: { errors: readonly IeltsError[] }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(
    () => preSubmitChecklist(IELTS_ERROR_SKILLS.map((skill) => patternsForSkill(skill, errors))),
    [errors],
  );

  // No mode qualifies → the section does not render. An empty checklist would
  // read as "nothing to check" when it means "nothing has been flagged twice".
  if (lines.length === 0) return null;

  const text = checklistText(lines);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Before you submit</CardTitle>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            One literal thing to search the draft for, per mode that has survived two flaggings.
            Not a rule to remember — you already know the rule.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-border-subtle bg-surface-2 p-3 text-[11px] leading-5 text-foreground-secondary">
          {text}
        </pre>
      </CardContent>
    </Card>
  );
}

function Proposals({ errors }: { errors: readonly IeltsError[] }) {
  const proposals = useMemo(() => pendingProposals(errors, parseProposal), [errors]);
  if (proposals.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Pending proposals</CardTitle>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            Modes the marking model could not place. The count is the signal: one occurrence is an
            observation, repetition makes a pattern. Promotion means editing the taxonomy — a code
            change, deliberately.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {proposals.map((proposal) => (
          <div key={proposal.name} className="border-l-2 border-border py-2 pl-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <code className="text-xs font-semibold text-foreground">
                {proposal.name}
              </code>
              <span className="text-xs tabular-nums text-foreground-muted">
                proposed {proposal.count}×
              </span>
            </div>
            {proposal.definition && (
              <p className="mt-1 text-xs leading-5 text-foreground-secondary">
                {proposal.definition}
              </p>
            )}
            <ul className="mt-1 space-y-0.5">
              {proposal.rows.map((row) => (
                <li key={row.id} className="text-xs text-foreground-muted">
                  <span className="tabular-nums">{row.date}</span> · {row.quote}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ErrorPatterns({ errors }: { errors: readonly IeltsError[] }) {
  const anyPatterns = useMemo(
    () =>
      IELTS_ERROR_SKILLS.some((skill) => patternsForSkill(skill, errors).patterns.length > 0),
    [errors],
  );
  const hasProposals = useMemo(
    () => pendingProposals(errors, parseProposal).length > 0,
    [errors],
  );

  return (
    <div className="space-y-5">
      <Checklist errors={errors} />
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>What to work on</CardTitle>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              Every logged failure mode, by class rather than by count. The class decides the
              remedy — and nothing here is stored, so it changes the moment a session is logged.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {anyPatterns ? (
            <SkillSection errors={errors} />
          ) : (
            <EmptyRow
              label="No errors logged"
              clause={
                hasProposals
                  ? 'Only unclassified rows so far — see pending proposals.'
                  : 'Paste a marking response below to start counting.'
              }
            />
          )}
        </CardContent>
      </Card>
      <Proposals errors={errors} />
      {anyPatterns && (
        <p className="text-xs leading-5 text-foreground-muted">
          {Object.entries(CLASS_MEANING)
            .map(([key, meaning]) => `${CLASS_LABEL[key as PatternClass]}: ${meaning}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
