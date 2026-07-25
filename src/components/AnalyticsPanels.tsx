import { eachDayOfInterval, format, parseISO, startOfISOWeek } from 'date-fns';
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
import type { DailyLog } from '../data/types';
import { buildContributionDays } from '../logic/contribution';

const bucketColors = [
  'hsl(var(--muted) / 0.55)',
  'hsl(var(--primary) / 0.25)',
  'hsl(var(--primary) / 0.45)',
  'hsl(var(--primary) / 0.7)',
  'hsl(var(--primary))',
];

/** 30-day habit-consistency grid, one cell per day. */
export function ContributionGraph({ logs, today }: { logs: DailyLog[]; today: Date }) {
  const contributions = buildContributionDays(logs, today, 30);
  return (
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
      <div className="mt-4 flex items-center justify-end gap-2 text-[10px] text-foreground-muted">
        <span>Less</span>
        {bucketColors.map((color) => (
          <span key={color} className="size-3 border border-black/20" style={{ backgroundColor: color }} />
        ))}
        <span>More</span>
      </div>
    </>
  );
}

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
    <div className="border border-border bg-card px-3 py-2 text-xs">
      <p className="font-semibold text-foreground">{item.day} · {item.score}</p>
      <p className="mt-1 text-foreground-muted">{format(parseISO(item.date), 'MMM d')}</p>
    </div>
  );
}

/** Current ISO week's daily-score bars, Mon–Sun. */
export function WeeklyScoreChart({ logs, today }: { logs: DailyLog[]; today: Date }) {
  const weekStart = startOfISOWeek(today);
  const weekDays = eachDayOfInterval({
    start: weekStart,
    end: new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000),
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

  return (
    <div className="h-64 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={weeklyScores} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
          <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground) / 0.8)', fontSize: 10 }} />
          <Tooltip content={<ScoreTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
          <Bar dataKey="score" radius={0} maxBarSize={38}>
            {weeklyScores.map((item) => (
              <Cell
                key={item.date}
                fill={item.hasLog ? 'hsl(var(--primary) / 0.85)' : 'hsl(var(--muted))'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
