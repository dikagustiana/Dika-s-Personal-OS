'use client';
import { useMemo } from 'react';
import { TIME_ZONE_CHOICES, formatHour, systemTimeZone } from '@/core/time/clock';
import { useUiStore, type HexGridMode } from '@/stores/uiStore';

const GRID_MODES: Array<{ value: HexGridMode; label: string }> = [
  { value: 'always', label: 'Always' },
  { value: 'exterior-only', label: 'Exterior only' },
  { value: 'never', label: 'Never' },
];

/** Developer controls: time scrubber, zone, grid mode, post toggles, frame rate. Shown behind the dev flag. */
export function DevPanel() {
  const s = useUiStore();
  const zones = useMemo(() => {
    const sys = systemTimeZone();
    return TIME_ZONE_CHOICES.includes(sys) ? TIME_ZONE_CHOICES : [sys, ...TIME_ZONE_CHOICES];
  }, []);
  const hour = s.timeMode === 'scrub' ? s.scrubHour : s.displayHour;

  return (
    <aside className="bc-panel absolute bottom-4 left-4 w-[340px] p-3 text-sm" aria-label="Developer controls">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">Time of day</span>
        <span className="font-mono text-xs text-ink-muted">{formatHour(hour)}</span>
      </div>
      <label className="block">
        <span className="sr-only">Hour of day</span>
        <input
          className="bc-range"
          type="range"
          min={0}
          max={24}
          step={0.01}
          value={hour}
          onChange={(e) => s.setScrubHour(Number(e.target.value))}
          aria-valuetext={formatHour(hour)}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="bc-seg" role="group" aria-label="Clock source">
          <button type="button" aria-pressed={s.timeMode === 'system'} onClick={() => s.setTimeMode('system')}>
            System time
          </button>
          <button type="button" aria-pressed={s.timeMode === 'scrub'} onClick={() => s.setTimeMode('scrub')}>
            Scrub
          </button>
        </div>
        <button
          type="button"
          className="rounded-panel border border-white/10 px-2.5 py-1 text-xs text-ink hover:border-accent"
          onClick={() => (s.sweep ? s.stopSweep() : s.startSweep(8000))}
        >
          {s.sweep ? 'Stop sweep' : 'Sweep 24 h'}
        </button>
      </div>
      <label className="mt-2 block text-xs text-ink-muted">
        Time zone
        <select
          className="mt-1 w-full rounded-panel border border-white/10 bg-transparent px-2 py-1 text-sm text-ink"
          value={s.timeZone}
          onChange={(e) => s.setTimeZone(e.target.value)}
        >
          {zones.map((z) => (
            <option key={z} value={z} className="bg-[#101420]">
              {z}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="mb-1 text-xs text-ink-muted">Hex grid</div>
        <div className="bc-seg" role="group" aria-label="Hex grid visibility">
          {GRID_MODES.map((m) => (
            <button key={m.value} type="button" aria-pressed={s.showHexGrid === m.value} onClick={() => s.setShowHexGrid(m.value)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex gap-4 border-t border-white/10 pt-3">
        <label className="bc-toggle">
          <input type="checkbox" checked={s.postEnabled} onChange={(e) => s.setPostEnabled(e.target.checked)} />
          Bloom + tone map
        </label>
        <label className="bc-toggle">
          <input type="checkbox" checked={s.aoEnabled} onChange={(e) => s.setAoEnabled(e.target.checked)} disabled={!s.postEnabled} />
          Ambient occlusion
        </label>
      </div>
      <label className="bc-toggle mt-2">
        <input type="checkbox" checked={s.greyPlaceholders} onChange={(e) => s.setGreyPlaceholders(e.target.checked)} />
        Show placeholders in grey
      </label>

      <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-white/10 pt-3 font-mono text-xs">
        <div>
          <dt className="text-ink-muted">fps</dt>
          <dd className={s.perf.fps >= 55 ? 'text-ok' : s.perf.fps >= 30 ? 'text-warn' : 'text-error'}>{s.perf.fps}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">ms</dt>
          <dd>{s.perf.frameMs}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">draws</dt>
          <dd>{s.perf.drawCalls}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">tris</dt>
          <dd>{(s.perf.triangles / 1000).toFixed(0)}k</dd>
        </div>
      </dl>
    </aside>
  );
}
