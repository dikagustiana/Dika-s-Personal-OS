import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { cn } from '../../../lib/utils';
import type {
  IeltsPractice,
  IeltsPracticeTopic,
  IeltsPrepConfig,
  IeltsPrepSkill,
  IeltsTopic,
} from '../../../data/types';
import {
  aggregateWeakness,
  bindingConstraint,
  daysUntil,
  loggedThisWeek,
  missRate,
  skillStandings,
  type ErrorBridgeResult,
} from '../../../logic/ielts/weakness';

/**
 * WHAT THE SCREEN SAYS ON OPENING.
 *
 * The headline is the BINDING CONSTRAINT — the skill furthest below its
 * per-skill floor — and not the average, deliberately. An overall 7.0 built
 * on a 5.5 in writing fails a 6.5 floor, and the average is exactly the
 * number that hides that. Admission is gated by the worst skill; so is this
 * card.
 *
 * A skill with no logged band is reported as UNKNOWN rather than quietly
 * omitted. The skill nobody practises is the one most likely to be the
 * constraint, and it is invisible precisely because it has no data.
 */

const SKILL_LABELS: Record<IeltsPrepSkill, string> = {
  listening: 'Listening',
  reading: 'Reading',
  writing: 'Writing',
  speaking: 'Speaking',
};

export function PrepDashboard({
  config,
  topics,
  practices,
  practiceTopics,
  bridge,
  onOpenMethod,
  onGoToWeakness,
}: {
  config: IeltsPrepConfig | null;
  topics: readonly IeltsTopic[];
  practices: readonly IeltsPractice[];
  practiceTopics: readonly IeltsPracticeTopic[];
  /**
   * The SAME error-log evidence the Weakness tab ranks. Passed here rather
   * than omitted because "See all" promises the same list: a dashboard top
   * three computed from one provenance and a full list computed from two
   * would disagree with nothing on screen to explain why.
   */
  bridge?: ErrorBridgeResult;
  onOpenMethod: (slug: string) => void;
  onGoToWeakness: () => void;
}) {
  const today = new Date();
  const days = config ? daysUntil(config.testDate, today) : null;
  const thisWeek = loggedThisWeek(practices, today);

  const standings = useMemo(
    () => skillStandings(practices, config?.targetFloor),
    [practices, config?.targetFloor],
  );
  const constraint = bindingConstraint(standings);
  const unknown = standings.filter((standing) => standing.latestBand === null);

  const topWeaknesses = useMemo(
    () => aggregateWeakness(topics, practices, practiceTopics, bridge?.evidence ?? []).slice(0, 3),
    [topics, practices, practiceTopics, bridge],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-px overflow-hidden border border-border-subtle bg-surface-2 sm:grid-cols-3">
        <div className="bg-card p-5">
          <p className="surface-label">Days to test</p>
          <p className="metric-hero mt-2 font-sans">
            {days === null ? '—' : days < 0 ? 'past' : days}
          </p>
          <p className="mt-1 text-xs text-foreground-muted">
            {config ? config.testDate : 'No test date set'}
          </p>
        </div>

        <div className="bg-card p-5">
          <p className="surface-label">Sessions this week</p>
          <p className="metric-hero mt-2 font-sans">{thisWeek}</p>
          <p className="mt-1 text-xs text-foreground-muted">rolling 7 days</p>
        </div>

        <div className="bg-card p-5">
          <p className="surface-label">Per-skill floor</p>
          <p className="metric-hero mt-2 font-sans">
            {config?.targetFloor !== undefined ? config.targetFloor.toFixed(1) : '—'}
          </p>
          <p className="mt-1 text-xs text-foreground-muted">
            {config?.targetOverall !== undefined
              ? `overall target ${config.targetOverall.toFixed(1)}`
              : 'no overall target'}
          </p>
        </div>
      </div>

      {/* The binding constraint, stated as a sentence rather than a figure. */}
      <Card>
        <CardHeader>
          <CardTitle>Binding constraint</CardTitle>
        </CardHeader>
        <CardContent>
          {constraint ? (
            <p className="text-sm leading-6 text-foreground-secondary">
              <span className="font-semibold text-foreground">
                {SKILL_LABELS[constraint.skill]}
              </span>{' '}
              is the skill furthest below the floor — latest band{' '}
              <span className="tabular-nums text-foreground">
                {constraint.latestBand?.toFixed(1)}
              </span>
              , which is{' '}
              <span className="tabular-nums text-escalate">
                {Math.abs(constraint.gapToFloor ?? 0).toFixed(1)}
              </span>{' '}
              below {config?.targetFloor?.toFixed(1)}. This is the one that gates the application,
              not the average.
            </p>
          ) : standings.every((standing) => standing.latestBand === null) ? (
            <p className="text-sm text-foreground-muted">
              No bands logged yet, so there is nothing to be constrained by. Log a session and this
              names the skill to work on.
            </p>
          ) : (
            <p className="text-sm leading-6 text-foreground-secondary">
              Every measured skill is at or above the floor.
              {unknown.length > 0 && (
                <>
                  {' '}
                  <span className="text-foreground-muted">
                    {unknown.map((standing) => SKILL_LABELS[standing.skill]).join(' and ')}{' '}
                    {unknown.length === 1 ? 'has' : 'have'} no logged band — unmeasured is not the
                    same as passing.
                  </span>
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest band per skill</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-px overflow-hidden border border-border-subtle bg-surface-2 sm:grid-cols-4">
            {standings.map((standing) => {
              const below = standing.gapToFloor !== null && standing.gapToFloor < 0;
              return (
                <div key={standing.skill} className="bg-card p-4">
                  <p className="font-sans text-2xl font-bold tabular-nums">
                    {standing.latestBand !== null ? standing.latestBand.toFixed(1) : '—'}
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                    {SKILL_LABELS[standing.skill]}
                  </p>
                  <p
                    className={cn(
                      'mt-1 text-xs tabular-nums',
                      standing.latestBand === null
                        ? 'text-foreground-muted'
                        : below
                          ? 'text-escalate'
                          : 'text-success',
                    )}
                  >
                    {standing.latestBand === null
                      ? 'not measured'
                      : standing.gapToFloor === null
                        ? '—'
                        : below
                          ? `${standing.gapToFloor.toFixed(1)} to floor`
                          : 'at/above floor'}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top weaknesses</CardTitle>
          <button
            type="button"
            onClick={onGoToWeakness}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            See all
            <ArrowRight className="size-3" />
          </button>
        </CardHeader>
        <CardContent>
          {topWeaknesses.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground-muted">
              Nothing tagged yet.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {topWeaknesses.map((row) => {
                const rate = missRate(row);
                return (
                  <li key={row.topic.slug}>
                    <button
                      type="button"
                      onClick={() => onOpenMethod(row.topic.slug)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {row.topic.label}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-foreground-muted">
                        {/* "logged" is the provenance signal at this density.
                            A derived row has no rated severity to print and no
                            denominator to make a ratio from, and printing
                            "severity undefined" is what happens if this falls
                            through to the severity branch. One extra word does
                            the whole job; an icon here would be noise in a
                            three-row summary. */}
                        {rate !== null
                          ? `${row.missed} of ${row.attempted}`
                          : row.meanSeverity !== null
                            ? `severity ${row.meanSeverity.toFixed(1)}`
                            : `${row.occurrences} logged`}
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-foreground-muted" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
