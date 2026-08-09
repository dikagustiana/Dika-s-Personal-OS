import { ArrowRight, ClipboardList, FileQuestion } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { cn } from '../../../lib/utils';
import type { IeltsPractice, IeltsPracticeTopic, IeltsPrepSkill, IeltsTopic } from '../../../data/types';
import { aggregateWeakness, missRate, type ErrorBridgeResult, type WeaknessRow } from '../../../logic/ielts/weakness';
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
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE, AND WHY IT LIVES WHERE IT DOES
 * ---------------------------------------------------------------------------
 * Rows now arrive from two places. A row TAGGED by hand on the Log session tab
 * carries a measurement — a miss rate against a real denominator, or a rated
 * 1..3 severity. A row DERIVED from the error log carries only occurrences:
 * os_ielts_errors records that a mistake happened and never how many chances
 * there were to make it. Those are different claims and must not look alike.
 *
 * The signal is put in TWO places, neither of them a new colour:
 *
 *   1. THE UNIT LABEL under the big number. It already says "missed" or
 *      "severity"; a derived row says "logged". That is the one word the eye
 *      lands on anyway, so the distinction costs no extra weight and cannot
 *      be missed. A derived row shows "12×", never a percentage — there is no
 *      denominator to compute one from and an invented one would read exactly
 *      like a measured one.
 *
 *   2. A MUTED MARKER beside the skill tag, in the slot "no method yet"
 *      already uses, and ONLY on rows that carry error-log evidence. A badge
 *      on every row is not a badge, it is a column; marking the exception
 *      keeps the hand-tagged rows — the stronger evidence — unmarked and lets
 *      the derived ones stand out by contrast.
 *
 * Colour is deliberately NOT a channel here: the escalate colour on the number
 * means "half or more of what you attempted was wrong", which is a measured
 * claim. An occurrence count has no such threshold, so a derived number stays
 * at the default weight however large it is. Icon shape and the word carry it.
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

/** At most two names, then a count. Five mode names would wrap the subline. */
function modeSummary(modes: readonly string[]): string {
  if (modes.length <= 2) return modes.join(', ');
  return `${modes.slice(0, 2).join(', ')} +${modes.length - 2}`;
}

/** The number in the right-hand column, always raw and never invented. */
function headlineFigure(row: WeaknessRow): { value: string; unit: string; escalate: boolean } {
  const rate = missRate(row);
  if (rate !== null) {
    return { value: `${Math.round(rate * 100)}%`, unit: 'missed', escalate: rate >= 0.5 };
  }
  // A rated severity outranks a derived count on the same row: it is the
  // stronger evidence, and the derived figure still appears in the subline.
  if (row.meanSeverity !== null) {
    return { value: row.meanSeverity.toFixed(1), unit: 'severity', escalate: false };
  }
  if (row.occurrences > 0) {
    return { value: `${row.occurrences}×`, unit: 'logged', escalate: false };
  }
  return { value: '—', unit: 'severity', escalate: false };
}

export function Weakness({
  topics,
  practices,
  practiceTopics,
  bridge,
  onOpenMethod,
}: {
  topics: readonly IeltsTopic[];
  practices: readonly IeltsPractice[];
  practiceTopics: readonly IeltsPracticeTopic[];
  /**
   * Error-log evidence and the full account of what did not map. Optional so
   * the component still renders from hand tags alone if the errors read fails.
   */
  bridge?: ErrorBridgeResult;
  onOpenMethod: (slug: string) => void;
}) {
  const [skillFilter, setSkillFilter] = useState<IeltsPrepSkill | 'all'>('all');

  const ranked = useMemo(
    () => aggregateWeakness(topics, practices, practiceTopics, bridge?.evidence ?? []),
    [topics, practices, practiceTopics, bridge],
  );

  const rows = useMemo(
    () => (skillFilter === 'all' ? ranked : ranked.filter((row) => row.topic.skill === skillFilter)),
    [ranked, skillFilter],
  );

  // Everything the error log held that produced no row. Reported rather than
  // dropped: an unmapped occurrence is a fact about the taxonomy or the alias
  // table, and a weakness list that quietly swallowed it would be lying by
  // omission about how much evidence it actually used.
  const unaccounted = useMemo(() => {
    if (!bridge) return null;
    const u = bridge.unresolved;
    // Ordered by how actionable each one is: UNCLASSIFIED first because it is
    // the only one that asks him to change something (the taxonomy), and the
    // two data-shape ones last because they only ever mean a stray row.
    const parts: Array<[number, string]> = [
      [u.unclassified, 'unclassified'],
      [u.mode_unmapped, 'whole-paper pacing'],
      [u.question_type_missing, 'with no question type'],
      [u.question_type_unknown, 'with an unreadable question type'],
      [u.unknown_mode, 'with an unknown failure mode'],
      [u.unknown_skill, 'with an unknown skill'],
    ];
    const total = parts.reduce((sum, [count]) => sum + count, 0);
    if (total === 0) return null;
    return {
      total,
      detail: parts
        .filter(([count]) => count > 0)
        .map(([count, label]) => `${count} ${label}`)
        .join(', '),
    };
  }, [bridge]);

  const derivedCount = ranked.filter((row) => row.provenance !== 'tagged').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What to work on</CardTitle>
        <span className="text-xs tabular-nums text-foreground-muted">
          {ranked.length} {ranked.length === 1 ? 'topic' : 'topics'}
          {derivedCount > 0 && ` · ${derivedCount} from the error log`}
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
            Nothing tagged yet. Log a practice session and tag what went wrong, or paste marking
            feedback under Bands &amp; errors — this list ranks both and links each row to its
            method.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {rows.map((row) => {
              const isStub = STUB_SLUGS.has(row.topic.slug);
              const figure = headlineFigure(row);
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
                        {row.provenance !== 'tagged' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                            <ClipboardList className="size-3" />
                            {row.provenance === 'both' ? 'tagged + error log' : 'error log'}
                          </span>
                        )}
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
                        ) : row.timesTagged > 0 ? (
                          <>
                            severity {row.meanSeverity?.toFixed(1)} of 3
                            {' · '}
                            tagged {row.timesTagged}×
                            {' · '}
                            {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}
                          </>
                        ) : (
                          // Derived only. No severity is printed because none
                          // was ever rated, and no ratio because there is no
                          // denominator. Occurrences and their dates are the
                          // whole of what os_ielts_errors actually knows.
                          <>
                            {row.occurrences} logged
                            {' · '}
                            {row.errorSessions} marking{' '}
                            {row.errorSessions === 1 ? 'session' : 'sessions'}
                            {row.modes.length > 0 && <> · {modeSummary(row.modes)}</>}
                          </>
                        )}
                        {row.provenance === 'both' && (
                          <>
                            {' · '}plus {row.occurrences} logged
                          </>
                        )}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          'font-sans text-xl font-bold tabular-nums',
                          figure.escalate ? 'text-escalate' : 'text-foreground',
                        )}
                      >
                        {figure.value}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-foreground-muted">
                        {figure.unit}
                      </p>
                    </div>

                    <ArrowRight className="size-4 shrink-0 text-foreground-muted transition-transform group-hover:translate-x-0.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {unaccounted && (
          // Not a row and not clickable: these occurrences have no method page
          // to open, by decision rather than by oversight. UNCLASSIFIED rows in
          // particular are evidence about the TAXONOMY — the proposals they
          // carry are grouped under Bands & errors, which is where they get
          // acted on.
          <p className="mt-4 border-t border-border-subtle pt-3 text-xs text-foreground-muted">
            <span className="tabular-nums">{unaccounted.total}</span> logged{' '}
            {unaccounted.total === 1 ? 'error is' : 'errors are'} not ranked here —{' '}
            {unaccounted.detail}. None of them map to a method page; see Bands &amp; errors.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
