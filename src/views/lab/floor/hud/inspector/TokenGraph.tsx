import type { TokenSample } from '../../../../../logic/floor/events/reducer';

/** Token usage over the last samples as an SVG area sparkline. Re-renders only when the record changes. */
export function TokenGraph({ samples, width = 300, height = 44 }: { samples: TokenSample[]; width?: number; height?: number }) {
  if (samples.length < 2) {
    return (
      <div className="flex h-[44px] items-center text-xs text-foreground-muted" role="img" aria-label="Token usage: not enough samples yet">
        Token usage appears after a few updates.
      </div>
    );
  }
  const values = samples.map((s) => s.tokens);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 4 - ((v - min) / span) * (height - 8)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Token usage, latest ${last.toLocaleString()} tokens`} className="block">
      <path d={area} fill="rgba(55,210,198,0.14)" />
      <path d={line} fill="none" stroke="#37D2C6" strokeWidth={1.5} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill="#37D2C6" />
    </svg>
  );
}
