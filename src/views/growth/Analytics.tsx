import {
  Activity,
  CalendarDays,
  Flame,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  eachDayOfInterval,
  format,
  parseISO,
  startOfISOWeek,
  subDays,
} from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import type { DailyLog } from '../../data/types';
import { buildContributionDays } from '../../logic/contribution';
import { useAppStore } from '../../store/appStore';

const bucketColors = ['#1b1f1c', '#293b31', '#365242', '#476b55', '#668b72'];

interface TooltipPayload {
  value: number;
  payload: { day: string; score: number; date: string };
}

function ScoreTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.[0]) return null;
  const item = payload[0].payload;
  return (
    <div className="border border-gray-700 bg-[#101311] px-3 py-2 text-xs">
      <p className="font-semibold text-gray-200">{item.day} · {item.score}</p>
      <p className="mt-1 text-gray-600">{format(parseISO(item.date), 'MMM d')}</p>
    </div>
  );
}

export function Analytics() {
  const repository = useAppStore((state) => state.repository);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const today = new Date();
  const todayKey = format(today, 'yyyy-MM-dd');

  const load = useCallback(async () => {
    const data = await repository.listDailyLogs({
      from: format(subDays(today, 29), 'yyyy-MM-dd'),
      to: todayKey,
    });
    setLogs(data);
  }, [repository, todayKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const contributions = useMemo(
    () => buildContributionDays(logs, today, 30),
    [logs, todayKey],
  );
  const activeDays = contributions.filter((day) => day.consistency !== null).length;
  const averageConsistency = useMemo(() => {
    const values = contributions
      .map((day) => day.consistency)
      .filter((value): value is number => value !== null);
    return values.length
      ? Math.round((100 * values.reduce((sum, value) => sum + value, 0)) / values.length)
      : 0;
  }, [contributions]);

  const weekDays = eachDayOfInterval({
    start: startOfISOWeek(today),
    end: new Date(startOfISOWeek(today).getTime() + 6 * 24 * 60 * 60 * 1000),
  });
  const logByDate = new Map(logs.map((log) => [log.date, log]));
  const weeklyScores = weekDays.map((date) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    return {
      date: dateKey,
      day: format(date, 'EEE'),
      score: logByDate.get(dateKey)?.score ?? 0,
      hasLog: logByDate.has(dateKey),
    };
  });
  const bestScore = logs.length ? Math.max(...logs.map((log) => log.score)) : 0;

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-gray-800 pb-7">
        <p className="page-kicker">Growth / Analytics</p>
        <h1 className="page-title">Evidence of effort</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
          A quiet record of consistency—not a leaderboard, and never a verdict.
        </p>
      </header>

      <div className="mb-5 grid gap-px overflow-hidden border border-gray-800 bg-gray-800 sm:grid-cols-3">
        <div className="bg-card p-5">
          <Flame className="size-4 text-gold" />
          <p className="mt-4 text-3xl font-bold tabular-nums">{activeDays}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">Days with data</p>
        </div>
        <div className="bg-card p-5">
          <Activity className="size-4 text-primary" />
          <p className="mt-4 text-3xl font-bold tabular-nums">{averageConsistency}%</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">Habit consistency</p>
        </div>
        <div className="bg-card p-5">
          <TrendingUp className="size-4 text-primary" />
          <p className="mt-4 text-3xl font-bold tabular-nums">{bestScore}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">Best daily score</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Habit consistency</CardTitle>
              <p className="mt-2 text-sm text-gray-600">Last 30 days · one cell per day</p>
            </div>
            <CalendarDays className="size-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            {activeDays === 0 ? (
              <div className="grid min-h-52 place-items-center border border-dashed border-gray-800 text-center">
                <div>
                  <Flame className="mx-auto size-6 text-gray-700" />
                  <p className="mt-3 font-semibold text-gray-400">Building your streak</p>
                  <p className="mt-1 text-sm text-gray-600">Complete one habit to light the first cell.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto pb-2">
                  <div
                    className="grid w-max grid-flow-col gap-2"
                    style={{ gridTemplateRows: 'repeat(7, minmax(0, 1fr))' }}
                    aria-label="30-day habit contribution graph"
                  >
                    {contributions.map((day) => (
                      <div
                        key={day.date}
                        className="size-7 rounded-sm border border-black/20 sm:size-8"
                        style={{ backgroundColor: bucketColors[day.bucket] }}
                        title={`${format(parseISO(day.date), 'MMM d')}: ${
                          day.consistency === null
                            ? 'No data'
                            : `${Math.round(day.consistency * 100)}%`
                        }`}
                        aria-label={`${day.date}: ${
                          day.consistency === null
                            ? 'no data'
                            : `${Math.round(day.consistency * 100)} percent`
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-end gap-2 text-[10px] text-gray-600">
                  <span>Less</span>
                  {bucketColors.map((color) => (
                    <span
                      key={color}
                      className="size-3 border border-black/20"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <span>More</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Daily score</CardTitle>
              <p className="mt-2 text-sm text-gray-600">Current ISO week · Mon–Sun</p>
            </div>
            <TrendingUp className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="h-64 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyScores} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                  <CartesianGrid stroke="#242925" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#707772', fontSize: 11 }} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#555c57', fontSize: 10 }} />
                  <Tooltip content={<ScoreTooltip />} cursor={{ fill: '#1c211d' }} />
                  <Bar dataKey="score" radius={0} maxBarSize={38}>
                    {weeklyScores.map((item) => (
                      <Cell
                        key={item.date}
                        fill={item.hasLog ? '#567563' : '#202421'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
