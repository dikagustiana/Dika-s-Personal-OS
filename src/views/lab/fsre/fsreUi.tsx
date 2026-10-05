/**
 * Small pieces every FSRE panel uses. A state is always glyph + word with a
 * tone (index.css maps the tone to a colour token); a badge never shows a
 * colour without both.
 */
import type { ReactNode } from 'react';
import type { Tone } from '../../../logic/lab/fsre/glyphs';
import { cn } from '../../../lib/utils';

export function Glyph({ glyph, tone }: { glyph: string; tone: Tone }) {
  return (
    <span aria-hidden="true" className="fsre-tone" data-tone={tone}>
      {glyph}
    </span>
  );
}

export function StatusBadge({ glyph, word, tone, className }: { glyph: string; word: string; tone: Tone; className?: string }) {
  return (
    <span className={cn('fsre-badge fsre-tone', className)} data-tone={tone}>
      <span aria-hidden="true">{glyph}</span>
      {word}
    </span>
  );
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="surface-label">{title}</h3>
      <div className="mt-2 text-sm">{children}</div>
    </section>
  );
}

export function FigureRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-1.5 last:border-b-0">
      <span className="text-foreground-secondary">{label}</span>
      <span className="text-right font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-foreground-muted">{children}</p>;
}

/** A row that selects something in the building: a real button, 44px tall. */
export function LinkRow({ onPress, label, children }: { onPress: () => void; label?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-2 text-left text-sm transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
    </button>
  );
}
