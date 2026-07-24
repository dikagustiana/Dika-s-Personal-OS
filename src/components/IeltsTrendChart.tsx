import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import type { IeltsResult } from '../data/types';
import { IELTS_SKILLS, IELTS_TARGET, overallBand } from '../logic/ielts';

// The one place multiple line hues are allowed, for legibility. Shared by the
// full IELTS view and the dashboard preview so both read identically.
export const IELTS_SKILL_COLORS: Record<string, string> = {
  listening: '#60a5fa',
  reading: '#c084fc',
  writing: '#f59e0b',
  speaking: '#f472b6',
};

/**
 * The four-skill + overall-average trend, Y-axis fixed 5.0–8.0 with a dashed
 * target line at 7.0. `compact` drops the axis furniture for the dashboard
 * preview. Read-only — no add-form here.
 */
export function IeltsTrendChart({
  results,
  compact = false,
}: {
  results: IeltsResult[];
  compact?: boolean;
}) {
  const data = [...results]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((result) => ({
      date: format(new Date(result.date), 'MMM d'),
      listening: result.listening,
      reading: result.reading,
      writing: result.writing,
      speaking: result.speaking,
      overall: overallBand(result),
      target: IELTS_TARGET,
    }));

  return (
    <div className={compact ? 'h-44 min-w-0' : 'h-72 min-w-0'}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 8, left: compact ? -28 : -20, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: compact ? 9 : 11 }}
            hide={compact}
          />
          <YAxis
            domain={[5, 8]}
            ticks={[5, 6, 7, 8]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground) / 0.8)', fontSize: compact ? 9 : 10 }}
          />
          {!compact && (
            <Tooltip
              contentStyle={{
                background: 'hsl(215 25% 16%)',
                border: '1px solid hsl(215 20% 22%)',
                fontSize: 12,
              }}
            />
          )}
          {IELTS_SKILLS.map((skill) => (
            <Line
              key={skill.key}
              type="monotone"
              dataKey={skill.key}
              name={skill.label}
              stroke={IELTS_SKILL_COLORS[skill.key]}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
          <Line
            type="monotone"
            dataKey="overall"
            name="Overall"
            stroke="hsl(var(--primary))"
            strokeWidth={3}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="target"
            name="Target 7.0"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
