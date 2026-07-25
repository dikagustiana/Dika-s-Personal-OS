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
// full IELTS view and the dashboard preview so both read identically. The
// values live in index.css (--chart-1…4).
export const IELTS_SKILL_COLORS: Record<string, string> = {
  listening: 'hsl(var(--chart-1))',
  reading: 'hsl(var(--chart-2))',
  writing: 'hsl(var(--chart-3))',
  speaking: 'hsl(var(--chart-4))',
};

// Colour alone is not enough here. On white, --chart-3 (#9A5200) and
// --chart-4 (#00728F) are only 1.06:1 apart in luminance — near-identical
// brightness — so anyone who cannot separate those two hues gets two lines
// that look the same. Every skill therefore also carries its own dash
// pattern, and the four are distinguishable in greyscale.
export const IELTS_SKILL_DASH: Record<string, string | undefined> = {
  listening: undefined, // solid
  reading: '6 3', // long dash
  writing: '2 3', // dotted
  speaking: '9 3 2 3', // dash-dot
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
                background: 'hsl(var(--surface-2))',
                border: '1px solid hsl(var(--border))',
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
              strokeDasharray={IELTS_SKILL_DASH[skill.key]}
              dot={false}
              isAnimationActive={false}
            />
          ))}
          <Line
            type="monotone"
            dataKey="overall"
            name="Overall"
            stroke="hsl(var(--success))"
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
