import { ArrowRight, FileQuestion } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { cn } from '../../../lib/utils';
import type { IeltsPractice, IeltsPracticeTopic, IeltsPrepSkill, IeltsTopic } from '../../../data/types';
import { aggregateWeakness, missRate } from '../../../logic/ielts/weakness';
import { STUB_SLUGS } from './methodPages';

/**
 * THE VIEW THAT JUSTIFIES THE WHOLE BUILD.
 *
 * A row reads "Matching Headings — 6 of 10 missed", and clicking it opens the
 * method for matching headings. Nothing else on this screen matters as much
 * as that click working, which is why the row IS the button rather than
 * carrying one: a link tucked at the end of a row is a smaller target and a
 * worse answer to "so what do I do about it".
 *
 * The ranking is shrunk, not raw — see logic/ielts/weakness.ts. The NUMBERS
 * SHOWN ARE ALWAYS RAW: "6 of 10", never the sort key, because the sort key
 * is a ranking device and would be a lie presented as a statistic.
 */

const SKILL_LABELS: Record<IeltsPrepSkill, string> = {
  listening: 'Listening',
  reading: 'Reading',
  writing: 'Writing',
  speaking: 'Speaking',
};

const SKILL_FILTERS: Array<{ id: IeltsPrepSkill | 'all'; label: string }> = [
  { id: 'all', label: 'All skills' },
  { id: 'listening', label: 'Listening' },
  { id: 'reading', label: 'Reading' },
  { id: 'writing', label: 'Writing' },
  { id: 'speaking', label: 'Speaking' },
];

export function Weakness({
  topics,
  practices,
  practiceTopics,
  onOpenMethod,
}: {
  topics: readonly IeltsTopic[];
  practices: readonly IeltsPractice[];
  practiceTopics: readonly IeltsPracticeTopic[];
  onOpenMethod: (slug: string) => void;
}) {
  const [skillFilter, setSkillFilter] = useState<IeltsPrepSkill | 'all'>('all');

  const ranked = useMemo(
    () => aggregateWeakness(topics, practices, practiceTopics),
    [topics, practices, practiceTopics],
  );

  const rows = useMemo(
    () => (skillFilter === 'all' ? ranked : ranked.filter((row) => row.topic.skill === skillFilter)),
    [ranked, skillFilter],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>What to work on</CardTitle>
        <span className="text-xs tabular-nums text-foreground-muted">
          {ranked.length} {ranked.length === 1 ? 'topic' : 'topics'} tagged
        </span>
      </CardHeader>
      <CardContent>
        {ranked.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1">
            {SKILL_FILTERS.map((filter) => {
              // A filter that narrows to nothing is worse than no filter: it
              // reads as "no weakness in speaking" when the truth is "nothing
              // logged for speaking". Only offer skills that have rows.
              const available =
                filter.id === 'all' || ranked.some((row) => row.topic.skill === filter.id);
              if (!available) return null;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setSkillFilter(filter.id)}
                  aria-pressed={skillFilter === filter.id}
                  className={cn(
                    'min-h-8 border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    skillFilter === filter.id
                      ? 'border-border bg-surface-2 text-foreground'
                      : 'border-border-subtle text-foreground-muted hover:text-foreground-secondary',
                  )}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground-muted">
            Nothing tagged yet. Log a practice session and tag what went wrong — this list ranks
            those tags and links each one to its method.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {rows.map((row) => {
              const rate = missRate(row);
              const isStub = STUB_SLUGS.has(row.topic.slug);
              return (
                <li key={row.topic.slug}>
                  <button
                    type="button"
                    onClick={() => onOpenMethod(row.topic.slug)}
                    className="group flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                        {row.topic.label}
                        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                          {SKILL_LABELS[row.topic.skill]}
                        </span>
                        {isStub && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                            <FileQuestion className="size-3" />
                            no method yet
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs tabular-nums text-foreground-muted">
                        {row.measurement === 'count' ? (
                          <>
                            {row.missed} of {row.attempted} missed
                            {' · '}
                            {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}
                          </>
                        ) : (
                          <>
                            severity {row.meanSeverity?.toFixed(1)} of 3
                            {' · '}
                            tagged {row.timesTagged}×
                            {' · '}
                            {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}
                          </>
                        )}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          'font-sans text-xl font-bold tabular-nums',
                          rate !== null && rate >= 0.5 ? 'text-escalate' : 'text-foreground',
                        )}
                      >
                        {rate !== null
                          ? `${Math.round(rate * 100)}%`
                          : row.meanSeverity !== null
                            ? row.meanSeverity.toFixed(1)
                            : '—'}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-foreground-muted">
                        {rate !== null ? 'missed' : 'severity'}
                      </p>
                    </div>

                    <ArrowRight className="size-4 shrink-0 text-foreground-muted transition-transform group-hover:translate-x-0.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
