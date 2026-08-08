import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { format } from 'date-fns';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { IELTS_SKILL_COLORS, IELTS_SKILL_DASH } from '../../components/IeltsTrendChart';
import { ErrorLogPaste } from '../../components/ielts/ErrorLogPaste';
import { ErrorPatterns } from '../../components/ielts/ErrorPatterns';
import type { IeltsError, IeltsResult, IeltsSession } from '../../data/types';
import {
  formatBand,
  IELTS_SKILLS,
  IELTS_TARGET,
  isValidBand,
  overallBand,
  type IeltsSkill,
} from '../../logic/ielts';
import { cn } from '../../lib/utils';
import { useMutation } from '../../hooks/useMutation';
import { useAppStore } from '../../store/appStore';

// The one place multiple line hues are allowed, for legibility. Overall uses
// the emerald primary; the target line is a dashed neutral. Shared with the
// dashboard preview so both charts read identically.
const skillColors: Record<IeltsSkill, string> = IELTS_SKILL_COLORS as Record<IeltsSkill, string>;
const skillDash = IELTS_SKILL_DASH as Record<IeltsSkill, string | undefined>;

const emptyForm = { date: format(new Date(), 'yyyy-MM-dd'), listening: '', reading: '', writing: '', speaking: '' };

function delta(current: number, previous: number | undefined): string | null {
  if (previous === undefined) return null;
  const diff = current - previous;
  if (diff === 0) return '±0';
  return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`;
}

/**
 * `embedded` is set when this renders as a tab of IeltsArea rather than as the
 * whole route. It drops the page shell and demotes the title to an <h2>,
 * because the area already owns the page-shell padding and the one <h1> the
 * page is allowed. Nothing else about the view changes.
 */
export function Ielts({ embedded = false }: { embedded?: boolean } = {}) {
  const repository = useAppStore((state) => state.repository);
  const { run } = useMutation();
  const [results, setResults] = useState<IeltsResult[]>([]);
  const [errors, setErrors] = useState<IeltsError[]>([]);
  const [sessions, setSessions] = useState<IeltsSession[]>([]);
  const [form, setForm] = useState<Record<string, string>>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [resultRows, errorRows, sessionRows] = await Promise.all([
      repository.listIeltsResults(),
      repository.listIeltsErrors(),
      repository.listIeltsSessions(),
    ]);
    setResults(resultRows);
    setErrors(errorRows);
    setSessions(sessionRows);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ascending for the chart; descending for the table.
  const ascending = useMemo(
    () => [...results].sort((a, b) => a.date.localeCompare(b.date)),
    [results],
  );
  const descending = useMemo(() => [...ascending].reverse(), [ascending]);
  const latest = descending[0];
  const previous = descending[1];

  const chartData = ascending.map((result) => ({
    date: format(new Date(result.date), 'MMM d'),
    listening: result.listening,
    reading: result.reading,
    writing: result.writing,
    speaking: result.speaking,
    overall: overallBand(result),
    target: IELTS_TARGET,
  }));

  const formAverage = useMemo(() => {
    const nums = IELTS_SKILLS.map((skill) => Number(form[skill.key]));
    if (nums.some((n) => !isValidBand(n))) return null;
    return overallBand({
      listening: nums[0],
      reading: nums[1],
      writing: nums[2],
      speaking: nums[3],
    });
  }, [form]);

  const addResult = async (event: FormEvent) => {
    event.preventDefault();
    const nums = IELTS_SKILLS.map((skill) => Number(form[skill.key]));
    if (!form.date || nums.some((n) => !isValidBand(n))) {
      setError('Enter a date and four bands (0–9 in 0.5 steps).');
      return;
    }
    setError(null);
    const created = await run('Add IELTS result', () =>
      repository.createIeltsResult({
        date: form.date,
        listening: nums[0],
        reading: nums[1],
        writing: nums[2],
        speaking: nums[3],
      }),
    );
    // Four bands are tedious to retype — only clear them once they are saved.
    if (!created) return;
    setResults((current) => [...current, created]);
    setForm({ ...emptyForm, date: form.date });
  };

  const remove = async (id: string) => {
    const result = await run('Delete IELTS result', async () => {
      await repository.deleteIeltsResult(id);
      return true as const;
    });
    if (!result) return;
    setResults((current) => current.filter((item) => item.id !== id));
  };

  const overall = latest ? overallBand(latest) : null;
  const gap = overall !== null ? overall - IELTS_TARGET : null;

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggleLine = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const lines: Array<{ key: string; label: string; color: string; dash?: string; width: number }> = [
    ...IELTS_SKILLS.map((skill) => ({
      key: skill.key,
      label: skill.label,
      color: skillColors[skill.key],
      dash: skillDash[skill.key],
      width: 1.5,
    })),
    { key: 'overall', label: 'Overall', color: 'hsl(var(--success))', width: 3 },
    { key: 'target', label: 'Target 7.0', color: 'hsl(var(--muted-foreground))', dash: '4 4', width: 1.5 },
  ];

  return (
    <div className={embedded ? '' : 'page-shell'}>
      <header className="mb-7 border-b border-border-subtle pb-7 md:flex md:items-end md:justify-between">
        <div>
          {!embedded && <p className="page-kicker">Growth / IELTS</p>}
          {embedded ? (
            <h2 className="page-title">Practice band</h2>
          ) : (
            <h1 className="page-title">Practice band</h1>
          )}
          <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-muted">
            Every mock result, tracked toward the target overall band.
          </p>
        </div>
        <div className="mt-5 flex items-end gap-4 md:mt-0">
          <div>
            <p className="surface-label">Latest overall</p>
            <p className="metric-hero font-sans text-foreground">
              {overall !== null ? formatBand(overall) : '—'}
            </p>
          </div>
          <div className="pb-1 text-sm text-foreground-muted">
            <p>Target {formatBand(IELTS_TARGET)}</p>
            {gap !== null && (
              <p className={cn('tabular-nums', gap >= 0 ? 'text-success' : 'text-escalate')}>
                {gap >= 0 ? 'at/above' : `${formatBand(Math.abs(gap))} to go`}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="mb-5 grid gap-px overflow-hidden border border-border-subtle bg-surface-2 sm:grid-cols-4">
        {IELTS_SKILLS.map((skill) => {
          const d = latest ? delta(latest[skill.key], previous?.[skill.key]) : null;
          return (
            <div key={skill.key} className="bg-card p-5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: skillColors[skill.key] }} />
              <p className="mt-3 font-sans text-3xl font-bold tabular-nums">
                {latest ? formatBand(latest[skill.key]) : '—'}
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                {skill.label}
                {d && <span className="ml-2 text-foreground-muted">{d}</span>}
              </p>
            </div>
          );
        })}
      </div>

      {/* CLASSIFICATION ABOVE THE PASTE BOX, and both above the chart and the
          result form. The question this screen answers on opening is what
          should I work on — "Reading 6.5" is a fact, "you dropped the Task 1
          overview in 4 of 6 attempts" is actionable tomorrow. */}
      <div className="mb-5 space-y-5">
        <ErrorPatterns errors={errors} sessions={sessions} />
        <ErrorLogPaste
          onCommitted={(rows) => setErrors((current) => [...current, ...rows])}
          onSessions={(rows) => setSessions((current) => [...current, ...rows])}
        />
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <div className="flex flex-wrap gap-2">
            {lines.map((line) => (
              <button
                key={line.key}
                onClick={() => toggleLine(line.key)}
                className={cn(
                  'flex items-center gap-1.5 border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-opacity',
                  hidden.has(line.key) ? 'border-border-subtle text-foreground-muted opacity-50' : 'border-border text-foreground-secondary',
                )}
              >
                {/* The swatch draws the line's real dash pattern, not a dot:
                    two of the four skill hues are near-identical in
                    brightness, so the pattern is what tells them apart and
                    the legend has to show the same thing the chart does. */}
                <svg width="18" height="8" aria-hidden className="shrink-0 overflow-visible">
                  <line
                    x1="0"
                    y1="4"
                    x2="18"
                    y2="4"
                    stroke={line.color}
                    strokeWidth={line.width}
                    strokeDasharray={line.dash}
                  />
                </svg>
                {line.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                <YAxis
                  domain={[5, 8]}
                  ticks={[5, 5.5, 6, 6.5, 7, 7.5, 8]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground) / 0.8)', fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--surface-2))',
                    border: '1px solid hsl(var(--border))',
                    fontSize: 12,
                  }}
                />
                {lines
                  .filter((line) => !hidden.has(line.key))
                  .map((line) => (
                    <Line
                      key={line.key}
                      type="monotone"
                      dataKey={line.key}
                      name={line.label}
                      stroke={line.color}
                      strokeWidth={line.width}
                      strokeDasharray={line.dash}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* min-w-0 on both cards, not decoration: a grid item defaults to
          min-width:auto, so the History card's min-w-[420px] table set the
          single-column track to 460px and pushed the whole page into
          horizontal scroll below 460px wide. With the floor removed the track
          fits the viewport and the table scrolls inside its own
          overflow-x-auto, which is what that wrapper is for. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Add a result</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addResult} className="space-y-3">
              <label className="block">
                <span className="surface-label">Date</span>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((f) => ({ ...f, date: event.target.value }))}
                  className="mt-1"
                  aria-label="Result date"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                {IELTS_SKILLS.map((skill) => (
                  <label key={skill.key} className="block">
                    <span className="surface-label">{skill.label}</span>
                    <Input
                      type="number"
                      min={0}
                      max={9}
                      step={0.5}
                      value={form[skill.key]}
                      onChange={(event) =>
                        setForm((f) => ({ ...f, [skill.key]: event.target.value }))
                      }
                      className="mt-1"
                      aria-label={skill.label}
                    />
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between border border-border-subtle bg-surface-2 px-3 py-2">
                <span className="surface-label">Overall (auto)</span>
                <span className="font-sans text-lg font-bold tabular-nums text-foreground-muted">
                  {formAverage !== null ? formatBand(formAverage) : '—'}
                </span>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full">
                <Plus className="size-4" />
                Add result
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>History</CardTitle>
            <span className="text-xs tabular-nums text-foreground-muted">{results.length} results</span>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-foreground-muted">
                    <th className="pb-2 font-bold">Date</th>
                    <th className="pb-2 text-center font-bold">L</th>
                    <th className="pb-2 text-center font-bold">R</th>
                    <th className="pb-2 text-center font-bold">W</th>
                    <th className="pb-2 text-center font-bold">S</th>
                    <th className="pb-2 text-center font-bold text-foreground">Overall</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {descending.map((result) => (
                    <tr key={result.id} className="tabular-nums text-foreground-secondary">
                      <td className="py-2 text-xs">{result.date}</td>
                      <td className="py-2 text-center">{formatBand(result.listening)}</td>
                      <td className="py-2 text-center">{formatBand(result.reading)}</td>
                      <td className="py-2 text-center">{formatBand(result.writing)}</td>
                      <td className="py-2 text-center">{formatBand(result.speaking)}</td>
                      <td className="py-2 text-center font-bold text-foreground">
                        {formatBand(overallBand(result))}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="danger"
                          size="icon"
                          onClick={() => void remove(result.id)}
                          aria-label={`Delete result from ${result.date}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-foreground-muted">
                        No results yet. Add your first mock above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
