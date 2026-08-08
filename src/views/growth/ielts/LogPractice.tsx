import { Plus, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { cn } from '../../../lib/utils';
import type {
  IeltsBandConversion,
  IeltsPractice,
  IeltsPracticeWrite,
  IeltsPrepSkill,
  IeltsTopic,
} from '../../../data/types';
import { isValidPrepBand, lookupBand } from '../../../logic/ielts/bandConversion';
import { useMutation } from '../../../hooks/useMutation';
import { useAppStore } from '../../../store/appStore';

/**
 * LOG ONE PRACTICE ATTEMPT AND WHAT WENT WRONG IN IT.
 *
 * THE BAND FIELD IS THE INTERESTING PART. For listening and reading it is
 * derived from the raw score against os_ielts_band_conversion and shown
 * read-only — typing a band by hand for a skill that has a conversion table
 * is a chance to be wrong for no gain. But the published tables VARY BY TEST
 * VERSION, so an override is one click away, and taking it stops the derived
 * value from writing over what he entered. For writing and speaking there is
 * no table and no raw score, so the band is simply typed.
 *
 * TAGS ARE THE POINT OF THE FORM, not an optional extra: an attempt with no
 * tags counts as practice on the dashboard and informs no weakness ratio.
 * The two tables are written by one RPC so the pair cannot come apart.
 */

const SKILLS: Array<{ id: IeltsPrepSkill; label: string }> = [
  { id: 'listening', label: 'Listening' },
  { id: 'reading', label: 'Reading' },
  { id: 'writing', label: 'Writing' },
  { id: 'speaking', label: 'Speaking' },
];

const SEVERITY_LABELS: Record<number, string> = {
  1: 'Minor',
  2: 'Notable',
  3: 'Severe',
};

interface DraftTag {
  slug: string;
  attempted: string;
  missed: string;
  severity: number;
}

export function LogPractice({
  topics,
  bandConversion,
  onLogged,
}: {
  topics: readonly IeltsTopic[];
  bandConversion: readonly IeltsBandConversion[];
  onLogged: (practice: IeltsPractice) => void;
}) {
  const { run, isPending } = useMutation();
  const repository = useAppStore((state) => state.repository);

  const [skill, setSkill] = useState<IeltsPrepSkill>('reading');
  const [source, setSource] = useState('');
  const [attemptedOn, setAttemptedOn] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [timed, setTimed] = useState(true);
  const [rawScore, setRawScore] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [overrideBand, setOverrideBand] = useState(false);
  const [manualBand, setManualBand] = useState('');
  const [tags, setTags] = useState<DraftTag[]>([]);
  const [error, setError] = useState<string | null>(null);

  const countable = skill === 'listening' || skill === 'reading';

  // Only taggable topics for this skill: overview pages are reference prose,
  // and "your weakness is the Reading Overview" is not a diagnosis.
  const taggable = useMemo(
    () =>
      topics
        .filter((topic) => topic.skill === skill && topic.kind !== 'overview')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [topics, skill],
  );

  const derived = useMemo(
    () => lookupBand(skill, rawScore === '' ? undefined : Number(rawScore), bandConversion),
    [skill, rawScore, bandConversion],
  );

  // Writing and speaking always type a band. Listening and reading type one
  // only when overriding, or when the raw score is below the published range.
  const bandIsManual = !countable || overrideBand || derived.kind === 'below-published-range';
  const effectiveBand = bandIsManual
    ? manualBand === ''
      ? undefined
      : Number(manualBand)
    : derived.kind === 'derived'
      ? derived.band
      : undefined;

  const resetSkill = (next: IeltsPrepSkill) => {
    setSkill(next);
    // Tags belong to a skill's taxonomy; carrying them across would submit
    // reading question types against a speaking attempt, and the topic_slug
    // foreign key would happily accept it.
    setTags([]);
    setRawScore('');
    setOverrideBand(false);
    setManualBand('');
  };

  const addTag = (slug: string) => {
    if (!slug || tags.some((tag) => tag.slug === slug)) return;
    setTags((current) => [...current, { slug, attempted: '', missed: '', severity: 2 }]);
  };

  const patchTag = (slug: string, patch: Partial<DraftTag>) => {
    setTags((current) => current.map((tag) => (tag.slug === slug ? { ...tag, ...patch } : tag)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (source.trim() === '') {
      setError('Name the source — which book, test or mock this was.');
      return;
    }
    if (countable && rawScore !== '') {
      const value = Number(rawScore);
      if (!Number.isInteger(value) || value < 0 || value > 40) {
        setError('Raw score is out of 40.');
        return;
      }
    }
    if (effectiveBand !== undefined && !isValidPrepBand(effectiveBand)) {
      setError('Band must be 0–9 in 0.5 steps.');
      return;
    }
    for (const tag of tags) {
      if (countable) {
        const attempted = Number(tag.attempted);
        const missed = Number(tag.missed);
        if (tag.attempted === '' || !Number.isInteger(attempted) || attempted <= 0) {
          setError('Every tag needs how many questions of that type you faced.');
          return;
        }
        if (tag.missed === '' || !Number.isInteger(missed) || missed < 0 || missed > attempted) {
          setError('Missed must be a number between 0 and the number faced.');
          return;
        }
      }
    }

    setError(null);

    const write: IeltsPracticeWrite = {
      skill,
      source: source.trim(),
      attemptedOn,
      timed,
      rawScore: countable && rawScore !== '' ? Number(rawScore) : undefined,
      band: effectiveBand,
      durationMinutes: durationMinutes === '' ? undefined : Number(durationMinutes),
      notes: notes.trim() === '' ? undefined : notes.trim(),
      topics: tags.map((tag) =>
        countable
          ? { topicSlug: tag.slug, attempted: Number(tag.attempted), missed: Number(tag.missed) }
          : { topicSlug: tag.slug, severity: tag.severity },
      ),
    };

    const created = await run('Log IELTS practice', () => repository.createIeltsPractice(write));
    // Only clear once it is saved — a transient failure must not discard a
    // form this long. The date and skill stay: the next entry is usually the
    // same session's other half.
    if (!created) return;
    onLogged(created);
    setSource('');
    setRawScore('');
    setDurationMinutes('');
    setNotes('');
    setManualBand('');
    setOverrideBand(false);
    setTags([]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a practice session</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="surface-label">Skill</span>
              <select
                className="native-select mt-1"
                value={skill}
                onChange={(event) => resetSkill(event.target.value as IeltsPrepSkill)}
                aria-label="Skill"
              >
                {SKILLS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="surface-label">Date</span>
              <Input
                type="date"
                className="mt-1"
                value={attemptedOn}
                onChange={(event) => setAttemptedOn(event.target.value)}
                aria-label="Date attempted"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="surface-label">Source</span>
              <Input
                className="mt-1"
                value={source}
                placeholder="Cambridge 18 Test 2"
                onChange={(event) => setSource(event.target.value)}
                aria-label="Source"
              />
            </label>

            {countable && (
              <label className="block">
                <span className="surface-label">Raw score (of 40)</span>
                <Input
                  type="number"
                  min={0}
                  max={40}
                  step={1}
                  className="mt-1"
                  value={rawScore}
                  onChange={(event) => setRawScore(event.target.value)}
                  aria-label="Raw score"
                />
              </label>
            )}

            <label className="block">
              <span className="surface-label">Duration (minutes)</span>
              <Input
                type="number"
                min={1}
                className="mt-1"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
                aria-label="Duration in minutes"
              />
            </label>
          </div>

          {/* The band block. Derived and read-only by default for L/R. */}
          <div className="border border-border-subtle bg-surface-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="surface-label">Band</p>
                <p className="mt-1 font-sans text-2xl font-bold tabular-nums" data-testid="derived-band">
                  {effectiveBand !== undefined ? effectiveBand.toFixed(1) : '—'}
                </p>
              </div>

              {bandIsManual ? (
                <label className="block w-32">
                  <span className="surface-label">Enter band</span>
                  <Input
                    type="number"
                    min={0}
                    max={9}
                    step={0.5}
                    className="mt-1"
                    value={manualBand}
                    onChange={(event) => setManualBand(event.target.value)}
                    aria-label="Band"
                  />
                </label>
              ) : (
                <p className="max-w-xs text-xs leading-5 text-foreground-muted">
                  Derived from the raw score. The published tables vary slightly by test version —
                  override if you have the official key.
                </p>
              )}
            </div>

            {countable && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const next = !overrideBand;
                    setOverrideBand(next);
                    // Seed the manual field with what was derived, so
                    // overriding starts from the estimate rather than blank.
                    if (next && manualBand === '' && derived.kind === 'derived') {
                      setManualBand(String(derived.band));
                    }
                  }}
                  className="text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {overrideBand ? 'Use the derived band' : 'Override the band'}
                </button>
                {derived.kind === 'below-published-range' && !overrideBand && (
                  <span className="text-xs text-foreground-muted">
                    The published table stops at 10 correct — enter a band by hand.
                  </span>
                )}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground-secondary">
            <input
              type="checkbox"
              checked={timed}
              onChange={(event) => setTimed(event.target.checked)}
              className="size-4 accent-[hsl(var(--success))]"
            />
            Done under exam timing
          </label>

          {/* Tags — the reason the form exists. */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="surface-label">
                What went wrong {countable ? '(questions faced / missed)' : '(severity)'}
              </p>
              <select
                className="native-select w-auto max-w-full text-sm"
                value=""
                onChange={(event) => addTag(event.target.value)}
                aria-label="Add a topic tag"
              >
                <option value="">Add a topic…</option>
                {taggable
                  .filter((topic) => !tags.some((tag) => tag.slug === topic.slug))
                  .map((topic) => (
                    <option key={topic.slug} value={topic.slug}>
                      {topic.label}
                    </option>
                  ))}
              </select>
            </div>

            {tags.length === 0 ? (
              <p className="border border-dashed border-border-subtle px-3 py-4 text-center text-xs text-foreground-muted">
                No tags yet. An untagged session counts as practice and tells the weakness view
                nothing.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle border border-border-subtle">
                {tags.map((tag) => {
                  const topic = taggable.find((item) => item.slug === tag.slug);
                  return (
                    <li key={tag.slug} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {topic?.label ?? tag.slug}
                      </span>

                      {countable ? (
                        <>
                          <label className="flex items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-foreground-muted">
                              faced
                            </span>
                            <Input
                              type="number"
                              min={1}
                              className="h-9 w-16"
                              value={tag.attempted}
                              onChange={(event) => patchTag(tag.slug, { attempted: event.target.value })}
                              aria-label={`${topic?.label ?? tag.slug} questions faced`}
                            />
                          </label>
                          <label className="flex items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-foreground-muted">
                              missed
                            </span>
                            <Input
                              type="number"
                              min={0}
                              className="h-9 w-16"
                              value={tag.missed}
                              onChange={(event) => patchTag(tag.slug, { missed: event.target.value })}
                              aria-label={`${topic?.label ?? tag.slug} missed`}
                            />
                          </label>
                        </>
                      ) : (
                        <div className="flex gap-1">
                          {[1, 2, 3].map((level) => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => patchTag(tag.slug, { severity: level })}
                              aria-pressed={tag.severity === level}
                              className={cn(
                                'min-h-8 border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                tag.severity === level
                                  ? 'border-border bg-surface-3 text-foreground'
                                  : 'border-border-subtle text-foreground-muted hover:text-foreground-secondary',
                              )}
                            >
                              {SEVERITY_LABELS[level]}
                            </button>
                          ))}
                        </div>
                      )}

                      <Button
                        type="button"
                        variant="danger"
                        size="icon"
                        onClick={() => setTags((current) => current.filter((item) => item.slug !== tag.slug))}
                        aria-label={`Remove ${topic?.label ?? tag.slug}`}
                      >
                        <X className="size-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <label className="block">
            <span className="surface-label">Notes</span>
            <textarea
              className="mt-1 min-h-20 w-full rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-label="Notes"
            />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={isPending}>
            <Plus className="size-4" />
            {isPending ? 'Saving…' : 'Log session'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
